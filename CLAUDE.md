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

### Kubernetes

```bash
kubectl apply -f DevSecOps/K8S/    # deploys to namespace 'dev'
kubectl get pods -n dev
```

## Architecture

Architecture diagrams are in `Arch/` directory.

### Request Flow

- **Frontend → Backend**: REST API via `https://api.dev.rosettacloud.app` (FastAPI on K8s, Istio VirtualService)
- **Frontend → Chatbot**: WebSocket via `wss://wss.dev.rosettacloud.app` (API Gateway WebSocket → `ai_chatbot` Lambda)
- **Frontend → Feedback**: HTTP to `https://feedback.dev.rosettacloud.app` (API Gateway → `feedback_request` Lambda → SQS)
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

1. Frontend `POST https://feedback.dev.rosettacloud.app/feedback/request` with `{user_id, module_uuid, lesson_uuid, feedback_id, questions, progress}`
2. HTTP API Gateway → `feedback_request` Lambda validates params, sends JSON to SQS queue (`rosettacloud-feedback-requested`)
3. Returns `{feedback_id, status: "pending"}` to frontend immediately
4. Backend `feedback_service._subscribe_loop()` long-polls SQS via `cache_events.subscribe()` (sync `boto3` + `asyncio.to_thread`, 20s long-poll)
5. Message received → `_handle()` spawned as `asyncio.create_task`
6. Builds educational prompt from student's question progress (completed/not completed per question)
7. Calls `ai.chat()` — Amazon Bedrock Nova Lite, non-streaming, `max_tokens=600`, `temperature=0.7`, system role: educational assistant
8. Constructs `{type: "feedback", feedback_id, content, timestamp}` payload
9. `cache_events.publish("FeedbackGiven", payload)` → detects `feedback_id` → stores in Redis as `cache:feedback:{feedback_id}` (600s TTL)
10. Frontend polls `GET /feedback/{feedback_id}` every 2s (60s timeout)
11. Backend reads Redis `cache:feedback:{feedback_id}` → returns `{status: "ready", content: "..."}` when found

### AI Chatbot Flow (RAG Pipeline)

1. Frontend connects via WebSocket to `wss://wss.dev.rosettacloud.app`
2. API Gateway WebSocket → `$connect` route → `handle_connect()` → 200
3. User sends `{session_id, prompt, bedrock_model_id, model_kwargs, file_filter?, knowledge_base_id?, response_style?}`
4. `$default` route → `handle_message()` validates required fields
5. Creates `BedrockStreamer(connectionId, session_id, api_endpoint)` with Bedrock client in `us-east-1`
6. Starts **heartbeat thread** (sends `{type: "heartbeat"}` every 5s to keep WebSocket alive during RAG processing)
7. **RAG chain setup** (`create_rag_chain`):
   a. Prompt templates: contextualize question (reformulate with chat history) + QA (DevOps system prompt, hints-first approach)
   b. Connects to LanceDB at `s3://rosettacloud-shared-interactive-labs-vector`
   c. Opens table `shell-scripts-knowledge-base`, detects vector dimensions
   d. Creates Titan embeddings (`amazon.titan-embed-text-v2:0`) and LanceDB vector store
   e. Creates retriever (max 2 docs, filtered by `file_type='shell_script'` or `file_name` if specified)
   f. Wraps retriever with history-awareness (reformulates question using chat history from DynamoDB)
   g. Builds chain: history-aware retriever → stuff documents → Bedrock LLM (streaming=true) → parser
   h. Wraps with `RunnableWithMessageHistory` using DynamoDB `SessionTable` (`SessionId` hash key)
8. **Response streaming** (`stream_response`):
   a. Sends `{type: "status", content: "Processing your question..."}`
   b. Invokes RAG chain → gets response with answer + source documents
   c. Sends `{type: "chunk", content: "..."}` via `post_to_connection`
   d. Sends `{type: "source", content: {filename, path, bucket, question_type?}}` for each source doc
   e. Sends `{type: "complete"}` to signal end
9. Stops heartbeat, frontend renders response with source references

**Key details:**
- LangChain orchestrates the full RAG pipeline
- Embeddings: Amazon Titan (`amazon.titan-embed-text-v2:0`, 1536 dimensions)
- LLM: configurable via `bedrock_model_id` (frontend sends model choice)
- Chat history persisted in DynamoDB `SessionTable` per `session_id`
- System prompt: DevOps specialist, hints first (only answers directly on second ask), rejects non-DevOps questions

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

