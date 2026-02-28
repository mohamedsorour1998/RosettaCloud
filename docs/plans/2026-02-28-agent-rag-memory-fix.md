# Agent RAG + Memory Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two agent bugs — (1) tutor agent can't look up specific questions because it lacks the right tools and context, and (2) conversation history is lost between messages because each request creates a fresh Agent with no prior state.

**Architecture:**
- Frontend enriches every chat message with `module_uuid` + `lesson_uuid` so the agent knows the student's current course context.
- Agent's `invoke()` passes this context in the message text so the tutor can call `get_question_details`.
- AgentCore Runtime (long-lived container) caches conversation history in a per-session-id dict so each new Agent instance starts with prior messages.

**Tech Stack:** Angular 19 (TypeScript), Python 3.12, Strands Agent, AWS Bedrock AgentCore, LanceDB, DynamoDB, S3

---

## Background / Root Cause Analysis

### Issue 1: RAG / Tools Not Triggered

The student asks "how to solve question number 3?" and the tutor agent says "I need more information."

**Why?**
1. The tutor toolset is `[search_knowledge_base]` only — it has **no** `get_question_details` tool.
2. The frontend sends only `{ session_id, prompt, user_id, type }` in chat messages — no `module_uuid` or `lesson_uuid`.
3. Without the module/lesson, even if the tutor had `get_question_details`, it couldn't call it (requires `module_uuid`, `lesson_uuid`, `question_number`).
4. `search_knowledge_base` searches by semantic vector similarity — "question 3" doesn't map to useful results.

**Fix:**
- Frontend: include `module_uuid` + `lesson_uuid` in all WebSocket messages.
- Agent `invoke()`: add these to the context string passed to the agent.
- Tutor tools: add `get_question_details` and `get_question_metadata`.
- Tutor prompt: instruct explicitly to call `get_question_details` when student asks about a specific question number.

### Issue 2: Memory Within Same Session

The student asks "what was my question?" and the agent says "I don't have access to previous questions in this conversation."

**Why?**
- `_create_agent()` creates a brand-new `Agent(...)` object on every single request.
- The `AgentCoreMemorySessionManager` is supposed to save/load history to the external AgentCore Memory store — but it appears to fail silently (no error logged, but no history loaded).
- A fresh `Agent` with no `messages` history = no memory of prior turns.

**Fix:**
- Add a global `_session_histories: dict[str, list]` in the AgentCore Runtime container.
- The container is long-lived (runs as a server process between invocations). Global dicts persist.
- On each request: load history from the dict, pass to agent as `messages`.
- After each response: save the agent's updated `messages` back to the dict.
- Keep `AgentCoreMemorySessionManager` for long-term cross-session memory — but rely on the in-process dict for reliable within-session continuity.

### Issue 3: WebSocket Architecture
The sync approach is correct. `invoke_agent_runtime` is synchronous — AgentCore Runtime returns the full response as one blob. The demo repo (`sample-logistics-agent-agentcore-runtime`) also uses sync invocation. No streaming supported. **No change needed.**

### Issue 4: Redis
Redis is still used by `Backend/app/backends/questions_backends.py` to cache parsed questions from S3. **Keep Redis** — removing it would break question loading.

---

## Task 1: Frontend — Send module/lesson context in all chat messages

**Files:**
- Modify: `Frontend/src/app/services/chatbot.service.ts`

**Context:**
The service already has `setUserId(userId)`. We add `setLabContext(moduleUuid, lessonUuid)` so components can pass the student's current lab context. All outgoing messages include these fields.

**Step 1: Add the context fields and setter to ChatbotService**

In `chatbot.service.ts`, find this block:
```typescript
private userId = '';

public setUserId(userId: string): void {
  this.userId = userId;
}
```

Replace with:
```typescript
private userId = '';
private moduleUuid = '';
private lessonUuid = '';

public setUserId(userId: string): void {
  this.userId = userId;
}

public setLabContext(moduleUuid: string, lessonUuid: string): void {
  this.moduleUuid = moduleUuid;
  this.lessonUuid = lessonUuid;
}
```

**Step 2: Include module/lesson in sendActualMessage**

