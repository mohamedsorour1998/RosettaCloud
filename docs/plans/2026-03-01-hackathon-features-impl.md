# Hackathon Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multimodal terminal screenshot analysis (Feature 1) and proactive hints after 2 wrong attempts (Feature 2) to the RosettaCloud lab.

**Architecture:** Feature 1 — browser Screen Capture API grabs one frame, sends base64 JPEG to `/chat` as a new `image` field, agent.py builds a Nova multimodal content block. Feature 2 — `attemptCount` added to the Question interface, incremented on each wrong attempt; at count === 2 the chatbot panel opens and `sendProactiveHint()` fires.

**Tech Stack:** Angular 19 (Frontend), FastAPI (Backend), Strands Agent on Nova Lite (AgentCore), AWS Bedrock Converse API for multimodal vision.

---

## Task 1: Backend — Add `image` field to ChatRequest and forward to AgentCore

**Files:**
- Modify: `Backend/app/main.py:313-322` (ChatRequest model)
- Modify: `Backend/app/main.py:402-413` (payload construction in `/chat`)

**Step 1: Add `image` field to ChatRequest**

In `Backend/app/main.py`, change the `ChatRequest` class (currently ends at line 321):

```python
class ChatRequest(BaseModel):
    message: str = ""
    user_id: str = ""
    session_id: str = ""
    module_uuid: str = ""
    lesson_uuid: str = ""
    type: str = "chat"
    question_number: int = 0
    result: str = ""
    image: str = ""  # base64 JPEG for multimodal terminal analysis
```

**Step 2: Forward `image` in the payload**

In the `/chat` handler, after the existing `if request.type == "grade":` block (currently lines 411-413), add:

```python
    if request.image:
        payload["image"] = request.image
```

**Step 3: Verify manually**

Start the backend locally and POST to `/chat` with `{"image": "data:image/jpeg;base64,/9j/..."}` — the request should be accepted (no validation error). The agent won't use it yet (Task 2 does that).

**Step 4: Commit**

```bash
git add Backend/app/main.py
git commit -m "feat: add image field to ChatRequest and forward to AgentCore payload"
```

---

## Task 2: Backend — Agent multimodal vision + hint routing

**Files:**
- Modify: `Backend/agents/agent.py:140-163` (_classify function)
- Modify: `Backend/agents/agent.py:166-190` (invoke function)

**Step 1: Add `hint` type shortcut in `_classify()`**

In `_classify()`, after the `if msg_type == "grade": return "grader"` line, add:

```python
    if msg_type == "hint":
        return "tutor"
```

**Step 2: Extract `image_b64` in `invoke()`**

In `invoke()`, after the `lesson_uuid` extraction line (currently `lesson_uuid = payload.get("lesson_uuid", "")`), add:

```python
    image_b64 = payload.get("image", "")
```

**Step 3: Build multimodal message when image is present**

Find the current agent call block (around line 168 after context building):

```python
        result = agent(f"Student ({context_str}): {message}")
```

Replace it with:

```python
        if image_b64:
            import base64 as _base64
            # Strip data:image/...;base64, prefix if present
            raw = image_b64.split(",")[-1] if "," in image_b64 else image_b64
            image_bytes = _base64.b64decode(raw)
            user_msg = [
                {
                    "role": "user",
                    "content": [
                        {"text": f"Student ({context_str}): {message}"},
                        {
                            "image": {
                                "format": "jpeg",
                                "source": {"bytes": image_bytes},
                            }
                        },
                    ],
                }
            ]
            result = agent(user_msg)
        else:
            result = agent(f"Student ({context_str}): {message}")
```

**Step 4: Commit**

```bash
git add Backend/agents/agent.py
git commit -m "feat: agent multimodal vision support and hint type routing"
```

---

## Task 3: Frontend — ChatMessage type + image thumbnail in chat bubbles

**Files:**
- Modify: `Frontend/src/app/services/chatbot.service.ts:8-14` (ChatMessage interface)
- Modify: `Frontend/src/app/chatbot/chatbot.component.html:139-144` (message bubble)
- Modify: `Frontend/src/app/chatbot/chatbot.component.scss` (thumbnail style)

