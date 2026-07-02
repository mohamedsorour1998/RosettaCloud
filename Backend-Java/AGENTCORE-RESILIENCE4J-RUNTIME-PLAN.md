# AgentCore Prod Path · Resilience4j on Boot 4 · Persistent Runtime WITHOUT EKS

> **Status:** PROPOSED — implementation plan of record for three deferred items.
> **Audience:** platform owner + execution sub-agents. Self-contained; every claim is grounded in a
> named source file or a web-verified citation (see §0.3 and inline `[ref]`).
> **Owner mandate (non-negotiable):** **NO EKS, EVER.** Every option in Part C respects this.
> **Prime directive:** do not regress the currently-green path — 5 services build + deploy on
> ephemeral k3s-in-runner, the nightly e2e drives a **real Nova Lite 2** reply, and all inter-service
> clients are timeout + transient-retry + fail-open. Each change below is additive and reversible.

---

## 0. Orientation

### 0.1 What this plan delivers
Three independently-shippable tracks, each with design → build → test → rollout → rollback:

- **PART A — Production AgentCore chat path.** (Re)deploy the Python Strands/Nova multi-agent
  runtime, wire `chat-service` to it in production (`invoker=agentcore`), give it live e2e coverage
  (today it is unit-tested only), and make the `agentcore ⇄ bedrock-direct` toggle observable.
- **PART B — Circuit breakers on Spring Boot 4.** Track resilience4j#2351, formalize the interim
  native-Spring resilience, and adopt real circuit breakers via **Spring Cloud CircuitBreaker 5.0.x
  (Oakwood)** — which, as of 2025-11-25, gives us CBs on Boot 4 **today** without waiting for #2351.
- **PART C — A persistent runtime WITHOUT EKS.** Decision matrix, a recommended path (persistent
  single-node k3s on EC2, growable to HA), Terraform-without-EKS, CI/CD to the persistent cluster
  (keeping ephemeral k3s-on-runner for PR gating), strangler cutover, cost controls, teardown.

### 0.2 How the three tracks interlock
- Part A needs **AWS credentials for `bedrock-agentcore:InvokeAgentRuntime`** inside the pod. With no
  EKS there is no IRSA, so this rides on the **`aws-creds` secret** today and on an **EC2 instance
  profile** once Part C lands. Part A therefore reads Part C §C.2.6 for its production credential story.
- Part B wraps the **same `AgentCoreInvoker` / `BedrockDirectInvoker` calls** Part A exercises, plus the
  three inter-service clients. Do Part B's chat→AI-plane breaker **after** Part A is live so the breaker
  is tuned against real AgentCore latency, not the bedrock-direct stand-in.
- Part C is the substrate both A and B ultimately run on in production. It is sequenced last but is the
  highest-leverage: it converts "green on a throwaway runner" into "serving real traffic durably."

### 0.3 Ground-truth inventory (read before editing anything)
| Area | File(s) | Established fact |
|------|---------|------------------|
| Prod invoker | `chat-service/.../service/AgentCoreInvoker.java` | `@ConditionalOnProperty(invoker=agentcore, matchIfMissing=true)`; `BedrockAgentCoreClient.invokeAgentRuntime(req, ResponseTransformer.toBytes())`; `DefaultCredentialsProvider`; pads `runtimeSessionId` to ≥33 chars; parses one JSON `{response, agent}`. |
| Dev/e2e invoker | `chat-service/.../service/BedrockDirectInvoker.java` | `@ConditionalOnProperty(invoker=bedrock-direct)`; `BedrockRuntimeClient.converse` on `us.amazon.nova-2-lite-v1:0`; maps type→prompt via `PromptLibrary`. |
| Abstraction | `chat-service/.../service/AgentInvoker.java` | `Invocation`/`Reply` records; single `invoke()` — the seam Part B wraps. |
| Orchestration | `chat-service/.../service/ChatService.java` | rate-limit → AI-quota gate (`chat` only) → JPEG validate → `invoker.invoke` → history + counter + `chat.message` event. |
| Wiring | `chat-service/src/main/resources/application.yml`, `chat-service/k8s/chat-service.yaml` | `rosettacloud.chat.invoker=${CHAT_INVOKER:agentcore}`; prod ConfigMap sets `CHAT_INVOKER=agentcore` + real `AGENT_RUNTIME_ARN`; SA has a **dormant** IRSA annotation. |
| Python runtime | `Backend/agents/agent.py`, `prompts.py`, `tools.py`, `.bedrock_agentcore.yaml` | `BedrockAgentCoreApp` entrypoint `invoke(payload, context)`; Strands `Agent`+`BedrockModel` Nova 2 Lite; `_classify`→tutor/grader/planner; `AgentCoreMemorySessionManager`; MCP tools via `GATEWAY_URL`. Agent ARN `...runtime/rosettacloud_education_agent-yebWcC9Yqy`; exec role `rosettacloud-agentcore-runtime-role`; ECR `bedrock-agentcore-rosettacloud_education_agent`; CodeBuild ARM64. |
| Gateway/tools | `Backend/agents/setup_gateway.py`, `serverless/Lambda/agent_tools/handler.py`, `serverless/flow.MD` | MCP Gateway `rosettacloud-education-tools`, `authorizerType=NONE`, target→`agent_tools` Lambda; 6 tools; `GATEWAY_URL` stored as GitHub var. |
| Agent CI/CD | `.github/workflows/agent-deploy.yml` | push→`main` on `Backend/agents/**`; OIDC `github-actions-role`; `agentcore launch --auto-update-on-conflict --env BEDROCK_AGENTCORE_MEMORY_ID=rosettacloud_education_memory_v2-vvC3mbAmra --env GATEWAY_URL=…`. |
| Resilience helper | `shared-lib/.../resilience/HttpRetry.java` | `withRetry(maxAttempts, delayMs, op)` — linear back-off, retries **only** `ResourceAccessException`; 4xx/5xx propagate. |
| Inter-svc clients | `chat/client/UserAiQuotaClient.java`, `lab/client/UserServiceClient.java`, `question/client/UserProgressClient.java` | 2s connect / 5s read; wrapped in `HttpRetry(2,150)`; fail-open (quota→50, minutes→0, best-effort). `UserServiceClient.setActiveLab` is now **retry-wrapped + fail-open** too (log + swallow, consistent with `linkLab`) — the former gap is closed. |
| Runbook posture | `Backend-Java/docs/RUNBOOK.md` | "Full circuit breakers intentionally NOT added yet (r4j#2351)"; AgentCore path stays Python; NO EKS; creds via `aws-creds` secret. |
| CI/CD (Java) | `.github/workflows/backend-java-deploy.yml`, `e2e-k3s.yml` | build→ECR (test gate) then deploy onto **k3s-in-runner**; e2e uses `CHAT_INVOKER=bedrock-direct` (real Nova); AgentCore path never hits a live runtime. |
| Infra | `DevSecOps/Terraform/environments/shared/{main.tf,backend-java.tf,variables.tf,terraform.tfvars}`, `modules/{ec2,sg,iam}` | the **EKS module in `main.tf` is now removed** (commented out under a `REMOVED: no-EKS-ever mandate` header — no cluster provisioned, `aws eks list-clusters` → `[]`); `node_public_dns`+`istio_http_nodeport(=80)` already feed CloudFront/API-GW origin; reusable `ec2`+`sg` modules exist; VPC has public subnets, **no NAT**. |
| Edge/cutover | `DevSecOps/K8S/strangler-virtualservice.yaml` | Istio VS routes `api.dev` by prefix to the 5 services, default→FastAPI; `/internal/**` never routed; NetworkPolicy locks user-service. |

