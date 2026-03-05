# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

Monorepo with three top-level directories, each originally a separate repo:

- **Frontend/** — Angular 19 SPA
- **Backend/** — FastAPI API server + Lambda functions
- **DevSecOps/** — Kubernetes manifests, Terraform IaC, interactive labs Dockerfile

## Common Commands

### Frontend (Angular 19)

```bash
cd Frontend
npm install
ng serve                          # dev server (port 4200)
ng serve -c=uat                   # UAT config
ng build                          # production build (output: dist/rosetta-cloud-frontend/)
ng build --configuration=development
ng test                           # Karma + Jasmine unit tests
```

### Backend (FastAPI) — Local Dev

```bash
cd Backend
pip install -r requirements.txt --break-system-packages

# Requires local Redis (sudo apt install redis-server && sudo service redis start)
REDIS_HOST=localhost \
LAB_K8S_NAMESPACE=dev \
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

uvicorn app.main:app --host 0.0.0.0 --port 80   # production (inside container)
```

**Local dev notes:**
- `REDIS_HOST=localhost` — K8s service name `redis-service` doesn't resolve locally
- `LAB_K8S_NAMESPACE=dev` — default is `openedx`, cluster uses `dev`; backend falls back to `~/.kube/config` automatically (current context: `rosettacloud-eks`)
- Kill stale port: `fuser -k 8000/tcp`

Note: Backend has no test suite wired up yet. The entry point is `app.main:app`.

### Terraform

```bash
cd DevSecOps/Terraform/environments/shared
terraform init
terraform plan -var-file="terraform.tfvars"
terraform apply -var-file="terraform.tfvars"
```

Remote state: S3 bucket `rosettacloud-shared-terraform-backend` in `us-east-1`.

**Terraform manages infrastructure only** (VPC, EKS, ECR repos, IAM roles, API Gateway, S3, Route 53, CloudFront). Lambda functions are **not** managed by Terraform — they're deployed via CI/CD pipelines (`lambda-deploy.yml`, `agent-deploy.yml`).

### Kubernetes

```bash
kubectl apply -f DevSecOps/K8S/    # deploys to namespace 'dev'
kubectl get pods -n dev
```

## Architecture

Architecture diagrams are in `Arch/` directory.

### Request Flow

- **Frontend → Backend**: REST API via `https://api.dev.rosettacloud.app` (FastAPI on K8s, Istio VirtualService)
- **Frontend → Chatbot**: HTTP POST to `https://api.dev.rosettacloud.app/chat` (FastAPI backend → AgentCore Runtime via boto3)

### Infrastructure

- **EKS Auto Mode** (k8s 1.33): Cluster `rosettacloud-eks` with custom Karpenter NodePool `rosettacloud-spot` (t3.xlarge, spot, max 1 node). NodePool definition lives in-cluster only, not in Terraform.
- **CloudFront** (`d2rn486bpgcf7d.cloudfront.net`): Routes to Istio ingress NodePort 30578 on the EKS node. Origin is the node's public DNS (updated in `terraform.tfvars` as `node_public_dns`).
- **Istio**: Service mesh with sidecar injection in `dev` namespace. Lab pods opt out with `sidecar.istio.io/inject: "false"` annotation. Istio ingress (NodePort) handles all inbound traffic via VirtualService routing.
- **Route 53**: `rosettacloud.app` hosted zone. `dev.rosettacloud.app`, `api.dev.rosettacloud.app`, `*.labs.dev.rosettacloud.app` all alias to CloudFront.

### Backend Internal Pattern

Each feature area follows a **service/backend** split:
- `app/services/*.py` — thin orchestration layer (business logic)
- `app/backends/*.py` — concrete implementations (AWS SDK calls, K8s API, Redis)

Service → Backend mappings:
- `labs_service` → `labs_backends` (Kubernetes SDK: creates pods, services, Istio VirtualService per-lab; namespace `dev`)
- `users_service` → `users_backends` (DynamoDB)
- `questions_service` → `questions_backends` (S3 shell scripts + in-memory TTL cache; uses async subprocess for kubectl)

### Create Lab Flow

1. Frontend `POST /labs` with `{user_id}`
2. Backend verifies user in DynamoDB, checks Redis `active_labs:{user_id}` → 400 if lab already exists
3. `lab.launch()` generates `lab_id` (`lab-{uuid8}`), creates **in parallel** (`asyncio.gather`):
   - **Pod** `lab-{lab_id}`: privileged, `interactive-labs:latest` (`IfNotPresent`), no Istio sidecar
   - **Service** `{lab_id}-svc`: ClusterIP targeting pod by `lab-id` label
   - **VirtualService** `{lab_id}`: routes `{lab_id}.labs.dev.rosettacloud.app` → service via Istio gateway
4. Stores lab_id in Redis (`active_labs:{user_id}`) + links lab to user in DynamoDB
5. Returns `{lab_id}` → frontend polls `GET /labs/{lab_id}` for status
6. Backend reads pod status from K8s: `Running + Ready = "running"`, `Running + !Ready = "starting"`

**Container startup** (`/usr/local/bin/start.sh`):
1. code-server (port 8080) + Caddy (port 80, reverse proxy) start in background — ~2-3s
2. Readiness probe succeeds once Caddy responds → pod Ready in **~6-10s**
3. dockerd starts, waits for `docker info` — ~5-15s (background to user)
4. `docker load -i /kind-node.tar` (650MB+) — ~10-30s (background to user)
5. `kind create cluster` — ~30-60s CPU-intensive (background to user)

**Image**: 1.86 GB, `IfNotPresent` policy (200ms cached pull). No `imagePullSecrets`; EKS node IAM role handles ECR auth. Lab pods annotated `sidecar.istio.io/inject: "false"`.

Readiness probe: HTTP GET `/` port 80, `initial_delay=3s`, `period=3s`, `timeout=5s`, `failure_threshold=40`.

**Resource warning:** Each lab runs a full Kind cluster. A t3.xlarge (4 CPU) supports platform services + 1 lab. Two concurrent Kind clusters starve the entire node.

### AI Chatbot Flow (HTTP POST → AgentCore Multi-Agent)

1. Frontend sends `POST https://api.dev.rosettacloud.app/chat` with `{session_id, message, user_id, module_uuid, lesson_uuid}`
2. `session_id` generated once per page load by `ChatbotService` constructor (stable for the whole chat session); module/lesson set via `ChatbotService.setLabContext()` by `LabComponent.ngOnInit`
3. FastAPI `/chat` endpoint loads in-process history from `_chat_histories` dict (keyed by `session_id`), includes it as `conversation_history` in the AgentCore payload
4. FastAPI calls `invoke_agent_runtime` synchronously via boto3 (`bedrock-agentcore` service)
5. AgentCore classifies message → routes to tutor, grader, or planner agent
6. **Tutor**: `search_knowledge_base` (LanceDB vector search) + `get_question_details` + `get_question_metadata`; calls `get_question_details(module_uuid, lesson_uuid, N)` for "question N" asks
7. **Grader**: `get_question_details`, `get_user_progress`, `get_attempt_result`
8. **Planner**: `get_user_progress`, `list_available_modules`, `get_question_metadata`
9. In-process session history (FastAPI): `_chat_histories` dict in FastAPI backend pod (keyed by `session_id`, max 40 messages, 4-hour TTL, max 500 sessions); single-replica pod makes this fully reliable
10. In-process session history (AgentCore): `_session_histories` dict in AgentCore Runtime container; reads from `conversation_history` payload (sent by FastAPI), used as fallback for CLI invocations
11. AgentCore Memory (`rosettacloud_education_memory-evO1o3F0jN`): long-term cross-session persistence via `AgentCoreMemorySessionManager`
12. Response returned as JSON `{response, agent, session_id}` — FastAPI saves updated history, returns response to frontend

### Document Indexing Flow

1. Shell scripts uploaded to `s3://rosettacloud-shared-interactive-labs/{module_uuid}/{lesson_uuid}/`
2. S3 EventBridge notification triggers `document_indexer` Lambda
3. Lambda processes scripts and extracts metadata (question text, type, difficulty, answers)
4. Amazon Bedrock creates Titan embeddings (`amazon.titan-embed-text-v2:0`)
5. Vectors stored in LanceDB at `s3://rosettacloud-shared-interactive-labs-vector` (table: `shell-scripts-knowledge-base`)

### Questions / Shell Script Pipeline

1. Frontend calls `GET /questions/{module_uuid}/{lesson_uuid}` → backend fetches `.sh` files from S3
2. Parses shell script headers (question number, text, type, difficulty, choices, correct answer)
3. Caches parsed questions + raw shell content in Redis (1-hour TTL)
4. Returns question metadata to frontend

**Question Types:**
- **MCQ (Multiple Choice)**: Frontend validates answer client-side against correct option from cache → `POST /users/{id}/progress/...` updates DynamoDB → UI updates
- **Practical Check**: Frontend triggers setup → Question Service extracts `-q` script from shell, `kubectl cp` + `kubectl exec` in pod → user works → "Check Solution" → extracts `-c` script → `kubectl cp` + `kubectl exec` → exit code 0 = correct → DynamoDB progress updated

Questions backend uses `asyncio.create_subprocess_exec` for kubectl with per-pod `asyncio.Lock` (prevents concurrent `kubectl cp` tar corruption). 30-second timeout on all kubectl operations.

### Supplementary Services

- **Serverless Components**: Lambda function for document indexing (`document_indexer`)
- **AgentCore Runtime**: Multi-agent platform (tutor/grader/planner) deployed via `agentcore` CLI
- **Redis**: In-cluster caching for questions and lab state

### Lambda Functions (`Backend/serverless/Lambda/`)

| Function | Runtime | Purpose |
|---|---|---|
| `document_indexer` | Python (container) | Indexes shell scripts into LanceDB vector store |
| `agent_tools` | Python (container) | AgentCore Gateway tool handler — DynamoDB, S3, LanceDB tools for tutor/grader/planner |

**AgentCore Gateway → Lambda event format** (critical):
- Tool name is in `context.client_context.custom["bedrockAgentCoreToolName"]` (format: `${target}___${tool-name}`)
- Event object IS the flat tool input parameters (NOT wrapped in `toolName`/`toolInput` fields)
- Strip `___` prefix and normalize hyphens to underscores for dispatch

## AWS Region Notes

- Primary region: `us-east-1`
- Bedrock (AI models): `us-east-1`
- ACM for CloudFront: `us-east-1`
- S3 buckets: `us-east-1`
  - `rosettacloud-shared-interactive-labs` — shell scripts (questions source)
  - `rosettacloud-shared-interactive-labs-vector` — LanceDB vector store (RAG source)
  - `rosettacloud-shared-terraform-backend` — Terraform remote state

## API Endpoints

| Name | URL | Purpose |
|---|---|---|
| Chatbot | `https://api.dev.rosettacloud.app/chat` | `POST /chat` on FastAPI backend → AgentCore Runtime |

### POST /chat — Request / Response

**Request body:**
```json
{
  "message": "What is Docker?",
  "user_id": "user-123",
  "session_id": "session-<uuid>-<timestamp>",
  "module_uuid": "linux-docker-k8s-101",
  "lesson_uuid": "intro-lesson-01",
  "type": "chat"
}
```
For grading: `"type": "grade"`, add `"question_number": 2, "result": "correct"`, `"message": ""`.

**Response:**
```json
{
  "response": "Docker is a platform for containerizing applications...",
  "agent": "tutor",
  "session_id": "session-<uuid>-<timestamp>"
}
```
`agent` is one of `"tutor"`, `"grader"`, `"planner"`.

**Notes:**
- `session_id` must be 33+ chars (AgentCore requirement); `ChatbotService` generates `"session-<uuid>-<timestamp>"` which always satisfies this
- `module_uuid` / `lesson_uuid` are optional but required for question-specific tool calls (`get_question_details`)
- History is maintained server-side keyed by `session_id`; no need to send prior messages in each request

## CI/CD

### Workflows

| Workflow | File | Trigger | What it does |
|---|---|---|---|
| **Agent Deploy** | `.github/workflows/agent-deploy.yml` | `workflow_dispatch` or push to `main` touching `Backend/agents/**` | Deploys AgentCore agent via `agentcore launch` (CodeBuild ARM64) + updates backend K8s ConfigMap with new ARN |
| **Lambda Deploy** | `.github/workflows/lambda-deploy.yml` | `workflow_dispatch` or push to `main` touching `Backend/serverless/Lambda/**` | Builds & deploys `document_indexer` Lambda (container image) |
| **Questions Sync** | `.github/workflows/questions-sync.yml` | `workflow_dispatch` or push to `main` touching `Backend/questions/**` | Syncs shell script questions to S3 (triggers EventBridge → document_indexer) |
| **Backend Build** | `.github/workflows/backend-build.yml` | `workflow_dispatch` or push to `main` touching `Backend/app/**`, `Backend/Dockerfile`, `Backend/requirements.txt` | Builds Backend Docker image → pushes to ECR → rollout restart on EKS |
| **Frontend Build** | `.github/workflows/frontend-build.yml` | `workflow_dispatch` or push to `main` touching `Frontend/src/**`, `Frontend/Dockerfile`, `Frontend/package.json`, `Frontend/angular.json`, `Frontend/nginx.conf` | Builds Frontend Docker image (multi-stage: `ng build --configuration=production` + nginx) → pushes to ECR → rollout restart on EKS |
| **Interactive Labs** | `.github/workflows/interactive-labs-build.yml` | `workflow_dispatch` or push to `main` touching `DevSecOps/interactive-labs/**` | Builds & pushes `interactive-labs` image to ECR |

All workflows use **GitHub OIDC** (no static AWS credentials). IAM role: `github-actions-role`.

**K8s deployment is not automated** — apply manually with `kubectl apply -f DevSecOps/K8S/`.

### Questions / S3 Sync

Shell script questions live in `Backend/questions/{module_uuid}/{lesson_uuid}/q{N}.sh`.
The deploy pipeline syncs this directory to `s3://rosettacloud-shared-interactive-labs/` (with `--delete`), which triggers EventBridge → `document_indexer` Lambda → LanceDB indexing.

Current modules:
- `linux-docker-k8s-101/intro-lesson-01/` — q1–q6 (Linux basics, Docker, Kubernetes)

## Key Environment Variables

| Variable | Used By | Default | Production value |
|---|---|---|---|
| `REDIS_HOST` | Backend | `redis-service` | `redis-service` (K8s) / `localhost` (local dev) |
| `REDIS_PORT` | Backend | `6379` | `6379` |
| `AWS_REGION` | Backend + Lambdas | `us-east-1` | `us-east-1`; IRSA provides credentials in-cluster |
| `LAB_K8S_NAMESPACE` | Backend | `openedx` | `dev` |
| `LANCEDB_S3_URI` | document_indexer Lambda | `s3://rosettacloud-shared-interactive-labs-vector` | same |
| `KNOWLEDGE_BASE_ID` | document_indexer Lambda | `shell-scripts-knowledge-base` | LanceDB table name |
| `AGENT_RUNTIME_ARN` | Backend (`/chat` endpoint) | — | AgentCore Runtime ARN (set in K8s ConfigMap; updated by agent-deploy workflow) |
| `USERS_TABLE_NAME` | Backend | `rosettacloud-users` | `rosettacloud-users` |
| `S3_BUCKET_NAME` | Backend | `rosettacloud-shared-interactive-labs` | same |
| `NOVA_MODEL_ID` | Backend | `amazon.nova-lite-v1:0` | same |
| `INGRESS_NAME` | Backend | `rosettacloud-ingress` | `rosettacloud-ingress` |
| `LAB_IMAGE_PULL_SECRET` | Backend | `ecr-creds` | `ecr-creds` |

## AgentCore Deployment (Multi-Agent Platform)

### Agent Code (`Backend/agents/`)

| File | Purpose |
|------|---------|
| `agent.py` | Entrypoint — multi-agent router (tutor/grader/planner), AgentCoreMemorySessionManager, MCPClient |
| `tools.py` | `@tool` stubs (not used in production — tools run via Gateway/Lambda) |
| `prompts.py` | System prompts for tutor, grader, planner agents |
| `requirements.txt` | Python deps (bedrock-agentcore, strands-agents, lancedb, etc.) |
| `.bedrock_agentcore.yaml` | CLI config (generated by `agentcore configure`) |
| `invoke_agent.py` | Test utility for invoking the deployed runtime |
| `setup_gateway.py` | One-time script: creates AgentCore Gateway + registers Lambda target |

### Current Deployment

- **Runtime ARN**: `arn:aws:bedrock-agentcore:us-east-1:339712964409:runtime/rosettacloud_education_agent-yebWcC9Yqy`
- **Deploy method**: `agentcore` CLI (CodeBuild builds ARM64 container in the cloud)
- **ECR**: `339712964409.dkr.ecr.us-east-1.amazonaws.com/bedrock-agentcore-rosettacloud_education_agent`
- **Memory ID**: `rosettacloud_education_memory-evO1o3F0jN` (env var `BEDROCK_AGENTCORE_MEMORY_ID`)
- **IAM Role**: `rosettacloud-agentcore-runtime-role` (Bedrock, DynamoDB, S3, ECR, CloudWatch, X-Ray, AgentCore Memory)
- **HTTP bridge**: FastAPI `/chat` endpoint reads `AGENT_RUNTIME_ARN` env var (from K8s ConfigMap) to invoke the runtime

### AgentCore Gateway

- **Gateway name**: `rosettacloud-education-tools`
- **Gateway URL**: stored as GitHub repo variable `GATEWAY_URL` (injected into agent container at deploy time)
- **Tool target**: `education-tools` → Lambda `agent_tools`
- **Tool names** (MCP protocol): `education-tools___search-knowledge-base`, `education-tools___get-question-details`, etc.
- **Agent normalization**: `_normalize_tool_name()` strips prefix + converts hyphens→underscores for Nova Lite model compatibility
- **Auth**: `NONE` (network-level security via known URL only)

MCP tool name flow: Gateway exposes `education-tools___get-question-details` → agent normalizes to `get_question_details` for model → MCP call uses original name → Gateway strips prefix → Lambda receives `get-question-details` in context → Lambda normalizes to `get_question_details` for dispatch.

### Deploy Commands (manual)
```bash
cd Backend/agents
agentcore configure -e agent.py -n rosettacloud_education_agent \
  -er arn:aws:iam::339712964409:role/rosettacloud-agentcore-runtime-role \
  -rf requirements.txt -r us-east-1 -ni
agentcore launch --auto-update-on-conflict \
  --env BEDROCK_AGENTCORE_MEMORY_ID=rosettacloud_education_memory-evO1o3F0jN \
  --env GATEWAY_URL=$GATEWAY_URL
agentcore status
agentcore invoke '{"message": "What is Docker?", "user_id": "test", "session_id": "test-session-1234567890abcdef1234"}'
```

### Invocation (boto3)
```python
client = boto3.client('bedrock-agentcore', region_name='us-east-1')
response = client.invoke_agent_runtime(
    agentRuntimeArn="arn:aws:bedrock-agentcore:us-east-1:339712964409:runtime/rosettacloud_education_agent-yebWcC9Yqy",
    runtimeSessionId="must-be-33-chars-or-longer-uuid4",  # 33+ chars required
    payload=json.dumps({"message": "question", "user_id": "uid", "session_id": "sid"}),
    qualifier="DEFAULT",
)
result = json.loads(response['response'].read())
```

### IAM Role (`rosettacloud-agentcore-runtime-role`)
- Trust: `bedrock-agentcore.amazonaws.com` service principal
- Bedrock InvokeModel/Converse (Nova Lite + Titan Embed)
- DynamoDB GetItem (`rosettacloud-users`)
- S3 GetObject/ListBucket (questions + vector buckets)
- ECR pull (GetAuthorizationToken, BatchGetImage, GetDownloadUrlForLayer)
- CloudWatch Logs, X-Ray, AgentCore Memory

### AgentCore Memory
```python
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemoryConfig, AgentCoreMemorySessionManager,
)
config = AgentCoreMemoryConfig(
    memory_id=MEMORY_ID, region_name=REGION,
    session_id=session_id, actor_id=user_id,
)
session_manager = AgentCoreMemorySessionManager(config, region=REGION)
agent = Agent(model=model, session_manager=session_manager, session_id=session_id, tools=[...])
```
Note: `AgentCoreMemoryConfig` requires `session_id` and `actor_id` at creation time — must be created per-request, not at init.

## Frontend Configuration

Build environments defined in `Frontend/src/environments/`:
- `environment.ts` (production), `environment.development.ts`, `environment.uat.ts`, `environment.stg.ts`
- Each defines `apiUrl`, `chatbotApiUrl` (HTTP POST URL: `https://api.dev.rosettacloud.app/chat`), `feedbackApiUrl`
- Angular strict mode and strict templates are enforced in `tsconfig.json`
- `.editorconfig`: 2-space indent, single quotes for `.ts` files

**Production build**: Multi-stage Dockerfile — `node:24-alpine` runs `ng build --configuration=production`, output copied to `nginx:alpine`. `nginx.conf` handles SPA routing (`try_files $uri $uri/ /index.html`). Do NOT use `ng serve` in production (causes HMR WebSocket reload loops).

### ChatbotService (`Frontend/src/app/services/chatbot.service.ts`)

Key public API used by components:
```typescript
setUserId(userId: string): void          // called on login
setLabContext(moduleUuid: string, lessonUuid: string): void  // called by LabComponent.ngOnInit
sendMessage(message: string): void       // chat messages
sendGradeMessage(moduleUuid, lessonUuid, questionNumber, result): void  // auto-grade on answer
sendFeedbackRequest(moduleUuid, lessonUuid, questions, userProgress): void  // end-of-lab feedback
clearChat(): void

messages$: Observable<ChatMessage[]>
loading$: Observable<boolean>
connected$: Observable<boolean>   // always true (HTTP)
sources$: Observable<Source[]>    // always empty (AgentCore doesn't return sources)
```
