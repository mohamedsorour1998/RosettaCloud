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
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/339712964409/rosettacloud-feedback-requested \
LAB_K8S_NAMESPACE=dev \
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

uvicorn app.main:app --host 0.0.0.0 --port 80   # production (inside container)
```

**Local dev notes:**
- `REDIS_HOST=localhost` — K8s service name `redis-service` doesn't resolve locally
- `SQS_QUEUE_URL` — must be set; queue is `rosettacloud-feedback-requested` in `us-east-1`
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

**Terraform manages infrastructure only** (VPC, EKS, ECR repos, IAM roles, API Gateways, S3, SQS, Route 53, CloudFront). Lambda functions are **not** managed by Terraform — they're deployed via CI/CD pipelines (`lambda-deploy.yml`, `agent-deploy.yml`).

### Kubernetes

```bash
kubectl apply -f DevSecOps/K8S/    # deploys to namespace 'dev'
kubectl get pods -n dev
```

## Architecture

Architecture diagrams are in `Arch/` directory.

### Request Flow

- **Frontend → Backend**: REST API via `https://api.dev.rosettacloud.app` (FastAPI on K8s, Istio VirtualService)
- **Frontend → Chatbot**: WebSocket via `wss://wss.dev.rosettacloud.app` (API Gateway WebSocket → `ws_agent_handler` Lambda → AgentCore Runtime)
- **Frontend → Feedback polling**: REST `GET /feedback/{id}` on backend (reads from Redis)

### Infrastructure

- **EKS Auto Mode** (k8s 1.33): Cluster `rosettacloud-eks` with custom Karpenter NodePool `rosettacloud-spot` (t3.xlarge, spot, max 1 node). NodePool definition lives in-cluster only, not in Terraform.
- **CloudFront** (`d2rn486bpgcf7d.cloudfront.net`): Routes to Istio ingress NodePort 30578 on the EKS node. Origin is the node's public DNS (updated in `terraform.tfvars` as `node_public_dns`).
- **Istio**: Service mesh with sidecar injection in `dev` namespace. Lab pods opt out with `sidecar.istio.io/inject: "false"` annotation. Istio ingress (NodePort) handles all inbound traffic via VirtualService routing.
- **Route 53**: `rosettacloud.app` hosted zone. `dev.rosettacloud.app`, `api.dev.rosettacloud.app`, `*.labs.dev.rosettacloud.app` all alias to CloudFront.

### Backend Internal Pattern

Each feature area follows a **service/backend** split:
- `app/services/*.py` — thin orchestration layer (business logic)
- `app/backends/*.py` — concrete implementations (AWS SDK calls, K8s API, Redis, SQS)

Service → Backend mappings:
- `ai_service` → `ai_backends` (Amazon Bedrock/Nova via `aioboto3`, uses `converse_stream` for streaming — no `schemaVersion` param)
- `labs_service` → `labs_backends` (Kubernetes SDK: creates pods, services, Istio VirtualService per-lab; namespace `dev`)
- `users_service` → `users_backends` (DynamoDB)
- `questions_service` → `questions_backends` (S3 shell scripts + Redis cache; uses async subprocess for kubectl)
- `cache_events_service` → `cache_events_backends` (Redis cache + SQS pub/sub via sync `boto3` + `asyncio.to_thread`; subscribe blocks forever when `SQS_QUEUE_URL` unset)
- `feedback_service` — long-polls SQS `FeedbackRequested` queue, calls AI, stores result in Redis

**Note:** Architecture diagrams reference "Momento Cache" and "Momento Pub/Sub" but the actual implementation uses Redis + SQS.

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

### Feedback Flow

