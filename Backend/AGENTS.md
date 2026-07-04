# AGENTS.md — Backend/ (Python) handoff

> Local context for AI agents working in the Python `Backend/`. See root `../AGENTS.md` for
> cross-cutting state. Last refreshed: 2026-07-04.

## ⚠️ CRITICAL: `Backend/` is NOT the API anymore

The FastAPI monolith (`Backend/app/`, its Dockerfile + requirements.txt) was **removed**. The REST
API (users/labs/questions/chat/analytics) now lives in the Spring Boot 4 / Java 25 microservices
under **`../Backend-Java/`**. `Backend/app/` on disk holds only stale `__pycache__/*.pyc` bytecode —
no `.py` source remains; it's gitignored scratch, ignore it. `Backend/README.md` has a migration note
at the top; its deeper FastAPI service/backend sections are **historical only**.

What remains in `Backend/` is the still-live Python:

```
Backend/
├── agents/            # Bedrock AgentCore multi-agent runtime (LIVE tutor/grader/planner)
├── serverless/Lambda/ # document_indexer + agent_tools (container-image Lambdas)
├── questions/         # shell-script lab content synced to S3
└── README.md          # migration note + historical FastAPI docs
```

## agents/ — Amazon Bedrock AgentCore runtime

Multi-agent tutor on **Nova 2 Lite** (`us.amazon.nova-2-lite-v1:0`, `NOVA_MODEL_ID` env).
- `agent.py` — entrypoint `@app.entrypoint def invoke(payload, context)`. `_classify(message, type)`
  routes: `type=grade`→grader, `hint`/`explain`→tutor, `session_start`→planner; keyword heuristics;
  else a Nova classifier call → default **tutor**. Tools injected at runtime via MCP `GATEWAY_URL`
  (each agent gets a fixed tool subset). Session continuity: in-process fallback + **AgentCoreMemory**
  (`AgentCoreMemorySessionManager`, `BEDROCK_AGENTCORE_MEMORY_ID`).
- `prompts.py` (TUTOR/GRADER/PLANNER/CLASSIFIER), `tools.py`, `setup_gateway.py`, `invoke_agent.py`.
- `requirements.txt`: bedrock-agentcore, strands-agents[otel], strands-agents-builder, boto3, mcp,
  aws-opentelemetry-distro. `.bedrock_agentcore.yaml` = deploy config (ARM64, account 339712964409,
  us-east-1, runtime `rosettacloud_education_agent-yebWcC9Yqy`).
- **Deploy:** `agent-deploy.yml` (push `Backend/agents/**`) → `agentcore launch` builds ARM64 on
  CodeBuild + updates the K8s ConfigMap ARN. Runtime is consumed by Backend-Java **chat-service**
  (`AGENT_RUNTIME_ARN`). Env for launch: `BEDROCK_AGENTCORE_MEMORY_ID`, `GATEWAY_URL`, Cognito
  `COGNITO_TOKEN_URL/CLIENT_ID/CLIENT_SECRET`.
- **Commands:** `cd Backend/agents && agentcore status` · `agentcore configure -e agent.py -n
  rosettacloud_education_agent ...` · `agentcore launch --auto-update-on-conflict`. The CLI may be at
  `~/.local/bin/agentcore`.

## serverless/Lambda/ — two container-image Lambdas

- `document_indexer/` (`document_indexer.py`) — S3 EventBridge (`rosettacloud-s3-sh-upload`) fires on
  `.sh` upload to `s3://rosettacloud-shared-interactive-labs/{module}/{lesson}/` → parse header →
  Titan Embed v2 → **LanceDB on S3** (table `shell-scripts-knowledge-base`).
- `agent_tools/` (`handler.py`) — AgentCore **Gateway** target (`rosettacloud-education-tools`);
  dispatches tool calls (search_knowledge_base, get_question_details/metadata, get_user_progress,
  get_attempt_result, list_available_modules) against DynamoDB/S3/LanceDB. Tool name comes from
  `context.client_context.custom["bedrockAgentCoreToolName"]`.
- Each has its own `Dockerfile` + `requirements.txt` (both include `lancedb`).
- **Deploy:** `lambda-deploy.yml` (push `Backend/serverless/Lambda/**`) → build image → ECR → Lambda
  update. See `serverless/flow.MD` for the full pipeline (its "AI Chat Request Flow" still names
  FastAPI — historical; that entrypoint is now chat-service).

## questions/ — lab content

Shell-script questions at `{module}/{lesson}/qN.sh` (e.g. `linux-docker-k8s-101/intro-lesson-01/
q1.sh`). **Deploy:** `questions-sync.yml` (push `Backend/questions/**`) syncs to S3 → EventBridge →
`document_indexer` re-indexes.

## Conventions / gotchas

- **Keep every pipeline green** (`agent-deploy`, `lambda-deploy`, `questions-sync`). All use GitHub
  OIDC — no static creds.
- **Never `git add .`** — stage explicit paths (repo has untracked scratch, e.g. `app/__pycache__`).
- No git/docker in the local working env — image builds run in CI only.
- Detailed AgentCore/resilience plan: `../Backend-Java/AGENTCORE-RESILIENCE4J-RUNTIME-PLAN.md`.
