# RosettaCloud Backend (Spring Boot 4) — Runbook & Status

## Status (verified)
- 6 Maven modules build green: `shared-lib, user-service, lab-service, question-service, chat-service, analytics-service`.
- **72 tests pass** (`./mvnw verify`) — unit + web slices + Testcontainers LocalStack IT.
- **CI** (`.github/workflows/backend-java-ci.yml`): mandatory `mvnw verify` test gate — GREEN.
- **E2E** (`.github/workflows/e2e-k3s.yml`): k3s-in-runner full stack (LocalStack + Redis + mock-OIDC +
  user/chat/analytics) with a **real Bedrock Nova Lite 2** chat reply — GREEN. Probe: `scripts/e2e/test_e2e.py`.

## Build & test
```bash
cd Backend-Java
JAVA_HOME=~/tools/jdk25 ./mvnw verify        # all modules + tests + coverage
JAVA_HOME=~/tools/jdk25 ./mvnw -pl chat-service -am test   # one service
```

## Container images
Each service has a multistage `Dockerfile` (Corretto 25). Build/push to ECR `rosettacloud-<svc>`
(repos + IRSA roles are defined in `DevSecOps/Terraform/environments/shared/backend-java.tf`).

## Deploy (namespace dev)
```bash
kubectl apply -f Backend-Java/<svc>/k8s/<svc>.yaml      # per service (ConfigMap, SA/IRSA, Deployment, Service)
```
Each service exposes actuator health at `/actuator/health` (readiness/liveness probes wired).

## Strangler cutover (FastAPI → Java)
`DevSecOps/K8S/strangler-virtualservice.yaml` routes `api.dev.rosettacloud.app` by path prefix to the
Java services and defaults everything else to the FastAPI backend. Recommended order:
1. `/public/stats` (read-only) → analytics-service. Verify live counters.
2. `/users` + `/users/{id}/...` → user-service. Verify DynamoDB item parity (Java writes native-M maps,
   identical to the Python plane — covered by `UserRepositoryIT`).
3. `/questions` → question-service; `/labs` → lab-service; `/chat` → chat-service.
4. `/admin/metrics` → analytics-service (now enforces DB-backed admin role — non-admins get 403).
`/internal/**` is never routed externally and is L3/L4-restricted by the NetworkPolicy in the same file.

**Rollback:** re-apply the previous VirtualService (or drop the per-prefix `match` so it falls through to
FastAPI). No data migration is involved — both planes share the `rosettacloud-users` table.

## FastAPI decommission
Once each prefix has run on the Java service in production for ≥7 days with no regressions:
1. Remove its `match` block from the strangler VirtualService (already default-routed away).
2. After all prefixes are migrated, scale down `rosettacloud-backend` (FastAPI) to 0, observe 48h, then delete
   the Deployment + `backend-build.yml` workflow.
3. Keep the Python AI/RAG plane (AgentCore runtime + `document_indexer`/`agent_tools` Lambdas + LanceDB) —
   it is invoked by chat-service and is out of scope for the Java migration.

## AgentCore chat path — Part A readiness (verified 2026-07-02, acct 339712964409)

`chat-service` defaults to `CHAT_INVOKER=agentcore` and targets the managed Python AgentCore runtime
(`AgentCoreInvoker` → `bedrock-agentcore:InvokeAgentRuntime`). Pre-flight inventory of that plane:

| Component | State | Evidence |
|-----------|-------|----------|
| Runtime `rosettacloud_education_agent-yebWcC9Yqy` | **READY in control plane but NOT invocable** | `list-agent-runtimes` → `READY`; 2× `agentcore invoke` → `RuntimeClientError: Runtime initialization time exceeded (120s)` |
| Runtime container image | **DELETED** | runtime artifact `containerUri = …/bedrock-agentcore-rosettacloud_education_agent:20260411-233818-959`; `ecr describe-repositories` on that repo → `RepositoryNotFoundException` |
| Execution role `rosettacloud-agentcore-runtime-role` | **EXISTS** | `iam get-role` (last used 2026-05-06) |
| Memory `rosettacloud_education_memory_v2-vvC3mbAmra` | **ACTIVE** | `list-memories` — the ID injected by `agent-deploy.yml` (canonical) |
| Memory `rosettacloud_education_memory-evO1o3F0jN` | **ACTIVE (legacy — reconciled)** | `list-memories` — older ID still present in AWS but **no longer referenced by any doc/code** (README, `flow.MD`, and Frontend all now point to the canonical v2 ID above); safe to delete out-of-band |
| `agent_tools` Lambda | **EXISTS** (idle) | `lambda get-function` (image `rosettacloud-agent_tools-lambda:latest`) |
| MCP Gateway `rosettacloud-education-tools` | **READY** (`authorizerType=NONE`) | `list-gateways` |
| `GATEWAY_URL` GitHub var | **SET** | `…-chuvlytfxx.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp` |
| CodeBuild `…-agent-builder` + source bucket | **EXIST** | `codebuild batch-get-projects`, `s3api head-bucket` |