### 0.4 Verified external facts (web-checked 2026-07-02)
- **resilience4j#2351 "Spring Boot 4 Compatibility"** — opened 2025-09-08 by `ryanjbaxter` (Spring Cloud
  team), **CLOSED**, labelled `question`, linked to PR #2384. No `resilience4j-spring-boot4` starter has
  shipped; the annotation-driven `@CircuitBreaker` starter is still Boot 3 only. [gh:resilience4j/resilience4j#2351]
- **Spring Framework 7 core resilience** — `@Retryable`, `@ConcurrencyLimit`, `RetryTemplate`, `RetryPolicy`
  (`withMaxRetries/withMaxDuration/withBackoff/forExceptions`, `and/or`), enabled by `@EnableResilientMethods`.
  **No circuit breaker in core.** [docs.spring.io/spring-framework/reference/core/resilience.html]
- **Spring Cloud 2025.1.0 "Oakwood" — GA 2025-11-25**, on Boot 4 / SF 7, all modules `5.0.0`. Spring Cloud
  CircuitBreaker moved to **5.0.x**; it ships **(a)** a Resilience4j backend
  (`spring-cloud-starter-circuitbreaker-resilience4j`, wrapping **resilience4j-core 2.3.0** →
  CircuitBreaker+Bulkhead+TimeLimiter+Micrometer) and **(b)** a NEW **Framework-Retry** backend
  (`spring-cloud-starter-circuitbreaker-framework-retry`) built on SF 7 retry. `spring-cloud-circuitbreaker-spring-retry`
  is now maintenance-only. [spring.io/blog/2025/11/25/spring-cloud-2025-1-0-aka-oakwood-has-been-released]
- **Framework-Retry CB semantics** — `FrameworkRetryCircuitBreakerFactory` + `FrameworkRetryConfigBuilder`
  (`retryPolicy`, `openTimeout` default 20s, `resetTimeout` default 5s); states closed/open/half-open;
  opens after a **complete** invocation fails (all retries exhausted); `CircuitBreakerFactory.create(id).run(supplier, fallback)`;
  **no reactive** (use the R4j backend for reactive). [docs.spring.io/spring-cloud-circuitbreaker/reference/spring-cloud-circuitbreaker-framework-retry.html]

> **Ground-truth correction (material):** the RUNBOOK/WP-40 note "wait for r4j#2351" predates Oakwood.
> Circuit breakers **are attainable on Boot 4 today** via Spring Cloud CircuitBreaker 5.0.x. Part B is
> re-scoped around that fact; #2351 is downgraded from *blocker* to *optional future ergonomics*.

---

# PART A — Production AgentCore Chat Path

**Goal.** Restore and productionize the managed Python AgentCore runtime that `AgentCoreInvoker` targets,
prove it end-to-end against a live runtime (not just unit tests), and make the prod/dev invoker toggle safe
and observable — without disturbing the green `bedrock-direct` e2e.

**Current reality.** `chat-service` ships with `invoker=agentcore` as the default and a real
`AGENT_RUNTIME_ARN` baked into `chat-service/k8s/chat-service.yaml`, but (1) that runtime was part of the
**decommissioned** infra, so the ARN may be stale/inactive, and (2) the AgentCore code path has **only ever
been unit-tested** (`ChatServiceTest` mocks `AgentInvoker`; the e2e forces `bedrock-direct`). Part A closes
both gaps.

## A.1 (Re)deploy the Python AgentCore runtime

### A.1.1 Preconditions to verify (fail fast — do not assume "decommissioned" = "gone")
Run these read-only checks first; they determine whether this is a *reactivate* or a *rebuild*:
```bash
# Does the runtime referenced by the ConfigMap still exist and is it READY?
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id rosettacloud_education_agent-yebWcC9Yqy --region us-east-1 || echo "MISSING"

# Does the execution role exist?
aws iam get-role --role-name rosettacloud-agentcore-runtime-role || echo "MISSING"

# Does the MCP Gateway + agent_tools Lambda still exist? (tools plane)
aws lambda get-function --function-name agent_tools --region us-east-1 || echo "MISSING"

# Does AgentCore Memory still exist? (the workflow expects rosettacloud_education_memory_v2-vvC3mbAmra)
aws bedrock-agentcore-control list-memories --region us-east-1 || true

# Is the ECR repo for the agent image present?
aws ecr describe-repositories --repository-names bedrock-agentcore-rosettacloud_education_agent --region us-east-1 || echo "MISSING"
```
**Decision:** if `get-agent-runtime` returns `READY`, skip to A.2 (wiring) and only run a redeploy to pick up
code changes. If `MISSING`, perform the full deploy below.

### A.1.2 IAM: the runtime execution role
`.bedrock_agentcore.yaml` sets `execution_role: rosettacloud-agentcore-runtime-role` with
`execution_role_auto_create: true`. Prefer to **codify it in Terraform** rather than rely on
auto-create (Part C §C.2 folds all AgentCore IAM into IaC). Least-privilege policy the runtime needs,
derived from what `agent.py`/`tools.py` actually call:
```jsonc
// Trust: principal Service = bedrock-agentcore.amazonaws.com, action sts:AssumeRole
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "NovaInvoke", "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse"],
      "Resource": ["arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0",
                   "arn:aws:bedrock:us-east-1:339712964409:inference-profile/us.amazon.nova-2-lite-v1:0"] },
    { "Sid": "TitanEmbedForRag", "Effect": "Allow", "Action": ["bedrock:InvokeModel"],
      "Resource": ["arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0"] },
    { "Sid": "AgentCoreMemory", "Effect": "Allow",
      "Action": ["bedrock-agentcore:CreateEvent","bedrock-agentcore:ListEvents",
                 "bedrock-agentcore:RetrieveMemoryRecords","bedrock-agentcore:GetMemoryRecord"],
      "Resource": ["arn:aws:bedrock-agentcore:us-east-1:339712964409:memory/*"] },
    { "Sid": "Observability", "Effect": "Allow",
      "Action": ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents",
                 "cloudwatch:PutMetricData","xray:PutTraceSegments"],
      "Resource": "*" }
  ]
}
```
> Note: the **tool** permissions (DynamoDB/S3/LanceDB) live on the **`agent_tools` Lambda** role
> (`rosettacloud-agent-tools-role`, already in `main.tf`), NOT on the runtime role — the runtime reaches
> data only through the MCP Gateway. Keep that separation.

### A.1.3 Memory
`agent-deploy.yml` injects `BEDROCK_AGENTCORE_MEMORY_ID=rosettacloud_education_memory_v2-vvC3mbAmra`, and
`serverless/flow.MD`, README, and the Frontend now all reference the **same canonical**
`rosettacloud_education_memory_v2-vvC3mbAmra` **(reconciled)** — the older `rosettacloud_education_memory-evO1o3F0jN`
is no longer referenced by any doc/code.
Resolution (completed — retained for the record):
1. `aws bedrock-agentcore-control list-memories` to find which (if any) exists.
2. If neither exists, create one and record the ID as the single source of truth:
   `agentcore memory create --name rosettacloud_education_memory_v2` (or the control-plane `create-memory`).
3. Pin the surviving ID in `agent-deploy.yml` **and** document it in the RUNBOOK. Memory is optional at
   runtime — `agent.py._create_session_manager` returns `None` when `MEMORY_ID` is unset and the agent
   still answers (just without cross-session recall), so a missing memory degrades gracefully.

### A.1.4 Gateway + tools plane
The tutor's RAG and the grader/planner data tools flow through the MCP Gateway. If `agent_tools` Lambda and
the Gateway survived decommission, only re-publish `GATEWAY_URL`; else rebuild:
1. Ensure `agent_tools` Lambda is deployed (its own `lambda-deploy.yml`) with role `rosettacloud-agent-tools-role`.
2. `cd Backend/agents && python setup_gateway.py` → creates `rosettacloud-education-tools`
   (`authorizerType=NONE`), registers the Lambda target, prints the Gateway URL.
3. `gh variable set GATEWAY_URL --body "<url>"` so the deploy bakes it in.
> `authorizerType=NONE` means the Gateway is reachable by URL alone. That is acceptable **only** because
> it is not publicly advertised and the Lambda is read-mostly; still, flag it in the risk register (R-A4)
> and prefer adding the Cognito client-credentials authorizer that `agent.py._get_bearer_token` already
> supports (`COGNITO_TOKEN_URL/CLIENT_ID/CLIENT_SECRET`) as a fast-follow hardening.

### A.1.5 Deploy the runtime
Deployment is via the `bedrock-agentcore-starter-toolkit` CLI (ARM64 container built on CodeBuild), exactly
as `agent-deploy.yml` already encodes:
```bash
cd Backend/agents
# One-time (or when entrypoint/role/region change) — regenerates .bedrock_agentcore.yaml:
agentcore configure -e agent.py -n rosettacloud_education_agent \
  -er arn:aws:iam::339712964409:role/rosettacloud-agentcore-runtime-role \
  -rf requirements.txt -r us-east-1 -ni
# Build + push + deploy (ARM64 CodeBuild), injecting runtime env:
agentcore launch --auto-update-on-conflict \
  --env BEDROCK_AGENTCORE_MEMORY_ID=rosettacloud_education_memory_v2-vvC3mbAmra \
  --env GATEWAY_URL="$GATEWAY_URL" \
  --env NOVA_MODEL_ID=us.amazon.nova-2-lite-v1:0 \
  --env AGENT_MAX_OUTPUT_TOKENS=4096
agentcore status   # wait for READY; capture the (possibly NEW) agent ARN
```
**Critical output:** `agentcore launch` may mint a **new** agent id/ARN. Whatever ARN `agentcore status`
reports is the value `chat-service` must use in A.2 — do not assume the old
`...rosettacloud_education_agent-yebWcC9Yqy` ARN is still valid. Treat the ARN as a deploy output that flows
into the chat-service ConfigMap.

### A.1.6 Direct smoke test (bypass chat-service)
Prove the runtime answers before touching Java, using the repo's own probe:
```bash
python Backend/agents/invoke_agent.py <RUNTIME_ARN> "What is Docker?"
# Expect: {"agent":"tutor","response":"<hint-first answer>","session_id":"..."}
```
Also exercise `type=grade` and `type=session_start` payloads to confirm grader/planner routing and that the
MCP tools resolve (watch `aws logs tail /aws/bedrock-agentcore/runtimes/<id> --follow`).

**A.1 acceptance:** `agentcore status = READY`; `invoke_agent.py` returns a non-empty tutor answer; grader
and planner routes return; runtime + Lambda logs show no `Init error` / gateway errors; the live ARN,
Memory ID, and Gateway URL are recorded in the RUNBOOK.

## A.2 Wire `chat-service` to the runtime

### A.2.1 Configuration (what changes, where)
`chat-service` already selects the invoker at boot via
`rosettacloud.chat.invoker=${CHAT_INVOKER:agentcore}` and reads `AGENT_RUNTIME_ARN`. The only prod change
is to make the ConfigMap's ARN match the **live** ARN from A.1.5:
```yaml
# chat-service/k8s/chat-service.yaml (ConfigMap chat-service-config)
CHAT_INVOKER: "agentcore"                 # already the default
AGENT_RUNTIME_ARN: "<ARN from `agentcore status`>"   # <-- update to the live value
AWS_REGION: "us-east-1"
```
No Java change is required for the happy path — `AgentCoreInvoker` is already correct. Confirm the payload
contract below still matches `agent.py` before shipping.

### A.2.2 Credentials (no EKS ⇒ no IRSA)
`AgentCoreInvoker` builds its client with `DefaultCredentialsProvider.create()`. With no EKS there is no
IRSA, so the chain must resolve to an identity holding **`bedrock-agentcore:InvokeAgentRuntime`**:
- **Today (k3s-in-runner / interim persistent):** inject `AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN` via the
  **`aws-creds` secret** (the deploy workflows already create it) and add `envFrom: secretRef: aws-creds` to
  the prod Deployment. The identity behind those keys needs the `AgentCore` statement already present in
  `backend-java.tf`'s `chat_service` policy (`bedrock-agentcore:InvokeAgentRuntime` on `runtime/*`).
- **Target (Part C persistent node):** attach an **EC2 instance profile** carrying the same permission and
  drop the static secret entirely — `DefaultCredentialsProvider` picks up the instance metadata creds with
  no code change. See Part C §C.2.6.
> Remove the **dormant** `eks.amazonaws.com/role-arn` IRSA annotation from the SA in the no-EKS manifests to
> avoid confusion (it references an OIDC provider that does not exist).

### A.2.3 Payload / response contract (verified against `AgentCoreInvoker` ↔ `agent.py`)
Request payload (Java `AgentCoreInvoker` builds; Python `invoke()` reads):
```jsonc
{
  "message": "...", "user_id": "...", "session_id": "...",
  "type": "chat|hint|explain|grade|session_start",
  "module_uuid": "...", "lesson_uuid": "...",
  "conversation_history": [ {"role":"user|assistant","text":"..."} ],  // authoritative; agent trusts it even if empty
  "question_number": 3, "result": "...",   // only when type=grade
  "image": "<base64 jpeg>"                  // optional; agent decodes for Nova vision
}
```
- **Session id:** AgentCore requires `runtimeSessionId` length ≥ 33. `AgentCoreInvoker` pads short ids with
  `"-" + 16 hex`. Keep this — it is load-bearing (a 12-char `e2e-sess-1` would be rejected raw).
- **History key semantics:** `agent.py` trusts `conversation_history` **whenever the key is present** (even
  `[]`) over its in-process cache — this is the fix for the tool-block imbalance `ValidationException`.
  `ChatService` sends `List.of()` for `explain`/`session_start`; that is correct and must be preserved.
- **Response:** the runtime returns a single JSON object `{"agent","response","session_id"}`.
  `AgentCoreInvoker` reads `response` + `agent` and defaults `agent` to `"tutor"` if absent. `agent.py` never
  throws to the caller — it maps `MaxTokensReached`/`ContextWindowOverflow`/`ValidationException` to friendly
  text and returns 200-shaped bodies. So `chat-service` will almost always get a parseable object; the Java
  side must still handle a non-JSON/empty body defensively (see A.2.4).

### A.2.4 Streaming contract (be precise about what "streaming" means here)
`InvokeAgentRuntime` returns a **streamed HTTP body**, but two things are true in this codebase:
1. `agent.py`'s `@app.entrypoint invoke()` **returns a single dict** (not an SSE token stream). The
   "stream" is just the response body transport, delivered as one JSON document.
2. `AgentCoreInvoker` uses `ResponseTransformer.toBytes()`, which **buffers the full body** then
   `mapper.readValue(...)`. So today's contract is **request/response, fully buffered** — there is no
   token-by-token streaming surfaced to the browser (parity with the FastAPI `boto3` path).
**Implication / hardening (small Java change, recommended):**
- Wrap the parse in a guard: if `bytes.asByteArray()` is empty or not valid JSON, return a graceful
  `Reply("The tutor is temporarily unavailable, please retry.", "tutor")` instead of throwing — this keeps
  `/chat` from 500-ing on a transient runtime hiccup and mirrors the fail-open philosophy elsewhere.
- **Do NOT** attempt real SSE streaming now: the frontend is synchronous POST `/chat` (README), Nova replies
  are ≤4096 tokens (~1–2 s), and streaming would add complexity for no UX gain. Record it as a future item.

### A.2.5 Build/deploy chat-service
No dependency change (`bedrockagentcore` is already in `chat-service/pom.xml`). Ship via the existing
`backend-java-deploy.yml` (build→ECR→k3s) or, post-Part-C, the persistent-cluster workflow (§C.3).

**A.2 acceptance:** with `CHAT_INVOKER=agentcore` and the live ARN, a manual `POST /chat {type:chat}` in the
target cluster returns a non-empty `response` and an `agent` of tutor/grader/planner; CloudWatch shows the
runtime invocation; no 500s on empty/garbled bodies (guard verified by a unit test feeding empty bytes).

## A.3 End-to-end test of the AgentCore path

**Problem being solved:** the AgentCore path is **unit-tested only**. We add a *live-runtime* e2e mode
without (a) inflating per-PR cost or (b) destabilizing the existing bedrock-direct e2e.

### A.3.1 Extend the probe with an `invoker=agentcore` mode
`scripts/e2e/test_e2e.py` currently drives `chat-service` (which itself is configured `bedrock-direct` in
`e2e-stack.yaml`). Add an **AgentCore assertion mode** selected by env, two possible layers:
- **Layer 1 — direct runtime probe (cheap, no cluster):** `AGENTCORE_ARN` set ⇒ call
  `bedrock-agentcore:InvokeAgentRuntime` directly (reuse `Backend/agents/invoke_agent.py` logic) and assert a
  non-empty `response` + a valid `agent`. This validates the *runtime* independently of chat-service.
- **Layer 2 — through chat-service (full path):** deploy a chat-service instance with
  `CHAT_INVOKER=agentcore` + `AGENT_RUNTIME_ARN=$AGENTCORE_ARN` (a second manifest overlay, see A.3.2) and
  assert `POST /chat` returns a body whose `agent`∈{tutor,grader,planner}. This validates the *wiring*
  (session-id padding, payload shape, creds).
Guard both behind `if os.environ.get("AGENTCORE_ARN")` so the default e2e (bedrock-direct) is unchanged when
the ARN is absent.

### A.3.2 Manifest overlay for the AgentCore e2e
Add `Backend-Java/e2e/k8s/chat-agentcore.overlay.yaml` (a patch, not a fork of `e2e-stack.yaml`) that flips
just the chat Deployment:
```yaml
env:
  - { name: CHAT_INVOKER, value: "agentcore" }
  - { name: AGENT_RUNTIME_ARN, value: "<injected from $AGENTCORE_ARN>" }
# aws-creds secret already provides creds; the assumed OIDC role rosettacloud-e2e-tester
# already holds bedrock-agentcore:InvokeAgentRuntime (see backend-java.tf e2e_tester policy).
```
The `rosettacloud-e2e-tester` role **already** grants `AgentCoreInvoke` on `runtime/*`, so no IAM change is
needed for the test.

### A.3.3 Cost / rate / gating (nightly vs PR)
Follow the existing discipline (e2e-k3s.yml is nightly + manual precisely because it spends real Bedrock):
| Trigger | Chat mode | Rationale |
|---------|-----------|-----------|
| **Per-PR** (`backend-java-deploy.yml` smoke) | `SKIP_CHAT=1` (health only) | zero model spend; proves the ECR image runs. **Unchanged.** |
| **Nightly** (`e2e-k3s.yml`) | `bedrock-direct` real Nova | current behavior. **Unchanged.** |
| **Nightly (new job) or manual dispatch** | `agentcore` (Layer 1 + Layer 2) | validates the prod path against a live runtime; one invocation per agent type. |
Put the AgentCore assertions in a **separate job** (or a `workflow_dispatch` input `chat_mode: agentcore`)
so a runtime outage fails only that job, never the stable bedrock-direct signal. Cap it to a handful of
invocations; Nova Lite 2 is cheap but the point is a **smoke**, not a load test.

### A.3.4 Rate-limit / quota interactions in the test
`ChatService` enforces `rate-limit-per-hour: 30` and the AI-quota gate. The probe must (a) seed the user's
DynamoDB item (it already does) and (b) keep AgentCore-mode invocations well under 30/hr — trivially true for
a smoke. Do **not** disable the limiter in the test; exercising it is part of the value.

**A.3 acceptance:** a nightly/dispatch job with `AGENTCORE_ARN` set turns green: Layer-1 direct invoke
returns per-type agents; Layer-2 `POST /chat` via `invoker=agentcore` returns a non-empty reply; the default
per-PR and nightly bedrock-direct paths are byte-for-byte unchanged; a forced runtime-down run fails **only**
the AgentCore job and dumps diagnostics.

## A.4 Runtime toggle (`agentcore ⇄ bedrock-direct`) + observability

### A.4.1 The toggle is already a first-class switch — make it operable
Selection is `@ConditionalOnProperty(rosettacloud.chat.invoker)` at **bean creation**, so switching requires
a restart (a ConfigMap change + rollout), which is the right blast radius for a provider swap. Operational
runbook entry to add:
```bash
# Fail over chat from AgentCore to direct Bedrock (e.g., runtime outage) — seconds to effect:
kubectl set env deploy/rosettacloud-chat-service -n dev CHAT_INVOKER=bedrock-direct
kubectl rollout status deploy/rosettacloud-chat-service -n dev
# Fail back:
kubectl set env deploy/rosettacloud-chat-service -n dev CHAT_INVOKER=agentcore
```
`bedrock-direct` is a **true fallback**, not just a test shim: it calls the same Nova Lite 2 model with the
same tutor/grader/planner prompts (`PromptLibrary`), so a failover degrades *gracefully* — it loses MCP tools
(RAG, progress lookups) and cross-session memory, but keeps answering. Document that trade-off.

### A.4.2 Make the active invoker observable
Today nothing emits which invoker is live or how the AgentCore call performed. Add (small, additive):
1. **Startup log + info contributor:** log `chat.invoker=<agentcore|bedrock-direct>` at boot and expose it
   at `/actuator/info` so an operator can confirm the mode without reading env.
2. **Micrometer timer + counter** around `invoker.invoke(...)` in `ChatService` (or via a thin decorator so
   both invokers are measured uniformly):
   - `chat.invoke.duration{invoker,type,agent,outcome}` (timer)
   - `chat.invoke.errors{invoker,reason}` (counter) — increments on empty/garbled body, SDK exception, timeout.
   These flow through the already-exposed `/actuator/prometheus` (see `application.yml`
   `management.endpoints...prometheus`).
3. **Structured warn log** on any AgentCore parse-guard hit (A.2.4) with `session_id` suffix only (never full
   ids/PII) — mirrors `agent.py`'s logging discipline.

### A.4.3 Alerts (wire once Prometheus scrape exists — Part C §C.2.8 / cross-cutting §X.3)
- `rate(chat.invoke.errors{invoker="agentcore"}[5m]) > 0.2 * rate(chat.invoke.duration_count{invoker="agentcore"}[5m])`
  for 10 m → page: "AgentCore degraded — consider `CHAT_INVOKER=bedrock-direct`."
- `histogram_quantile(0.95, chat.invoke.duration{invoker="agentcore"}) > 5s` for 10 m → warn.

**A.4 acceptance:** `/actuator/info` reports the active invoker; `chat.invoke.*` metrics appear in
`/actuator/prometheus` tagged by invoker/type/agent/outcome; the documented `kubectl set env` failover works
in a drill (flip to bedrock-direct, `/chat` still answers, flip back).

---

# PART B — Circuit Breakers on Spring Boot 4

**Goal.** Add real circuit breaking to the failure-prone cross-boundary calls **without regressing** the
current fail-open behavior, and do it on a path that is actually available on Boot 4 / Spring Framework 7.

**Reframed thesis (see §0.4).** The prior stance ("wait for resilience4j#2351") is obsolete. Circuit
breakers are available on Boot 4 **today** through **Spring Cloud CircuitBreaker 5.0.x (Oakwood, GA
2025-11-25)**. Part B therefore has three phases: **(B.1)** keep tracking #2351 but redefine the trigger;
**(B.2)** formalize the interim native-Spring resilience we already partly have; **(B.3)** adopt Spring Cloud
CircuitBreaker as the target — then **(B.4)** roll out with state-machine tests and a rollback.

## B.1 Track resilience4j#2351 — and redefine the adoption trigger

### B.1.1 What #2351 actually is (and is not)
- #2351 asks the **resilience4j** project for a **Spring Boot 4 starter** (i.e. the annotation-driven
  `io.github.resilience4j:resilience4j-spring-boot4` with `@CircuitBreaker`/`@Bulkhead`/`@TimeLimiter`/`@Retry`
  and `application.yml` config). Opened by the Spring Cloud team, **closed as a `question`** (→ PR #2384). As
  of 2025-07-02 **no such Boot 4 starter has shipped**. [gh#2351]
- #2351 is **not** the only route to circuit breakers. **Spring Cloud CircuitBreaker 5.0.x** already wraps
  **resilience4j-core 2.3.0** on Boot 4 and adds a native Framework-Retry backend. That is our target, and it
  does not depend on #2351 closing with a starter. [Oakwood blog]

### B.1.2 Adoption triggers (decision table)
| Trigger (whichever comes first) | Action | Ergonomics |
|---|---|---|
| **NOW** — Oakwood is GA | Adopt **Spring Cloud CircuitBreaker 5.0.x** (B.3). Programmatic `CircuitBreakerFactory` API. | Good; explicit `.run(supplier, fallback)`. |
| resilience4j ships a Boot 4 starter (**#2351 resolved with a release**) | *Optionally* migrate to annotation-driven `@CircuitBreaker` for terser call sites. | Best; declarative. |
| Neither, and we want zero third-party CB | Use the **Framework-Retry** backend (pure Spring) via the same Spring Cloud CircuitBreaker facade. | OK; no rolling-window failure-rate. |
**Recommendation:** proceed with B.3 on the **Resilience4j backend** now; revisit the annotation style only
if/when #2351 yields a starter. Set a **watch**: subscribe to #2351 and the `spring-cloud-circuitbreaker`
releases; re-evaluate at the next Spring Cloud minor.

### B.1.3 Definition-of-ready for adoption
- `spring-cloud-dependencies:2025.1.x` BOM imports cleanly alongside the pinned `spring-boot` 4.x and AWS SDK
  BOM in the parent `pom.xml` (verify no version divergence in `./mvnw dependency:tree`).
- A spike branch shows `CircuitBreakerFactory` autoconfigures and a trivial breaker opens/closes in a unit
  test (B.4.1). Only then wire real clients.

## B.2 Interim design NOW (native Spring 7 + existing HttpRetry)

This is what to ship **before/independent of** the CB dependency, hardening today's posture.

### B.2.1 What we already have (keep — do not rip out)
- **Timeouts:** every client uses `SimpleClientHttpRequestFactory` 2s connect / 5s read. Correct and cheap.
- **Transient retry:** `HttpRetry.withRetry(2, 150, op)` retries **only** `ResourceAccessException`
  (connect-refused / read-timeout — the rolling-deploy case), linear back-off; 4xx/5xx propagate. This is a
  deliberate, unit-testable helper and should **remain** even after CBs land (retry and CB compose).
- **Fail-open fallbacks:** `UserAiQuotaClient.aiQuota→{messages_remaining:50}`, `UserServiceClient`
  `remainingLabMinutes→0` / `activeLab→empty` / `closeLabSession→0`, `UserProgressClient.trackProgress→best-effort`.
  These preserve UX when user-service is degraded and **must be preserved verbatim** as the CB fallbacks in B.3.

### B.2.2 Gaps to fix in the interim (small, no new deps)
1. **`UserServiceClient.setActiveLab` — DONE (reconciled):** now wrapped in `HttpRetry(2,150)` + a fail-open
   try/catch (log + swallow), consistent with its siblings (`linkLab`/`unlinkLab`). A user-service blip no
   longer propagates or fails an otherwise-successful lab launch. *No call site is fail-closed anymore.*
2. **`chat→Bedrock/AgentCore` has no app-level resilience** — only SDK-internal timeouts/retries. It is the
   most latency-variable dependency and the prime CB candidate (B.3).
3. **No metrics** on client outcomes (added generically in B.3.4 / A.4.2).

### B.2.3 Optional: formalize with Spring Framework 7 native retry
SF 7 core gives `@Retryable` / `RetryTemplate` / `@ConcurrencyLimit` with `@EnableResilientMethods`, **no new
dependency**. Use them where they add clarity, but **do not** expect a circuit breaker from core SF7 (there
isn't one):
- `@ConcurrencyLimit` on the chat→AI-plane call is a genuinely useful **bulkhead-lite** today: it caps
  concurrent in-flight Nova/AgentCore calls per pod, protecting against thread/connection exhaustion under a
  burst — especially relevant with virtual threads enabled (`spring.threads.virtual.enabled=true`).
- `RetryTemplate` could replace the hand-rolled `HttpRetry`, but **defer**: `HttpRetry` is green, unit-tested,
  and its "retry only `ResourceAccessException`" policy is precisely tuned. Migrate only when the CB work
  (B.3) touches these call sites anyway, to avoid a churn-only change (matches the RUNBOOK's explicit
  reasoning for deferring the `@HttpExchange` refactor).

### B.2.4 Where circuit-breaking belongs (the map — applies to B.3)
| Call site | Source | Failure mode | Breaker? | Fallback (preserve current) |
|---|---|---|---|---|
| **chat → Bedrock/AgentCore** | `AgentCoreInvoker`/`BedrockDirectInvoker` via `ChatService` | slow/timeout/throttle/runtime-down | **YES — highest priority** | friendly "tutor temporarily unavailable" text (A.2.4); *consider* auto-switch signal to bedrock-direct |
| **chat → user-service** (AI quota) | `UserAiQuotaClient.aiQuota/increment` | user-svc down during deploy | **YES** | `{messages_remaining:50}`; increment best-effort |
| **lab → user-service** (quota/session) | `UserServiceClient.*` | user-svc down | **YES** | minutes→0, activeLab→empty, session→0, link best-effort; `setActiveLab` now fail-open (done) |
| **question → user-service** (progress) | `UserProgressClient.trackProgress` | user-svc down | **YES (low)** | best-effort (already swallows) |
| lab → **K8s API** (Fabric8) | lab-service provisioner | API blip | maybe (later) | out of scope here; K8s client has its own retry |
> Priority order: **chat→AI-plane** first (most variable, user-facing), then **chat→quota** and
> **lab→user** (they gate paid actions), then **question→progress** (already best-effort, low value).

## B.3 Target design — Spring Cloud CircuitBreaker 5.0.x (available now)

### B.3.1 Dependency & backend choice
Add the Spring Cloud BOM to the parent POM and the starter to each service that makes cross-boundary calls
(`chat`, `lab`, `question`):
```xml
<!-- parent pom.xml dependencyManagement -->
<dependency>
  <groupId>org.springframework.cloud</groupId>
  <artifactId>spring-cloud-dependencies</artifactId>
  <version>2025.1.0</version><type>pom</type><scope>import</scope>
</dependency>
<!-- chat/lab/question pom.xml -->
<dependency>
  <groupId>org.springframework.cloud</groupId>
  <artifactId>spring-cloud-starter-circuitbreaker-resilience4j</artifactId>
</dependency>
```
**Backend = Resilience4j** (not Framework-Retry) because we want a **rolling-window failure-rate** breaker
plus **Bulkhead + TimeLimiter + Micrometer metrics**, all of which the R4j backend provides and which the
Framework-Retry backend (per-invocation open, no bulkhead/timelimiter, no reactive) does not. [Oakwood docs]
Keep Framework-Retry noted as the zero-3rd-party alternative if the owner later wants to drop resilience4j
entirely.

### B.3.2 Configuration (per-client instances, fail-open fallbacks)
Provide a default `Customizer` and per-id overrides via a `@Configuration` in `shared-lib` so all services
inherit one policy vocabulary:
```java
@Bean
Customizer<Resilience4JCircuitBreakerFactory> cbDefaults() {
  return factory -> factory.configureDefault(id -> new Resilience4JConfigBuilder(id)
      .circuitBreakerConfig(CircuitBreakerConfig.custom()
          .slidingWindowType(COUNT_BASED).slidingWindowSize(20)
          .failureRateThreshold(50f).waitDurationInOpenState(Duration.ofSeconds(10))
          .permittedNumberOfCallsInHalfOpenState(3).build())
      .timeLimiterConfig(TimeLimiterConfig.custom()
          .timeoutDuration(Duration.ofSeconds(6)).build())   // > chat read timeout headroom
      .build());
}
// Per-id tuning: "ai-plane" gets a longer TimeLimiter (Nova can take ~2s, allow 10s) + a Bulkhead;
// "user-quota"/"user-session"/"user-progress" get the tighter default (fast internal calls).
```
Call sites use the factory, wrapping the **existing** logic and returning the **existing** fallbacks:
```java
// UserAiQuotaClient.aiQuota — CB around the retry, fallback = today's permissive default
return cbFactory.create("user-quota").run(
    () -> HttpRetry.withRetry(2, 150, () -> http.get()...body(Map.class)),
    throwable -> Map.of("messages_remaining", 50, "messages_limit", 50));  // unchanged semantics
```
- **Retry stays inside the breaker** (`HttpRetry` for transient I/O), so a rolling-deploy blip is retried,
  and only a *sustained* failure rate trips the breaker — the two compose cleanly.
- **Every fallback == the current fail-open value.** The CB changes *when* we fall back (fast, when open),
  never *what* we fall back to. This is the key non-regression guarantee.
- **chat→AI-plane:** wrap `invoker.invoke(...)` in `cbFactory.create("ai-plane").run(call, t → new Reply(
  "The tutor is temporarily unavailable, please retry.", "tutor"))`. Add a `Bulkhead` on `ai-plane` to cap
  concurrent model calls per pod.

### B.3.3 Where the breaker is instantiated
Prefer wrapping in the **client classes** (`UserAiQuotaClient`, `UserServiceClient`, `UserProgressClient`)
and a thin decorator around `AgentInvoker` (so both invokers get the breaker uniformly and `ChatService`
stays clean). This keeps the CB adjacent to the fallback that already lives there.

### B.3.4 Metrics & alerts
- R4j backend auto-registers Micrometer meters: `resilience4j.circuitbreaker.state`,
  `...calls{kind=successful|failed|not_permitted}`, `...failure.rate`, plus bulkhead/timelimiter meters —
  exported via the already-enabled `/actuator/prometheus`.
- These complement the `chat.invoke.*` meters from A.4.2 (app-level) — keep both: CB meters explain *why*
  (breaker open) and app meters explain *impact* (latency/errors seen by users).
- **Prometheus alerts:**
  - `resilience4j_circuitbreaker_state{name="ai-plane",state="open"} == 1` for 2 m → page.
  - `resilience4j_circuitbreaker_failure_rate{name=~"user-.*"} > 60` for 10 m → warn (user-service degraded).
  - `increase(resilience4j_circuitbreaker_calls_total{kind="not_permitted"}[5m]) > 0` → info (breaker shedding).

## B.4 Rollout, tests (open/half-open/closed), rollback

### B.4.1 Tests — prove the state machine (the crux of the acceptance)
Use Resilience4j's own registry in unit tests (no network) to assert transitions, plus a WireMock
integration test per client:
1. **CLOSED → OPEN:** feed failures past `slidingWindowSize`×`failureRateThreshold`; assert state=OPEN and
   that the **fallback value equals the pre-CB fail-open value** (e.g. `messages_remaining==50`).
2. **OPEN → fast-fail:** while OPEN, assert calls return the fallback **without** hitting WireMock
   (verify zero new WireMock requests) and `calls{kind=not_permitted}` increments.
3. **OPEN → HALF_OPEN → CLOSED:** advance past `waitDurationInOpenState`; serve successes for
   `permittedNumberOfCallsInHalfOpenState`; assert CLOSED.
4. **HALF_OPEN → OPEN:** fail the trial call; assert back to OPEN.
5. **TimeLimiter:** a WireMock fixed-delay > `timeoutDuration` counts as a failure (drives #1).
6. **Retry×CB compose:** a single `ResourceAccessException` is retried by `HttpRetry` and does **not** trip
   the breaker; sustained failures do.
7. **chat→AI-plane:** stub the invoker to throw/timeout; assert `/chat` returns the friendly fallback text
   with HTTP 200 and the breaker opens (via `@WebMvcTest` + a mocked `AgentInvoker` decorated by the CB).
These run under `./mvnw verify` in every pipeline (the mandatory test-gate discipline already in force).

### B.4.2 Rollout (incremental, observable, low-risk)
1. **Spike** (B.1.3): BOM imports, trivial breaker test green. Merge behind no runtime change.
2. **Shadow metrics first:** wrap one low-risk client (**question→progress**, already best-effort) so CB
   meters appear in Prometheus with zero UX risk; watch a nightly.
3. **Expand to user-service clients** (chat→quota, lab→user) — verify fallbacks unchanged via the e2e
   (quota-exhausted 403 path and lab launch still pass).
4. **chat→AI-plane last**, after Part A is live, tuned against real AgentCore latency; run the A.3 AgentCore
   e2e to confirm the breaker doesn't false-trip on normal ~1–2 s replies.
5. Enable alerts (B.3.4) once Part C's Prometheus scrape exists.

### B.4.3 Rollback
- **Config-level (no redeploy where possible):** set a generous `failureRateThreshold`/large window to
  effectively disable tripping, or toggle `spring.cloud.circuitbreaker.resilience4j.enabled=false` (R4j
  backend honors this) via ConfigMap + rollout — reverts to pure timeout+retry+fail-open.
- **Dependency-level:** revert the POM addition; because breakers were introduced as **wrappers around
  unchanged logic returning unchanged fallbacks**, removing them leaves the exact pre-B.3 behavior. No data
  or contract migration is involved.
- **Blast radius:** per-service; roll back one service without touching others.

**Part B acceptance:** `spring-cloud-starter-circuitbreaker-resilience4j:5.0.x` builds on Boot 4; the 7
state-machine tests pass under `./mvnw verify`; CB + bulkhead + timelimiter meters appear at
`/actuator/prometheus`; the e2e's quota-403 and lab-launch paths are unchanged; `ai-plane` breaker opens on a
forced AgentCore outage and `/chat` still returns 200 with fallback text; disabling the CB via config
restores the prior path.

---

# PART C — Persistent Runtime WITHOUT EKS

**Goal.** Turn "green on a throwaway GitHub runner" into a **durable** runtime that serves real traffic,
honoring the **NO-EKS-EVER** mandate, reusing the existing Kubernetes manifests and ECR images, and staying
cheap and reversible.

**Why now.** `backend-java-deploy.yml` proves the images run on k3s, but the cluster **evaporates when the
runner job ends** — nothing serves users between runs. The edge is already built for a persistent node:
`terraform.tfvars` sets `node_public_dns` + `istio_http_nodeport = 80`, and `main.tf`'s CloudFront/API-GW
origin points at exactly that host:port. We need a box that *stays up* at that address.

**Contradiction resolved.** The **EKS module in `main.tf` is now removed** — the `module "eks"` block, the
`github_actions` EKS access entries, and the `local.eks_oidc_*` IRSA references are all commented out under a
`REMOVED: no-EKS-ever mandate` header (`aws eks list-clusters` → `[]`, no cluster provisioned). The remaining
C.2 work is to stand up the replacement k3s node from the existing `modules/ec2` + `modules/sg` building blocks.

## C.1 Decision matrix — no-EKS options

Scoring: **Fit** = how well existing K8s manifests/Istio/ECR map with least change; **Ops** = ongoing
burden; **Cost** = steady-state $/mo (us-east-1, rough); **Resilience** = failure tolerance.

| Option | Fit (manifests/Istio/ECR) | Ops burden | Cost/mo (steady) | Resilience | Verdict |
|---|---|---|---|---|---|
| **Persistent k3s — single small EC2** ⭐ | **Excellent** — same YAML/Istio CRDs/ECR; identical to the runner path but durable | Low–med (one box to patch) | **~$15–30** (t3.small/medium spot-or-on-demand + EBS) | Single-AZ, single node (SPOF) | **RECOMMENDED start** |
| **Persistent k3s — HA (3 servers, embedded etcd) + agents** | Excellent (same as above) | Med–high (etcd quorum, upgrades) | ~$60–120+ | Multi-node, survives a node loss | **Target for scale/SLA** (grow into it) |
| **Self-managed k8s (kubeadm) on EC2** | Good, but heavier control plane | **High** (you own etcd/upgrades/CNI) | ~$60+ | Configurable | ❌ more ops than k3s for no gain here |
| **k3d (k3s-in-Docker) on an EC2** | Good, but nested Docker adds a layer | Med | ~$15–30 | Single box + nesting fragility | ❌ k3d is a dev tool; bare k3s is simpler in prod |
| **ECS Fargate** | **Poor for reuse** — must rewrite all K8s YAML as task defs/services; **Istio VS lab routing doesn't exist**; lab-service's Fabric8 K8s calls break | Low (serverless) | ~$30–60 (5 tiny tasks) | Multi-AZ managed | ❌ abandons Istio + lab-service's K8s API model |
| **AWS App Runner** | **Very poor** — no K8s, no Istio, no in-cluster lab pods; lab-service **cannot** create pods; only fits stateless HTTP svcs | Very low | ~$5–25/svc | Managed | ❌ breaks the lab plane entirely |
| **HashiCorp Nomad on EC2** | Poor — rewrite manifests as Nomad jobs; no Istio VS; new tooling | Med–high (new stack to learn/run) | ~$15–30 | Configurable | ❌ throws away the K8s investment |

### C.1.1 How the existing assets map onto the recommended option
- **Manifests:** `Backend-Java/<svc>/k8s/<svc>.yaml` (ConfigMap+SA+Deployment+Service) and
  `DevSecOps/K8S/*` (Istio gateway/VS, strangler VS, NetworkPolicy) apply **unchanged** to persistent k3s —
  it is the same Kubernetes API the runner uses. Two edits only: (a) drop the dormant IRSA SA annotations,
  (b) set `imagePullPolicy: Always` + real ECR image refs (prod manifests already do; e2e overlay uses
  `Never`).
- **ECR images:** already the deploy artifact (`rosettacloud-<svc>:{latest,SHA}`). Persistent k3s pulls from
  ECR directly (needs registry creds — C.2.5), instead of `k3s ctr images import`.
- **Istio:** the runner path installs **CRDs only**; the persistent node runs a **real Istio ingress** (or a
  lighter Traefik/NGINX — see C.2.4) so `VirtualService` lab routing and the strangler VS actually route.
- **Edge:** CloudFront + API Gateway origins already target `node_public_dns:istio_http_nodeport(=80)` — a
  persistent node with an Elastic IP / stable DNS on NodePort 80 slots straight in.
- **SNS/SQS backbone:** real and unchanged; analytics-service consumes the same queue.
- **Lab pods:** lab-service creates pods **in-cluster** via Fabric8 — this **requires** a real Kubernetes
  API (k3s), which is precisely why ECS/App Runner/Nomad are disqualified.

### C.1.2 Recommendation
**Start on persistent single-node k3s (t3.small→medium), architected to grow into 3-server HA.** It reuses
100% of the manifests/Istio/ECR investment, is the cheapest durable option, and is the *same* runtime the CI
already validates — so PR gating and production share one substrate. Accept the single-node SPOF initially
(dev-tier SLA), with a documented, Terraform-ready path to HA (C.2.7) when traffic/SLA warrant.

## C.2 Recommended path — full setup

### C.2.1 Topology
```
Route53 (rosettacloud.app) → CloudFront → [origin: node EIP:80] → k3s node (public subnet)
   └ API Gateway (Cognito JWT @ edge) → same node:80
node (t3.medium, Amazon Linux 2023 or Ubuntu 22.04, EBS gp3 30–50GB):
   k3s server (traefik disabled) + Istio ingressgateway (NodePort 80) OR Traefik (C.2.4)
   ns dev: 5 Java svcs + Redis + (FastAPI during strangler) + dynamic lab pods
   AWS data plane: DynamoDB / S3 / SNS / SQS / Bedrock / AgentCore  ← via instance profile (C.2.6)
```
Single node runs control-plane + workloads (k3s default). Lab pods are ephemeral and node-local — mind
capacity (C.2.9).

### C.2.2 Terraform WITHOUT EKS (the IaC change)
Replace the EKS module with a k3s EC2 node built from the **existing** `modules/ec2` + `modules/sg`:
1. **Delete/guard EKS:** remove `module "eks"` from `main.tf`, the `aws_eks_access_*` resources, and the
   `local.eks_oidc_*` references. In `backend-java.tf`, delete the **dormant** per-service IRSA roles (they
   reference the now-gone OIDC provider) or keep them behind a `count=0`/`var.enable_irsa=false` guard with a
   comment. Keep VPC, Route53, ACM, CloudFront, API-GW, ECR, S3, SNS/SQS, Lambda/AgentCore IAM — all still valid.
2. **Security group** (`modules/sg`): ingress 80/tcp (from CloudFront prefix-list or 0.0.0.0/0 if simplest),
   443 only if terminating TLS on-node (else TLS is at CloudFront), 22/tcp from your admin CIDR (or use SSM —
   preferred, no open SSH), 6443/tcp only if HA agents join (private). Egress all (needs to reach AWS APIs +
   ECR + get.k3s.io).
3. **Instance** (`modules/ec2`): `t3.medium`, `associate_public_ip_address=true` (VPC has **no NAT**, so the
   node needs a public IP for egress), gp3 root 30–50 GB, `iam_instance_profile` = the node role (C.2.6),
   `user_data` = the k3s+Istio bootstrap (C.2.3), a **stable address** via `aws_eip` + association.
4. **Wire the edge:** set `node_public_dns` to the EIP's public DNS (or a Route53 record for the node) and
   `istio_http_nodeport = 80` (already the tfvars value). CloudFront/API-GW pick it up with no module change.
```hcl
# sketch — environments/shared (replaces the eks module)
module "k3s_sg" { source = "../../modules/sg" ; security_groups = { k3s = { name="rosettacloud-k3s", vpc_id=module.vpc.vpc_id,
  ingress_with_cidr_blocks=[{from_port=80,to_port=80,protocol="tcp",cidr_blocks="0.0.0.0/0",description="http"}] } } }
resource "aws_eip" "k3s" { domain = "vpc" ; tags = local.tags }
module "k3s_node" { source = "../../modules/ec2" ; ec2_instances = { node = {
  name="rosettacloud-k3s", instance_type="t3.medium", subnet_id=module.vpc.public_subnets[0],
  vpc_security_group_ids=[module.k3s_sg.security_group_ids["k3s"]], associate_public_ip_address=true,
  iam_instance_profile=aws_iam_instance_profile.k3s_node.name, root_volume_size=40, user_data=local.k3s_userdata } } }
resource "aws_eip_association" "k3s" { instance_id = module.k3s_node.instance_ids["node"] ; allocation_id = aws_eip.k3s.id }
```
> **State/rollback note:** removing `module.eks` will plan the **destruction of the EKS cluster**. If EKS was
> never actually applied for the Java plane (RUNBOOK says the runtime is k3s-on-runner and IRSA is dormant),
> confirm with `terraform state list | grep eks` first. If present, this is a **high-impact destroy** — do it
> deliberately, off-hours, with a state backup (`terraform state pull > backup.tfstate`), and confirm nothing
> else references it.

### C.2.3 Install (user_data bootstrap)
```bash
#!/usr/bin/env bash
set -euxo pipefail
# 1) k3s server, Traefik disabled (we bring Istio), kubeconfig world-readable for the deploy user
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik --write-kubeconfig-mode 644 \
  --tls-san $(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)" sh -
# 2) namespace + istio-injection
until kubectl get nodes | grep -q ' Ready'; do sleep 3; done
kubectl create ns dev --dry-run=client -o yaml | kubectl apply -f -
kubectl label ns dev istio-injection=enabled --overwrite
# 3) Istio (ingress on NodePort 80) — pin a version; demo profile is fine for one node
curl -L https://istio.io/downloadIstio | ISTIO_VERSION=1.29.0 sh -
./istio-*/bin/istioctl install -y --set profile=demo \
  --set components.ingressGateways[0].k8s.service.type=NodePort \
  --set components.ingressGateways[0].k8s.service.ports[0].port=80 \
  --set components.ingressGateways[0].k8s.service.ports[0].nodePort=30080  # then hostPort/iptables 80→30080
# 4) ECR pull secret refreshed by a timer (C.2.5); manifests applied by CI (C.3)
```
> One-node Istio `demo` profile is heavier than needed; if resource pressure appears on t3.small, either size
> up to t3.medium or swap Istio for **Traefik/NGINX ingress + Gateway API** (C.2.4). Keep Istio if lab
> `VirtualService` routing must stay identical to production intent with zero manifest change.

### C.2.4 Ingress choice (Istio vs Traefik)
- **Istio (recommended for parity):** the strangler VS, lab per-pod `VirtualService`, and gateway manifests
  apply unchanged; matches the architecture the manifests were written for. Cost: ~300–500 MB RAM overhead.
- **Traefik/NGINX (lighter):** viable on a tiny node, but lab-service emits Istio `VirtualService` objects —
  you'd need to translate lab routing to Ingress/IngressRoute and rewrite the strangler VS. **Only** choose
  this if RAM is the binding constraint; it is more migration work, not less.
**Decision:** keep Istio unless the node is RAM-starved; the manifests assume it.

### C.2.5 ECR image pulls (no `ctr import` in prod)
Persistent k3s pulls from ECR over the network, which needs rotating registry creds:
- Simplest: a systemd timer (every ~8h) runs `aws ecr get-login-password | k3s kubectl create secret
  docker-registry ecr-creds -n dev --docker-server=<acct>.dkr.ecr.us-east-1.amazonaws.com ...
  --dry-run=client -o yaml | kubectl apply -f -`, and Deployments reference `imagePullSecrets: [ecr-creds]`.
  The node's instance profile (C.2.6) authorizes `ecr:GetAuthorizationToken` + pull.
- Alternative: k3s `registries.yaml` with an ECR credential helper. Either way, **no static registry
  password** is stored.

### C.2.6 Secrets WITHOUT IRSA → instance profile
This is the crux of "no EKS ⇒ no IRSA." All pods on the node inherit the **EC2 instance profile** via IMDS,
and `DefaultCredentialsProvider` (used by every AWS SDK client incl. `AgentCoreInvoker`) resolves it with
**zero code change**. Consolidate the per-service least-privilege into **one node role** (or, for finer
grain, run kube2iam-style scoping later):
```jsonc
// rosettacloud-k3s-node role — union of what the 5 services + lab need, least-privilege by resource
{
  "Statement": [
    { "Sid":"Ddb","Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem",
        "dynamodb:DeleteItem","dynamodb:Query","dynamodb:Scan"],
      "Resource":["arn:aws:dynamodb:us-east-1:339712964409:table/rosettacloud-*",
                  "arn:aws:dynamodb:us-east-1:339712964409:table/rosettacloud-*/index/*"] },
    { "Sid":"S3Questions","Effect":"Allow","Action":["s3:GetObject","s3:ListBucket"],
      "Resource":["arn:aws:s3:::rosettacloud-shared-interactive-labs","arn:aws:s3:::rosettacloud-shared-interactive-labs/*"] },
    { "Sid":"Bedrock","Effect":"Allow","Action":["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream","bedrock:Converse"],
      "Resource":["arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0",
                  "arn:aws:bedrock:us-east-1:339712964409:inference-profile/us.amazon.nova-2-lite-v1:0"] },
    { "Sid":"AgentCore","Effect":"Allow","Action":["bedrock-agentcore:InvokeAgentRuntime"],
      "Resource":["arn:aws:bedrock-agentcore:us-east-1:339712964409:runtime/*"] },
    { "Sid":"Events","Effect":"Allow","Action":["sns:Publish"],"Resource":["arn:aws:sns:us-east-1:339712964409:rosettacloud-events"] },
    { "Sid":"AnalyticsQueue","Effect":"Allow","Action":["sqs:ReceiveMessage","sqs:DeleteMessage","sqs:GetQueueAttributes"],
      "Resource":["arn:aws:sqs:us-east-1:339712964409:rosettacloud-analytics"] },
    { "Sid":"Cognito","Effect":"Allow","Action":["cognito-idp:AdminUpdateUserAttributes"],
      "Resource":["arn:aws:cognito-idp:us-east-1:339712964409:userpool/*"] },
    { "Sid":"EcrPull","Effect":"Allow","Action":["ecr:GetAuthorizationToken","ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"],"Resource":"*" }
  ]
}
```
> **Trade-off & mitigation:** a single node role is coarser than per-service IRSA — any pod on the node can
> use any of these permissions. Acceptable for a dev-tier single-tenant box; document it (R-C3). Tighten
> later with per-pod scoping (e.g. `kube2iam`/`kiam`-equivalent) or by splitting workloads across node pools
> if you go HA. **Drop the `aws-creds` static-secret** once the instance profile is in place (secret becomes
> the CI-only path). This is strictly better than static keys.

### C.2.7 TLS
- **Recommended:** terminate TLS at **CloudFront** using the existing **ACM wildcard** (`*.rosettacloud.app`,
  `*.dev.rosettacloud.app`, `*.labs.dev.rosettacloud.app`) — already provisioned in `main.tf`. Origin traffic
  CloudFront→node stays HTTP on :80 (as the current CloudFront origin config expects: `origin_protocol_policy
  = "http-only"`). **No on-node cert management.** ✅ least ops.
- **If you ever expose the node directly:** the repo has a `DevSecOps/K8S/certbot` asset; run cert-manager or
  certbot for Let's Encrypt. Not needed while CloudFront fronts everything.

### C.2.8 Autoscaling limits, backups, upgrades
- **Autoscaling:** single node has no cluster-autoscaler. Use **HPA** within the node's capacity (set modest
  `maxReplicas`), and set **resource requests/limits** on every Deployment (chat-service already sets
  100m/384Mi req, 512Mi limit — replicate across services) so the scheduler protects the node. Vertical
  headroom = resize the instance (stop/change-type/start; EIP persists).
- **Backups:** the durable state is **DynamoDB/S3** (already backed by AWS; enable PITR on
  `rosettacloud-users`). On-node state is minimal: **Redis is a cache** (sessions/rate-limit — acceptable to
  lose) and k3s state is in SQLite at `/var/lib/rancher/k3s/server/db` — snapshot the **EBS volume** on a
  schedule (`aws_dlm_lifecycle_policy`, daily, keep 7) and/or `k3s etcd-snapshot` if you move to embedded
  etcd. Store the applied manifests in git (they already are) so the cluster is re-creatable.
- **Upgrades:** k3s in-place (`curl … | INSTALL_K3S_VERSION=vX sh -`) on a maintenance window; snapshot EBS
  first. App upgrades ride the CI rollout (C.3). Pin Istio and k3s versions in `user_data` for reproducibility.

### C.2.9 Capacity guardrail (lab pods)
Lab pods are node-local and can be heavy (the real interactive-labs image runs DinD/Kind). On one small node,
**cap concurrent labs** (lab-service already enforces a single active lab per user; also bound total via a
namespace `ResourceQuota` and the lab pod TTL). If labs need real capacity, that is the trigger to go **HA /
add an agent node dedicated to lab pods** (taint/toleration), still no EKS.

**C.2 acceptance:** `terraform apply` stands up the node + EIP + SG + instance profile with **no EKS in
state**; `kubectl get nodes` (via the node kubeconfig) shows `Ready`; Istio ingress answers on :80; CloudFront
→ node serves `/actuator/health` for all 5 services; pods obtain AWS creds via the instance profile (a chat
`/chat` call and a DynamoDB read both succeed with **no `aws-creds` secret present**); EBS snapshot schedule
active.

## C.3 CI/CD to the persistent k3s (keep ephemeral k3s-on-runner for PR gating)

**Principle:** two distinct pipelines with distinct purposes — never conflate gating with deploying.
- **PR gate (unchanged):** `backend-java-ci.yml` (`mvnw verify`) + `e2e-k3s.yml`'s ephemeral k3s-in-runner
  smoke. These stay exactly as they are — they build a throwaway cluster to *prove the images run*, then
  discard it. No connection to production.
- **Deploy to persistent (new/rescoped):** rework `backend-java-deploy.yml`'s `deploy_k3s` job to target the
  **persistent** node instead of spinning up a runner-local k3s.

### C.3.1 Connect the runner to the persistent cluster (kubeconfig secret)
1. On the node, the k3s kubeconfig is at `/etc/rancher/k3s/k3s.yaml` with `server: https://127.0.0.1:6443`.
   Produce a **remote** kubeconfig: replace the server with `https://<node-EIP>:6443` and ensure the node's
   TLS SAN includes that IP (the `--tls-san` in C.2.3 handles this).
2. Store it as a GitHub **secret** `KUBECONFIG_PERSISTENT` (base64). Lock down 6443 SG ingress to GitHub's
   egress or, better, avoid opening 6443 publicly by using **SSM Session Manager port-forwarding** or an
   **SSM RunCommand**-based apply (no inbound port at all — preferred; see C.3.4).
3. Least-privilege: create a dedicated k3s ServiceAccount + RBAC (deploy to ns `dev` only) and mint the
   kubeconfig from **its** token, not the cluster-admin file.

### C.3.2 Deploy job (rollout + verification)
```yaml
deploy_persistent:
  needs: build_push
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Write kubeconfig
      run: echo "${{ secrets.KUBECONFIG_PERSISTENT }}" | base64 -d > "$RUNNER_TEMP/kc" ; echo "KUBECONFIG=$RUNNER_TEMP/kc" >> $GITHUB_ENV
    - name: Set images to the freshly-pushed SHA tags
      run: |
        for s in user-service lab-service question-service chat-service analytics-service; do
          kubectl -n dev set image deploy/rosettacloud-$s $s=$ECR/rosettacloud-$s:${GITHUB_SHA::8}
        done
    - name: Wait for rollouts (fail = auto-undo)
      run: |
        for s in user-service lab-service question-service chat-service analytics-service; do
          kubectl -n dev rollout status deploy/rosettacloud-$s --timeout=180s \
            || { kubectl -n dev rollout undo deploy/rosettacloud-$s; exit 1; }
        done
    - name: Post-deploy smoke (through the real edge)
      run: SKIP_CHAT=1 BASE_URL=https://api.dev.rosettacloud.app python scripts/e2e/test_e2e.py || \
           { echo "smoke failed — rolling back"; for s in ...; do kubectl -n dev rollout undo deploy/rosettacloud-$s; done; exit 1; }
```
- **Immutable tags:** deploy by **`${GITHUB_SHA::8}`**, not `latest`, so a rollout is reproducible and
  `rollout undo` returns to a known image.
- **Rollout verification** is a hard gate: any service that fails readiness auto-`rollout undo`s and fails
  the pipeline. The manifests already define readiness probes (`/actuator/health/readiness`).
- **Trigger:** `workflow_dispatch` first (manual, safe). Later, on green `main` after the PR gate — but keep
  it **manual for production** until confidence is high (matches the current cautious posture).

### C.3.3 First-apply vs steady-state
- **First apply** (bootstrap): `kubectl apply -f` the ConfigMaps/SAs/Deployments/Services + Istio gateway +
  strangler VS + NetworkPolicy + `ResourceQuota`. This is a one-time (or GitOps-managed) step.
- **Steady-state:** deploys are just `set image` + `rollout status`. Consider **GitOps (Argo CD/Flux)** on the
  node later so the git manifests are the source of truth and drift self-heals — optional, not required for v1.

### C.3.4 Preferred: no inbound 6443 (SSM)
Rather than exposing the API server, install the SSM agent (present on AL2023) and have CI use
`aws ssm start-session`/`send-command` to run `kubectl` **on the node**. This keeps the SG closed except :80,
removes the kubeconfig-over-internet exposure, and reuses the node instance profile. Slightly more setup, much
smaller attack surface — recommended for the security-conscious default.

**C.3 acceptance:** a `workflow_dispatch` deploy updates all 5 Deployments on the persistent node to the
commit SHA, every rollout reaches Ready (or auto-undoes), the through-the-edge smoke passes, and the ephemeral
PR-gate pipelines are untouched and still green.

## C.4 Strangler cutover, cost controls, teardown/rollback

### C.4.1 Strangler cutover on the persistent node
The persistent cluster is the first place the strangler VS actually serves users durably. Follow the RUNBOOK
order, now against a live node:
1. Deploy **FastAPI (`rosettacloud-backend`) + all 5 Java services** side-by-side in ns `dev`.
2. Apply `DevSecOps/K8S/strangler-virtualservice.yaml` — it already routes `api.dev` by prefix to the Java
   services and **defaults everything else to FastAPI**, with `/internal/**` never externally routable and a
   NetworkPolicy locking user-service.
3. Cut over **one prefix at a time** in the RUNBOOK's recommended order: `/public/stats` (read-only, analytics)
   → `/users` (verify DynamoDB item parity) → `/questions` → `/labs` → `/chat` → `/admin/metrics`.
4. **Verify per prefix** against the real edge (`https://api.dev.rosettacloud.app/...`) and watch the A.4/B.3
   metrics + service logs. **Rollback a prefix** = drop its `match` block so it falls through to FastAPI
   (re-apply the previous VS); no data migration (both planes share `rosettacloud-users`).
5. **FastAPI decommission** (RUNBOOK): after each prefix runs ≥7 days clean, remove its `match`; once all are
   migrated, scale `rosettacloud-backend` to 0, observe 48 h, then delete it. **Keep the Python AI plane**
   (AgentCore runtime + `document_indexer`/`agent_tools` Lambdas + LanceDB) — chat-service depends on it
   (Part A).

### C.4.2 Cost controls
- **Right-size:** start t3.small (~$15/mo on-demand; less on a Compute-Savings-Plan/spot); move to t3.medium
  only if Istio+labs need RAM. gp3 30–50 GB ≈ $2.4–4/mo.
- **Spot for dev:** a spot node halves compute cost; pair with an EBS-backed root + `user_data` re-bootstrap +
  Route53/EIP re-association so a spot reclaim self-heals. Accept the interruption risk at dev tier.
- **Single NAT-free egress:** VPC has **no NAT gateway** (saves ~$32/mo/AZ) — the node uses a public IP for
  egress. Keep it that way; don't add NAT for one box.
- **CloudFront PriceClass_100** already set (cheapest edge footprint). **DynamoDB PAY_PER_REQUEST** already
  used. **ECR lifecycle** keeps last 10 (java) / 5 (others) — bounded storage.
- **Bedrock/AgentCore = usage-based:** the biggest variable. The AI-quota gate (50 msgs/wk) + chat rate limit
  (30/hr) + the nightly-only real-model e2e already cap spend. Add a **CloudWatch billing alarm** and,
  optionally, a budget on Bedrock usage.
- **Auto-stop for non-prod:** if this node is dev-only, an EventBridge Scheduler stop/start (nights/weekends)
  can cut compute ~60%. Skip if it must serve 24/7.
- **Target:** steady-state ~**$20–35/mo** infra + variable Bedrock — consistent with the README's
  cost-efficiency claims and far below EKS's ~$73/mo control-plane floor (a further reason the mandate makes
  economic sense).

### C.4.3 Teardown / rollback (of the whole persistent runtime)
- **App rollback:** `kubectl rollout undo` per Deployment (C.3.2) — seconds.
- **Cluster rollback:** the node is cattle. `terraform destroy -target=module.k3s_node` (+ EIP/SG) removes it;
  re-`apply` rebuilds from `user_data` + CI re-deploy. Durable data (DynamoDB/S3/SNS/SQS) is untouched.
- **Full revert to runner-only:** re-point CloudFront/API-GW origin away (or accept 5xx), stop the node. The
  ephemeral `e2e-k3s.yml` path still works for validation. Because nothing about the images/manifests changed,
  reverting is a Terraform/DNS operation, not a code change.
- **State safety:** always `terraform state pull > backup.tfstate` before destroys; never `-target` the VPC or
  data resources.

**Part C acceptance:** persistent node serves `https://api.dev.rosettacloud.app` health for all 5 services via
CloudFront; strangler VS routes at least `/public/stats` and `/users` to Java with FastAPI fallback intact;
pods use the instance profile (no static AWS secret); EBS snapshots scheduled; documented `terraform destroy
-target` teardown verified in a drill; PR-gate pipelines unaffected; **no EKS anywhere in Terraform state**.

---

# X. Cross-Cutting: Risks, Sequencing, Effort, Acceptance, References

## X.1 Risk register
| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R-A1 | Old AgentCore ARN (`...yebWcC9Yqy`) is stale/deleted; ConfigMap points at a dead runtime | High | Chat 5xx on `agentcore` mode | A.1.1 pre-check; treat `agentcore status` ARN as deploy output; A.2.4 empty-body guard; toggle to `bedrock-direct` (A.4.1) |
| R-A2 | Memory ID mismatch (`_v2-vvC3mbAmra` vs `-evO1o3F0jN`) | High | Cross-session recall silently absent | A.1.3 reconcile to one ID; memory is optional (graceful degrade) |
| R-A3 | AgentCore e2e inflates Bedrock cost or flakes | Med | CI spend / red builds | A.3.3 separate nightly/dispatch job, few invocations, PR stays `SKIP_CHAT=1` |
| R-A4 | MCP Gateway `authorizerType=NONE` reachable by URL | Med | Unauthorized tool calls | Don't advertise URL; fast-follow Cognito client-creds authorizer (`agent.py` already supports it) |
| R-A5 | No IRSA ⇒ pod can't get `InvokeAgentRuntime` creds | Med | Chat fails auth | `aws-creds` secret now; instance profile post-C.2.6 (both carry the perm) |
| R-B1 | Spring Cloud 2025.1.x BOM diverges from pinned Boot/AWS BOMs | Med | Build/dep conflicts | B.1.3 spike + `dependency:tree` before wiring clients |
| R-B2 | CB false-trips on normal ~1–2 s Nova latency | Med | Spurious fallback text | Tune `ai-plane` TimeLimiter (~10s) + failure-rate window against real AgentCore (B.4.2 step 4) |
| R-B3 | CB changes fallback *value* (regression) | Low | Behavior drift | Fallbacks == current fail-open values verbatim; asserted in B.4.1 tests |
| R-B4 | resilience4j never ships a Boot 4 starter (#2351) | Med | No annotation ergonomics | Immaterial — SCCB 5.0.x is the path; annotations are optional (B.1.2) |
| R-C1 | Removing `module.eks` destroys a live EKS cluster | **Resolved** | Outage / lost resources | `module.eks` already commented out + `aws eks list-clusters` → `[]` (no live cluster to destroy); keep the C.2.2 state-check + backup discipline for any future re-enable |
| R-C2 | Single node = SPOF (AZ/node loss) | High (eventually) | Full outage until rebuild | Dev-tier SLA accepted; EBS snapshots + IaC rebuild; documented HA path (C.2.7 → 3-server) |
| R-C3 | Single node role coarser than per-service IRSA | Med | Broader blast radius per pod | Least-privilege by resource; document; per-pod scoping later; still better than static keys |
| R-C4 | 6443 exposed to the internet for CI | Med | API-server attack surface | Prefer SSM (C.3.4); else lock SG to GitHub egress + scoped SA token |
| R-C5 | Lab pods exhaust the single node | Med | Node pressure / evictions | ResourceQuota + requests/limits + single-active-lab + TTL; HA/agent-node trigger (C.2.9) |
| R-C6 | Spot reclaim / node replace loses Redis (sessions) | Med | Users re-auth / lose short-term chat context | Redis is a cache by design; durable state in DynamoDB/S3; document |
| R-X1 | Doing all three at once obscures blame on failure | Med | Hard debugging | Strict sequencing (X.2); land + verify each before the next |

## X.2 Sequencing & dependencies
```
C.2 (persistent node + instance profile)  ─┐  provides durable substrate + creds
                                            ├─> A.1→A.2 (deploy runtime + wire chat, instance-profile creds)
                                            │        └─> A.3 (AgentCore e2e)  ─┐
                                            │                                  ├─> A.4 (toggle + observability)
C.3 (CI/CD to persistent) ──────────────────┘                                 │
                                                                              v
B.1→B.2 (track #2351 + interim: fix setActiveLab, @ConcurrencyLimit)  ─> B.3 (SCCB 5.0.x on user-svc clients)
                                                                       └─> B.3 chat→AI-plane breaker  [AFTER A.2 live]
C.4 (strangler cutover + cost + teardown)  [AFTER C.2/C.3 stable, services deployed]
```
- **Recommended order:** (1) **C.2** stand up the durable node + instance profile; (2) **C.3** wire deploys;
  (3) **A.1→A.4** restore + prove + observe the AgentCore path on the durable node; (4) **B.1→B.3** interim
  fixes then breakers (chat→AI-plane breaker last, tuned against the now-live runtime); (5) **C.4** cut over
  and, later, decommission FastAPI.
- **Parallelizable:** B.2 interim fixes (esp. `setActiveLab`) and A.1 runtime pre-checks can proceed
  immediately, independent of C.
- **Hard gates:** never wire the chat→AI-plane breaker (B.3) before A.2 is live; never remove `module.eks`
  (C.2.2) without the state check + backup.

## X.3 Effort estimates (engineer-days; ranges assume familiarity with the repo)
| Work | Est. | Notes |
|------|------|-------|
| A.1 (re)deploy runtime + IAM/Memory/Gateway reconcile | 1.5–3 | Mostly ops + verification; more if full rebuild |
| A.2 wire chat + empty-body guard + creds | 0.5–1 | ConfigMap ARN + small Java guard + unit test |
| A.3 AgentCore e2e (probe mode + overlay + job) | 1–2 | Reuses e2e infra + `rosettacloud-e2e-tester` role |
| A.4 toggle runbook + Micrometer meters + info | 0.5–1 | Additive, low risk |
| B.1/B.2 track + interim (fix setActiveLab, optional @ConcurrencyLimit) | 0.5–1 | Small, ship immediately |
| B.3 SCCB 5.0.x wiring (shared-lib config + 4 call sites) | 2–3 | Spike + per-client + fallbacks |
| B.4 state-machine tests + staged rollout | 1.5–2.5 | 7 transition tests + WireMock ITs |
| C.2 Terraform-without-EKS + node bootstrap + instance profile + Istio/TLS | 3–5 | Highest; includes EKS removal + edge wiring |
| C.3 CI/CD to persistent (SSM or kubeconfig) + rollout verify | 1.5–3 | SSM path adds a little |
| C.4 strangler cutover drill + cost alarms + teardown drill | 1–2 | Per-prefix verification is the bulk |
| **Total** | **~14–24 dd** | Sequenced over ~3–5 calendar weeks with verification soak between tracks |

## X.4 Consolidated acceptance criteria (Definition of Done)
**Part A:** `agentcore status = READY`; live ARN/Memory/Gateway recorded in RUNBOOK; `POST /chat`
(`invoker=agentcore`) returns non-empty `response` + valid `agent` on the durable node; empty/garbled body
never 500s (unit-tested); nightly/dispatch AgentCore e2e green while PR + bedrock-direct paths unchanged;
`/actuator/info` shows active invoker; `chat.invoke.*` metrics present; documented `kubectl set env` failover
drilled.
**Part B:** `spring-cloud-starter-circuitbreaker-resilience4j:5.0.x` builds on Boot 4; 7 state-machine tests
(closed↔open↔half-open incl. timelimiter + retry-compose) pass under `./mvnw verify`; `setActiveLab` no longer
propagates; CB/bulkhead/timelimiter meters at `/actuator/prometheus`; e2e quota-403 + lab-launch unchanged;
`ai-plane` breaker opens on forced AgentCore outage with `/chat` still 200 + fallback; config-disable restores
prior path.
**Part C:** `terraform apply` yields node + EIP + SG + instance profile with **no EKS in state**; node
`Ready`; Istio :80 up; CloudFront→node health for all 5 services; pods use instance profile (works with **no
`aws-creds` secret**); persistent deploy pipeline updates by SHA with auto-`rollout undo` on failure + edge
smoke; ephemeral PR-gate pipelines untouched; strangler routes ≥`/public/stats`+`/users` to Java with FastAPI
fallback; EBS snapshots scheduled; teardown drill (`terraform destroy -target`) verified.
**Cross-cutting:** sequencing gates honored; risk mitigations in place; RUNBOOK updated (§X.5); no regression
to the currently-green build/deploy/e2e.

## X.5 Documentation deliverables (update alongside code)
- `Backend-Java/docs/RUNBOOK.md`: live AgentCore ARN/Memory/Gateway; invoker failover procedure; persistent
  node ops (upgrade/backup/restore); CB tuning + disable switch; strangler cutover/rollback per prefix.
- ADRs: "Circuit breakers via Spring Cloud CircuitBreaker 5.0.x (not waiting on r4j#2351)"; "Persistent
  single-node k3s over EKS (owner mandate + cost)"; "Instance profile in lieu of IRSA."
- This plan file is the authoritative spec until those land.

## X.6 References (verified 2026-07-02)
- resilience4j#2351 "Spring Boot 4 Compatibility" (closed, `question`, → PR #2384): `github.com/resilience4j/resilience4j/issues/2351`
- Spring Framework 7 resilience (`@Retryable`/`@ConcurrencyLimit`/`RetryTemplate`, no CB): `docs.spring.io/spring-framework/reference/core/resilience.html`
- Spring Cloud 2025.1.0 "Oakwood" release (CB 5.0.x, r4j-core 2.3.0, framework-retry, spring-retry maintenance-only): `spring.io/blog/2025/11/25/spring-cloud-2025-1-0-aka-oakwood-has-been-released`
- Framework-Retry CB config/semantics (`FrameworkRetryCircuitBreakerFactory`, openTimeout 20s/resetTimeout 5s, no reactive): `docs.spring.io/spring-cloud-circuitbreaker/reference/spring-cloud-circuitbreaker-framework-retry.html`
- Spring Cloud CircuitBreaker Resilience4j backend (Bulkhead, metrics, properties): `docs.spring.io/spring-cloud-circuitbreaker/reference/`
- Internal source of truth: `Backend/agents/{agent.py,prompts.py,tools.py,setup_gateway.py,.bedrock_agentcore.yaml}`, `Backend/serverless/Lambda/agent_tools/handler.py`, `Backend/serverless/flow.MD`; `Backend-Java/chat-service/**` (`AgentCoreInvoker`, `BedrockDirectInvoker`, `AgentInvoker`, `ChatService`, `PromptLibrary`, `application.yml`, `k8s/chat-service.yaml`); `Backend-Java/shared-lib/.../resilience/HttpRetry.java` + `client/{UserAiQuotaClient,UserServiceClient,UserProgressClient}`; `Backend-Java/docs/{RUNBOOK.md,MIGRATION-PLAN.md,work-packages/*}`; `DevSecOps/Terraform/environments/shared/{main.tf,backend-java.tf,variables.tf,terraform.tfvars}` + `modules/{ec2,sg,iam}`; `DevSecOps/K8S/strangler-virtualservice.yaml`; `.github/workflows/{backend-java-deploy.yml,e2e-k3s.yml,agent-deploy.yml}`; `scripts/e2e/test_e2e.py`.

*End of plan.*