**Step 1: Add `imageData` to ChatMessage interface**

In `chatbot.service.ts`, change the `ChatMessage` interface:

```typescript
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
  id?: string;
  agent?: AgentType;
  imageData?: string;  // base64 JPEG for screenshot messages
}
```

**Step 2: Render image thumbnail in message bubble**

In `chatbot.component.html`, find the `message-bubble` div (around line 139):

```html
<div class="message-bubble" [ngClass]="...">
  <div class="message-text" [innerHTML]="formatMessage(message.content)"></div>
</div>
```

Change it to:

```html
<div class="message-bubble" [ngClass]="message.agent ? getAgentClass(message.agent) + '-bubble' : ''">
  <img
    *ngIf="message.imageData"
    [src]="message.imageData"
    alt="Terminal screenshot"
    class="screenshot-thumb"
  />
  <div class="message-text" [innerHTML]="formatMessage(message.content)"></div>
</div>
```

**Step 3: Add thumbnail CSS**

In `chatbot.component.scss`, add at the end of the file (before any last closing brace if inside a block, otherwise at root level):

```scss
.screenshot-thumb {
  display: block;
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: 0.5rem;
  margin-bottom: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
```

**Step 4: Commit**

```bash
git add Frontend/src/app/services/chatbot.service.ts \
        Frontend/src/app/chatbot/chatbot.component.html \
        Frontend/src/app/chatbot/chatbot.component.scss
git commit -m "feat: add imageData to ChatMessage and render screenshot thumbnails in chat"
```

---

## Task 4: Frontend — New ChatbotService methods

**Files:**
- Modify: `Frontend/src/app/services/chatbot.service.ts:99-138` (after sendMessage, before sendGradeMessage)

**Step 1: Add `sendImageMessage()` method**

Add after the existing `sendMessage()` method (after its closing `}`):

```typescript
  public sendImageMessage(base64: string, text: string = 'Help me understand what I see in my terminal'): void {
    this.addMessage({
      role: 'user',
      content: text,
      timestamp: new Date(),
      imageData: base64,
    });
    this.loadingSubject.next(true);

    this.http
      .post<ChatApiResponse>(this.apiUrl, {
        session_id: this.sessionId,
        message: text,
        user_id: this.userId,
        module_uuid: this.moduleUuid,
        lesson_uuid: this.lessonUuid,
        type: 'chat',
        image: base64,
      })
      .subscribe({
        next: (res) => {
          this.addMessage({
            role: 'assistant',
            content: res.response,
            timestamp: new Date(),
            agent: res.agent as AgentType,
          });
          this.loadingSubject.next(false);
        },
        error: (err) => {
          this.addMessage({
            role: 'error',
            content: `Analysis error: ${err.message ?? 'Unknown error'}`,
            timestamp: new Date(),
          });
          this.loadingSubject.next(false);
        },
      });
  }
```

**Step 2: Add `sendProactiveHint()` method**

Add after `sendImageMessage()`:

```typescript
  public sendProactiveHint(questionNumber: number, questionText: string): void {
    const message = `I'm stuck on Question ${questionNumber} — can you give me a hint?`;
    this.addMessage({ role: 'user', content: message, timestamp: new Date() });
    this.loadingSubject.next(true);

    this.http
      .post<ChatApiResponse>(this.apiUrl, {
        session_id: this.sessionId,
        message,
        user_id: this.userId,
        module_uuid: this.moduleUuid,
        lesson_uuid: this.lessonUuid,
        type: 'hint',
        question_number: questionNumber,
      })
      .subscribe({
        next: (res) => {
          this.addMessage({
            role: 'assistant',
            content: res.response,
            timestamp: new Date(),
            agent: res.agent as AgentType,
          });
          this.loadingSubject.next(false);
        },
        error: (err) => {
          this.addMessage({
            role: 'error',
            content: `Hint error: ${err.message ?? 'Unknown error'}`,
            timestamp: new Date(),
          });
          this.loadingSubject.next(false);
        },
      });
  }