1. Backend `feedback_service._subscribe_loop()` long-polls SQS via `cache_events.subscribe()` (sync `boto3` + `asyncio.to_thread`, 20s long-poll)
2. Message received → `_handle()` spawned as `asyncio.create_task`
3. Builds educational prompt from student's question progress (completed/not completed per question)
4. Calls `ai.chat()` — Amazon Bedrock Nova Lite, non-streaming, `max_tokens=600`, `temperature=0.7`, system role: educational assistant
5. Constructs `{type: "feedback", feedback_id, content, timestamp}` payload
6. `cache_events.publish("FeedbackGiven", payload)` → detects `feedback_id` → stores in Redis as `cache:feedback:{feedback_id}` (600s TTL)
7. Frontend polls `GET /feedback/{feedback_id}` every 2s (60s timeout)
8. Backend reads Redis `cache:feedback:{feedback_id}` → returns `{status: "ready", content: "..."}` when found

**Note:** The `feedback_request` Lambda (HTTP API Gateway → SQS) has been deleted. Feedback ingestion needs a replacement path if re-enabled.

### AI Chatbot Flow (AgentCore Multi-Agent)

1. Frontend connects via WebSocket to `wss://wss.dev.rosettacloud.app`
2. API Gateway WebSocket → `$connect` route → `handle_connect()` → 200
3. User sends `{session_id, prompt}` (session_id must be 33+ chars)
4. `$default` route → `ws_agent_handler` Lambda bridges to AgentCore Runtime
5. AgentCore classifies message → routes to tutor, grader, or planner agent
6. Agent uses tools (knowledge base search, user progress, question details) and AgentCore Memory for conversation persistence
7. Response streamed back via WebSocket chunks: `{type: "chunk"}`, `{type: "complete"}`

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

- **Serverless Components**: Lambda functions for document indexing and WebSocket agent bridge
- **AgentCore Runtime**: Multi-agent platform (tutor/grader/planner) deployed via `agentcore` CLI
- **Event-Driven Architecture**: SQS for async feedback processing, Redis for caching and result storage

### Lambda Functions (`Backend/serverless/Lambda/`)

| Function | Runtime | Purpose |
|---|---|---|
| `document_indexer` | Python (container) | Indexes shell scripts into LanceDB vector store |
| `ws_agent_handler` | Python (container) | WebSocket bridge — API Gateway → AgentCore Runtime |

## AWS Region Notes

- Primary region: `us-east-1`
- Bedrock (AI models): `us-east-1`
- ACM for CloudFront: `us-east-1`
- S3 buckets: `us-east-1`
  - `rosettacloud-shared-interactive-labs` — shell scripts (questions source)
  - `rosettacloud-shared-interactive-labs-vector` — LanceDB vector store (RAG source)
  - `rosettacloud-shared-terraform-backend` — Terraform remote state

## API Gateway Endpoints

| Name | URL | Purpose |
|---|---|---|
| WebSocket (chatbot) | `wss://wss.dev.rosettacloud.app` | `ws_agent_handler` Lambda → AgentCore Runtime |

## CI/CD

### Workflows

