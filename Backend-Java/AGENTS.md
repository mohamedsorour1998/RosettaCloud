# AGENTS.md — Backend-Java (Spring Boot 4 platform API)

> Local handoff for AI agents working under `Backend-Java/`.
> For cross-cutting repo context see the root **`../AGENTS.md`**.

## What this is

The **platform REST API** — **Spring Boot 4.1.0 on Java 25**, a Maven multi-module build
(`mvnw` wrapper, parent `app.rosettacloud:rosettacloud-backend-parent`). It **replaced the
removed FastAPI monolith** (`Backend/app/`); every users/labs/questions/chat/analytics
endpoint now lives here. One service per domain:

| Module | Port | Role |
|---|---|---|
| `user-service` | 8081 | users, quota, sessions, progress (DynamoDB) |
| `lab-service` | 8082 | per-lab Pod/Service/Istio VirtualService lifecycle + janitor (Fabric8) |
| `question-service` | 8083 | question content + in-pod exec grading |
| `chat-service` | 8084 | AgentCore/Bedrock Nova Lite chat proxy, Redis sessions, rate limit, AI-quota |
| `analytics-service` | 8085 | usage/progress analytics |
| `shared-lib` | — | auto-config lib: `resilience/` (`HttpRetry`), `events`, `security`, `aws`, `error`, `util` |

## Build / test / run

- All modules: `./mvnw -B -ntp verify`  •  one + deps: `./mvnw -pl <service> -am verify`
- Run a service: `./mvnw -pl user-service spring-boot:run`
- Needs **JDK 25 (Corretto)**. Tests include web slices + **Testcontainers** (localstack). JaCoCo
  gate: BUNDLE ≥ 0.40 line coverage (infra/DTO/client packages excluded — see parent `pom.xml`).

## Resilience (Part B §B.3 — Spring Cloud CircuitBreaker / Resilience4j)

Inter-service calls are wrapped with `CircuitBreakerFactory.create(id).run(call, fallback)`.
`HttpRetry.withRetry(...)` stays **inside** the breaker (retry ∘ CB compose). Fallbacks return the
**same fail-open value** the old try/catch returned — the breaker changes *when* we give up, not *what*.

- **lab-service → user-service** (`lab/client/UserServiceClient`): every method wrapped; reads use id
  **`user-quota`**, session/lifecycle mutations use **`user-session`**. TimeLimiter `6s` (> 5s read timeout).
- **chat-service → AI-plane** (`chat/service/ChatService` around `AgentInvoker`): id **`ai-plane`**;
  fallback = `AI_UNAVAILABLE` reply ("The tutor is temporarily unavailable, please retry.") which
  is treated by identity so a degraded turn does **not** record history, charge AI quota, or emit an
  event. TimeLimiter **`60s`** — deliberately generous so a slow-but-successful Nova reply isn't cut off.
- Tuning is via `resilience4j.*` in each service's `application.yml` (the `configs.default` group),
  **not** a Customizer bean. `resilience4j-bulkhead` is added explicitly (starter marks it `<optional>`).

## CRITICAL GOTCHAS (break the build/pods if changed)

1. **`spring.cloud.compatibility-verifier.enabled: false`** is set in `application.yml` of **every
   service with the CircuitBreaker starter** (currently lab-service + chat-service). Spring Cloud
   **2025.1.0** validates only Boot **4.0.x**; we run **4.1.0**, so the verifier aborts startup →
   **CrashLoopBackOff**. The Resilience4j adapter works fine on 4.1.0. Keep the flag; add it to any
   new service that pulls the CB starter.
2. **`org.bouncycastle:bcprov-jdk18on` is pinned to `1.81.1`** in the **parent `pom.xml`
   `dependencyManagement`** (transitive from `spring-cloud-context`; 1.81 = CRITICAL CVE-2025-14813).
   It clears the Trivy CRITICAL gate — **do not remove or downgrade**.

Key versions (parent `pom.xml`): Spring Boot `4.1.0`, Java `25`, Spring Cloud `2025.1.0`,
Resilience4j `2.3.0`, AWS SDK v2 `2.46.18`, Fabric8 `7.8.0`, Testcontainers `1.21.4`.

## CI / deploy (`.github/workflows/`)

- **`backend-java-ci.yml`** — push/PR on `Backend-Java/**`: JDK 25 `./mvnw -B -ntp verify` (unit +
  Testcontainers gate). The mandatory test gate.
- **`backend-java-deploy.yml`** — manual dispatch: per-service **TEST GATE → build 5 images → ECR →
  deploy to in-runner k3s**, asserts **hardened securityContext** on all 5 pods, runs a **PSA
  `restricted`** enforcement probe, then a smoke test with **`SKIP_CHAT=1` (no Bedrock)**.
- **`security.yml`** — Trivy (secret + fixable-CRITICAL + KSV misconfig gates) also runs on `Backend-Java/**`.
- **`e2e-k3s.yml`** — nightly/dispatch: full stack on k3s with **real Bedrock Nova** probe.

## NO-EKS deploy model

There is **no live EKS**. The deploy target is a **k3s cluster inside the GitHub runner**.
`e2e/k8s/e2e-stack.yaml` is the deployed manifest set. Image pattern: pull from ECR →
`docker tag … <name>:e2e` → `k3s ctr -n k8s.io images import` → manifests reference `<name>:e2e`
with `imagePullPolicy: IfNotPresent`. Any `kubectl … -n dev` against a live cluster is illustrative.

## Pointers & conventions

- Resilience design: **`AGENTCORE-RESILIENCE4J-RUNTIME-PLAN.md`**. Ops: `docs/RUNBOOK.md`;
  migration history: `docs/MIGRATION-PLAN.md` + `docs/work-packages/WP-*.md`.
- **Keep every pipeline green** (reproduce gates locally before pushing). **Never `git add .`** —
  stage explicit paths (many untracked scratch files live in the repo).
