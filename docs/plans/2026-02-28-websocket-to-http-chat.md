# WebSocket → HTTP Chat Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the WebSocket chatbot flow (API Gateway WS → ws_agent_handler Lambda → AgentCore) with a simple HTTP POST endpoint on the existing FastAPI backend, eliminating the Lambda middleman and fixing conversation memory via in-process history.

**Architecture:** Frontend posts `{message, session_id, …}` to `POST https://api.dev.rosettacloud.app/chat`, which already serves all other API traffic. The FastAPI backend maintains per-session conversation history in an in-process dict (same pattern as `questions_backends.py`), passes it in every AgentCore payload, and returns the full response as JSON. The entire WebSocket infrastructure (`ws_agent_handler` Lambda, API Gateway WebSocket, `wss.dev.rosettacloud.app` domain) is deleted.

**Tech Stack:** FastAPI (Python 3.12), Angular 19 (TypeScript), AWS Bedrock AgentCore (`boto3`), Terraform (IaC cleanup)

---

## Background / Why This Works

**Why WebSocket memory never worked:** `ws_agent_handler` is a Lambda — each invocation may hit a different Lambda instance, so the global dict was unreliable. AgentCore containers also don't guarantee session affinity.

**Why HTTP solves it:** The FastAPI backend is a single pod (`replicas: 1`). Its in-process dict is fully reliable for the lifetime of the pod. History is keyed by `session_id` (generated once per page load in the frontend, stable for the whole chat session).

**Why no Redis needed:** The existing questions backend uses the same in-process TTL-dict pattern (see `Backend/app/backends/questions_backends.py:18-28`). Redis is in the cluster but the backend never actually connected to it — the `REDIS_HOST`/`REDIS_PORT` ConfigMap entries are vestigial.

**What stays unchanged:**
- `Backend/agents/` (AgentCore Runtime) — no changes
- `agent-deploy` CI/CD workflow — no changes
- All other FastAPI routes — no changes

---

## Task 1: Backend — Add `POST /chat` endpoint

**Files:**
- Modify: `Backend/app/main.py`

**Context:**
The backend calls AgentCore synchronously via `boto3`. Since FastAPI is async and boto3 is sync, we use `asyncio.get_event_loop().run_in_executor(None, fn)` to avoid blocking the event loop — the same way any sync I/O should be done in FastAPI.

The backend IRSA role (`rosettacloud-backend-irsa`) currently lacks `bedrock-agentcore:InvokeAgentRuntime` — that permission is only on the Lambda role. Task 2 fixes that. For now, implement the endpoint; it will fail with AuthError until Task 2 is applied.

**Step 1: Add imports and module-level constants/history dict**

At the top of `Backend/app/main.py`, add these imports alongside the existing ones:

```python
import json
import logging
import asyncio
```

And add after the existing `app = FastAPI(...)` block (before any route definitions):

```python
logger = logging.getLogger(__name__)

# ── AgentCore chat configuration ──
_AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN", "")
_AGENT_REGION = os.environ.get("AWS_REGION", "us-east-1")

# ── In-process chat history (same pattern as questions_backends.py) ──
# Keyed by session_id. Each entry: (timestamp_float, list_of_{role,text}_dicts).
# Single-replica pod → fully reliable. Max 40 messages (20 turns) per session.
_chat_histories: dict = {}
_CHAT_HISTORY_TTL = 14400   # 4 hours
_CHAT_MAX_MESSAGES = 40     # 20 turns

def _chat_history_get(session_id: str) -> list:
    entry = _chat_histories.get(session_id)
    if entry and time.time() - entry[0] < _CHAT_HISTORY_TTL:
        return entry[1]
    _chat_histories.pop(session_id, None)
    return []

def _chat_history_set(session_id: str, history: list) -> None:
    _chat_histories[session_id] = (time.time(), history)
```

**Step 2: Add Pydantic models**

Add alongside the existing request/response models (before the route definitions):