Find the `request` object in `sendActualMessage`:
```typescript
const request = {
  session_id: this.sessionId,
  prompt: message,
  user_id: this.userId,
  type: 'chat',
};
```

Replace with:
```typescript
const request = {
  session_id: this.sessionId,
  prompt: message,
  user_id: this.userId,
  type: 'chat',
  module_uuid: this.moduleUuid,
  lesson_uuid: this.lessonUuid,
};
```

**Step 3: Also include in sendGradeMessage** (already has module_uuid/lesson_uuid but ensure they use the stored values as fallback)

Find in `sendGradeMessage`:
```typescript
const request = {
  session_id: this.sessionId,
  user_id: this.userId,
  type: 'grade',
  module_uuid: moduleUuid,
  lesson_uuid: lessonUuid,
  question_number: questionNumber,
  result: result,
};
```
This is already correct (uses parameters) — no change needed.

**Step 4: Find and update the component(s) that initialize the chatbot**

Search for `setUserId` in the codebase to find where it's called. That same component should also call `setLabContext`. The lab component knows the current module/lesson.

Run: `grep -r "setUserId" Frontend/src/ --include="*.ts" -l`

For each file found, check if the component has access to `module_uuid` and `lesson_uuid`. If so, add:
```typescript
this.chatbotService.setLabContext(this.moduleUuid, this.lessonUuid);
```
right after the `setUserId` call.

**Step 5: Build to verify no TypeScript errors**

```bash
cd Frontend
ng build --configuration=development 2>&1 | tail -20
```
Expected: `Build at: ... - Hash: ... - Time: ...ms` (no errors)

**Step 6: Commit**
```bash
git add Frontend/src/app/services/chatbot.service.ts
git add Frontend/src/  # any component files changed
git commit -m "feat: send module/lesson context in all chatbot messages"
```

---

## Task 2: Agent — Fix in-process conversation history

**Files:**
- Modify: `Backend/agents/agent.py`

**Context:**
The AgentCore Runtime is a long-running container (server process). Global Python variables persist between requests. We use a `dict[str, list]` to store per-session conversation history. The Strands `Agent` class accepts a `messages` parameter to pre-populate conversation history.

**Step 1: Add session history dict to agent.py**

After the existing globals block at the top of `agent.py`:
```python
# ── Lazy-initialized globals ──
_model = None
_bedrock = None
_init_error = None
```

Add:
```python
# ── In-process session history (survives across requests within same container) ──
_session_histories: dict = {}  # session_id -> list of Strands message dicts
MAX_HISTORY_TURNS = 20  # keep last 20 turns (40 messages) to avoid runaway context
```

**Step 2: Update _create_agent to accept and use history**

Find:
```python
def _create_agent(agent_name: str, user_id: str = "", session_id: str = "") -> Agent:
    """Create a fresh Agent instance for this request."""
    prompt, tools = AGENT_CONFIGS[agent_name]
    kwargs = {
        "model": _model,
        "system_prompt": prompt,
        "tools": tools,
        "callback_handler": None,
    }
```

Replace with:
```python
def _create_agent(agent_name: str, user_id: str = "", session_id: str = "", messages: list = None) -> Agent:
    """Create a fresh Agent instance for this request."""
    prompt, tools = AGENT_CONFIGS[agent_name]
    kwargs = {
        "model": _model,
        "system_prompt": prompt,
        "tools": tools,
        "callback_handler": None,
    }
    if messages:
        kwargs["messages"] = messages
```

**Step 3: Update invoke() to load/save history**

Find the section in `invoke()` that calls `_create_agent` and gets the response:
```python
    agent_name = _classify(message, msg_type)
    agent = _create_agent(agent_name, user_id=user_id, session_id=session_id)

    logger.info("Routing to %s: user=%s", agent_name, user_id)

    try:
        result = agent(f"Student (user_id: {user_id}): {message}")
        response_text = _extract_text(result)
    except Exception as e:
        logger.error("Agent error: %s", e)
        response_text = f"Agent error: {e}"
```

