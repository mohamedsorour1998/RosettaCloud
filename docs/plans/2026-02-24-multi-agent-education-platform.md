# Multi-Agent Education Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform RosettaCloud into a multi-agent education platform using Amazon Nova 2 Lite + Bedrock AgentCore Runtime + Strands Agents SDK for the Amazon Nova AI Hackathon.

**Architecture:** Four Strands agents (Orchestrator, Tutor, Grader, Curriculum Planner) deployed on AgentCore Runtime. Agents use tools to access DynamoDB (progress), S3 (course content), and LanceDB (RAG). Frontend upgraded with agent card UI. Backend stripped down to labs/users/questions only — all AI moves to AgentCore.

**Tech Stack:** Python 3.11+, Strands Agents SDK, Amazon Bedrock AgentCore Runtime, Amazon Nova 2 Lite, AWS CDK, Angular 19, LanceDB, DynamoDB, S3

---

## Task 1: Strip Backend — Remove AI, Feedback, Redis, SQS

Remove all AI/feedback/cache-events code from the FastAPI backend. The backend becomes a slim data + lab management API.

**Files:**
- Delete: `Backend/app/services/ai_service.py`
- Delete: `Backend/app/backends/ai_backends.py`
- Delete: `Backend/app/services/feedback_service.py`
- Delete: `Backend/app/services/cache_events_service.py`
- Delete: `Backend/app/backends/cache_events_backends.py`
- Modify: `Backend/app/main.py`
- Modify: `Backend/app/backends/questions_backends.py` (replace Redis cache with in-memory)
- Modify: `Backend/requirements.txt`
- Delete: `DevSecOps/K8S/redis.yaml`

**Step 1: Remove imports and service references from main.py**

Remove these from `Backend/app/main.py`:
- Line 11: `from app.services import cache_events_service as cache_events`
- Line 12: `from app.services import ai_service as ai`
- Lines 15-17: feedback_service import
- Lines 23: `questions_service = QuestionService(ai, question_backend)` — change to `questions_service = QuestionService(question_backend)` (remove `ai` param)

**Step 2: Simplify lifespan in main.py**

Replace lines 26-40 with:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await lab.init()
    await users.init()
    yield
    await users.close()
    await lab.close()
```

**Step 3: Remove cache/events/AI/feedback routes from main.py**

Remove:
- Lines 57-81: Cache and Events routes (`/cache/`, `/events/`, `/ws/events/`)
- Lines 83-105: AI streaming route (`/ai/chat`, `Prompt` model)
- Lines 405-417: Feedback polling route (`/feedback/{feedback_id}`)

**Step 4: Replace Redis active_lab tracking with DynamoDB**

In `Backend/app/main.py`, the lab routes use `cache_events.get/set("active_labs", user_id)`. Replace with DynamoDB calls via the users service:

- `new_lab()` (line 276): Replace `cache_events.get("active_labs", user_id)` with `await users.get_active_lab(user_id)`
- `new_lab()` (line 295): Replace `cache_events.set("active_labs", user_id, lab_id)` with `await users.set_active_lab(user_id, lab_id)`
- `lab_info()` (line 308): Replace `cache_events.set("active_labs", user_id, "null")` with `await users.clear_active_lab(user_id)`
- `terminate_lab()` (line 334): Replace `cache_events.set("active_labs", user_id, "null")` with `await users.clear_active_lab(user_id)`

Add these methods to `Backend/app/backends/users_backends.py`:
```python
async def get_active_lab(user_id: str) -> str | None:
    """Get active lab ID from user record in DynamoDB."""
    user = await get_user(user_id)
    if user:
        lab = user.get("active_lab")
        if lab and lab != "null":
            return lab
    return None

async def set_active_lab(user_id: str, lab_id: str) -> None:
    """Set active lab ID on user record in DynamoDB."""
    await update_user(user_id, {"active_lab": lab_id})

async def clear_active_lab(user_id: str) -> None:
    """Clear active lab from user record in DynamoDB."""
    await update_user(user_id, {"active_lab": None})
```

And expose them through `Backend/app/services/users_service.py`.

**Step 5: Replace Redis cache in questions_backends.py**

Replace the Redis cache with a simple in-memory TTL dict. In `Backend/app/backends/questions_backends.py`, replace any `redis` import and calls with:
```python
import time

_cache: dict[str, tuple[float, any]] = {}
_CACHE_TTL = 3600  # 1 hour

def _cache_get(key: str):
    entry = _cache.get(key)
    if entry and time.time() - entry[0] < _CACHE_TTL:
        return entry[1]
    _cache.pop(key, None)
    return None

def _cache_set(key: str, value):
    _cache[key] = (time.time(), value)
```

**Step 6: Update requirements.txt**

Remove from `Backend/requirements.txt`:
- `redis[hiredis]==5.2.1`

Add:
- (nothing yet — agent deps go in the agent directory)

**Step 7: Delete removed files**

```bash
rm Backend/app/services/ai_service.py
rm Backend/app/backends/ai_backends.py
rm Backend/app/services/feedback_service.py
rm Backend/app/services/cache_events_service.py
rm Backend/app/backends/cache_events_backends.py
rm DevSecOps/K8S/redis.yaml
```

**Step 8: Verify backend starts**

```bash
cd Backend
LAB_K8S_NAMESPACE=dev uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Expected: Server starts without import errors. `/health-check` returns `{"status": "healthy"}`.