```python
class ChatRequest(BaseModel):
    message: str = ""
    user_id: str = ""
    session_id: str = ""
    module_uuid: str = ""
    lesson_uuid: str = ""
    type: str = "chat"
    # grade-only fields
    question_number: int = 0
    result: str = ""

class ChatResponse(BaseModel):
    response: str
    agent: str
    session_id: str
```

**Step 3: Add the `/chat` endpoint**

Add at the end of `Backend/app/main.py`, before the health-check:

```python
@app.post("/chat", response_model=ChatResponse, tags=["Chat"])
async def chat(request: ChatRequest):
    if not _AGENT_RUNTIME_ARN:
        raise HTTPException(status_code=503, detail="AGENT_RUNTIME_ARN not configured")

    session_id = request.session_id
    history = _chat_history_get(session_id) if session_id else []

    # Ensure runtime_session_id meets AgentCore's 33-char minimum
    runtime_session_id = session_id
    if len(runtime_session_id) < 33:
        import secrets
        runtime_session_id = session_id + "-" + secrets.token_hex(8)

    payload = {
        "message": request.message,
        "user_id": request.user_id,
        "session_id": session_id,
        "type": request.type,
        "module_uuid": request.module_uuid,
        "lesson_uuid": request.lesson_uuid,
        "conversation_history": history,
    }
    if request.type == "grade":
        payload["question_number"] = request.question_number
        payload["result"] = request.result

    def _invoke():
        import boto3
        client = boto3.client("bedrock-agentcore", region_name=_AGENT_REGION)
        resp = client.invoke_agent_runtime(
            agentRuntimeArn=_AGENT_RUNTIME_ARN,
            runtimeSessionId=runtime_session_id,
            payload=json.dumps(payload),
            qualifier="DEFAULT",
        )
        return json.loads(resp["response"].read())

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _invoke)
    except Exception as e:
        logger.error("AgentCore invocation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Agent error: {e}")

    agent_response = result.get("response", "")
    agent_name = result.get("agent", "tutor")

    # Persist history
    if session_id:
        updated = history + [
            {"role": "user", "text": request.message},
            {"role": "assistant", "text": agent_response},
        ]
        if len(updated) > _CHAT_MAX_MESSAGES:
            updated = updated[-_CHAT_MAX_MESSAGES:]
        _chat_history_set(session_id, updated)

    return ChatResponse(response=agent_response, agent=agent_name, session_id=session_id)
```

**Step 4: Add AGENT_RUNTIME_ARN to K8s ConfigMap**

In `DevSecOps/K8S/be-deployment.yaml`, add to the `ConfigMap` data section:

```yaml
data:
  LAB_IMAGE_PULL_SECRET: "ecr-creds"
  LAB_K8S_NAMESPACE: "dev"
  LAB_POD_IMAGE: "339712964409.dkr.ecr.us-east-1.amazonaws.com/interactive-labs:latest"
  AWS_REGION: "us-east-1"
  INGRESS_NAME: "rosettacloud-ingress"
  REDIS_HOST: "redis-service"
  REDIS_PORT: "6379"
  AGENT_RUNTIME_ARN: "arn:aws:bedrock-agentcore:us-east-1:339712964409:runtime/rosettacloud_education_agent-yebWcC9Yqy"
```

And add the env var to the container spec in the Deployment, alongside the existing ones:

```yaml
- name: AGENT_RUNTIME_ARN
  valueFrom:
    configMapKeyRef:
      name: rosettacloud-backend-config
      key: AGENT_RUNTIME_ARN
```

**Step 5: Verify Python syntax**

```bash
cd /home/sorour/RosettaCloud/Backend
python3 -c "import ast; ast.parse(open('app/main.py').read()); print('OK')"
```
Expected: `OK`

**Step 6: Commit**

```bash
cd /home/sorour/RosettaCloud
git add Backend/app/main.py DevSecOps/K8S/be-deployment.yaml
git commit -m "feat: add POST /chat endpoint to FastAPI backend with in-process history"
```

---

## Task 2: Terraform — Add AgentCore permission to backend IRSA

**Files:**
- Modify: `DevSecOps/Terraform/environments/shared/main.tf`