Replace with:
```python
    agent_name = _classify(message, msg_type)

    # Load in-process history for this session
    history = _session_histories.get(session_id, []) if session_id else []

    agent = _create_agent(agent_name, user_id=user_id, session_id=session_id, messages=history)

    logger.info("Routing to %s: user=%s session=%s history_turns=%d",
                agent_name, user_id, session_id[:8] if session_id else "none", len(history) // 2)

    try:
        result = agent(f"Student (user_id: {user_id}): {message}")
        response_text = _extract_text(result)

        # Save updated conversation history back to in-process cache
        if session_id:
            try:
                updated_messages = agent.messages if hasattr(agent, 'messages') else []
                # Trim to avoid unbounded growth
                if len(updated_messages) > MAX_HISTORY_TURNS * 2:
                    updated_messages = updated_messages[-(MAX_HISTORY_TURNS * 2):]
                _session_histories[session_id] = updated_messages
            except Exception as hist_err:
                logger.warning("Failed to save session history: %s", hist_err)
    except Exception as e:
        logger.error("Agent error: %s", e)
        response_text = f"Agent error: {e}"
```

**Step 4: Verify the Strands Agent `messages` attribute name**

Check the Strands SDK docs/source to confirm the attribute for conversation history. It may be `messages`, `conversation_history`, or similar. To verify:
```bash
cd Backend/agents
python3 -c "from strands import Agent; import inspect; print([a for a in dir(Agent) if 'mess' in a.lower() or 'hist' in a.lower()])"
```

If the attribute name is different, update the `agent.messages` reference in the save step.

**Step 5: Commit**
```bash
git add Backend/agents/agent.py
git commit -m "fix: add in-process session history to preserve conversation within same chat"
```

---

## Task 3: Agent — Add question context and get_question_details to tutor

**Files:**
- Modify: `Backend/agents/agent.py`
- Modify: `Backend/agents/prompts.py`

**Context:**
When a student asks "how to solve question 3?", the agent needs to:
1. Know which module/lesson the student is in (passed in the payload)
2. Call `get_question_details(module_uuid, lesson_uuid, 3)` to look up the actual question
3. Give a helpful hint

**Step 1: Add get_question_details and get_question_metadata to tutor tools**

In `agent.py`, find:
```python
AGENT_CONFIGS = {
    "tutor": (TUTOR_PROMPT, [search_knowledge_base]),
    "grader": (GRADER_PROMPT, [get_question_details, get_user_progress, get_attempt_result]),
    "planner": (PLANNER_PROMPT, [get_user_progress, list_available_modules, get_question_metadata]),
}
```

Replace with:
```python
AGENT_CONFIGS = {
    "tutor": (TUTOR_PROMPT, [search_knowledge_base, get_question_details, get_question_metadata]),
    "grader": (GRADER_PROMPT, [get_question_details, get_user_progress, get_attempt_result]),
    "planner": (PLANNER_PROMPT, [get_user_progress, list_available_modules, get_question_metadata]),
}
```

**Step 2: Include module/lesson in the agent message context**

In `invoke()`, find:
```python
    message = payload.get("message", payload.get("prompt", ""))
    user_id = payload.get("user_id", "")
    session_id = payload.get("session_id", "")
    msg_type = payload.get("type", "chat")
```

Add after:
```python
    module_uuid = payload.get("module_uuid", "")
    lesson_uuid = payload.get("lesson_uuid", "")
```

Then find where the agent is called:
```python
        result = agent(f"Student (user_id: {user_id}): {message}")
```

Replace with:
```python
        context_parts = [f"user_id: {user_id}"]
        if module_uuid:
            context_parts.append(f"module: {module_uuid}")
        if lesson_uuid:
            context_parts.append(f"lesson: {lesson_uuid}")
        context_str = ", ".join(context_parts)
        result = agent(f"Student ({context_str}): {message}")
```

**Step 3: Update TUTOR_PROMPT to instruct question lookup**

In `prompts.py`, find the end of `TUTOR_PROMPT`:
```python
You have access to search_knowledge_base to look up relevant course content.
Always search the knowledge base before answering to ground your response in the course material.
"""
```

