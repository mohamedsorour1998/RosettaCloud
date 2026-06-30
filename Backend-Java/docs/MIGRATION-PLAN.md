# RosettaCloud Backend → Spring Boot 4 Microservices — MASTER MIGRATION PLAN

> Status: APPROVED (all six decisions = recommended defaults). Authoritative plan of record.
> Audience: orchestrator + execution sub-agents. Every work package (WP) below is written to be
> executed by an independent sub-agent with no prior context beyond this document and the named source files.
> Rule: **No assumptions.** If a sub-agent is unsure of an API/version/signature, it MUST web-search and
> cite before coding. All version/API facts in §3 were web-verified on 2026-06-30 (citations inline).

---

## 1. Purpose & Scope

Migrate the RosettaCloud **FastAPI** backend to an **enterprise-grade Spring Boot 4.1.0 / Java 25**
microservice system, using the **Strangler Fig** pattern behind the existing AWS API Gateway so the
Python backend and the new Java services run in parallel and traffic is cut over endpoint-by-endpoint.

### 1.1 In scope (migrate to Java/Spring Boot)
The HTTP API / business plane currently in `Backend/app/`:
- `app/main.py` (routes, rate limiting, metrics, chat proxy, lifespan)
- `app/services/*.py` + `app/backends/*.py` (users, labs, questions)
- `app/dependencies/auth.py` (JWT)

### 1.2 Stays Python (polyglot plane — invoked from Java, NOT rewritten)
Verified constraint (§3.6): no Java equivalents exist for these frameworks.
- `Backend/agents/**` — AgentCore Runtime (Strands Agents + Nova). Invoked by `chat-service`
  via AWS SDK for Java `BedrockAgentCoreClient.invokeAgentRuntime` (IAM auth — works, §3.5).
- `Backend/serverless/Lambda/document_indexer/**` — LanceDB indexing (LanceDB has no S3-embedded Java SDK, §3.6).
- `Backend/serverless/Lambda/agent_tools/**` — LanceDB/DynamoDB/S3 tools behind the MCP Gateway.

### 1.3 Explicitly NOT a goal
- Rewriting the AI agents in Spring AI (possible later; out of scope now).
- Swapping the vector store off LanceDB.
- Changing the public API contract (frontend must keep working unchanged during cutover).

---

## 2. Confirmed Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | AI/RAG plane | Stays Python; invoked from Java |
| 2 | Service granularity | 5 services: user, lab, question, chat, analytics |
| 3 | Repo layout | Maven multi-module **monorepo** at `Backend-Java/` |
| 4 | Data | Keep shared `rosettacloud-users` DynamoDB table (bounded contexts, not table-per-service) |
| 5 | Edge | Keep AWS API Gateway as the only gateway (no Spring Cloud Gateway) |
| 6 | Stack | Spring Boot 4.1.0 / Java 25 / Maven (matches `demo/`) |

---

## 3. Verified Technology Baseline (web-verified 2026-06-30)

### 3.1 Platform
- **Spring Boot 4.1.0**, **Spring Framework 7**, **Java 25** (Corretto 25.0.3 LTS installed at `~/tools/jdk25`).
  Spring Boot 4 requires Java 17+, first-class Java 25 support. (spring.io blog 2025-11-20; demo `pom.xml`)
- **Maven** via wrapper (`mvnw`, Maven 3.9.16) — already copied into `Backend-Java/`.

### 3.2 Dependency versions (pinned)
- AWS SDK for Java v2 **BOM 2.46.18** (repo1 maven-metadata, 2026-06-30) — managed in parent `pom.xml`.
- Fabric8 **kubernetes-client 7.8.0** (lab-service only).
- JaCoCo **0.8.13** (coverage gate).
- Testcontainers, JUnit 5, Mockito, spring-security-test — versions managed by Spring Boot BOM.

### 3.3 Security (Spring Security 7 / resource server)
- OAuth2 Resource Server validating Cognito JWT via **`spring.security.oauth2.resourceserver.jwt.issuer-uri`**
  (JWKS auto-discovered). Custom `JwtAuthenticationConverter` (principal = `custom:user_id` ?: `sub`;
  authorities from `cognito:groups`/`custom:role`). Custom `OAuth2TokenValidator<Jwt>` for **audience**
  (= Cognito client id) + **`token_use`=id**. This REPLACES the FastAPI `verify_signature=False` shortcut
  with real signature verification (defense in depth behind API GW). (docs.spring.io resource-server/jwt)