**Step 9: Commit**

```bash
git add -A
git commit -m "refactor: strip AI, feedback, Redis, SQS from backend

Backend is now a slim data + lab management API.
All AI intelligence moves to AgentCore agents."
```

---

## Task 2: Build Agent Tools (Python Functions)

Create the shared tool functions that agents will use. These are plain Python functions decorated with `@tool` from Strands SDK.

**Files:**
- Create: `Backend/agents/__init__.py`
- Create: `Backend/agents/tools/__init__.py`
- Create: `Backend/agents/tools/knowledge_base.py`
- Create: `Backend/agents/tools/user_progress.py`
- Create: `Backend/agents/tools/course_content.py`
- Create: `Backend/agents/requirements.txt`

**Step 1: Create directory structure**

```bash
mkdir -p Backend/agents/tools
touch Backend/agents/__init__.py
touch Backend/agents/tools/__init__.py
```

**Step 2: Create agent requirements**

Create `Backend/agents/requirements.txt`:
```
bedrock-agentcore
strands-agents
strands-agents-tools
boto3
lancedb
pyarrow
```

**Step 3: Create knowledge_base tool**

Create `Backend/agents/tools/knowledge_base.py`:
```python
"""RAG search tool for the Tutor Agent — searches LanceDB vector store."""

import os
import json
import boto3
import lancedb

LANCEDB_S3_URI = os.environ.get("LANCEDB_S3_URI", "s3://rosettacloud-shared-interactive-labs-vector")
TABLE_NAME = os.environ.get("KNOWLEDGE_BASE_ID", "shell-scripts-knowledge-base")
BEDROCK_REGION = os.environ.get("AWS_REGION", "us-east-1")

_db = None
_table = None
_bedrock_client = None


def _get_bedrock_client():
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
    return _bedrock_client


def _embed_query(text: str) -> list[float]:
    """Create embedding using Amazon Titan."""
    client = _get_bedrock_client()
    response = client.invoke_model(
        modelId="amazon.titan-embed-text-v2:0",
        body=json.dumps({"inputText": text}),
    )
    result = json.loads(response["body"].read())
    return result["embedding"]


def _get_table():
    global _db, _table
    if _table is None:
        _db = lancedb.connect(LANCEDB_S3_URI)
        _table = _db.open_table(TABLE_NAME)
    return _table


def search_knowledge_base(query: str, max_results: int = 3) -> str:
    """Search the DevOps knowledge base for relevant content about Linux, Docker, and Kubernetes.

    Use this tool when you need to look up technical information to answer
    a student's question about DevOps topics.

    Args:
        query: The search query describing what information to find.
        max_results: Maximum number of results to return (default 3).

    Returns:
        JSON string with relevant document excerpts and metadata.
    """
    table = _get_table()
    query_vector = _embed_query(query)
    results = table.search(query_vector).limit(max_results).to_list()

    documents = []
    for r in results:
        documents.append({
            "content": r.get("text", ""),
            "metadata": {
                "file_name": r.get("file_name", ""),
                "file_type": r.get("file_type", ""),
                "question_text": r.get("question_text", ""),
            },
            "score": float(r.get("_distance", 0)),
        })
    return json.dumps(documents, indent=2)
```

**Step 4: Create user_progress tool**

Create `Backend/agents/tools/user_progress.py`:
```python
"""User progress tools — read student progress from DynamoDB."""

import os
import json
import boto3

USERS_TABLE = os.environ.get("USERS_TABLE_NAME", "rosettacloud-users")
REGION = os.environ.get("AWS_REGION", "us-east-1")

_dynamodb = None


def _get_table():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb", region_name=REGION)
    return _dynamodb.Table(USERS_TABLE)


def get_user_progress(user_id: str) -> str:
    """Get a student's learning progress across all modules and lessons.

    Use this tool to understand what the student has completed, what they
    struggled with, and their overall progress.

    Args:
        user_id: The student's user ID.

    Returns:
        JSON string with progress data per module/lesson/question.
    """
    table = _get_table()
    response = table.get_item(Key={"user_id": user_id})
    item = response.get("Item", {})

    progress = item.get("progress", {})
    return json.dumps({
        "user_id": user_id,
        "name": item.get("name", "Student"),
        "progress": progress,
    }, indent=2, default=str)


def get_attempt_result(user_id: str, module_uuid: str, lesson_uuid: str, question_number: int) -> str:
    """Get the result of a student's latest attempt on a specific question.

    Use this tool when grading a specific question attempt to understand
    what the student got right or wrong.

    Args:
        user_id: The student's user ID.
        module_uuid: The module identifier.
        lesson_uuid: The lesson identifier.
        question_number: The question number.

    Returns:
        JSON string with the attempt result (completed or not).
    """
    table = _get_table()
    response = table.get_item(Key={"user_id": user_id})
    item = response.get("Item", {})

    progress = item.get("progress", {})
    module_progress = progress.get(module_uuid, {})
    lesson_progress = module_progress.get(lesson_uuid, {})
    question_key = str(question_number)
    completed = lesson_progress.get(question_key, {}).get("completed", False)

    return json.dumps({
        "user_id": user_id,
        "module_uuid": module_uuid,
        "lesson_uuid": lesson_uuid,
        "question_number": question_number,
        "completed": completed,
    }, indent=2)
```

