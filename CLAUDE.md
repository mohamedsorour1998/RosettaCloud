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

### Feedback Flow (SQS + Redis)

1. Frontend calls `POST /feedback/request` → `feedback_request` Lambda sends message to SQS queue
2. Backend `feedback_service` (long-polling SQS via `asyncio.to_thread`) receives message, calls Bedrock AI, stores result in Redis (`feedback:{id}`)
3. Frontend polls `GET /feedback/{id}` on backend every 2s until result is ready (60s timeout)

### AI Chatbot (RAG Pipeline)

1. Angular Frontend → user inputs question about shell scripts
2. WebSocket API Gateway routes request with `connectionId`
3. `ai_chatbot` Lambda initiates RAG workflow
4. Fetches chat history from DynamoDB `SessionTable` (`SessionId` as key) + vector search in LanceDB (`shell-scripts-knowledge-base`)
5. Amazon Bedrock (Nova Lite) processes query + retrieved context
6. Lambda streams response chunks back via `apigatewaymanagementapi.post_to_connection`
7. Frontend renders response and source references

- LangChain orchestrates the full pipeline
- Embeddings: Amazon Titan (`amazon.titan-embed-text-v2:0`)

### Document Indexing Flow

1. Shell scripts uploaded to S3 bucket
2. EventBridge trigger invokes `document_indexer` Lambda
3. Lambda processes scripts and extracts metadata
4. Amazon Bedrock creates Titan embeddings
5. Vectors stored in LanceDB (S3-backed at `s3://rosettacloud-shared-interactive-labs-vector`)

### Questions / Shell Script Pipeline

1. Upload `.sh` scripts to `s3://rosettacloud-shared-interactive-labs/{module_uuid}/{lesson_uuid}/`
2. S3 EventBridge notification triggers `document_indexer` Lambda (see Document Indexing Flow)
3. Backend `questions_backends` reads `.sh` files directly from S3 (not the vector store)
4. Questions are parsed, cached in Redis, and served to frontend

**Question Types:**
- **MCQ (Multiple Choice)**: Frontend validates answer client-side against correct option loaded from cache → User Service updates progress in DynamoDB → UI updates
- **Practical Check**: Frontend loads question → Question Service extracts `-q` script and copies to lab pod → pod executes setup script → user works in lab → user clicks "Check Solution" → Question Service extracts `-c` script → copies to pod → pod executes verification → if exit code 0 → progress updated in DynamoDB → frontend shows success

Questions backend uses `asyncio.create_subprocess_exec` for kubectl operations with per-pod `asyncio.Lock` to prevent concurrent `kubectl cp` tar stream corruption. 30-second timeout on all kubectl operations.

### Lab Provisioning

Backend dynamically creates Kubernetes Pod + Service + Istio VirtualService per lab via the Python `kubernetes` SDK. Each lab runs the `interactive-labs` image (code-server + Docker-in-Docker + Kind). Labs are accessible at `<lab-id>.labs.dev.rosettacloud.app`. Active labs tracked in Redis cache with 15-minute TTL.

Lab pods are annotated with `sidecar.istio.io/inject: "false"` because Docker-in-Docker + Kind startup starves CPU, causing Istio sidecar health checks to fail.

Readiness probe: HTTP GET `/` on port 80, `initial_delay_seconds=5`, `period_seconds=10`, `timeout_seconds=10`, `failure_threshold=30`. The long failure threshold accommodates Kind cluster creation (~2-3 min CPU-intensive).

**Resource warning:** Each lab pod runs a full Kind cluster. A single t3.xlarge (4 CPU) can support platform services + 1 lab pod. Two concurrent Kind clusters will starve the entire node.

### Supplementary Services

- **Serverless Components**: Lambda functions for auxiliary functionality (chatbot, document indexing, feedback)
- **Event-Driven Architecture**: SQS messaging for async feedback processing
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

## Frontend Configuration

Build environments defined in `Frontend/src/environments/`:
- `environment.ts` (production), `environment.development.ts`, `environment.uat.ts`, `environment.stg.ts`
- Each defines `apiUrl`, `chatbotApiUrl`, `feedbackApiUrl`
- Angular strict mode and strict templates are enforced in `tsconfig.json`
- `.editorconfig`: 2-space indent, single quotes for `.ts` files