### 3.4 DynamoDB (arbitrary nested data — the key modelling decision)
The `progress` (nested module→lesson→question→bool) and `metadata` (arbitrary user settings) fields are
schemaless. The Python plane and (during strangler parallel-run) FastAPI read/write the SAME table, so the
Java side MUST preserve the **native DynamoDB Map (`M`) wire format** — NOT a JSON string.
- Known scalar/typed fields → `@DynamoDbBean UserItem` (BeanTableSchema).
- `progress` → nested `Map<String, Map<String, Map<String, Boolean>>>` (natively supported by Enhanced Client).
- `metadata` → custom `AttributeConverter<Map<String,Object>>` mapping recursively to DynamoDB `M`
  (preserves native types; keeps Python interop). Alternative if a sub-agent hits converter limits:
  model the whole item with **`DocumentTableSchema` + `EnhancedDocument`** (official schemaless mechanism).
  (docs.aws.amazon.com ddb-en-client-doc-api / adv-features — verified DocumentTableSchema/EnhancedDocument exist)
- Table: `rosettacloud-users`, PK `user_id` (S), GSI `email-index` (HASH `email`). `STATS#global` PK for counters.

### 3.5 Bedrock AgentCore invoke (chat-service)
- Artifact `software.amazon.awssdk:bedrockagentcore` (in AWS SDK BOM). Class `BedrockAgentCoreClient`,
  request model `InvokeAgentRuntimeRequest` (fields incl. `agentRuntimeArn`, `runtimeSessionId`, `payload`, `qualifier`).
  IAM auth path is valid for us (the OAuth-only caveat does NOT apply; we use the IRSA role's
  `bedrock-agentcore:InvokeAgentRuntime`). (docs.aws.amazon.com InvokeAgentRuntimeCommandRequest, Java API)

### 3.6 Hard constraints (why the AI/RAG plane stays Python)
- **Strands Agents**: Python (TypeScript preview Dec 2025); no Java. AgentCore CLI generates Python. (aws.amazon.com)
- **LanceDB**: official SDKs Python/TypeScript/Rust; the Java SDK only targets LanceDB Cloud/Enterprise REST,
  NOT the S3-embedded mode used here (`lancedb.connect("s3://...")`). (docs.lancedb.com api-reference)

### 3.7 Kubernetes / Istio (lab-service)
- Fabric8 `KubernetesClient` for Pod/Service. Istio `VirtualService` (CRD) via **`GenericKubernetesResource`**
  + `ResourceDefinitionContext` (group `networking.istio.io`, version `v1`, plural `virtualservices`).
  Mirrors the Python `CustomObjectsApi`. (developers.redhat.com fabric8 dynamic client)

### 3.8 Inter-service calls (Spring Boot 4)
- Declarative HTTP interfaces with `@HttpExchange`/`@GetExchange` + **`@ImportHttpServices`** auto-registration
  (no manual `HttpServiceProxyFactory`). (danvega.dev / dimitri.codes — Spring Boot 4 feature, verified)

### 3.9 Testing
- Unit: JUnit 5 + Mockito. Web slice: `@WebMvcTest` + `spring-security-test` (`jwt()` post-processor + mock `JwtDecoder`).
- Integration: Testcontainers **LocalStack** (`Service.DYNAMODB`/`S3`/`SNS`/`SQS`) wired via `@DynamicPropertySource`
  → `endpointOverride` (DynamoDB is NOT auto-`@ServiceConnection`). lab-service: **k3s** Testcontainer. chat-service: **WireMock** + Testcontainers **Redis**.
- Coverage gate: JaCoCo, target **≥80%** line coverage on `service`/`domain` packages.

