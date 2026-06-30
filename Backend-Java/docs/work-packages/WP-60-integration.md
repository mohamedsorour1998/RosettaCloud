# WP-60 — Integration (clients, events, resilience, observability, strangler routing)

> Sub-agent brief. Read this + `docs/MIGRATION-PLAN.md` §3.8,§8,§10. Depends on WP-10..WP-50. No assumptions — web-search & cite if unsure.
> Verify: `JAVA_HOME=~/tools/jdk25 ./mvnw -q verify` (whole reactor).

## Objective
Wire the services into a coherent system: declarative inter-service HTTP clients, an async event backbone for
counters/progress, resilience, observability, and the API-Gateway/Istio strangler routing for cutover.

## 1. Inter-service clients (Spring Boot 4 `@ImportHttpServices`)
- Define `@HttpExchange` interfaces in each consumer (`UserServiceClient` used by lab/question/chat/analytics).
- Register with `@ImportHttpServices(group="user-service", types=UserServiceClient.class)` + a `RestClient` whose
  baseUrl = `http://user-service.dev.svc.cluster.local:8081` (K8s DNS; configurable). Propagate the caller JWT
  (Bearer) on internal calls via a `RestClient` request interceptor (or a service-to-service token). Cite the
  Spring Boot 4 HTTP-interface docs in the impl.

## 2. Event backbone (replace in-process counters / decouple progress)
- SNS topic `rosettacloud-events` + SQS queue `rosettacloud-analytics` (subscribed). Terraform additions under
  `DevSecOps/Terraform` (new file) + LocalStack equivalents for tests.
- Publishers: lab-service (`lab.started`,`lab.terminated`), question-service (`question.attempted`,`question.correct`),
  chat-service (`chat.message`). Payload: `{type,userId,ts,attrs}`. Use `SnsClient.publish`.
- Consumer: analytics-service `@SqsListener` (spring-cloud-aws or manual `SqsClient` poller) → increment DynamoDB
  `STATS#global` + per-user metrics. Idempotent.

## 3. Resilience4j
- Circuit breaker + retry + timeout on: every `@HttpExchange` client, lab-service→K8s API, chat-service→AgentCore/Bedrock.
- Config in `application.yml`; sensible defaults (timeout 3s clients / 30s AgentCore; retry 2; CB 50% over 20 calls).

## 4. Observability
- `spring-boot-starter-actuator` + Micrometer + `micrometer-tracing-bridge-otel` + OTLP exporter → CloudWatch/X-Ray
  (endpoint via `OTEL_EXPORTER_OTLP_ENDPOINT`). Common log pattern with `traceId`/`spanId`. `/actuator/prometheus` scrape.

## 5. Strangler routing (cutover)
- Istio: update `api.dev.rosettacloud.app` VirtualService with path-prefix routes →
  `/users`,`/internal/users`→user-service; `/labs`→lab-service; `/questions`→question-service; `/chat`→chat-service;
  `/admin/metrics`,`/public/stats`→analytics-service; default → FastAPI backend (until decommission).
- Provide `DevSecOps/K8S/strangler-virtualservice.yaml` + a documented cutover order (start with read-only `/public/stats`,
  then `/users`, then labs/questions/chat). Rollback = revert the route.

## Tests
- Contract tests (Spring Cloud Contract) for `UserServiceClient` ⇄ user-service.
- Event flow IT: LocalStack SNS+SQS — publish → analytics consumer increments STATS#global.
- Resilience: simulate user-service 5xx → CB opens, fallback path returns degraded but safe response.

## Acceptance
- Whole-reactor `./mvnw verify` GREEN; event flow + contract + resilience tests pass; strangler manifest validated (`kubeconform`).