- **Serverless Components**: Lambda functions for chatbot, document indexing, feedback request
- **Event-Driven Architecture**: SQS for async feedback processing, Redis for caching and result storage
- **Integration Points**: OpenEdX LMS integration for seamless learning experiences

### Lambda Functions (`Backend/serverless/Lambda/`)

| Function | Runtime | Purpose |
|---|---|---|
| `ai_chatbot` | Python (container) | WebSocket RAG chatbot |
| `document_indexer` | Python (container) | Indexes shell scripts into LanceDB vector store |
| `feedback_request` | Python (zip) | Sends feedback requests to SQS queue |

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
| WebSocket (chatbot) | `wss://wss.dev.rosettacloud.app` | `ai_chatbot` Lambda — RAG chat |
| HTTP (feedback) | `https://feedback.dev.rosettacloud.app/feedback/request` | `feedback_request` Lambda → SQS |

## CI/CD

### Workflows

| Workflow | File | Trigger | What it does |
|---|---|---|---|
| **Deploy** | `.github/workflows/deploy.yml` | `workflow_dispatch` or push to `main` touching `Backend/questions/**` or `Backend/serverless/Lambda/**` | **Syncs questions to S3** + builds/pushes `document_indexer` & `ai_chatbot` Lambda images + creates/updates Lambda functions |
| Backend image | `.github/workflows/backend-build.yml` | `workflow_dispatch` | Builds Backend Docker image → pushes to ECR `rosettacloud-backend` |
| Frontend image | `.github/workflows/frontend-build.yml` | `workflow_dispatch` | Builds Frontend Docker image → pushes to ECR `rosettacloud-frontend` |
| DevSecOps | `DevSecOps/.github/workflows/actions.yml` | `workflow_dispatch` | Builds & pushes `interactive-labs` image to ECR |

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
| `SQS_QUEUE_URL` | Backend + feedback_request Lambda | — | `https://sqs.us-east-1.amazonaws.com/339712964409/rosettacloud-feedback-requested` |
| `CACHE_EVENTS_BACKEND` | Backend | `redis_sqs` | `redis_sqs` |
| `AWS_REGION` | Backend + Lambdas | `us-east-1` | `us-east-1`; IRSA provides credentials in-cluster |
| `LAB_K8S_NAMESPACE` | Backend | `openedx` | `dev` |
| `LANCEDB_S3_URI` | ai_chatbot Lambda | `s3://rosettacloud-shared-interactive-labs-vector` | same |
| `KNOWLEDGE_BASE_ID` | ai_chatbot Lambda | `shell-scripts-knowledge-base` | LanceDB table name |
| `DYNAMO_TABLE` | ai_chatbot Lambda | — | DynamoDB table for chat history |
| `USERS_TABLE_NAME` | Backend | `rosettacloud-users` | `rosettacloud-users` |
| `S3_BUCKET_NAME` | Backend | `rosettacloud-shared-interactive-labs` | same |
| `NOVA_MODEL_ID` | Backend | `amazon.nova-lite-v1:0` | same |
| `INGRESS_NAME` | Backend | `rosettacloud-ingress` | `rosettacloud-ingress` |
| `LAB_IMAGE_PULL_SECRET` | Backend | `ecr-creds` | `ecr-creds` |

## AgentCore Deployment (Multi-Agent Platform)

### Reference Repos (studied, cloned to `demo-repo/`)
- `amazon-bedrock-agentcore-samples/` — tutorials for Runtime, Gateway, Memory, Identity, Observability
- `sample-logistics-agent-agentcore-runtime/` — CDK deployment with VPC/RDS, `@tool` pattern, `invoke_agent_runtime()` API
- `AWS-Resource-Optimizer-Agent/` — Gateway + Smithy API targets, AgentCore Memory hooks, `agentcore configure/launch` CLI

