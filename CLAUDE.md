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

### Backend (FastAPI)

```bash
cd Backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # dev server
uvicorn app.main:app --host 0.0.0.0 --port 80              # production
```

Note: Backend has no test suite wired up yet. The entry point is `app.main:app`.

### Terraform

```bash
cd DevSecOps/Terraform/environments/shared
terraform init
terraform plan -var-file="terraform.tfvars"
terraform apply -var-file="terraform.tfvars"
```

Remote state: S3 bucket `rosettacloud-shared-terraform-backend` in `me-central-1`.

### Kubernetes

```bash
kubectl apply -f DevSecOps/K8S/    # deploys to namespace 'openedx'
kubectl get pods -n openedx
```

## Architecture

### Request Flow

- **Frontend → Backend**: REST API via `https://api.dev.rosettacloud.app` (FastAPI on K8s, Nginx Ingress)
- **Frontend → Chatbot**: WebSocket via `wss://wss.dev.rosettacloud.app` (API Gateway WebSocket → `ai_chatbot` Lambda)
- **Frontend → Feedback**: HTTP to `https://feedback.dev.rosettacloud.app` (API Gateway → `feedback_request` Lambda)
- **Frontend → Real-time events**: Momento Topics SDK (browser), tokens from `momento_token_vending` Lambda

### Backend Internal Pattern

Each feature area follows a **service/backend** split:
- `app/services/*.py` — thin orchestration layer (business logic)
- `app/backends/*.py` — concrete implementations (AWS SDK calls, K8s API, Momento)

Service → Backend mappings:
- `ai_service` → `ai_backends` (Amazon Bedrock/Nova via `aioboto3`)
- `labs_service` → `labs_backends` (Kubernetes SDK: creates pods, services, ingress per-lab)
- `users_service` → `users_backends` (DynamoDB)
- `questions_service` → `questions_backends` (S3 shell scripts + Momento cache)
- `cache_events_service` → `cache_events_backends` (Momento cache + topics)
- `feedback_service` — subscribes to Momento `FeedbackRequested` topic, calls AI, publishes to `FeedbackGiven`

### Event-Driven Feedback Flow

1. Frontend calls `POST /feedback/request` → `feedback_request` Lambda publishes to Momento topic `FeedbackRequested`
2. Backend `feedback_service` (subscribed to `FeedbackRequested`) calls Bedrock AI, publishes result to `FeedbackGiven`
3. Frontend (subscribed via Momento SDK Web with a disposable token from `momento_token_vending`) receives response filtered by `feedback_id`

### AI Chatbot (RAG Pipeline)

- WebSocket API Gateway → `ai_chatbot` Lambda
- LangChain orchestrates: retriever (LanceDB on S3) → Amazon Nova Lite LLM (Bedrock) → streaming response
- Embeddings: Amazon Titan (`amazon.titan-embed-text-v2:0`)
- Chat history: DynamoDB `SessionTable`

### Lab Provisioning

Backend dynamically creates Kubernetes Pod + Service + Ingress per lab via the Python `kubernetes` SDK. Each lab runs the `interactive-labs` image (code-server + Docker-in-Docker + Kind). Labs are accessible at `<lab-id>.labs.dev.rosettacloud.app`. Active labs tracked in Momento cache with 1-hour TTL.

### Lambda Functions (`Backend/serverless/Lambda/`)

| Function | Runtime | Purpose |
|---|---|---|
| `ai_chatbot` | Python (container) | WebSocket RAG chatbot |
| `document_indexer` | Python (container) | Indexes shell scripts into LanceDB vector store |
| `feedback_request` | Python (zip) | Publishes feedback requests to Momento topic |
| `momento_token_vending` | Node.js | Generates short-lived Momento disposable tokens |

## AWS Region Notes

- Primary region: `me-central-1` (UAE)
- Bedrock (AI models): `us-east-1`
- ACM for CloudFront: `us-east-1`

## CI/CD

All three components have separate GitHub Actions workflows (`.github/workflows/actions.yml` inside each directory). All are **manually triggered** (`workflow_dispatch`), not auto-triggered on push. They build Docker images, push to ECR, and update Lambda functions. Authentication uses GitHub OIDC (no static AWS credentials).

## Key Environment Variables

| Variable | Used By |
|---|---|
| `MOMENTO_API_KEY` | Backend, feedback_request Lambda, momento_token_vending Lambda |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Backend (via K8s ConfigMap) |
| `AWS_REGION` | Backend + Lambdas (default: `me-central-1`) |
| `LANCEDB_S3_URI` | ai_chatbot Lambda |
| `KNOWLEDGE_BASE_ID` | ai_chatbot Lambda (LanceDB table name) |
| `DYNAMO_TABLE` | ai_chatbot Lambda (DynamoDB table for chat history) |
| `USERS_TABLE_NAME` | Backend (default: `rosettacloud-users`) |
| `S3_BUCKET_NAME` | Backend (S3 bucket for shell scripts) |
| `NOVA_MODEL_ID` | Backend (default: `amazon.nova-lite-v1:0`) |
| `INGRESS_NAME` | Backend (K8s Ingress to update: `rosettacloud-ingress`) |
| `LAB_IMAGE_PULL_SECRET` | Backend (K8s image pull secret: `ecr-creds`) |

## Frontend Configuration

Build environments defined in `Frontend/src/environments/`:
- `environment.ts` (production), `environment.development.ts`, `environment.uat.ts`, `environment.stg.ts`
- Each defines `apiUrl`, `chatbotApiUrl`, `feedbackApiUrl`, and `momentoApiKey`
- Angular strict mode and strict templates are enforced in `tsconfig.json`
- `.editorconfig`: 2-space indent, single quotes for `.ts` files