**Step 5: Create course_content tool**

Create `Backend/agents/tools/course_content.py`:
```python
"""Course content tools — read questions and modules from S3."""

import os
import re
import json
import boto3

S3_BUCKET = os.environ.get("S3_BUCKET_NAME", "rosettacloud-shared-interactive-labs")
REGION = os.environ.get("AWS_REGION", "us-east-1")

_s3 = None


def _get_s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3", region_name=REGION)
    return _s3


def list_available_modules() -> str:
    """List all available course modules and their lessons.

    Use this tool to understand what courses are available when planning
    a student's learning path.

    Returns:
        JSON string with module/lesson structure.
    """
    s3 = _get_s3()
    response = s3.list_objects_v2(Bucket=S3_BUCKET, Delimiter="/")
    modules = []
    for prefix in response.get("CommonPrefixes", []):
        module_uuid = prefix["Prefix"].rstrip("/")
        lesson_resp = s3.list_objects_v2(
            Bucket=S3_BUCKET, Prefix=f"{module_uuid}/", Delimiter="/"
        )
        lessons = []
        for lp in lesson_resp.get("CommonPrefixes", []):
            lesson_uuid = lp["Prefix"].split("/")[1]
            lessons.append(lesson_uuid)
        modules.append({"module_uuid": module_uuid, "lessons": lessons})
    return json.dumps(modules, indent=2)


def get_question_details(module_uuid: str, lesson_uuid: str, question_number: int) -> str:
    """Get details about a specific question including its text, type, difficulty, and correct answer.

    Use this tool when grading a student's answer or when you need to
    understand what a question is asking.

    Args:
        module_uuid: The module identifier.
        lesson_uuid: The lesson identifier.
        question_number: The question number.

    Returns:
        JSON string with question text, type, difficulty, choices, and correct answer.
    """
    s3 = _get_s3()
    key = f"{module_uuid}/{lesson_uuid}/q{question_number}.sh"
    try:
        obj = s3.get_object(Bucket=S3_BUCKET, Key=key)
        content = obj["Body"].read().decode("utf-8")
    except s3.exceptions.NoSuchKey:
        return json.dumps({"error": f"Question {question_number} not found"})

    # Parse shell script header comments for metadata
    metadata = {"question_number": question_number, "raw_available": True}
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("# QUESTION_TEXT:"):
            metadata["question_text"] = line.split(":", 1)[1].strip()
        elif line.startswith("# QUESTION_TYPE:"):
            metadata["question_type"] = line.split(":", 1)[1].strip()
        elif line.startswith("# DIFFICULTY:"):
            metadata["difficulty"] = line.split(":", 1)[1].strip()
        elif line.startswith("# CORRECT_ANSWER:"):
            metadata["correct_answer"] = line.split(":", 1)[1].strip()
        elif re.match(r"# OPTION_[A-Z]:", line):
            key_name = line.split(":")[0].replace("# ", "").lower()
            metadata.setdefault("choices", {})[key_name] = line.split(":", 1)[1].strip()

    return json.dumps(metadata, indent=2)


def get_question_metadata(module_uuid: str, lesson_uuid: str) -> str:
    """Get metadata for all questions in a lesson including difficulty and topics.

    Use this tool when planning a learning path to understand what topics
    and difficulty levels a lesson covers.

    Args:
        module_uuid: The module identifier.
        lesson_uuid: The lesson identifier.

    Returns:
        JSON string with metadata for all questions in the lesson.
    """
    s3 = _get_s3()
    prefix = f"{module_uuid}/{lesson_uuid}/"
    response = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix)

    questions = []
    for obj in response.get("Contents", []):
        key = obj["Key"]
        if key.endswith(".sh"):
            # Extract question number from filename
            filename = key.split("/")[-1]
            match = re.match(r"q(\d+)\.sh", filename)
            if match:
                q_num = int(match.group(1))
                detail = json.loads(get_question_details(module_uuid, lesson_uuid, q_num))
                questions.append(detail)

    return json.dumps(questions, indent=2)
```

**Step 6: Commit**

```bash
git add Backend/agents/
git commit -m "feat: add Strands agent tools for knowledge base, progress, and course content"
```

---

## Task 3: Build the Four Agents

Create each agent as a Python module with Strands SDK.

**Files:**
- Create: `Backend/agents/orchestrator.py`
- Create: `Backend/agents/tutor.py`
- Create: `Backend/agents/grader.py`
- Create: `Backend/agents/planner.py`
- Create: `Backend/agents/app.py` (AgentCore entrypoint)

**Step 1: Create the Tutor Agent**