**Verdict: everything survived decommission EXCEPT the runtime's ECR image.** The runtime reports `READY` but
fails every cold-start (the managed service cannot re-pull the deleted image); last successful run 2026-05-06.
This is **not** a `chat-service` wiring bug — the ConfigMap ARN, `CHAT_INVOKER`, and the
`AGENT_RUNTIME_ARN` → `rosettacloud.chat.agent-runtime-arn` binding are all correct.

### Why redeploy was FLAGGED, not executed
Restoring the runtime requires an **`agentcore launch` → CodeBuild ARM64 image rebuild** — i.e. rebuilding a
deliberately-decommissioned plane. Per the owner mandate (recurring-cost / decommissioned infra is flagged,
not silently provisioned) this is left for an explicit owner go. Cost is low (CodeBuild ≈ a few ¢/build;
AgentCore runtime bills per-invocation, ~$0 idle) but the decision is the owner's. The green chat path does
**not** depend on it: e2e uses `CHAT_INVOKER=bedrock-direct` (real Nova Lite 2, same tutor/grader/planner
prompts) — a true graceful fallback (loses MCP tools + cross-session memory, still answers).

### Exact redeploy sequence (owner runs this to reactivate the AgentCore path)
Prereq that currently BLOCKS both this and `agent-deploy.yml`: the agent ECR repo is gone and
`.bedrock_agentcore.yaml` has `ecr_auto_create: false`, so a launch fails until the repo is recreated:
```bash
# 0) Recreate the agent image repo (one-time) — unblocks agentcore launch / agent-deploy.yml
aws ecr create-repository --repository-name bedrock-agentcore-rosettacloud_education_agent \
  --image-scanning-configuration scanOnPush=true --region us-east-1

# 1) Build + push + deploy (ARM64 via CodeBuild — NO local Docker needed)
cd Backend/agents
agentcore configure -e agent.py -n rosettacloud_education_agent \
  -er arn:aws:iam::339712964409:role/rosettacloud-agentcore-runtime-role -rf requirements.txt -r us-east-1 -ni
agentcore launch --auto-update-on-conflict \
  --env BEDROCK_AGENTCORE_MEMORY_ID=rosettacloud_education_memory_v2-vvC3mbAmra \
  --env GATEWAY_URL="https://rosettacloud-education-tools-chuvlytfxx.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp" \
  --env NOVA_MODEL_ID=us.amazon.nova-2-lite-v1:0
agentcore status                      # wait for READY; capture the (possibly NEW) agent ARN

# 2) Verify against the live runtime
agentcore invoke '{"message":"What is Docker?","type":"chat","session_id":"verify-1234567890abcdef1234567890xyz"}'
# expect {"agent":"tutor|grader|planner","response":"…"}

# 3) If agentcore minted a NEW ARN, update AGENT_RUNTIME_ARN in chat-service/k8s/chat-service.yaml then rollout.
```
Readiness checklist before flipping prod chat to `agentcore`: [ ] runtime READY **and** `agentcore invoke`
returns non-empty; [ ] `AGENT_RUNTIME_ARN` in the ConfigMap == live ARN; [ ] pod holds `InvokeAgentRuntime`
creds (EC2 instance profile on the persistent node, or the `aws-creds` secret on k3s-in-runner); [ ]
`agent-deploy.yml` re-run green (or ECR repo pre-created as above).

### Failover (first-class switch — no code change)
```bash
kubectl set env deploy/rosettacloud-chat-service -n dev CHAT_INVOKER=bedrock-direct   # AgentCore → direct Nova
kubectl rollout status deploy/rosettacloud-chat-service -n dev
kubectl set env deploy/rosettacloud-chat-service -n dev CHAT_INVOKER=agentcore        # fail back
```
Hardening shipped with this note: `AgentCoreInvoker.parseReply` now **fails open** (empty/garbled runtime body
→ friendly HTTP 200 reply, unit-tested in `AgentCoreInvokerTest`) so a runtime hiccup no longer 500s `/chat`
(§A.2.4). A **thrown** SDK error (e.g. the current init-timeout) is still surfaced until the chat→AI-plane
circuit breaker lands (Part B, sequenced after the runtime is live). The chat SA's dormant IRSA annotation was
removed (NO-EKS; creds resolve via instance profile / `aws-creds`).