**Context:**
The backend IRSA role (`rosettacloud-backend-irsa`) currently has DynamoDB, S3, and Bedrock InvokeModel permissions but NOT `bedrock-agentcore:InvokeAgentRuntime`. That permission is only on the Lambda role. We add it now.

**Step 1: Add AgentCore permission to backend IRSA policy**

In `main.tf`, find the `backend_irsa_permissions` inline policy. It has statements for DynamoDB, S3, Bedrock. Add a new statement:

```hcl
      {
        Sid      = "AgentCoreInvoke"
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:InvokeAgentRuntime"]
        Resource = ["arn:aws:bedrock-agentcore:us-east-1:${local.account_id}:runtime/*"]
      },
```

Add it after the existing `Bedrock` statement block.

**Step 2: Run terraform plan to verify**

```bash
cd /home/sorour/RosettaCloud/DevSecOps/Terraform/environments/shared
terraform plan -var-file="terraform.tfvars" 2>&1 | grep -E "Plan:|will be|must be"
```
Expected: `Plan: 0 to add, 1 to change, 0 to destroy.` (updating the inline policy)

**Step 3: Apply**

```bash
terraform apply -var-file="terraform.tfvars" -auto-approve 2>&1 | tail -5
```
Expected: `Apply complete! Resources: 0 added, 1 changed, 0 destroyed.`

**Step 4: Commit**

```bash
cd /home/sorour/RosettaCloud
git add DevSecOps/Terraform/environments/shared/main.tf
git commit -m "feat: add bedrock-agentcore InvokeAgentRuntime permission to backend IRSA"
```

---

## Task 3: Frontend — Replace WebSocket service with HTTP

**Files:**
- Modify: `Frontend/src/app/services/chatbot.service.ts`
- Modify: `Frontend/src/environments/environment.ts`
- Modify: `Frontend/src/environments/environment.development.ts`
- Modify: `Frontend/src/environments/environment.uat.ts` (if exists)
- Modify: `Frontend/src/environments/environment.stg.ts` (if exists)

**Context:**
The existing service exposes `messages$`, `sources$`, `loading$`, `connected$` observables. Components depend on these. We keep the same public API signatures to avoid changing component code, but simplify the internals — WebSocket is replaced with `HttpClient.post()`, `connected$` always emits `true`, `sources$` stays empty (AgentCore doesn't return source docs).

The existing `setLabContext()` and `setUserId()` methods (added in Task 1 of the previous sprint) are kept.

**Step 1: Update chatbotApiUrl in all environment files**

In every `Frontend/src/environments/environment*.ts` file that has `chatbotApiUrl`, change it from the `wss://` URL to:

```typescript
chatbotApiUrl: 'https://api.dev.rosettacloud.app/chat',
```

Also remove `feedbackApiUrl` from the environments if present — it was for the deleted feedback Lambda.

**Step 2: Rewrite chatbot.service.ts**

Replace the entire contents of `Frontend/src/app/services/chatbot.service.ts` with:

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, of } from 'rxjs';
import { environment } from '../../environments/environment';

export type AgentType = 'tutor' | 'grader' | 'planner' | null;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
  id?: string;
  agent?: AgentType;
}

export interface Source {
  filename: string;
  path: string;
  bucket: string;
}

interface ChatApiResponse {
  response: string;
  agent: string;
  session_id: string;
}

@Injectable({
  providedIn: 'root',
})
export class ChatbotService {
  private apiUrl = environment.chatbotApiUrl;
  private sessionId: string;

  private userId = '';
  private moduleUuid = '';
  private lessonUuid = '';

  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  private loadingSubject = new BehaviorSubject<boolean>(false);

  // HTTP is always "connected"; sources are not returned by AgentCore.
  public messages$ = this.messagesSubject.asObservable();
  public loading$ = this.loadingSubject.asObservable();
  public connected$ = of(true);
  public sources$ = of<Source[]>([]);