Create `Backend/agents/tutor.py`:
```python
"""Tutor Agent — teaches DevOps concepts using RAG and hints-first pedagogy."""

from strands import Agent
from strands.models.bedrock import BedrockModel
from agents.tools.knowledge_base import search_knowledge_base

SYSTEM_PROMPT = """You are RosettaCloud's Tutor Agent, a DevOps education specialist.

Your role is to teach students about Linux, Docker, and Kubernetes through interactive guidance.

## Teaching Approach
- On the FIRST time a student asks a question, give HINTS and guiding questions — do NOT give the direct answer
- If the student asks the SAME question again or says they're stuck, then provide the direct answer with explanation
- Always relate concepts to practical, real-world DevOps scenarios
- Use simple language and build on what the student already knows

## Boundaries
- Only answer questions related to DevOps: Linux, Docker, Kubernetes, shell scripting, CI/CD, cloud infrastructure
- If a student asks about something unrelated, politely redirect them to DevOps topics
- Never provide answers to graded questions directly — guide them to discover the answer

## Tools
- Use search_knowledge_base to find relevant course content before answering
- Reference specific exercises or scripts from the knowledge base when helpful

## Response Format
- Keep responses concise (2-4 paragraphs max)
- Use code blocks for commands or configuration examples
- Use bullet points for step-by-step guidance"""

model = BedrockModel(
    model_id="amazon.nova-lite-v1:0",
    region_name="us-east-1",
)

tutor_agent = Agent(
    model=model,
    system_prompt=SYSTEM_PROMPT,
    tools=[search_knowledge_base],
)
```

**Step 2: Create the Grader Agent**

Create `Backend/agents/grader.py`:
```python
"""Grader Agent — evaluates student work and provides educational feedback."""

from strands import Agent
from strands.models.bedrock import BedrockModel
from agents.tools.user_progress import get_user_progress, get_attempt_result
from agents.tools.course_content import get_question_details

SYSTEM_PROMPT = """You are RosettaCloud's Grader Agent, an educational assessor for DevOps exercises.

Your role is to evaluate student answers and provide constructive, encouraging feedback.

## Grading Approach
- When a student completes a question correctly: congratulate them, explain WHY the answer is correct, and connect it to broader DevOps concepts
- When a student gets it wrong: be encouraging, explain what went wrong WITHOUT giving the answer directly, and suggest what to review
- For on-demand progress summaries: analyze all completed/incomplete questions and provide a comprehensive overview

## Feedback Style
- Be encouraging and supportive — never discouraging
- Focus on learning, not just right/wrong
- Connect individual questions to the bigger picture of DevOps mastery
- Include a brief progress snapshot (X/Y completed in current lesson)

## Tools
- Use get_question_details to understand what the question is asking and the correct answer
- Use get_user_progress to see the student's overall progress
- Use get_attempt_result to check if a specific question was answered correctly

## Response Format
- Start with the result (Correct/Incorrect or progress overview)
- Then provide educational context
- End with encouragement or a suggestion for what to focus on next
- Keep feedback concise (2-3 paragraphs)"""

model = BedrockModel(
    model_id="amazon.nova-lite-v1:0",
    region_name="us-east-1",
)

grader_agent = Agent(
    model=model,
    system_prompt=SYSTEM_PROMPT,
    tools=[get_question_details, get_user_progress, get_attempt_result],
)
```

**Step 3: Create the Curriculum Planner Agent**

Create `Backend/agents/planner.py`:
```python
"""Curriculum Planner Agent — analyzes progress and recommends learning paths."""

from strands import Agent
from strands.models.bedrock import BedrockModel
from agents.tools.user_progress import get_user_progress
from agents.tools.course_content import list_available_modules, get_question_metadata

SYSTEM_PROMPT = """You are RosettaCloud's Curriculum Planner Agent, a learning path advisor for DevOps education.

Your role is to analyze student progress and recommend personalized next steps.

## Planning Approach
- Review the student's progress across all modules and lessons
- Identify knowledge gaps based on incomplete or failed questions
- Recommend the optimal next lesson or topic to study
- Consider the natural DevOps learning progression: Linux Basics → Shell Scripting → Docker → Docker Compose → Kubernetes → Helm

## Recommendations
- Be specific: "Complete Docker Q5-Q6 on volumes" not just "do more Docker"
- Explain WHY you recommend a particular path
- If the student is stuck on a topic, suggest reviewing prerequisites
- Celebrate completed milestones

## Tools
- Use get_user_progress to see what the student has completed
- Use list_available_modules to see all available courses
- Use get_question_metadata to understand difficulty and topics per lesson

## Response Format
- Start with a progress summary (completed modules, current lesson status)
- Identify 1-2 areas that need attention
- Give a clear, actionable recommendation
- Keep it concise (2-3 paragraphs)"""

model = BedrockModel(
    model_id="amazon.nova-lite-v1:0",
    region_name="us-east-1",
)

planner_agent = Agent(
    model=model,
    system_prompt=SYSTEM_PROMPT,
    tools=[get_user_progress, list_available_modules, get_question_metadata],
)
```

**Step 4: Create the Orchestrator Agent**