### 3.10 Verified runtime capabilities & e2e identity (this environment, 2026-06-30)
- JDK 25 (Corretto 25.0.3 LTS) at `~/tools/jdk25`; Maven wrapper (3.9.16) builds with it. ✓
- AWS CLI works on account **339712964409**; `aws bedrock-runtime converse --model-id us.amazon.nova-2-lite-v1:0`
  returns live output → e2e uses the **real Nova Lite 2 model**, not a mock. ✓
- IAM **`rosettacloud-e2e-tester`** role created (least-privilege: `bedrock:InvokeModel*`/`Converse*` on Nova Lite 2 +
  `bedrock-agentcore:InvokeAgentRuntime`), **GitHub-OIDC-assumable** by `repo:mohamedsorour1998/RosettaCloud:*` —
  **no static access keys**. ARN stored in GitHub as variable+secret **`E2E_AWS_ROLE_ARN`**. To be codified in Terraform (WP-70). ✓
- `gh` CLI authenticated as `mohamedsorour1998`; repo `github.com/mohamedsorour1998/RosettaCloud`.

---

## 4. Target Architecture

```
Internet
  │  HTTPS
CloudFront ──> ALB (EKS Auto Mode) ──> Istio ingress (ns: dev)
  │                                        │
  ├─ dev.rosettacloud.app ───────────────> frontend pod (Angular/nginx)
  ├─ api.dev.rosettacloud.app ─> AWS API Gateway (Cognito JWT @ edge)
  │        │ HTTP_PROXY (Host overwrite)
  │        └──> Istio ──> [strangler router] ──> FastAPI (old)  ── cut over per route ──>  Java services (new)
  └─ *.labs.dev.rosettacloud.app ────────> dynamic per-lab VirtualService ──> lab pod (code-server)

Java services (ns: dev), each: Deployment(1+) + ClusterIP Service + ConfigMap + IRSA ServiceAccount
  user-service      :8081   DynamoDB users/progress/quotas, Cognito backfill
  lab-service       :8082   Fabric8 Pod/Service/Istio VS lifecycle + janitor
  question-service  :8083   S3 shell scripts + in-pod exec (setup/check)
  chat-service      :8084   AgentCore invoke + Redis session/rate-limit/AI-quota
  analytics-service :8085   /public/stats, /admin/metrics (+admin-role fix), event counters

Polyglot plane (unchanged, Python):
  AgentCore Runtime (Strands/Nova)  ← chat-service invokes via BedrockAgentCoreClient
  document_indexer Lambda, agent_tools Lambda (LanceDB)  ← invoked by S3 events / MCP Gateway
```

### 4.1 Service responsibilities & source replaced
| Service | Replaces | Owns |
|---------|----------|------|
| user-service | `users_service.py`, `users_backends.py`, user/progress routes in `main.py` | users, progress, lab & AI quotas, Cognito backfill |
| lab-service | `labs_service.py`, `labs_backends.py`, lab routes | Pod/Service/Istio VS lifecycle, janitor, TTL/quota gate |
| question-service | `questions_service.py`, `questions_backends.py`, question routes | S3 shell-script questions, in-pod setup/check |
| chat-service | `/chat` + `auth` in `main.py` | AgentCore proxy, session history, rate limit, AI-quota gate, image validation |
| analytics-service | `/admin/metrics`, `/public/stats`, in-process counters in `main.py` | metrics aggregation, event-driven counters |

---

## 5. Repository & Module Layout

```
Backend-Java/
  pom.xml                      # parent (DONE) — BOMs, java 25, jacoco
  mvnw, mvnw.cmd, .mvn/        # wrapper (DONE)
  docs/
    MIGRATION-PLAN.md          # THIS FILE
    work-packages/WP-*.md      # one self-contained sub-agent spec per WP
    ADR/                       # architecture decision records
  shared-lib/                  # platform starter (pom DONE)
    src/main/java/app/rosettacloud/shared/{error,security,aws,util,config}
    src/main/resources/META-INF/spring/...AutoConfiguration.imports
  user-service/                # Phase 1 vertical slice (reference implementation)
  question-service/            # Phase 2
  lab-service/                 # Phase 2
  chat-service/                # Phase 3
  analytics-service/           # Phase 3
```