Replace with:
```python
You have access to:
- search_knowledge_base: look up DevOps concepts, commands, examples from course material
- get_question_details: look up a specific question's text, type, and correct answer
- get_question_metadata: list all questions in a lesson with their topics and difficulty

When a student asks about "question N" or "solve question N":
1. ALWAYS call get_question_details(module_uuid, lesson_uuid, N) to read the actual question first
2. Then provide a hint (NOT the answer directly) to guide them

When answering DevOps concept questions, call search_knowledge_base first to ground your response.
"""
```

**Step 4: Also pass module/lesson in grade message construction**

In `invoke()`, find the grade message construction:
```python
    if msg_type == "grade":
        module = payload.get("module_uuid", "")
        lesson = payload.get("lesson_uuid", "")
```

This already reads `module_uuid` / `lesson_uuid` from payload — good, no change needed. But confirm `module_uuid` and `lesson_uuid` local vars are set before this block (they are, from Step 2 above).

**Step 5: Commit**
```bash
git add Backend/agents/agent.py Backend/agents/prompts.py
git commit -m "feat: add question lookup tools to tutor agent + pass module/lesson context"
```

---

## Task 4: Deploy and Test

**Step 1: Deploy the updated agent**

```bash
cd Backend/agents
agentcore launch \
  --auto-update-on-conflict \
  --env BEDROCK_AGENTCORE_MEMORY_ID=rosettacloud_education_memory-evO1o3F0jN
```

Wait for READY status (~5-10 min for CodeBuild):
```bash
agentcore status
```
Expected: `Status: READY`

**Step 2: Test question lookup**

```bash
agentcore invoke '{
  "message": "How do I solve question number 1?",
  "user_id": "test",
  "session_id": "test-session-1234567890abcdef12345678",
  "module_uuid": "linux-docker-k8s-101",
  "lesson_uuid": "intro-lesson-01"
}'
```
Expected: Agent calls `get_question_details`, reads the question text, gives a specific hint.

**Step 3: Test within-session memory**

```bash
# Message 1
agentcore invoke '{
  "message": "What is Docker?",
  "user_id": "test",
  "session_id": "test-memory-session-1234567890abcdef12345"
}'

# Message 2 — same session_id
agentcore invoke '{
  "message": "What was my previous question?",
  "user_id": "test",
  "session_id": "test-memory-session-1234567890abcdef12345"
}'
```
Expected: Message 2 response references "Docker" from message 1.

**Step 4: Build and push frontend**

```bash
cd Frontend
ng build --configuration=production 2>&1 | tail -5
```
Expected: Build succeeds. Then push to trigger frontend-build pipeline.

**Step 5: Full E2E test via WebSocket**

Open `wss://wss.dev.rosettacloud.app` from the app:
1. Ask "How do I solve question 1?" — agent should look up question, give hint ✓
2. Ask "What was my previous question?" — agent should say "question 1 about..." ✓

**Step 6: Commit and push all changes**

```bash
git add Backend/agents/ Frontend/src/
git push origin main
```
Pipelines triggered: `agent-deploy` (rebuilds AgentCore container) + `frontend-build` (if frontend changed).

---

## Summary: What We're NOT Changing

| Topic | Decision |
|-------|----------|
| WebSocket sync approach | Keep — AgentCore Runtime is synchronous. Demo repo also uses sync. |
| Redis | Keep — `questions_backends.py` uses Redis to cache S3 question data. |
| `AgentCoreMemorySessionManager` | Keep — provides long-term cross-session memory. In-process dict handles short-term. |
| `search_knowledge_base` in tutor | Keep — useful for general DevOps concept questions. Now SUPPLEMENTED by `get_question_details`. |

---

## Files Modified

| File | Change |
|------|--------|
| `Frontend/src/app/services/chatbot.service.ts` | Add `setLabContext()`, include `module_uuid`/`lesson_uuid` in all messages |
| `Frontend/src/app/...component.ts` | Call `setLabContext()` alongside existing `setUserId()` |
| `Backend/agents/agent.py` | In-process session history dict + tutor tools + module/lesson context |
| `Backend/agents/prompts.py` | Update TUTOR_PROMPT to use question lookup tools |