Create `Backend/agents/orchestrator.py`:
```python
"""Orchestrator Agent — classifies student intent and routes to specialist agents."""

from strands import Agent
from strands.models.bedrock import BedrockModel
from agents.tutor import tutor_agent
from agents.grader import grader_agent
from agents.planner import planner_agent

import json


def route_to_tutor(message: str, user_id: str, session_id: str) -> str:
    """Route a question to the Tutor Agent for DevOps concept explanations and learning guidance.

    Use this tool when the student is asking about a DevOps concept, needs help
    understanding something, or wants to learn about Linux, Docker, or Kubernetes.

    Args:
        message: The student's question or message.
        user_id: The student's user ID for context.
        session_id: The current chat session ID.

    Returns:
        The Tutor Agent's response as a string.
    """
    result = tutor_agent(f"Student (user_id: {user_id}): {message}")
    return json.dumps({"agent": "tutor", "response": str(result)})


def route_to_grader(message: str, user_id: str, module_uuid: str = "", lesson_uuid: str = "", question_number: int = 0, result: str = "") -> str:
    """Route to the Grader Agent for evaluating student work and providing feedback.

    Use this tool when:
    - A student just answered a question (auto-grade with result pass/fail)
    - A student asks "how am I doing?" or wants feedback on their progress
    - A student asks about their performance

    Args:
        message: The student's message or auto-grade context.
        user_id: The student's user ID.
        module_uuid: The current module (if grading a specific question).
        lesson_uuid: The current lesson (if grading a specific question).
        question_number: The question number (if grading a specific question).
        result: "pass" or "fail" (if auto-grading).

    Returns:
        The Grader Agent's response as a string.
    """
    context = f"Student (user_id: {user_id}): {message}"
    if result:
        context += f"\n\nAuto-grade context: Question {question_number} in {module_uuid}/{lesson_uuid} — Result: {result}"
    grader_result = grader_agent(context)
    return json.dumps({"agent": "grader", "response": str(grader_result)})


def route_to_planner(message: str, user_id: str) -> str:
    """Route to the Curriculum Planner Agent for learning path recommendations.

    Use this tool when the student asks about:
    - What to study next
    - Their overall progress
    - Learning recommendations
    - Which topics to focus on

    Args:
        message: The student's question about their learning path.
        user_id: The student's user ID.

    Returns:
        The Curriculum Planner Agent's response as a string.
    """
    result = planner_agent(f"Student (user_id: {user_id}): {message}")
    return json.dumps({"agent": "planner", "response": str(result)})


SYSTEM_PROMPT = """You are RosettaCloud's Orchestrator, the coordinator for a multi-agent DevOps education platform.

Your ONLY job is to understand the student's intent and route their message to the right specialist agent.

## Routing Rules
1. **Tutor Agent** — for concept questions, explanations, "how do I...", "what is...", help with exercises
2. **Grader Agent** — for grading requests, "how am I doing?", feedback on progress, or when you receive auto-grade data
3. **Curriculum Planner** — for "what should I learn next?", "what's my progress?", learning path questions

## Important
- ALWAYS use exactly ONE of your routing tools per student message
- NEVER answer the student directly — always route to a specialist
- If the message contains auto-grade data (type: "grade"), ALWAYS route to Grader
- If unsure, route to Tutor (it's the safest default)
- Pass the student's message and user_id to the routing tool"""

model = BedrockModel(
    model_id="amazon.nova-lite-v1:0",
    region_name="us-east-1",
)

orchestrator_agent = Agent(
    model=model,
    system_prompt=SYSTEM_PROMPT,
    tools=[route_to_tutor, route_to_grader, route_to_planner],
)
```

**Step 5: Create the AgentCore entrypoint**

Create `Backend/agents/app.py`:
```python
"""AgentCore Runtime entrypoint — receives requests and invokes the Orchestrator."""

import json
import logging
from bedrock_agentcore import BedrockAgentCoreApp
from agents.orchestrator import orchestrator_agent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload: dict) -> dict:
    """Handle incoming requests from API Gateway / AgentCore Runtime."""
    message = payload.get("message", "")
    user_id = payload.get("user_id", "")
    session_id = payload.get("session_id", "")
    msg_type = payload.get("type", "chat")

    # Auto-grade messages include question context
    if msg_type == "grade":
        module_uuid = payload.get("module_uuid", "")
        lesson_uuid = payload.get("lesson_uuid", "")
        question_number = payload.get("question_number", 0)
        result = payload.get("result", "")
        message = (
            f"Auto-grade: Student answered question {question_number} "
            f"in {module_uuid}/{lesson_uuid}. Result: {result}. "
            f"Please provide feedback."
        )

    # Invoke orchestrator
    logger.info(f"Invoking orchestrator for user={user_id} type={msg_type}")
    response = orchestrator_agent(
        f"user_id: {user_id}, session_id: {session_id}\n\n{message}"
    )

    # Parse agent response to extract which agent responded
    response_text = str(response)
    try:
        parsed = json.loads(response_text)
        agent_name = parsed.get("agent", "tutor")
        agent_response = parsed.get("response", response_text)
    except (json.JSONDecodeError, TypeError):
        agent_name = "tutor"
        agent_response = response_text

    return {
        "agent": agent_name,
        "response": agent_response,
        "session_id": session_id,
    }


if __name__ == "__main__":
    app.run()
```

**Step 6: Commit**

```bash
git add Backend/agents/
git commit -m "feat: add four Strands agents — Orchestrator, Tutor, Grader, Planner"
```

---

## Task 4: Deploy Agents to AgentCore Runtime (CDK)

Create CDK infrastructure to deploy the agents to AgentCore Runtime.

**Files:**
- Create: `Backend/agents/cdk/app.py`
- Create: `Backend/agents/cdk/agent_stack.py`
- Create: `Backend/agents/cdk/requirements.txt`
- Create: `Backend/agents/cdk/cdk.json`