- Base package: **`app.rosettacloud`** (group id `app.rosettacloud`); per service `app.rosettacloud.<svc>`.
- Each service module mirrors the same internal layout (§6.1).

---

## 6. Global Engineering Conventions (apply to EVERY service)

### 6.1 Package layout per service
```
app.rosettacloud.<svc>
  <Svc>ServiceApplication.java        # @SpringBootApplication
  web/         controllers (@RestController) + dto/ (Java records, jakarta.validation)
  service/     business logic (@Service), transactional units
  domain/      domain types, value objects, enums
  persistence/ DynamoDB items (@DynamoDbBean) + repositories
  client/      @HttpExchange inter-service clients (if any)
  config/      @ConfigurationProperties, beans
```

### 6.2 Error model (from shared-lib)
- Exceptions: `ApiException(HttpStatus,detail,code?)` + `ResourceNotFoundException`(404),
  `BadRequestException`(400), `ConflictException`(409), `QuotaExceededException`(403, code+payload),
  `TooManyRequestsException`(429). `GlobalExceptionHandler` (`@RestControllerAdvice`) → **RFC 7807 `ProblemDetail`**.
- Preserve existing error semantics (e.g., quota 403 body `{code:"AI_QUOTA_EXHAUSTED", quota:{...}}`).

### 6.3 Security (from shared-lib auto-config)
- All routes authenticated by default. Public allow-list (configurable, default): `POST /users`,
  `GET /health-check`, `GET /actuator/health`, `GET /public/**`. (CORS preflight handled by API GW + permitAll OPTIONS.)
- `CurrentUser.resolvedUserId()` reads principal from `JwtAuthenticationToken`.
- The path param `{user_id}` is IGNORED for identity (as in FastAPI); identity = resolved JWT user id.

### 6.4 Config & profiles
- `application.yml` per service; env-var overrides match existing K8s ConfigMap keys
  (`AWS_REGION`, `COGNITO_ISSUER_URL`, `USERS_TABLE_NAME`, `S3_BUCKET_NAME`, `LAB_*`, `AGENT_RUNTIME_ARN`, `REDIS_*`).
- Profiles: `default` (prod/in-cluster, IRSA creds), `local` (AWS profile, localhost), `test` (LocalStack/mocks).

### 6.5 Observability
- Actuator (`/actuator/health`,`/info`,`/prometheus`), Micrometer + OpenTelemetry (OTLP → CloudWatch/X-Ray),
  structured JSON logging, `traceId` propagation. Virtual threads enabled (`spring.threads.virtual.enabled=true`).

### 6.6 Build, container, deploy
- Build: `./mvnw -q verify` (compiles + tests + jacoco). Container: **Spring Boot buildpacks** (`spring-boot:build-image`)
  or Dockerfile (multistage, Corretto 25 base). Image → ECR `rosettacloud-<svc>`.
- K8s: per service `k8s/{deployment,service,configmap,serviceaccount}.yaml` in ns `dev`, IRSA via SA annotation.

---

## 7. Source → Target Mapping (endpoint level)

| FastAPI (Backend/app/main.py) | Java target | Notes |
|---|---|---|
| `POST /users` | user-service `UserController.create` | public (no JWT); Cognito `AdminUpdateUserAttributes` backfill |
| `GET/PUT/DELETE /users/{id}` | user-service | identity from JWT |
| `GET /users/{id}/labs` | user-service | from `labs[]` |
| `GET/POST /users/{id}/progress[...]` | user-service | nested progress map |
| `GET /users/{id}/lab-quota` | user-service `QuotaService` | weekly 120 min, in-flight included |
| `GET /users/{id}/ai-quota` | user-service | weekly 50 msgs |
| `POST /labs` | lab-service | quota gate (calls user-service), launch Pod+Svc+VS |
| `GET /labs/{id}` | lab-service | status + phantom recovery → user-service close session |
| `DELETE /labs/{id}` | lab-service | stop + `closeLabSession` |
| `GET /questions/{m}/{l}` | question-service | S3 fetch + parse + progress merge |
| `POST /questions/{m}/{l}/{n}/setup|check` | question-service | in-pod exec; check→progress update + grade event |
| `POST /chat` | chat-service | AgentCore invoke, session, rate limit, AI quota |
| `GET /admin/metrics` | analytics-service | **add admin-role @PreAuthorize (DB-backed)** |
| `GET /public/stats` | analytics-service | public |
| `GET /health-check` | every service (actuator) | public |