```

**Step 3: Commit**

```bash
git add Frontend/src/app/services/chatbot.service.ts
git commit -m "feat: add sendImageMessage and sendProactiveHint to ChatbotService"
```

---

## Task 5: Frontend — Lab component: analyzeTerminal + attemptCount tracking

**Files:**
- Modify: `Frontend/src/app/lab/lab.component.ts:45-55` (Question interface)
- Modify: `Frontend/src/app/lab/lab.component.ts:644-653` (MCQ wrong path)
- Modify: `Frontend/src/app/lab/lab.component.ts:764-770` (practical check wrong path)
- Modify: `Frontend/src/app/lab/lab.component.ts:819-836` (saveQuestionState)
- Modify: `Frontend/src/app/lab/lab.component.ts:841-861` (restoreQuestionState)
- Add method: `analyzeTerminal()` anywhere in the class body

**Step 1: Add `attemptCount` to the Question interface**

```typescript
interface Question {
  id: number;
  question: string;
  type: 'mcq' | 'check';
  options?: string[];
  correctAnswer?: string;
  completed: boolean;
  visited: boolean;
  disabledOptions: number[];
  wrongAttempt: boolean;
  attemptCount: number;   // tracks wrong attempts for proactive hints
}
```

**Step 2: Initialize `attemptCount: 0` wherever questions are constructed**

Search the file for where `Question` objects are constructed (look for `disabledOptions: []`). Each constructed question object needs `attemptCount: 0` added:

```typescript
{
  id: ...,
  question: ...,
  type: ...,
  completed: false,
  visited: false,
  disabledOptions: [],
  wrongAttempt: false,
  attemptCount: 0,   // add this
}
```

**Step 3: Increment `attemptCount` and trigger hint in the MCQ wrong path**

Find the MCQ wrong answer block (currently around line 644–653):

```typescript
    } else {
      this.isAnswerCorrect = false;
      this.feedbackMessage = 'Incorrect. Try again or skip.';
      if (!q.disabledOptions.includes(this.selectedOption)) {
        q.disabledOptions.push(this.selectedOption);
      }
      q.wrongAttempt = true;
      this.selectedOption = null;
    }
```

Change to:

```typescript
    } else {
      this.isAnswerCorrect = false;
      this.feedbackMessage = 'Incorrect. Try again or skip.';
      if (!q.disabledOptions.includes(this.selectedOption)) {
        q.disabledOptions.push(this.selectedOption);
      }
      q.wrongAttempt = true;
      q.attemptCount = (q.attemptCount || 0) + 1;
      if (q.attemptCount === 2) {
        this.openChatPanel();
        this.chatbotSv.sendProactiveHint(q.id, q.question);
      }
      this.selectedOption = null;
    }
```

**Step 4: Increment `attemptCount` and trigger hint in the practical check wrong path**

Find the practical check wrong block (currently around line 764–770):

```typescript
          } else {
            this.isAnswerCorrect = false;
            this.feedbackMessage = 'Your solution is not working yet. Try again.';
            q.wrongAttempt = true;
          }
```

Change to:

```typescript
          } else {
            this.isAnswerCorrect = false;
            this.feedbackMessage = 'Your solution is not working yet. Try again.';
            q.wrongAttempt = true;
            q.attemptCount = (q.attemptCount || 0) + 1;
            if (q.attemptCount === 2) {
              this.openChatPanel();
              this.chatbotSv.sendProactiveHint(questionNumber, q.question);
            }
          }
```

**Step 5: Persist `attemptCount` in `saveQuestionState()`**

Find `saveQuestionState()` and add `attemptCount` to the saved state:

```typescript
  private saveQuestionState(): void {
    try {
      sessionStorage.setItem(
        this.qStateKey,
        JSON.stringify({
          currentIndex: this.currentQuestionIndex,
          questions: this.questions.map((q) => ({
            completed: q.completed,
            visited: q.visited,
            disabledOptions: q.disabledOptions,
            wrongAttempt: q.wrongAttempt,
            attemptCount: q.attemptCount,   // add this
          })),
        })
      );
    } catch (e) {
      console.error('Error saving question state:', e);
    }
  }
```

**Step 6: Restore `attemptCount` in `restoreQuestionState()`**

Find `restoreQuestionState()` and add the restore line:

```typescript
            this.questions[i].wrongAttempt = s.wrongAttempt || false;
            this.questions[i].attemptCount = s.attemptCount || 0;   // add this
