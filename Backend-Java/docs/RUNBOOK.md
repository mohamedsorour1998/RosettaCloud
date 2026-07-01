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
- **Event backbone**: SNS `rosettacloud-events` → SQS `rosettacloud-analytics` (RawMessageDelivery=true, queue
  policy allows the topic). Validated: publish → raw JSON body received → `SqsEventConsumer` regex parses `type`.
- **e2e OIDC role**: `rosettacloud-e2e-tester` (Bedrock Nova Lite 2 + AgentCore invoke).
Reverse with: `aws ecr delete-repository --repository-name … --force`, `aws sns delete-topic`, `aws sqs delete-queue`.

## Load test (k6)
`Backend-Java/loadtest/backend-load.js` runs in the e2e workflow against the k3s stack (informational stage,
CI-tuned VUs/thresholds via env). Against a real staged target: `BASE_URL=… ANALYTICS_URL=… TOKEN=<jwt> k6 run …`.

## Blocked on a live cluster (needs EKS — decommissioned for cost)
- **Per-service IRSA roles** (`backend-java.tf`): trust policy references the EKS OIDC provider, which does not
  exist. Create the EKS cluster, then `terraform apply` reconciles ECR/SNS/SQS (import first) and adds IRSA.
- **`backend-java-deploy.yml` EKS rollout**: `aws eks update-kubeconfig --name rosettacloud-eks` + `kubectl rollout`
  requires the cluster. The TEST-GATE + ECR build/push halves are ready; only the rollout step needs EKS.

## Remaining enhancements (non-blocking)
- WP-60: `@HttpExchange` + `@ImportHttpServices` declarative-client refactor is deferred — the RestClient
  clients are functional and now carry connect/read timeouts, transient-retry, and fail-open fallbacks
  (converting to bare `@HttpExchange` proxies would forfeit the fail-open behavior without a wrapper).

## Resilience posture (inter-service calls)
All inter-service clients (chat→user AI-quota, lab→user lab/session, question→user progress) have:
- **Timeouts**: 2s connect / 5s read.
- **Transient retry**: `shared-lib` `HttpRetry.withRetry(attempts, delayMs, op)` retries only `ResourceAccessException`
  (connection-refused / read-timeout — the common case during rolling deploys); HTTP 4xx/5xx propagate immediately.
- **Fail-open fallbacks**: permissive AI-quota default, `0` lab-minutes, best-effort progress/link — a degraded
  user-service never hard-fails the calling request.

Full **circuit breakers** are intentionally NOT added yet: Resilience4j has no Spring Boot 4 release
(resilience4j/resilience4j#2351), and Spring Framework 7 core ships `@Retryable`/`@ConcurrencyLimit` but no
circuit-breaker. Revisit once Resilience4j publishes a Boot 4 starter or Spring Cloud CircuitBreaker GA's on Boot 4.

## Event backbone (implemented)
SNS topic `rosettacloud-events` + SQS `rosettacloud-analytics` (Terraform). Services publish domain events
via shared-lib `DomainEventPublisher` (no-op unless `rosettacloud.events.topic-arn` is set): `user.created`
(user-service), `lab.started`/`lab.terminated` (lab-service), `question.attempted`/`question.correct`
(question-service), `chat.message` (chat-service). analytics-service `SqsEventConsumer` (active when
`rosettacloud.events.queue-url` is set) polls the queue and increments the durable `STATS#global` counters
surfaced by `/public/stats` and `/admin/metrics`. Observability: Prometheus at `/actuator/prometheus`.
