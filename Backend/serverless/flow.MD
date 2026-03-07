## Current Serverless Architecture

The platform uses two Lambda functions as part of the AI and document-processing pipeline.

---

### 1. `document_indexer` Lambda

**Trigger:** S3 EventBridge notification when `.sh` files are uploaded to `s3://rosettacloud-shared-interactive-labs/{module_uuid}/{lesson_uuid}/`

**Flow:**
```
S3 upload (.sh file)
  → EventBridge rule (rosettacloud-s3-sh-upload)
  → document_indexer Lambda (container image)
  → Parse shell script header (question text, type, difficulty, answers)
  → Titan Embed v2 (Amazon Bedrock) → vector embedding
  → LanceDB on S3 (table: shell-scripts-knowledge-base)
```

**Deployed via:** `lambda-deploy.yml` GitHub Actions workflow (container image → ECR → Lambda update).

---

### 2. `agent_tools` Lambda (AgentCore Gateway Target)

**Trigger:** Amazon Bedrock AgentCore Gateway (`rosettacloud-education-tools`) — called by the multi-agent runtime when a tool is invoked.

**Tool dispatch:**

| Tool name (Gateway) | Normalized (Lambda) | Description |
|---------------------|---------------------|-------------|
| `education-tools___search-knowledge-base` | `search_knowledge_base` | LanceDB vector search — RAG for tutor agent |
| `education-tools___get-question-details` | `get_question_details` | Fetch question text/answers from S3 |
| `education-tools___get-question-metadata` | `get_question_metadata` | Module/lesson metadata |
| `education-tools___get-user-progress` | `get_user_progress` | DynamoDB progress for grader/planner |
| `education-tools___get-attempt-result` | `get_attempt_result` | Last attempt result |
| `education-tools___list-available-modules` | `list_available_modules` | All available modules |

**Event format (AgentCore Gateway → Lambda):**
```python
# Tool name location:
tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
# e.g. "education-tools___get-question-details"

# Event IS the flat tool input params (NOT wrapped):
# { "module_uuid": "linux-docker-k8s-101", "lesson_uuid": "intro-lesson-01", "question_number": 1 }
```

**Deployed via:** `lambda-deploy.yml` GitHub Actions workflow.

---

### AI Chat Request Flow (current)

```
Browser POST /chat {message, user_id, session_id, module_uuid, lesson_uuid}
  → API Gateway (JWT validated)
  → FastAPI /chat endpoint
  → Load in-process session history (_chat_histories[session_id])
  → boto3 invoke_agent_runtime(payload + history)
  → AgentCore Runtime (rosettacloud_education_agent)
  → _classify(message, type) → tutor | grader | planner
  → Agent(Nova Lite, tools=[...], session_manager=AgentCoreMemorySessionManager)
  → Tool calls → AgentCore Gateway → agent_tools Lambda → DynamoDB/S3/LanceDB
  → Response → FastAPI saves history → JSON response to browser
```

**No WebSockets** — purely synchronous HTTP POST. Session continuity maintained by:
- **Within session:** in-process `_chat_histories` dict in FastAPI pod (keyed by `session_id`, max 40 msgs, 4h TTL)
- **Cross session:** AgentCore Memory (`rosettacloud_education_memory-evO1o3F0jN`) via `AgentCoreMemorySessionManager`