```

**Step 7: Add `analyzeTerminal()` method**

Add this method anywhere in the class (e.g., after `toggleInstructions()`):

```typescript
  async analyzeTerminal(): Promise<void> {
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        preferCurrentTab: true,
      });

      const video = document.createElement('video');
      video.srcObject = stream;

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
        video.play();
      });

      const canvas = document.createElement('canvas');
      // Scale down to max 1280px wide to keep payload manageable
      const maxW = 1280;
      const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Stop the stream immediately — no lingering share indicator
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      video.srcObject = null;

      const base64 = canvas.toDataURL('image/jpeg', 0.75);
      this.openChatPanel();
      this.chatbotSv.sendImageMessage(base64, 'Help me understand what I see in my terminal');
    } catch {
      // User cancelled or browser unsupported — fail silently
    }
  }
```

**Step 8: Commit**

```bash
git add Frontend/src/app/lab/lab.component.ts
git commit -m "feat: add attemptCount tracking, proactive hints, and analyzeTerminal capture"
```

---

## Task 6: Frontend — "Analyze Terminal" button in lab header

**Files:**
- Modify: `Frontend/src/app/lab/lab.component.html:22-50` (lab-actions section)
- Modify: `Frontend/src/app/lab/lab.component.scss` (button style, mirror existing btn-info style)

**Step 1: Add the button**

In `lab.component.html`, find the `lab-actions` div. Add the Analyze button as the **first** button (before Instructions), so it's most visible:

```html
    <div class="lab-actions">
      <!-- Analyze Terminal -->
      <button
        class="btn-analyze"
        (click)="analyzeTerminal()"
        [disabled]="!isLabActive"
        title="Analyze Terminal with AI"
      >
        <i class="bi bi-camera-video"></i>
        <span class="action-text">Analyze</span>
      </button>
      <!-- existing Instructions, Refresh, Terminate buttons below -->
```

**Step 2: Add button style**

In `lab.component.scss`, find where `.btn-info` is styled and add `.btn-analyze` with the same pattern but a purple/indigo accent to make it stand out (purple = multimodal/AI):

```scss
.btn-analyze {
  // Same layout as btn-info but with a purple accent
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  border: none;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  background: linear-gradient(135deg, #7c3aed, #a855f7);
  color: white;

  &:hover:not(:disabled) {
    background: linear-gradient(135deg, #6d28d9, #9333ea);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  i {
    font-size: 1rem;
  }
}
```

**Step 3: Commit**

```bash
git add Frontend/src/app/lab/lab.component.html \
        Frontend/src/app/lab/lab.component.scss
git commit -m "feat: add Analyze Terminal button to lab header"
```

---

## Task 7: Deploy and verify end-to-end

**Step 1: Push all commits**

```bash
git push origin main
```

This triggers:
- `backend-build.yml` (touches `Backend/app/main.py`) — builds + pushes backend image, rollout restart
- `agent-deploy.yml` (touches `Backend/agents/agent.py`) — redeploys AgentCore runtime
- `frontend-build.yml` (touches `Frontend/src/**`) — builds + pushes frontend image, rollout restart

**Step 2: Monitor workflows**

```bash
gh run list --limit 6
```

Wait for all three to show `completed success`.

**Step 3: Verify Feature 1 — Multimodal**

1. Open the lab at `https://dev.rosettacloud.app`
2. Click the purple **Analyze** button
3. Browser popup: select the current tab
4. Chat panel opens — you should see your screenshot thumbnail + "Help me understand what I see in my terminal" as your message
5. Tutor agent responds analyzing the screenshot

**Step 4: Verify Feature 2 — Proactive hints**

1. On any MCQ question, intentionally answer wrong twice
2. On the 2nd wrong answer: chat panel opens automatically
3. Chat shows: *"I'm stuck on Question N — can you give me a hint?"* as your message
4. Tutor agent responds with a contextual hint (no spoilers)

**Step 5: Verify hint fires only once**

Answer wrong a 3rd time — no second automatic hint should fire (condition is `=== 2`, not `>= 2`).