## Persistent runtime WITHOUT EKS — Part C recommendation + COST FLAG (assessment only)

**Not provisioned.** Part C is design-only here; standing up persistent compute is recurring-cost infra and
requires explicit owner approval (full decision matrix in `AGENTCORE-RESILIENCE4J-RUNTIME-PLAN.md` §C.1).

**Recommendation:** persistent **single-node k3s on one EC2** (t3.small→medium, Amazon Linux 2023, gp3
30–50 GB, Elastic IP, EC2 **instance profile** in lieu of IRSA), Istio ingress on NodePort 80 behind the
existing CloudFront/API-GW origin (`node_public_dns:istio_http_nodeport=80`). Reuses 100% of the current
manifests/Istio/ECR — the same runtime CI already validates on k3s-in-runner — growable to 3-server HA later.
Rejected: EKS (owner mandate + ~$73/mo control-plane floor); ECS/App Runner/Nomad (break Istio VS + the
lab-service Fabric8 in-cluster pod model).

**COST FLAG (recurring, us-east-1, approximate):**
- EC2 t3.small on-demand ≈ **$15/mo** (t3.medium ≈ $30/mo); spot ≈ half.
- gp3 40 GB ≈ **$3–4/mo**; attached Elastic IP = $0.
- No NAT gateway (node egresses via public IP) — preserves the current ~$32/mo/AZ saving.
- **Steady-state ≈ $20–35/mo infra** + usage-based Bedrock/AgentCore (gated by the 50-msg/wk AI quota +
  30/hr chat limit). Far below EKS.

**Resolved caveat (R-C1):** the **EKS module in `main.tf` is now removed** — the `module "eks"` block (and its
dependent `aws_eks_access_*` entries and `local.eks_oidc_*` IRSA references) is commented out under a
`REMOVED: no-EKS-ever mandate` header, so **no EKS cluster is provisioned**. Verified there is no live cluster
(`aws eks list-clusters` → `[]`), so there is nothing to destroy. If a future change ever re-enables an EKS
block, first run `terraform state list | grep eks` and `terraform state pull > backup.tfstate` off-hours before
any `terraform apply`.

## Provisioned AWS resources (real, us-east-1, acct 339712964409)
Created out-of-band to match `backend-java.tf` (EKS-independent; low-cost + reversible):
- **ECR ×5**: `rosettacloud-{user,lab,question,chat,analytics}-service` — scan-on-push, MUTABLE, keep-last-10.
  **All 5 images built + pushed** by `backend-java-deploy.yml` (tags: `latest` + commit SHA).
- **Event backbone**: SNS `rosettacloud-events` → SQS `rosettacloud-analytics` (RawMessageDelivery=true, queue
  policy allows the topic). Validated: publish → raw JSON body received → `SqsEventConsumer` regex parses `type`.
- **IAM roles**: `rosettacloud-e2e-tester` (Bedrock Nova Lite 2 + AgentCore invoke); `rosettacloud-backend-deploy`
  (repo-scoped OIDC, ECR push + `eks:DescribeCluster`).
Reverse with: `aws ecr delete-repository --repository-name … --force`, `aws sns delete-topic`, `aws sqs delete-queue`,
`aws iam delete-role`.

## Deploy pipeline status
`backend-java-deploy.yml` runs green end-to-end, targeting **k3s inside the GitHub public runner** (no EKS):
1. `build_push` (matrix): TEST GATE (`mvnw verify`) → build per-service image → push to ECR (`latest` + SHA).
2. `deploy_k3s`: install k3s in-runner → pull the ECR images + import → apply the stack → **wait for all 5
   rollouts** → smoke probe (`SKIP_CHAT=1`, no Bedrock). Verified: all deployments `successfully rolled out`
   running `rosettacloud-<svc>:e2e` (the ECR builds), smoke `ALL E2E CHECKS PASSED (… ECR images on k3s runner)`.

## Out of scope (by direction): EKS
No EKS, ever. Deploys are validated on k3s-on-runner. The per-service IRSA roles in `backend-java.tf` are a
dormant template only (they reference an EKS OIDC provider that does not exist); in-cluster services receive
AWS credentials via the `aws-creds` secret.

## CI quality gates (all enforced on every push to main)
- **Test gate** — `backend-java-ci.yml` runs `mvnw verify`: **101 tests**, 0 failures (unit + Testcontainers ITs).
- **Coverage gate** — JaCoCo `check` fails the build under **40% line coverage** per module, excluding
  framework glue / DTOs / infra adapters covered by ITs+e2e (repositories, Redis stores, RestClient clients,
  AWS/K8s invokers, Fabric8 provisioner). shared-lib 51% / user-service 62%+ line at last measure.