**Step 1: Create CDK project structure**

```bash
mkdir -p Backend/agents/cdk
```

**Step 2: Create CDK requirements**

Create `Backend/agents/cdk/requirements.txt`:
```
aws-cdk-lib>=2.170.0
constructs>=10.0.0
```

**Step 3: Create CDK app**

Create `Backend/agents/cdk/cdk.json`:
```json
{
  "app": "python3 app.py"
}
```

Create `Backend/agents/cdk/app.py`:
```python
#!/usr/bin/env python3
import aws_cdk as cdk
from agent_stack import RosettaCloudAgentStack

app = cdk.App()
RosettaCloudAgentStack(app, "RosettaCloudAgentStack",
    env=cdk.Environment(region="us-east-1"),
)
app.synth()
```

**Step 4: Create CDK stack**

Create `Backend/agents/cdk/agent_stack.py`:

This stack deploys the agents to AgentCore Runtime. Follow the pattern from the logistics agent sample — use `BedrockAgentCoreRuntime` construct with S3 code asset.

Detailed CDK code depends on the exact AgentCore CDK constructs available. Reference:
- `https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html`
- The logistics agent sample CDK at `github.com/aws-samples/sample-logistics-agent-agentcore-runtime/tree/main/cdk`

The stack should:
1. Create an IAM role with permissions for: Bedrock (Nova 2 Lite invocation), DynamoDB (read rosettacloud-users), S3 (read rosettacloud-shared-interactive-labs), S3 (read/write rosettacloud-shared-interactive-labs-vector for LanceDB)
2. Package agent code from `Backend/agents/` into an S3 asset
3. Create an AgentCore Runtime endpoint with the packaged code
4. Output the Runtime ARN for testing

**Step 5: Bootstrap and deploy**

```bash
cd Backend/agents/cdk
pip install -r requirements.txt
cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-east-1
cdk deploy
```

**Step 6: Test the deployed agent**

```bash
# Get runtime ARN from CDK output
AGENT_RUNTIME_ARN=$(aws cloudformation describe-stacks \
  --stack-name RosettaCloudAgentStack \
  --query 'Stacks[0].Outputs[?OutputKey==`RuntimeArn`].OutputValue' \
  --output text)

# Test with a simple message
agentcore invoke --runtime-arn $AGENT_RUNTIME_ARN \
  '{"message": "What is a Docker container?", "user_id": "test-user", "session_id": "test-session"}'
```

Expected: JSON response with `{"agent": "tutor", "response": "...hints about Docker containers..."}`.

**Step 7: Commit**

```bash
git add Backend/agents/cdk/
git commit -m "feat: add CDK stack for AgentCore Runtime deployment"
```

---

## Task 5: Connect API Gateway WebSocket to AgentCore

Update the API Gateway WebSocket to invoke the AgentCore Runtime instead of the old chatbot Lambda.

**Step 1: Create a thin Lambda handler that bridges WebSocket ↔ AgentCore**

Create `Backend/agents/ws_handler/handler.py`:
```python
"""WebSocket handler Lambda — bridges API Gateway WebSocket to AgentCore Runtime."""

import os
import json
import boto3
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AGENT_RUNTIME_ARN = os.environ["AGENT_RUNTIME_ARN"]
agentcore_client = boto3.client("bedrock-agent-runtime", region_name="us-east-1")


def handler(event, context):
    route = event["requestContext"]["routeKey"]
    connection_id = event["requestContext"]["connectionId"]
    domain = event["requestContext"]["domainName"]
    stage = event["requestContext"]["stage"]
    api_endpoint = f"https://{domain}/{stage}"

    apigw = boto3.client("apigatewaymanagementapi", endpoint_url=api_endpoint)

    if route == "$connect":
        return {"statusCode": 200}

    if route == "$disconnect":
        return {"statusCode": 200}

    # $default route — handle message
    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        _send(apigw, connection_id, {"type": "error", "content": "Invalid JSON"})
        return {"statusCode": 400}

    message = body.get("prompt", body.get("message", ""))
    user_id = body.get("user_id", "")
    session_id = body.get("session_id", "")
    msg_type = body.get("type", "chat")

    if not message and msg_type != "grade":
        _send(apigw, connection_id, {"type": "error", "content": "Missing prompt"})
        return {"statusCode": 400}

    # Send processing status
    _send(apigw, connection_id, {"type": "status", "content": "Processing your question..."})

    # Build payload for AgentCore
    payload = {
        "message": message,
        "user_id": user_id,
        "session_id": session_id,
        "type": msg_type,
    }

    # Add grade context if present
    if msg_type == "grade":
        payload.update({
            "module_uuid": body.get("module_uuid", ""),
            "lesson_uuid": body.get("lesson_uuid", ""),
            "question_number": body.get("question_number", 0),
            "result": body.get("result", ""),
        })

    # Invoke AgentCore Runtime
    response = agentcore_client.invoke_agent(
        agentRuntimeArn=AGENT_RUNTIME_ARN,
        inputText=json.dumps(payload),
        sessionId=session_id or "default",
    )

    # Parse response
    result = json.loads(response.get("output", "{}"))
    agent_name = result.get("agent", "tutor")
    agent_response = result.get("response", "")

    # Send agent response
    _send(apigw, connection_id, {
        "type": "chunk",
        "content": agent_response,
        "agent": agent_name,
    })

    # Send complete signal
    _send(apigw, connection_id, {"type": "complete", "agent": agent_name})

    return {"statusCode": 200}


def _send(apigw, connection_id, data):
    """Send a message to the WebSocket client."""
    try:
        apigw.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(data).encode(),
        )
    except apigw.exceptions.GoneException:
        logger.warning(f"Connection {connection_id} is gone")
```