  constructor(private http: HttpClient) {
    this.sessionId = 'session-' + crypto.randomUUID() + '-' + Date.now();
    this.addMessage({
      role: 'system',
      content: 'Connected to RosettaCloud Assistant. Ask any questions about the lab!',
      timestamp: new Date(),
    });
  }

  public setUserId(userId: string): void {
    this.userId = userId;
  }

  public setLabContext(moduleUuid: string, lessonUuid: string): void {
    this.moduleUuid = moduleUuid;
    this.lessonUuid = lessonUuid;
  }

  public sendMessage(message: string): void {
    this.addMessage({ role: 'user', content: message, timestamp: new Date() });
    this.loadingSubject.next(true);

    this.http
      .post<ChatApiResponse>(this.apiUrl, {
        session_id: this.sessionId,
        message,
        user_id: this.userId,
        module_uuid: this.moduleUuid,
        lesson_uuid: this.lessonUuid,
        type: 'chat',
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
            content: `Agent error: ${err.message ?? 'Unknown error'}`,
            timestamp: new Date(),
          });
          this.loadingSubject.next(false);
        },
      });
  }

  public sendGradeMessage(
    moduleUuid: string,
    lessonUuid: string,
    questionNumber: number,
    result: string
  ): void {
    this.loadingSubject.next(true);

    this.http
      .post<ChatApiResponse>(this.apiUrl, {
        session_id: this.sessionId,
        user_id: this.userId,
        type: 'grade',
        message: '',
        module_uuid: moduleUuid,
        lesson_uuid: lessonUuid,
        question_number: questionNumber,
        result,
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
            content: `Grade error: ${err.message ?? 'Unknown error'}`,
            timestamp: new Date(),
          });
          this.loadingSubject.next(false);
        },
      });
  }

  public sendFeedbackRequest(
    moduleUuid: string,
    lessonUuid: string,
    questions: any[],
    userProgress: any
  ): void {
    const questionSummary = questions
      .map((q: any) => {
        const qNum = q.question_number || q.id;
        const completed = userProgress?.[qNum?.toString()] === true;
        return `Q${qNum}: ${q.question || q.question_text} — ${completed ? 'Completed' : 'Not completed'}`;
      })
      .join('\n');

    const feedbackPrompt =
      `Please provide comprehensive feedback for this lab session.\n` +
      `Module: ${moduleUuid}\nLesson: ${lessonUuid}\n` +
      `Progress summary:\n${questionSummary}\n\n` +
      `Provide: overall performance assessment, strengths, areas for improvement, and next steps.`;

    this.addMessage({
      role: 'user',
      content: 'Generate my lab feedback report',
      timestamp: new Date(),
    });
    this.loadingSubject.next(true);

    this.http
      .post<ChatApiResponse>(this.apiUrl, {
        session_id: this.sessionId,
        user_id: this.userId,
        type: 'grade',
        message: feedbackPrompt,
        module_uuid: moduleUuid,
        lesson_uuid: lessonUuid,
        question_number: 0,
        result: `Lab feedback request. ${questions.length} total questions.`,
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
            content: `Feedback error: ${err.message ?? 'Unknown error'}`,
            timestamp: new Date(),
          });
          this.loadingSubject.next(false);
        },
      });
  }

  public clearChat(): void {
    this.messagesSubject.next([
      {
        role: 'system',
        content: 'Chat cleared. Ask any questions about the lab!',
        timestamp: new Date(),
      },
    ]);
  }

  private addMessage(message: ChatMessage): void {
    const current = this.messagesSubject.getValue();
    this.messagesSubject.next([...current, message]);
  }
}
```

**Step 3: Build to verify no TypeScript errors**

```bash
cd /home/sorour/RosettaCloud/Frontend
ng build --configuration=development 2>&1 | tail -20
```
Expected: Build succeeds, no TypeScript errors. SCSS warnings from pre-existing files are OK.

**Step 4: Commit**

```bash
cd /home/sorour/RosettaCloud
git add Frontend/src/app/services/chatbot.service.ts
git add Frontend/src/environments/
git commit -m "feat: replace WebSocket chatbot with HTTP POST to /chat"
```

---

## Task 4: Cleanup — Delete ws_agent_handler and WebSocket infrastructure

**Files:**
- Delete: `Backend/serverless/Lambda/ws_agent_handler/` (entire directory)
- Modify: `.github/workflows/lambda-deploy.yml`
- Modify: `DevSecOps/Terraform/environments/shared/main.tf`
- Modify: `DevSecOps/Terraform/environments/shared/outputs.tf`

**Context:**
We remove: the Lambda ECR repo, the Lambda IAM role, the API Gateway WebSocket API, the `wss.dev.rosettacloud.app` custom domain and Route53 record, and the Lambda function itself (already deleted earlier as part of migration, but Terraform still manages these resources).

Note: The actual Lambda function was already deleted manually. Terraform needs to be updated to not manage it anymore.

**Step 1: Remove ws_agent_handler from lambda-deploy workflow**

In `.github/workflows/lambda-deploy.yml`, find and remove the entire `ws-agent-handler` job. Keep the `document-indexer` job.

The file currently has a `detect-changes` job and at least `ws-agent-handler` and `document-indexer` jobs. Remove the `ws-agent-handler` job entirely. If `detect-changes` outputs a flag for `ws_agent_handler`, remove that output too.

**Step 2: Delete ws_agent_handler source directory**

```bash
rm -rf /home/sorour/RosettaCloud/Backend/serverless/Lambda/ws_agent_handler
```

**Step 3: Remove WebSocket Terraform resources from main.tf**

Remove these complete resource blocks from `main.tf`:
- `resource "aws_ecr_repository" "ws_agent_handler_lambda"` — ECR repo
- `resource "aws_iam_role" "ws_agent_handler"` — Lambda IAM role
- `resource "aws_iam_role_policy_attachment" "ws_agent_handler_basic"` — role policy attachment
- `resource "aws_iam_role_policy" "ws_agent_handler_permissions"` — inline policy
- `resource "aws_apigatewayv2_api" "chatbot_ws"` — WebSocket API
- `resource "aws_apigatewayv2_integration" "chatbot_ws"` — API integration
- `resource "aws_apigatewayv2_route" "ws_connect"` — $connect route
- `resource "aws_apigatewayv2_route" "ws_disconnect"` — $disconnect route
- `resource "aws_apigatewayv2_route" "ws_default"` — $default route
- `resource "aws_apigatewayv2_stage" "chatbot_ws"` — production stage
- `resource "aws_lambda_permission" "apigw_chatbot"` — Lambda invoke permission
- `resource "aws_apigatewayv2_domain_name" "wss"` — custom domain
- `resource "aws_apigatewayv2_api_mapping" "wss"` — domain mapping
- `resource "aws_route53_record" "wss_dev"` — DNS record (find by searching for `wss_dev` or `wss.dev.rosettacloud`)

Also find and remove the section comment `# API Gateway v2 – WebSocket (ws_agent_handler → AgentCore)` and `# IAM – ws_agent_handler Lambda execution role`.

