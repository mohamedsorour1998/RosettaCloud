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

## Remaining enhancements (non-blocking)
- WP-60: replace RestClient inter-service calls with Spring Boot 4 `@HttpExchange` + `@ImportHttpServices`;
  wire SNS/SQS event consumers in analytics-service (topic/queue defined in Terraform); add Resilience4j.
- WP-80: extend e2e to lab/question pod-lifecycle on a full cluster (needs Istio CRDs + a lab-stub image);
  current e2e covers user/chat/analytics + real Nova Lite 2. lab/question logic is covered by unit tests.
- Per-service ECR build+deploy workflows (depend on the Terraform ECR repos) — the test-gate CI is in place.