Quota math (port EXACTLY from `users_backends.py`): week start = Monday 00:00 UTC epoch; `lab_week_minutes`
reset when `lab_week_start < weekStart`; `get_lab_quota` adds in-flight minutes from `lab_started_at`;
`close_lab_session` is a single atomic update (record duration + clear `active_lab`/`lab_started_at`).
`WeekWindow` util in shared-lib encapsulates this; unit-tested against Python behaviour.

---

## 8. Inter-service Contracts & Events
- Sync: `@HttpExchange` clients (e.g., lab-service → user-service `GET /internal/users/{id}/lab-quota`,
  `POST /internal/users/{id}/close-lab-session`). Internal endpoints under `/internal/**` (cluster-only).
- Async events (Phase 4): progress-completed, lab-started/terminated, chat-message → **SNS topic → SQS** consumed
  by analytics-service to maintain counters (replaces in-process dicts). DynamoDB `STATS#global` remains the durable store.
- Resilience4j (circuit breaker + retry + timeout) on all cross-service and K8s/AgentCore calls.

---

## 9. Testing Strategy (per service Definition of Done)
1. **Unit** — service/domain logic, esp. quota/week-reset math (golden cases mirrored from Python).
2. **Web slice** — `@WebMvcTest` + security (authorized/unauthorized/forbidden, validation 400, RFC7807 shape).
3. **Integration** — `@SpringBootTest` + Testcontainers (LocalStack DynamoDB/S3/SNS; k3s for lab; Redis+WireMock for chat).
4. **Contract** — Spring Cloud Contract at internal boundaries (Phase 4).
5. Build green via `./mvnw verify`; JaCoCo ≥80% on service/domain.
6. **Frontend** — `ng lint` + `ng test` (Karma, ChromeHeadless) gate in the frontend pipeline.
7. **Full-stack E2E (WP-80)** — k3s installed in a PUBLIC GitHub runner deploys the ENTIRE platform
   (LocalStack data plane, mock-OIDC, all 5 Java services, frontend, lab-stub) and runs a backend probe
   (`httpx`) + frontend Playwright suite, exercising the **real Nova Lite 2** model via the OIDC role. Manual + nightly.
8. **Tests in EVERY pipeline (mandatory)** — no build/push/deploy workflow may skip the test stage; the test
   stage must fail the pipeline on test failure or coverage shortfall. (The legacy Python backend shipped without
   tests — this is a hard requirement of the migration.)

---

## 10. Strangler-Fig Cutover
1. Deploy Java service alongside FastAPI in ns `dev`.
2. Shadow/parallel-run; verify identical DynamoDB wire format + responses.
3. Flip the route at the Istio VirtualService for `api.dev` (path-based) from FastAPI → Java service, per endpoint group.
4. Monitor; roll back by re-pointing the route. 5. Decommission FastAPI route once stable.

---

## 11. Sub-agent Execution Model (the DAG)

Each WP = one sub-agent stage. Dependencies enforce ordering; independent WPs run in parallel.
Review gates use loop-back (reviewer emits `NEEDS_CHANGES` → implementer re-runs).

```
WP-00 Foundation (parent+shared-lib)         [DONE pom/wrapper; finish shared-lib]
   ├─> WP-10 user-service (REFERENCE SLICE)  ──> WP-REVIEW-1 (gate) ─┐
   │                                                                 │ pattern locked
   ├─> (after gate, parallel:)                                       v
   │      WP-20 question-service     WP-30 lab-service       (parallel)
   │      WP-40 chat-service          WP-50 analytics-service (parallel; need shared-lib only)
   └─> WP-60 integration (clients, events, resilience, strangler routing)  [needs 10–50]
          ├─> WP-70 hardening (CI/CD w/ MANDATORY test gate, IaC/Terraform, load, docs, decommission)
          └─> WP-80 full-stack k3s e2e on PUBLIC runner (frontend + backend + e2e, real Nova Lite 2)
```

