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