**Step 4: Remove ws_agent_handler outputs from outputs.tf**

In `DevSecOps/Terraform/environments/shared/outputs.tf`, remove:
- `output "chatbot_ws_api_endpoint"` — WebSocket API endpoint output
- `output "chatbot_ws_custom_domain"` — custom domain output

**Step 5: Run terraform plan**

```bash
cd /home/sorour/RosettaCloud/DevSecOps/Terraform/environments/shared
terraform plan -var-file="terraform.tfvars" 2>&1 | grep -E "Plan:|will be destroyed|must be"
```

Expected: `Plan: 0 to add, 0 to change, N to destroy.` where N is ~10-14 resources (ECR repo, IAM roles, API Gateway, Route53 record, etc.)

If `terraform plan` shows any errors about resources that no longer exist (already deleted), run `terraform state rm` for each:
```bash
terraform state rm <resource_address>
```

**Step 6: Apply destruction**

```bash
terraform apply -var-file="terraform.tfvars" -auto-approve 2>&1 | tail -10
```
Expected: `Apply complete! Resources: 0 added, 0 changed, N destroyed.`

**Step 7: Commit**

```bash
cd /home/sorour/RosettaCloud
git add .github/workflows/lambda-deploy.yml
git add DevSecOps/Terraform/environments/shared/main.tf
git add DevSecOps/Terraform/environments/shared/outputs.tf
git rm -r Backend/serverless/Lambda/ws_agent_handler/
git commit -m "chore: remove ws_agent_handler Lambda and WebSocket infrastructure"
```

