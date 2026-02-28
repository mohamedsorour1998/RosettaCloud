# Post-Migration Hardening Plan

## Context
AgentCore CLI migration is complete (commit 1b20b03). This plan covered CI/CD refactoring,
Lambda containerization, Terraform cleanup, and E2E verification.

## Status: COMPLETE

All steps have been implemented and verified.

## Completed Steps

### Step 1: Fix agent-deploy workflow (IAM permissions)
- Added CodeBuild + AgentCore + IAM PassRole permissions to `github-actions-role`
- Un-gitignored `Backend/agents/Dockerfile` and `.dockerignore` (needed by CodeBuild in CI)
- Workflow passing (run #22520738412)

### Step 2: Add auto-triggers to backend-build + frontend-build workflows
- `backend-build.yml`: push trigger on `Backend/app/**`, `Backend/Dockerfile`, `Backend/requirements.txt`
- `frontend-build.yml`: push trigger on `Frontend/src/**`, `Frontend/Dockerfile`, `Frontend/package.json`

### Step 3: Fix frontend session ID generation
- `ChatbotService`: `'session-' + crypto.randomUUID() + '-' + Date.now()` (~58 chars, well over 33-char minimum)

### Step 4: Delete unused Lambda functions
- Deleted `ai_chatbot` and `feedback_request` from AWS
- Chatbot now uses AgentCore multi-agent system via `ws_agent_handler`

### Step 5: Containerize ws_agent_handler Lambda
- Added `Backend/serverless/Lambda/ws_agent_handler/Dockerfile`
- Deleted zip-based Lambda, recreated as Image-based
- Re-added API Gateway invoke permission

### Step 6: Split monolith CI/CD into focused pipelines
- Deleted `deploy.yml` monolith
- Created: `questions-sync.yml`, `lambda-deploy.yml`, `interactive-labs-build.yml`
- All auto-trigger on push to main when respective directories change

### Step 7: Delete old subdirectory workflows
- Deleted: `Backend/.github/`, `Frontend/.github/`, `DevSecOps/.github/` workflow files

### Step 8: Terraform cleanup
- Removed: `ai_chatbot` ECR/IAM, `feedback_request` Lambda/IAM/SQS policy, feedback API Gateway
- Added: `ws_agent_handler` IAM role + ECR repo, kept `document_indexer` resources
- Updated comments and outputs

### Step 9: E2E verification
- AgentCore direct invoke: tutor agent responding with hints-first pedagogy
- Lambda container: operational (Image-based, 256MB, 60s timeout)
- lambda-deploy pipeline: all 3 jobs passed (detect-changes, ws-agent-handler, document-indexer)
- agent-deploy pipeline: passing (CodeBuild ARM64 container build + Lambda ARN update)

## Note
`terraform apply` needs to be run to reconcile state with the removed resources
(ai_chatbot ECR, feedback API Gateway, feedback IAM roles, etc.).