**Step 2: Deploy the WebSocket handler Lambda**

Either update the existing `ai_chatbot` Lambda to use this new handler, or create a new Lambda and update the API Gateway integration.

**Step 3: Update API Gateway WebSocket integration to point to new handler**

```bash
# Get the API Gateway ID for wss://wss.dev.rosettacloud.app
# Update the $default route integration to point to the new Lambda
```

**Step 4: Test end-to-end via WebSocket**

Use `wscat` or the frontend to test:
```bash
npx wscat -c "wss://wss.dev.rosettacloud.app"
> {"session_id": "test-123", "prompt": "What is Docker?", "user_id": "test-user"}
```

Expected: Receive `{type: "status"}`, then `{type: "chunk", agent: "tutor", content: "..."}`, then `{type: "complete"}`.

**Step 5: Commit**

```bash
git add Backend/agents/ws_handler/
git commit -m "feat: add WebSocket handler Lambda bridging API Gateway to AgentCore"
```

---

## Task 6: Update Frontend — Agent Cards UI

Modify the Angular chatbot component to display agent cards.

**Files:**
- Modify: `Frontend/src/app/services/chatbot.service.ts`
- Modify: `Frontend/src/app/chatbot/chatbot.component.ts`
- Modify: `Frontend/src/app/chatbot/chatbot.component.html`
- Modify: `Frontend/src/app/chatbot/chatbot.component.scss`

**Step 1: Update ChatMessage interface in chatbot.service.ts**

Add `agent` field to the `ChatMessage` interface:
```typescript
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
  id?: string;
  agent?: 'tutor' | 'grader' | 'planner' | 'orchestrator';
}
```

**Step 2: Update handleResponse in chatbot.service.ts**

In the `handleResponse` method, extract the `agent` field from incoming WebSocket messages:
```typescript
case 'chunk':
  // Update the last assistant message with new content
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    lastMsg.content += response.content;
    lastMsg.agent = response.agent || lastMsg.agent;
  }
  break;
```

**Step 3: Add sendGradeMessage method to chatbot.service.ts**

```typescript
sendGradeMessage(userId: string, moduleUuid: string, lessonUuid: string, questionNumber: number, result: string): void {
  if (this.socket && this.socket.readyState === WebSocket.OPEN) {
    this.socket.send(JSON.stringify({
      type: 'grade',
      session_id: this.sessionId,
      user_id: userId,
      module_uuid: moduleUuid,
      lesson_uuid: lessonUuid,
      question_number: questionNumber,
      result: result,
    }));
  }
}
```

**Step 4: Update chatbot.component.html**

Add agent card header to message template:
```html
<div *ngFor="let message of messages" class="message" [ngClass]="message.role">
  <!-- Agent card header for assistant messages -->
  <div *ngIf="message.role === 'assistant' && message.agent" class="agent-card-header"
       [ngClass]="'agent-' + message.agent">
    <span class="agent-icon">{{ getAgentIcon(message.agent) }}</span>
    <span class="agent-name">{{ getAgentName(message.agent) }}</span>
  </div>
  <div class="message-content" [innerHTML]="formatMessage(message.content)"></div>
</div>
```

**Step 5: Add agent helper methods to chatbot.component.ts**

```typescript
getAgentIcon(agent: string): string {
  const icons: Record<string, string> = {
    tutor: '📚',
    grader: '✅',
    planner: '🗺️',
  };
  return icons[agent] || '🤖';
}

getAgentName(agent: string): string {
  const names: Record<string, string> = {
    tutor: 'Tutor Agent',
    grader: 'Grader Agent',
    planner: 'Curriculum Planner',
  };
  return names[agent] || 'AI Assistant';
}
```

**Step 6: Add agent card styles to chatbot.component.scss**

```scss
.agent-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px 8px 0 0;
  font-size: 0.85rem;
  font-weight: 600;

  .agent-icon {
    font-size: 1.1rem;
  }
}

.agent-tutor {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
  border-left: 3px solid #3b82f6;
}

.agent-grader {
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  border-left: 3px solid #22c55e;
}

.agent-planner {
  background: rgba(168, 85, 247, 0.1);
  color: #a855f7;
  border-left: 3px solid #a855f7;
}
```

**Step 7: Wire auto-grading from question check**

In the lesson/questions component that calls `POST /questions/.../check`, after receiving the result, trigger auto-grading:
```typescript
// After receiving check result
if (checkResult.status === 'success') {
  this.chatbotService.sendGradeMessage(
    this.userId,
    this.moduleUuid,
    this.lessonUuid,
    questionNumber,
    checkResult.completed ? 'pass' : 'fail'
  );
}
```

**Step 8: Build and verify**