---

## Task 5: Deploy and verify

**Step 1: Push all commits to trigger CI**

```bash
cd /home/sorour/RosettaCloud
git push origin main
```

This triggers `backend-build` (builds new Docker image with `/chat` endpoint) and `frontend-build`.

**Step 2: Apply K8s ConfigMap update**

The ConfigMap now has `AGENT_RUNTIME_ARN`. Apply it:

```bash
kubectl apply -f DevSecOps/K8S/be-deployment.yaml -n dev
```

Then restart the backend pod to pick up the new env var:

```bash
kubectl rollout restart deployment/rosettacloud-backend -n dev
kubectl rollout status deployment/rosettacloud-backend -n dev
```

Wait until: `deployment "rosettacloud-backend" successfully rolled out`

**Step 3: Test the /chat endpoint**

```bash
curl -X POST https://api.dev.rosettacloud.app/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is Docker?",
    "user_id": "test",
    "session_id": "test-http-chat-session-abc1234567890abcdef"
  }' | jq .
```

Expected: `{"response": "...(hint about Docker)...", "agent": "tutor", "session_id": "..."}`

**Step 4: Test memory**

```bash
# Message 1
curl -s -X POST https://api.dev.rosettacloud.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is a Kubernetes pod?", "user_id": "test", "session_id": "memory-test-http-123456789012345678901234"}' | jq .response

# Message 2 (same session_id)
curl -s -X POST https://api.dev.rosettacloud.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What was my previous question?", "user_id": "test", "session_id": "memory-test-http-123456789012345678901234"}' | jq .response
```

Expected: Message 2 references "Kubernetes" or "pod" from message 1.

**Step 5: Update CLAUDE.md**

Update the AI Chatbot Flow section to reflect HTTP (not WebSocket). Update the environments table to show `chatbotApiUrl` is now `https://api.dev.rosettacloud.app/chat`. Remove `wss.dev.rosettacloud.app` from API Gateway Endpoints table.

**Step 6: Commit and push**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect HTTP chat endpoint"
git push origin main
```

---

## Files Modified Summary

| File | Action |
|------|--------|
| `Backend/app/main.py` | Add `POST /chat` endpoint with history |
| `DevSecOps/K8S/be-deployment.yaml` | Add `AGENT_RUNTIME_ARN` ConfigMap entry + env var |
| `DevSecOps/Terraform/environments/shared/main.tf` | Add AgentCore to IRSA; remove all ws_agent_handler + WebSocket resources |
| `DevSecOps/Terraform/environments/shared/outputs.tf` | Remove WebSocket outputs |
| `Frontend/src/app/services/chatbot.service.ts` | Rewrite: WebSocket → HTTP |
| `Frontend/src/environments/environment*.ts` | Change `chatbotApiUrl` to `/chat` HTTP URL |
| `.github/workflows/lambda-deploy.yml` | Remove `ws-agent-handler` job |
| `Backend/serverless/Lambda/ws_agent_handler/` | Delete entire directory |
| `CLAUDE.md` | Update docs |

## What Does NOT Change

| Item | Why kept |
|------|---------|
| `Backend/agents/` (AgentCore Runtime) | Unchanged — same agent code, same deploy |
| `agent-deploy` CI workflow | Unchanged |
| `Backend/serverless/Lambda/document_indexer/` | Unchanged |
| `lambda-deploy.yml` `document-indexer` job | Unchanged |
| Redis in K8s | Unchanged (used by questions in-memory, ConfigMap kept) |
| `Backend/agents/agent.py` in-process history dict | Kept — useful as fallback for CLI invocations |