- Orchestrator builds the reference slice (WP-00, WP-10) itself to lock conventions, runs the review gate,
  THEN fans out WP-20…WP-50 to parallel sub-agents (each given its WP file + shared-lib + named Python sources).
- Every sub-agent MUST: read its WP file + cited Python source, implement, run `./mvnw -pl <module> -am verify`
  with `JAVA_HOME=~/tools/jdk25`, and report build/test output. No WP is "done" without a green build.

---

## 12. Work Package Catalog
(Full self-contained specs live in `docs/work-packages/WP-*.md`. Summary:)

- **WP-00 Foundation** — parent POM (DONE), wrapper (DONE), shared-lib: error model, security auto-config
  (JWT converter + audience/token_use validator + filter chain), AWS auto-config (DynamoDbEnhancedClient),
  `WeekWindow` util, metadata `AttributeConverter`, autoconfiguration imports. Tests for `WeekWindow` + converter.
- **WP-10 user-service** — full vertical slice (domain, persistence, service, web, security wiring, tests, Docker, k8s).
- **WP-20 question-service** — S3 shell fetch+parse (regex headers), in-pod exec (setup/check) via process/Fabric8 exec,
  in-memory TTL cache, progress update + grade event, tests, k8s.
- **WP-30 lab-service** — Fabric8 Pod/Service/Istio VS lifecycle, janitor scheduler, TTL override + quota gate
  (HTTP client → user-service), in-memory tracking + K8s recovery, k3s Testcontainer tests, k8s + RBAC.
- **WP-40 chat-service** — AgentCore invoke, Redis session history + rate limit + AI-quota gate (client → user-service),
  base64 JPEG validation, message-type routing, WireMock+Redis tests, k8s.
- **WP-50 analytics-service** — `/public/stats`, `/admin/metrics` with **DB-backed admin `@PreAuthorize` fix**,
  event consumers (SQS) updating counters + `STATS#global`, tests, k8s.
- **WP-60 integration** — `@ImportHttpServices` clients, SNS/SQS event backbone, Resilience4j, OTel, Istio strangler routing.
- **WP-70 hardening** — per-service + frontend CI/CD with a **MANDATORY test gate** (`./mvnw verify`, JaCoCo, `ng test`)
  before any build/push/deploy; Terraform to codify the `rosettacloud-e2e-tester` IAM role (import) + per-service IRSA
  roles + new ECR repos + SNS/SQS event backbone; k6 load tests; architecture/runbook/ADR docs; FastAPI decommission plan.
- **WP-80 full-stack E2E (public-runner k3s)** — `.github/workflows/e2e-k3s.yml`: installs k3s in a public runner,
  deploys the WHOLE platform (LocalStack, mock-OIDC, 5 Java services, frontend, lab-stub, Istio CRDs), assumes the
  `E2E_AWS_ROLE_ARN` OIDC role, runs an `httpx` backend probe + Playwright frontend e2e, exercising **real Nova Lite 2**.
  Manual + nightly (real Bedrock → not per-PR). Diagnostics dump on failure.

---

## 13. Risk Register & Open Items
| Risk | Mitigation |
|------|------------|
| DynamoDB wire-format drift breaks Python interop | Native `M` converter (not JSON string); round-trip integration test reading a Python-written item |
| Single-replica in-process state (sessions/rate-limit/metrics) doesn't scale | Move to Redis (chat) + SNS/SQS+DynamoDB (analytics) |
| AgentCore invoke auth | IAM via IRSA (verified works; OAuth caveat N/A) |
| Istio CRD typing | GenericKubernetesResource (dynamic) — no Istio model dep |
| Lab node capacity (1 lab/t3.xlarge) | unchanged platform constraint; lab-service enforces single active lab |
| Spring Boot 4 newness of `@ImportHttpServices` | verified GA; fallback = manual `HttpServiceProxyFactory` |

## 14. Definition of Done (overall)
All 5 services build green (`./mvnw verify`), tests pass, JaCoCo ≥80% on core packages, containerized,
K8s manifests applied in `dev`, strangler routes cut over, FastAPI decommission plan documented, CI/CD per service.
```