```bash
cd Frontend
ng build
```

Expected: Build succeeds with no errors.

**Step 9: Commit**

```bash
git add Frontend/src/
git commit -m "feat: add agent card UI to chatbot — shows Tutor, Grader, Planner cards"
```

---

## Task 7: Remove Feedback Component & Old Lambda

Clean up the old feedback flow since it's replaced by the Grader Agent.

**Files:**
- Modify: `Frontend/src/app/feedback/feedback.component.ts` (simplify or remove)
- Delete: `Frontend/src/app/services/feedback.service.ts`
- Delete: `Backend/serverless/Lambda/ai_chatbot/` (entire directory)
- Delete: `Backend/serverless/Lambda/feedback_request/` (entire directory)
- Modify: `.github/workflows/deploy.yml` (remove feedback Lambda build steps)

**Step 1: Simplify feedback component**

The feedback component currently does HTTP polling. Replace it with a simple "Get Feedback" button that sends a message to the chatbot (which routes to Grader Agent):

```typescript
requestFeedback(): void {
  // Instead of HTTP call to feedback API, send a grade summary request via chatbot
  this.chatbotService.sendMessage(
    `Please give me a comprehensive feedback summary for my progress in ${this.moduleUuid}/${this.lessonUuid}. My user ID is ${this.userId}.`
  );
}
```

**Step 2: Delete old Lambdas**

```bash
rm -rf Backend/serverless/Lambda/ai_chatbot/
rm -rf Backend/serverless/Lambda/feedback_request/
```

**Step 3: Update deploy workflow**

Remove the build/push steps for `ai_chatbot` and `feedback_request` Lambdas from `.github/workflows/deploy.yml`. Keep the `document_indexer` Lambda build (it's still needed for S3 → LanceDB indexing).

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove old chatbot Lambda and feedback pipeline — replaced by AgentCore agents"
```

---

## Task 8: Integration Testing & End-to-End Verification

Test the complete flow from frontend through agents.

**Step 1: Deploy updated backend to EKS**

```bash
# Build and push backend image
cd Backend
docker build -t rosettacloud-backend .
# Push to ECR, then kubectl rollout restart
```

**Step 2: Deploy frontend to EKS**

```bash
cd Frontend
ng build
docker build -t rosettacloud-frontend .
# Push to ECR, then kubectl rollout restart
```

**Step 3: Test Tutor Agent**

1. Open `https://dev.rosettacloud.app`
2. Open the chatbot panel
3. Type "What is a Kubernetes pod?"
4. Verify: Response appears with Tutor Agent card header (blue, 📚)
5. Verify: Hints-first pedagogy (doesn't give direct answer)

**Step 4: Test Grader Agent — auto-grade**

1. Start a lab, navigate to a lesson
2. Answer a question (MCQ or practical check)
3. Verify: Auto-grade message appears in chatbot with Grader Agent card (green, ✅)
4. Verify: Feedback explains why correct/incorrect

**Step 5: Test Curriculum Planner**

1. In the chatbot, type "What should I study next?"
2. Verify: Response appears with Curriculum Planner card (purple, 🗺️)
3. Verify: Shows progress summary and recommendations

**Step 6: Test on-demand grading**

1. Type "How am I doing so far?"
2. Verify: Grader Agent responds with comprehensive progress analysis

**Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for multi-agent platform"
```

---

## Task 9: AgentCore Observability (Demo Polish)

Set up tracing to show agent decision-making in the demo video.

**Step 1: Enable AgentCore Observability**

AgentCore provides built-in observability via OpenTelemetry. Enable it in the agent code:

```python
# In Backend/agents/app.py, add:
import os
os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = "https://otlp.us-east-1.amazonaws.com"
```

**Step 2: Verify traces in CloudWatch**

Check CloudWatch → X-Ray traces to see:
- Orchestrator receives message
- Orchestrator routes to Tutor/Grader/Planner
- Specialist agent calls tools
- Tool execution time
- Total response time

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: enable AgentCore observability for agent tracing"
```

---

## Task 10: Hackathon Submission Preparation

**Step 1: Record 3-minute demo video**

Demo flow:
1. Show RosettaCloud landing page (0:00-0:15)
2. Student logs in, starts a lab (0:15-0:30)
3. Student asks Tutor "What is Docker?" — show agent card (0:30-1:00)
4. Student answers a question — auto-grade with Grader feedback (1:00-1:30)
5. Student asks "What should I learn next?" — Planner response (1:30-2:00)
6. Show architecture diagram — 4 agents on AgentCore Runtime (2:00-2:30)
7. Show AgentCore observability traces (2:30-2:50)
8. Closing: education impact for MENA region (2:50-3:00)

**Step 2: Write builder.aws.com blog post (bonus prize)**

Cover:
- The problem: DevOps education lacks personalization
- The solution: Multi-agent AI platform with specialized agents
- Technical architecture: AgentCore Runtime + Nova 2 Lite + Strands SDK
- Community impact: Accessible education for MENA region
- Include #AmazonNova hashtag

**Step 3: Submit to Devpost**

- Category: Agentic AI
- Description, demo video, code repo link
- Blog post link for bonus prize

**Step 4: Submit AIdeas article (Mar 13)**

Write Builder Center article showcasing the multi-agent architecture.