### Agent Code Pattern (Strands SDK)
```python
from bedrock_agentcore import BedrockAgentCoreApp
from strands import Agent, tool
from strands.models.bedrock import BedrockModel

app = BedrockAgentCoreApp()

@tool
def my_tool(param: str) -> str:
    """Docstring becomes the tool description for the LLM."""
    return "result"

model = BedrockModel(model_id="amazon.nova-lite-v1:0", region_name="us-east-1")
agent = Agent(model=model, system_prompt="...", tools=[my_tool], callback_handler=None)

@app.entrypoint
def invoke(payload):
    result = agent(payload.get("prompt", ""))
    return {"result": result.message['content'][0]['text']}

if __name__ == "__main__":
    app.run()  # HTTP on :8080 → /invocations (POST) + /ping (GET)
```

### Deployment via CLI (simplest path)
```bash
pip install bedrock-agentcore bedrock-agentcore-starter-toolkit strands-agents
agentcore configure -e agent.py --auto-create-execution-role --auto-create-ecr
agentcore launch          # builds Docker, pushes ECR, creates Runtime
agentcore status          # wait for READY
agentcore invoke '{"prompt": "test"}'
```

### Deployment via CDK (more control)
```python
# AWS::BedrockAgentCore::Runtime L1 construct
CfnResource(self, "Runtime", type="AWS::BedrockAgentCore::Runtime", properties={
    "AgentRuntimeName": "name",
    "RoleArn": role.role_arn,
    "NetworkConfiguration": {"NetworkMode": "PUBLIC"},  # or VPC for private resources
    "AgentRuntimeArtifact": {
        "CodeConfiguration": {
            "Code": {"S3": {"Bucket": bucket, "Prefix": key}},
            "EntryPoint": ["agent.py"],
            "Runtime": "PYTHON_3_12",
        }
    },
})
```

### Invocation (boto3)
```python
client = boto3.client('bedrock-agentcore', region_name='us-east-1')
response = client.invoke_agent_runtime(
    agentRuntimeArn="arn:aws:bedrock-agentcore:us-east-1:ACCOUNT:runtime/ID",
    runtimeSessionId="must-be-33-chars-or-longer-uuid4",  # 33+ chars required
    payload=json.dumps({"prompt": "question"}),
    qualifier="DEFAULT",
)
result = json.loads(response['response'].read())
```

### Dockerfile (auto-generated by `agentcore configure`)
- Base: `ghcr.io/astral-sh/uv:python3.12-bookworm-slim` (arm64)
- Non-root user `bedrock_agentcore:1000`
- OpenTelemetry auto-instrumentation: `CMD ["opentelemetry-instrument", "python", "-m", "agent"]`
- Ports: 8080 (HTTP/invocations), 8000 (MCP), 9000 (OTel)

### IAM Role
- Trust: `bedrock-agentcore.amazonaws.com` service principal
- Required: Bedrock InvokeModel, CloudWatch Logs, X-Ray
- Custom: DynamoDB read (`rosettacloud-users`), S3 read (questions + vector buckets)

### AgentCore Gateway (for exposing APIs as MCP tools)
- **Smithy targets**: Point to Smithy JSON API specs on S3 → auto-generates MCP tools
- **Lambda targets**: Point to Lambda functions → auto-wraps as MCP tools
- **Auth**: Cognito JWT or IAM
- **Not used for RosettaCloud**: Our tools are simple enough as local `@tool` functions

### AgentCore Memory (for conversation persistence)
```python
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
session_manager = AgentCoreMemorySessionManager(config, region)
agent = Agent(model=model, session_manager=session_manager, tools=[...])
```

### Key Differences Between Repos
| Aspect | Logistics Agent | Resource Optimizer |
|--------|----------------|-------------------|
| Tools | Local `@tool` functions (2 tools) | MCP via Gateway + Smithy (137 tools) |
| LLM | OpenAI GPT-4o | Bedrock Claude Sonnet |
| Deploy | CDK with VPC | `agentcore configure/launch` CLI |
| Memory | None (stateless) | AgentCore Memory with hooks |
| Data | RDS PostgreSQL (pg8000) | CloudWatch/EBS AWS APIs |

## Frontend Configuration

Build environments defined in `Frontend/src/environments/`:
- `environment.ts` (production), `environment.development.ts`, `environment.uat.ts`, `environment.stg.ts`
- Each defines `apiUrl`, `chatbotApiUrl`, `feedbackApiUrl`
- Angular strict mode and strict templates are enforced in `tsconfig.json`
- `.editorconfig`: 2-space indent, single quotes for `.ts` files