- **Security scan** — `security.yml`: Trivy gates on any committed secret + fixable CRITICAL dependency CVE;
  Semgrep SAST (informational). ECR repos also scan-on-push.

## Remaining enhancements (non-blocking)
- WP-60: `@HttpExchange` + `@ImportHttpServices` declarative-client refactor is deferred. The RestClient
  clients are functional and carry connect/read timeouts + transient-retry + fail-open fallbacks. Beyond the
  fail-open concern, the inter-service clients are mocked in unit tests, so the declarative wiring could only
  be validated by the (slow, real-Bedrock) e2e — not worth risking a green, resilient, e2e-verified path for
  a stylistic change. Revisit if/when it can be unit-verified cheaply.
- Optional hardening surfaced by Trivy: add pod `securityContext` (runAsNonRoot, drop caps, seccomp) to the
  production manifests.

## Resilience posture (inter-service calls)
All inter-service clients (chat→user AI-quota, lab→user lab/session, question→user progress) have **all three**
of the following on **every** call site (audited across `UserAiQuotaClient`, `UserServiceClient`,
`UserProgressClient` — the only inter-service HTTP clients; no `WebClient`/`RestTemplate` elsewhere):
- **Timeouts**: 2s connect / 5s read (`SimpleClientHttpRequestFactory`).
- **Transient retry**: `shared-lib` `HttpRetry.withRetry(2, 150, op)` retries only `ResourceAccessException`
  (connection-refused / read-timeout — the common case during rolling deploys); HTTP 4xx/5xx propagate immediately.
- **Fail-open fallbacks**: permissive AI-quota default (`messages_remaining=50`), `0` lab-minutes, empty
  active-lab, `0` recorded minutes, best-effort progress/link/unlink — a degraded user-service never
  hard-fails the calling request. `lab→user setActiveLab` was the **one** call that previously propagated;
  it is now fail-open (log + swallow) like its siblings, so a user-service blip during the post-provisioning
  bookkeeping step can no longer fail an otherwise-successful lab launch (covered by `UserServiceClientTest`).

### Circuit breakers — adoption trigger
Full **circuit breakers** are intentionally **NOT** added yet, and no CB dependency is on the classpath:
- **Resilience4j** has **no Spring Boot 4 release** (`resilience4j/resilience4j#2351`) — its annotation-driven
  starter is Boot 3 only.
- **Spring Cloud CircuitBreaker** is **not Boot 4-compatible** on this stack today, so
  `spring-cloud-starter-circuitbreaker-*` is deliberately not added.
- **Spring Framework 7 core** ships `@Retryable`/`@ConcurrencyLimit`/`RetryTemplate` (verified present in the
  resolved SF **7.0.8**) but **no circuit breaker**.

> **Adoption trigger (single, explicit):** adopt real circuit breakers **when Resilience4j publishes a Spring
> Boot 4 release** (i.e. `resilience4j/resilience4j#2351` ships a `resilience4j-spring-boot4` starter). At that
> point, wrap the existing retry+fail-open call sites with `@CircuitBreaker`, keeping each fallback value
> byte-for-byte identical to today's fail-open value (the CB changes *when* we fall back, never *what* to).
> Until then, the timeout + transient-retry + fail-open posture above is the resilience contract.

**`@ConcurrencyLimit` (SF 7 bulkhead-lite) — deferred, not wired.** The plan flags SF 7's native
`@ConcurrencyLimit` as an optional per-pod bulkhead for the chat→AI-plane call (relevant under
`spring.threads.virtual.enabled=true`). It compiles on this stack (SF 7.0.8), but it is intentionally **not
wired** yet: the plan sequences chat→AI-plane resilience to be tuned against a **live** AgentCore runtime
(Part A, not yet live), and adding an AOP concurrency gate to the exact path the real-Nova nightly e2e
exercises would risk the currently-green signal for no present load benefit. Revisit alongside the Part A
runtime bring-up.

## Event backbone (implemented)
SNS topic `rosettacloud-events` + SQS `rosettacloud-analytics` (Terraform). Services publish domain events
via shared-lib `DomainEventPublisher` (no-op unless `rosettacloud.events.topic-arn` is set): `user.created`
(user-service), `lab.started`/`lab.terminated` (lab-service), `question.attempted`/`question.correct`
(question-service), `chat.message` (chat-service). analytics-service `SqsEventConsumer` (active when
`rosettacloud.events.queue-url` is set) polls the queue and increments the durable `STATS#global` counters
surfaced by `/public/stats` and `/admin/metrics`. Observability: Prometheus at `/actuator/prometheus`.
