# Post-Migration Hardening Plan

## Context
AgentCore CLI migration is complete (commit 1b20b03). Agent is deployed and responding.
This plan covers: fixing CI/CD, adding auto-build pipelines, E2E verification, and reliability hardening.

## Step 1: Fix agent-deploy workflow (IAM permissions)
**Problem**: `github-actions-role` lacks CodeBuild permissions. The `agentcore launch` CLI needs to create/manage CodeBuild projects.
**Fix**: Add CodeBuild + related permissions to `github-actions-role` inline policy.
**Permissions needed**:
- `codebuild:CreateProject`, `codebuild:UpdateProject`, `codebuild:StartBuild`, `codebuild:BatchGetBuilds`
- `s3:PutObject` (for uploading source zip to CodeBuild bucket)
- `iam:PassRole` (to pass CodeBuild execution role)
- `bedrock-agentcore:*AgentRuntime*` (create/update runtime)
- `lambda:UpdateFunctionConfiguration` (update ws_agent_handler ARN)
- `logs:*` for CodeBuild logs

## Step 2: Add auto-trigger to backend-build workflow
**File**: `.github/workflows/backend-build.yml`
**Change**: Add `push` trigger on `Backend/**` excluding `Backend/agents/**` and `Backend/questions/**` (those have their own workflows).
**Keep**: `workflow_dispatch` for manual runs.

## Step 3: Add auto-trigger to frontend-build workflow
**File**: `.github/workflows/frontend-build.yml`
**Change**: Add `push` trigger on `Frontend/src/**`.
**Keep**: `workflow_dispatch` for manual runs.

## Step 4: Fix session ID generation (Frontend)
**Problem**: `session-` + 13 random chars = ~21 chars. AgentCore requires 33+. Lambda pads it with random UUID which breaks session continuity.
**Fix**: Generate 33+ char session IDs in `ChatbotService`.

## Step 5: E2E WebSocket verification
**Test**: Send message via `wscat` to `wss://wss.dev.rosettacloud.app` and verify full chain:
Frontend WebSocket -> API Gateway -> ws_agent_handler Lambda -> AgentCore Runtime -> response back.

## Step 6: Commit, push, verify pipelines
- Commit all changes
- Push to main
- Verify all 3 workflows trigger and pass (agent-deploy, backend-build, frontend-build)

## Files Modified
| File | Action |
|------|--------|
| `.github/workflows/agent-deploy.yml` | No code changes needed (IAM fix is AWS-side) |
| `.github/workflows/backend-build.yml` | Add push trigger on `Backend/**` |
| `.github/workflows/frontend-build.yml` | Add push trigger on `Frontend/src/**` |
| `Frontend/src/app/services/chatbot.service.ts` | Fix session ID length (33+ chars) |
| `github-actions-role` (IAM) | Add CodeBuild + AgentCore permissions |
