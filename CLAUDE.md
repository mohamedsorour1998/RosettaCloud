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

### Request Flow

- **Frontend → Backend**: REST API via `https://api.dev.rosettacloud.app` (FastAPI on K8s, Nginx Ingress)
- **Frontend → Chatbot**: WebSocket via `wss://wss.dev.rosettacloud.app` (API Gateway WebSocket → `ai_chatbot` Lambda)
- **Frontend → Feedback**: HTTP to `https://feedback.dev.rosettacloud.app` (API Gateway → `feedback_request` Lambda → SQS)
- **Frontend → Feedback polling**: REST `GET /feedback/{id}` on backend (reads from Redis)

### Backend Internal Pattern

Each feature area follows a **service/backend** split:
- `app/services/*.py` — thin orchestration layer (business logic)
- `app/backends/*.py` — concrete implementations (AWS SDK calls, K8s API, Redis, SQS)

Service → Backend mappings:
- `ai_service` → `ai_backends` (Amazon Bedrock/Nova via `aioboto3`, uses `converse_stream` for streaming — no `schemaVersion` param)
- `labs_service` → `labs_backends` (Kubernetes SDK: creates pods, services, ingress per-lab; namespace `dev`)
- `users_service` → `users_backends` (DynamoDB)
- `questions_service` → `questions_backends` (S3 shell scripts + Redis cache)
- `cache_events_service` → `cache_events_backends` (Redis cache + SQS pub/sub; subscribe blocks forever when `SQS_QUEUE_URL` unset)
- `feedback_service` — long-polls SQS `FeedbackRequested` queue, calls AI, stores result in Redis

### Feedback Flow (SQS + Redis)

1. Frontend calls `POST /feedback/request` → `feedback_request` Lambda sends message to SQS queue
2. Backend `feedback_service` (long-polling SQS) receives message, calls Bedrock AI, stores result in Redis (`feedback:{id}`)
3. Frontend polls `GET /feedback/{id}` on backend every 2s until result is ready (60s timeout)

### AI Chatbot (RAG Pipeline)

- WebSocket API: `wss://wss.dev.rosettacloud.app` → API Gateway v2 WebSocket → `ai_chatbot` Lambda
- LangChain orchestrates: retriever (LanceDB on S3) → Amazon Nova Lite LLM (Bedrock) → streaming response
- Embeddings: Amazon Titan (`amazon.titan-embed-text-v2:0`)
- Chat history: DynamoDB `SessionTable` (hash key: `SessionId` — matches LangChain `DynamoDBChatMessageHistory` default)
- Lambda sends streaming chunks back via `apigatewaymanagementapi.post_to_connection` using the custom domain endpoint

### Questions / Shell Script Pipeline

1. Upload `.sh` scripts to `s3://rosettacloud-shared-interactive-labs/{module_uuid}/{lesson_uuid}/`
2. S3 EventBridge notification triggers `document_indexer` Lambda
3. `document_indexer` embeds scripts via Amazon Titan → writes vectors to LanceDB at `s3://rosettacloud-shared-interactive-labs-vector`
4. Backend `questions_backends` reads `.sh` files directly from `rosettacloud-shared-interactive-labs` (not the vector store)
5. Vector store is used by `ai_chatbot` Lambda for RAG

### Lab Provisioning

Backend dynamically creates Kubernetes Pod + Service + Ingress per lab via the Python `kubernetes` SDK. Each lab runs the `interactive-labs` image (code-server + Docker-in-Docker + Kind). Labs are accessible at `<lab-id>.labs.dev.rosettacloud.app`. Active labs tracked in Redis cache with 15-minute TTL.

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