| Workflow | File | Trigger | What it does |
|---|---|---|---|
| **Agent Deploy** | `.github/workflows/agent-deploy.yml` | `workflow_dispatch` or push to `main` touching `Backend/agents/**` | Deploys AgentCore agent via `agentcore launch` (CodeBuild ARM64) + updates `ws_agent_handler` Lambda ARN |
| **Lambda Deploy** | `.github/workflows/lambda-deploy.yml` | `workflow_dispatch` or push to `main` touching `Backend/serverless/Lambda/**` | Builds & deploys `document_indexer` and `ws_agent_handler` Lambdas (container images) |
| **Questions Sync** | `.github/workflows/questions-sync.yml` | `workflow_dispatch` or push to `main` touching `Backend/questions/**` | Syncs shell script questions to S3 (triggers EventBridge → document_indexer) |
| **Backend Build** | `.github/workflows/backend-build.yml` | `workflow_dispatch` or push to `main` touching `Backend/app/**` | Builds Backend Docker image → pushes to ECR → rollout restart on EKS |
| **Frontend Build** | `.github/workflows/frontend-build.yml` | `workflow_dispatch` or push to `main` touching `Frontend/src/**` | Builds Frontend Docker image → pushes to ECR → rollout restart on EKS |
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
| `SQS_QUEUE_URL` | Backend | — | `https://sqs.us-east-1.amazonaws.com/339712964409/rosettacloud-feedback-requested` |
| `CACHE_EVENTS_BACKEND` | Backend | `redis_sqs` | `redis_sqs` |
| `AWS_REGION` | Backend + Lambdas | `us-east-1` | `us-east-1`; IRSA provides credentials in-cluster |
| `LAB_K8S_NAMESPACE` | Backend | `openedx` | `dev` |
| `LANCEDB_S3_URI` | document_indexer Lambda | `s3://rosettacloud-shared-interactive-labs-vector` | same |
| `KNOWLEDGE_BASE_ID` | document_indexer Lambda | `shell-scripts-knowledge-base` | LanceDB table name |
| `AGENT_RUNTIME_ARN` | ws_agent_handler Lambda | — | AgentCore Runtime ARN (set by agent-deploy workflow) |
| `USERS_TABLE_NAME` | Backend | `rosettacloud-users` | `rosettacloud-users` |
| `S3_BUCKET_NAME` | Backend | `rosettacloud-shared-interactive-labs` | same |
| `NOVA_MODEL_ID` | Backend | `amazon.nova-lite-v1:0` | same |
| `INGRESS_NAME` | Backend | `rosettacloud-ingress` | `rosettacloud-ingress` |
| `LAB_IMAGE_PULL_SECRET` | Backend | `ecr-creds` | `ecr-creds` |

## AgentCore Deployment (Multi-Agent Platform)

### Agent Code (`Backend/agents/`)

| File | Purpose |
|------|---------|
| `agent.py` | Entrypoint — multi-agent router (tutor/grader/planner), AgentCoreMemorySessionManager |
| `tools.py` | `@tool` functions — knowledge base search, user progress, question details |
| `prompts.py` | System prompts for tutor, grader, planner agents |
| `requirements.txt` | Python deps (bedrock-agentcore, strands-agents, lancedb, etc.) |
| `.bedrock_agentcore.yaml` | CLI config (generated by `agentcore configure`) |
| `invoke_agent.py` | Test utility for invoking the deployed runtime |

### Current Deployment

- **Runtime ARN**: `arn:aws:bedrock-agentcore:us-east-1:339712964409:runtime/rosettacloud_education_agent-yebWcC9Yqy`
- **Deploy method**: `agentcore` CLI (CodeBuild builds ARM64 container in the cloud)
- **ECR**: `339712964409.dkr.ecr.us-east-1.amazonaws.com/bedrock-agentcore-rosettacloud_education_agent`
- **Memory ID**: `rosettacloud_education_memory-evO1o3F0jN` (env var `BEDROCK_AGENTCORE_MEMORY_ID`)
- **IAM Role**: `rosettacloud-agentcore-runtime-role` (Bedrock, DynamoDB, S3, ECR, CloudWatch, X-Ray, AgentCore Memory)
- **Lambda bridge**: `ws_agent_handler` Lambda reads `AGENT_RUNTIME_ARN` env var to invoke the runtime

### Deploy Commands (manual)
```bash
cd Backend/agents
agentcore configure -e agent.py -n rosettacloud_education_agent \
  -er arn:aws:iam::339712964409:role/rosettacloud-agentcore-runtime-role \
  -rf requirements.txt -r us-east-1 -ni
agentcore launch --auto-update-on-conflict \
  --env BEDROCK_AGENTCORE_MEMORY_ID=rosettacloud_education_memory-evO1o3F0jN
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
- Each defines `apiUrl`, `chatbotApiUrl`, `feedbackApiUrl`
- Angular strict mode and strict templates are enforced in `tsconfig.json`
- `.editorconfig`: 2-space indent, single quotes for `.ts` files
