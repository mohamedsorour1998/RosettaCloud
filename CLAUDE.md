# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this first

- **This repo migrated off a Python FastAPI monolith to Spring Boot microservices.** If you see
  "FastAPI", "`Backend/app/`", "EKS Auto Mode", "Karpenter", or `rosettacloud-backend` in old
  docs, diagrams, or your own memory of this project — that's **historical**, not current.
- **There is no live EKS cluster.** The verified deploy/test target is a **k3s cluster spun up
  inside the GitHub Actions runner** for every workflow run. Terraform's `module "eks"` is
  commented out. Treat any `kubectl ... -n dev` against a persistent cluster as illustrative only.
- **Every directory has its own `AGENTS.md`** (root `AGENTS.md`, `Frontend/AGENTS.md`,
  `Backend/AGENTS.md`, `Backend-Java/AGENTS.md`, `DevSecOps/AGENTS.md`) — tracked, kept current,
  and the deeper source of truth for gotchas/conventions. This file summarizes the same ground for
  quick orientation; when they conflict, trust `AGENTS.md` and update this file.
- **Never `git add .`** — the repo has untracked scratch (`docs/`, `image copy*.png`, backups,
  `__pycache__/`). Stage explicit paths.
- **Keep CI green** — reproduce a workflow's gate locally before pushing when you can.
- AIdeas/hackathon competition and business-strategy notes live in `docs/aideas-notes.md`
  (gitignored, local-only) — not part of this file.

## Repository Structure

Monorepo, four top-level components:

- **Frontend/** — Angular 22 SPA (standalone components, Vitest via the Angular builder, Playwright).
- **Backend-Java/** — Spring Boot 4 / Java 25 REST microservices. **This is the live API** —
  `user-service`, `lab-service`, `question-service`, `chat-service`, `analytics-service`, plus a
  shared auto-config library `shared-lib`. Maven multi-module (`mvnw` wrapper).
- **Backend/** — what's left of the Python backend after the FastAPI monolith was removed:
  `agents/` (the live Bedrock AgentCore multi-agent tutor/grader/planner runtime),
  `serverless/Lambda/` (`document_indexer`, `agent_tools`), `questions/` (shell-script lab content
  synced to S3). `Backend/app/` on disk is stale `__pycache__` only — no source remains.
- **DevSecOps/** — Terraform IaC (no EKS module), Kubernetes manifests (Istio strangler routing,
  Pod Security, NetworkPolicies), the `interactive-labs/` lab-pod image, CI security scanning.

## Common Commands

### Frontend (Angular 22)

```bash
cd Frontend
npm ci                                     # install from lockfile
npx ng serve                               # dev server → http://localhost:4200
npx ng build --configuration=production    # → dist/rosetta-cloud-frontend/browser
npx ng test --watch=false                  # unit tests (Vitest, via Angular's builder)
npx ng test --watch=false --coverage       # coverage (feeds scripts/check-coverage.mjs gate)
npx ng lint                                # ESLint 10 + typescript-eslint
npx playwright test                        # mocked e2e (needs a prod build first)
```

**Do not run standalone `vitest run`** — there's no `vitest.config`; the Angular
`@angular/build:unit-test` builder injects TestBed/jsdom/globals. Requires **Node ≥ 24.15**.
Playwright's default suite (`e2e/*.spec.ts`) is deterministic/backend-independent (mocks every
API/Cognito call). A separate config (`e2e/fullstack/playwright.fullstack.config.ts`) runs against
the live k3s backend — dispatch/nightly only, not part of local iteration.

### Backend-Java (Spring Boot 4 / Java 25)

```bash
cd Backend-Java
./mvnw -B -ntp verify                      # all modules: unit + web-slice + Testcontainers tests
./mvnw -pl user-service -am verify         # one module + its deps
./mvnw -pl user-service spring-boot:run    # run one service locally
```

Requires **JDK 25 (Corretto)**. No local Docker in the working env — image builds and k3s happen
in CI only.

### Backend (Python — AgentCore runtime)

```bash
cd Backend/agents
agentcore status                           # inspect the deployed multi-agent runtime
agentcore configure -e agent.py -n rosettacloud_education_agent \
  -er arn:aws:iam::339712964409:role/rosettacloud-agentcore-runtime-role \
  -rf requirements.txt -r us-east-1 -ni
agentcore launch --auto-update-on-conflict \
  --env BEDROCK_AGENTCORE_MEMORY_ID=rosettacloud_education_memory_v2-vvC3mbAmra \
  --env GATEWAY_URL=$GATEWAY_URL
agentcore invoke '{"message": "What is Docker?", "user_id": "test", "session_id": "test-session-1234567890abcdef1234"}'
```

The `agentcore` CLI may not be on `PATH` — check `~/.local/bin/agentcore`.

### Terraform

```bash
cd DevSecOps/Terraform/environments/shared
terraform plan -var-file="terraform.tfvars"
terraform apply -var-file="terraform.tfvars"
```

Remote state: S3 bucket `rosettacloud-shared-terraform-backend`, `us-east-1`. Manages VPC, IAM
(GitHub-OIDC roles), ECR repos, S3, Route 53 + ACM + CloudFront, DynamoDB, EventBridge, SNS/SQS,
API Gateway + Cognito. **No EKS module** — `module "eks"` and its IRSA/OIDC blocks are commented
out in `main.tf`.

## Architecture

### Request Flow

Browser (Angular SPA) → CloudFront → API Gateway HTTP API (Cognito JWT authorizer) → Istio
**strangler `VirtualService`** in the `dev` namespace, which path-routes to one Spring Boot pod per
domain — no single "backend" pod anymore:

| Path prefix | Service | Port |
|---|---|---|
| `/users` | user-service | 8081 |
| `/labs` | lab-service | 8082 |
| `/questions` | question-service | 8083 |
| `/chat` | chat-service | 8084 |
| `/admin/metrics`, `/public/stats` | analytics-service | 8085 |

The strangler cutover is **complete** — the old FastAPI fallback route was removed, so an
unmatched path 404s. `/internal/**` endpoints exist for service-to-service calls only and are
deliberately unrouted at the gateway (enforced by a NetworkPolicy allow-list). Each service
resolves identity from the JWT itself (`custom:user_id` ?? `sub`) — there's no shared auth layer
doing this for them.

### Deploy model — no live EKS

The verified deploy/verification target for every workflow is a **k3s cluster spun up inside the
GitHub Actions runner**: build image → push to ECR → `k3s ctr images import` → apply manifests →
smoke test. Any EKS-specific workflow step is gated (`if aws eks describe-cluster ... else skip`).
`DevSecOps/K8S/` manifests are largely EKS-era/illustrative plus the source of truth for the
in-runner e2e stack — don't assume a `kubectl -n dev` against a persistent cluster reflects
anything real.

### Backend-Java microservices

Spring Boot 4.1.0 on Java 25, Maven multi-module, one service per domain:

| Module | Port | Responsibility |
|---|---|---|
| `user-service` | 8081 | Users, profiles, weekly free-tier quotas (120 lab-minutes + 50 AI-messages), active-lab/session bookkeeping, progress (DynamoDB) |
| `lab-service` | 8082 | Lab lifecycle — creates Pod + Service + Istio `VirtualService` per lab (Fabric8 K8s client), TTL janitor (`LabJanitor`, `@Scheduled`) |
| `question-service` | 8083 | Question content + in-pod `exec` grading of shell-script checks |
| `chat-service` | 8084 | AI chat proxy → AgentCore/Bedrock, Redis-backed session history, rate limiting, AI-quota gating |
| `analytics-service` | 8085 | Usage/progress analytics, consumes SNS/SQS domain events |
| `shared-lib` | — | Cross-cutting auto-config: Cognito JWT resource-server, RFC 7807 error handling, `HttpRetry` resilience helper, event publishing, AWS/DynamoDB helpers |

**Critical build gotchas** (break the pod / CI if changed):
- `spring.cloud.compatibility-verifier.enabled: false` must stay set in `application.yml` for
  every service with the CircuitBreaker starter (currently `lab-service`, `chat-service`) — Spring
  Cloud 2025.1.0 only validates Boot 4.0.x; we run 4.1.0, so the verifier aborts startup into
  `CrashLoopBackOff` if this flag is missing.
- `org.bouncycastle:bcprov-jdk18on` is pinned to `1.81.1` in the parent `pom.xml`
  `dependencyManagement` (transitive CRITICAL CVE-2025-14813 via `spring-cloud-context`) — clears
  the Trivy CRITICAL gate; don't remove or downgrade it.

**Resilience (Spring Cloud CircuitBreaker / Resilience4j):** inter-service calls wrap
`CircuitBreakerFactory.create(id).run(call, fallback)`, with `HttpRetry` retries composed *inside*
the breaker.
- `lab-service → user-service` (`UserServiceClient`): every method wrapped; reads use CB id
  `user-quota`, session/lifecycle mutations use `user-session`. TimeLimiter 6s.
- `chat-service → AI plane` (`ChatService` around the AgentInvoker): CB id `ai-plane`; fallback
  returns an `AI_UNAVAILABLE` reply ("tutor temporarily unavailable") that, by design, does **not**
  record history, charge AI quota, or emit an event. TimeLimiter 60s — deliberately generous so a
  slow-but-successful Nova reply isn't cut off.

### Lab lifecycle & quota (`LabService.java`, `QuotaService.java`)

`LabService.launch(userId)`: 409 if the user already has an active lab; 403
(`LAB_QUOTA_EXHAUSTED`) if weekly minutes are exhausted; otherwise generates `lab-{uuid8}`,
provisions Pod + Service + VirtualService **in parallel** (`CompletableFuture.runAsync` × 3 in
`Fabric8LabProvisioner` — privileged pod, `sidecar.istio.io/inject: "false"`), registers it with a
TTL clamped to remaining quota minutes, and calls `user-service` to set `active_lab` +
`lab_started_at` and append lab history.

`QuotaService` in `user-service` is a faithful Java port of the old `users_backends.py` logic:
**120 lab-minutes/week, 50 AI-messages/week**, Monday-00:00-UTC reset window (`WeekWindow`).
`closeLabSession(user)` is the single atomic operation that both paths below must funnel through —
it records session duration into the weekly total *and* clears `active_lab`/`lab_started_at` in one
write, so a crash between "clear" and "record" can never leave quota enforcement reading a stale
zero. It's called from: (1) explicit `DELETE /labs/{id}` (`LabService.terminate`), and (2) the
`LabJanitor` auto-terminate path when a lab exceeds its TTL.

### AI Chatbot flow (`chat-service` → AgentCore Runtime)

`chat-service` invokes the Amazon Bedrock **AgentCore Runtime** (boto3-equivalent AWS SDK call)
that runs `Backend/agents/agent.py` — a Python **Strands Agents** multi-agent router, unchanged by
the Java migration. `_classify(message, type)` routes `type=grade`→grader, `hint`/`explain`→tutor,
`session_start`→planner, else a Nova classifier call, defaulting to tutor. Each agent gets tools via
MCP through an AgentCore Gateway (`GATEWAY_URL`); session continuity comes from an in-process
fallback plus **AgentCoreMemory** (`AgentCoreMemorySessionManager`, keyed by `BEDROCK_AGENTCORE_MEMORY_ID`).

**History sanitization (`agent.py:_sanitize_history`)** — still the load-bearing fix for two
Bedrock Converse hard rules (every `toolResult` must match a prior `toolUse` in the immediately
preceding assistant turn, in order; strict user/assistant role alternation). Three phases run on
every load *and* save: **strip** tool blocks (keep only `text`/`image`, drop emptied messages),
**merge** consecutive same-role messages, **anchor** (trim to start-with-user, end-with-assistant).
The agent treats `payload["conversation_history"]` as authoritative whenever the key is *present*
(even `[]`) and only falls back to its in-process cache when the key is missing entirely — this is
what lets `chat-service` deliberately signal "no history" for `session_start`/`explain` turns
without a stale cache silently overriding it.

**Exception handling at the invoke site (`_run_agent`)**: `MaxTokensReachedException` →
`_salvage_partial_text(agent)` walks `agent.messages` backwards for the last real assistant text
(ignoring truncated `toolUse` blocks) and returns it with a cut-off notice, so no raw Strands
traceback reaches the student. `ContextWindowOverflowException` → drops that session's
in-process history cache and asks the user to repeat their last question. `max_tokens` is set
explicitly on the `BedrockModel` — without it Strands omits `maxTokens` from `inferenceConfig` and
Bedrock silently falls back to a much lower platform default.

### Document indexing & questions pipeline

Unchanged by the migration:
1. Shell scripts live in `Backend/questions/{module_uuid}/{lesson_uuid}/qN.sh`; `questions-sync.yml`
   syncs them to `s3://rosettacloud-shared-interactive-labs/` on push, which fires an S3
   EventBridge notification.
2. `document_indexer` Lambda parses the script header, embeds with Amazon Titan
   (`amazon.titan-embed-text-v2:0`), and writes to **LanceDB on S3**
   (`s3://rosettacloud-shared-interactive-labs-vector`, table `shell-scripts-knowledge-base`).
3. `question-service` (Java) now owns fetching/caching question content and in-pod `exec` grading
   (`kubectl cp` + `kubectl exec` against the student's lab pod) that previously lived in the
   FastAPI `questions_backends.py`.

### Security & hardening

- **Auth:** Amazon Cognito user pool (`us-east-1_jPds5WJ0I`), JWT-authorized API Gateway; each
  service validates issuer + audience itself.
- **Pod Security "restricted":** all five Java services run `runAsNonRoot` (uid 1000),
  `readOnlyRootFilesystem`, `capabilities: drop [ALL]`, `seccompProfile: RuntimeDefault`, with
  resource requests/limits — asserted at deploy time in `backend-java-deploy.yml`. The `labs`
  namespace is the deliberate exception: it's PSA `enforce=privileged` because lab pods need
  privileged Docker-in-Docker, and `backend-java-deploy.yml` fails fast if that enforcement level
  drifts.
- **Network isolation:** default-deny NetworkPolicies with explicit allow-lists; the `labs`
  namespace specifically blocks the cloud metadata endpoint (`169.254.169.254`) and cluster
  RFC1918 ranges, to stop a compromised lab pod from pivoting or stealing node IAM credentials.
- **Supply-chain scanning (`security.yml`, triggers on `Backend-Java/**` + `DevSecOps/**`):** Trivy
  secret gate (fail on any committed secret), fixable-CRITICAL CVE gate, and an **8-check
  Kubernetes misconfig regression gate** (KSV-0118, 0012, 0001, 0003, 0014, 0030, 0011, 0106 must
  stay at 0 findings) across the five service manifests. Semgrep SAST runs informationally.
- **No static cloud credentials anywhere** — every workflow authenticates via GitHub OIDC.

## CI/CD (`.github/workflows/`)

| Workflow | Trigger | What it does |
|---|---|---|
| `frontend-ci.yml` | push/PR `Frontend/**` | Node 24: `npm ci`, ESLint, tsc, prod build, Vitest + coverage gate, `npm audit`, Playwright (mocked) |
| `frontend-deploy.yml` | dispatch + push `Frontend/src/**` | Build Angular 22 image → ECR (`rosettacloud-frontend`) → deploy to in-runner k3s (hardened non-root nginx `:8080`) → curl smoke |
| `frontend-e2e-fullstack.yml` | dispatch + nightly | SPA + strangler gateway + live backend on k3s (Playwright, real, not mocked) |
| `backend-java-ci.yml` | push/PR `Backend-Java/**` | JDK 25 `./mvnw verify` — unit + Testcontainers gate |
| `backend-java-deploy.yml` | dispatch | Build 5 service images (test-gated) → ECR → in-runner k3s + securityContext assertions + PSA-restricted probe + smoke (`SKIP_CHAT=1`, no Bedrock) |
| `e2e-k3s.yml` | dispatch + nightly | Full stack on k3s + a real Amazon Nova cross-service probe |
| `security.yml` | push `Backend-Java/**`, `DevSecOps/**` | Trivy (secret + CVE + KSV misconfig gates) + Semgrep |
| `agent-deploy.yml` | push `Backend/agents/**` | `agentcore launch` (CodeBuild ARM64) + updates the K8s ConfigMap ARN |
| `lambda-deploy.yml` | push `Backend/serverless/Lambda/**` | Build/push `document_indexer` + `agent_tools` Lambda container images |
| `questions-sync.yml` | push `Backend/questions/**` | Sync questions → S3 → EventBridge → RAG re-indexing |
| `interactive-labs-build.yml` | push `DevSecOps/interactive-labs/**` | Build/push the lab-pod image to ECR |

All use **GitHub OIDC** (no static AWS credentials). Account `339712964409`, region `us-east-1`,
ECR repos `rosettacloud-*`, GitHub repo `mohamedsorour1998/RosettaCloud`.

## Frontend Configuration

Build environments in `Frontend/src/environments/` (`environment.ts` = production, plus
`.development`/`.uat`/`.stg`): each defines `apiUrl` (single origin, `https://api.dev.rosettacloud.app`),
`chatbotApiUrl` (`{apiUrl}/chat`), `feedbackApiUrl`, and `apiFlags.useJavaProblemDetails` — the SPA
tolerates both RFC 7807 (`application/problem+json`, the Java shape) and the legacy FastAPI error
shape via `core/problem-detail`, documenting Java as the expected default post-cutover.

**Auth:** Cognito via the **direct AWS SDK** (`@aws-sdk/client-cognito-identity-provider` in
`user.service.ts`) — no Amplify. The ID token is stored in `localStorage.idToken` and attached as
`Authorization: Bearer` by a **functional interceptor**
(`src/app/interceptors/auth.interceptor.ts`, wired via `provideHttpClient(withInterceptors([...]))`
in `app.config.ts`) that only decorates requests to `environment.apiUrl`. The class-based
interceptors under `src/interceptors/` are legacy/unwired — don't edit those by mistake.

**Docker:** multi-stage — `node:24-bookworm-slim` builds (`npm ci && npm run build`), runtime is
`nginx:1.27-alpine`, non-root `USER 1000`, listens on `:8080` (not 80), `nginx.conf` routes all
temp paths under `/tmp` so it works with `readOnlyRootFilesystem` + an `emptyDir` mount. Do not use
`ng serve` in production — it causes HMR WebSocket reload loops.

### ChatbotService (`Frontend/src/app/services/chatbot.service.ts`)

Key public API used by components:
```typescript
setUserId(userId: string): void          // called on login; triggers loadAiQuota()
setLabContext(moduleUuid: string, lessonUuid: string): void  // called by LabComponent.ngOnInit
sendMessage(message: string): void
sendImageMessage(base64: string, text: string): void
stagePendingImage(base64: string, defaultText?: string): void  // stage a Snap & Ask screenshot for the user to edit before sending
sendGradeMessage(moduleUuid, lessonUuid, questionNumber, result): void
sendFeedbackRequest(moduleUuid, lessonUuid, questions, userProgress): void

messages$: Observable<ChatMessage[]>
loading$: Observable<boolean>
aiQuota$: Observable<AiQuota | null>      // null until setUserId(); refreshed after every response
pendingImageStaged$: Observable<{ base64: string; defaultText: string }>  // Subject, no replay for late subscribers
```

- All HTTP calls go through a private `post<T>(body)` helper that retries **once after 1.5s on
  HTTP status 0** (connection refused / cold backend pod) and propagates other error codes
  immediately without retry.
- **Snap & Ask stages before sending**: `lab.component.ts:analyzeTerminal()` calls
  `stagePendingImage(base64)` rather than sending immediately; `ChatbotComponent` subscribes to
  `pendingImageStaged$`, pre-fills the input with default text, and shows a preview card. Sending
  then calls `sendImageMessage()`.
- **AI message quota (50/week):** on 403 `AI_QUOTA_EXHAUSTED`, `sendMessage`/`sendImageMessage`
  catch it, update quota state, and append a friendly error with the reset date.
  `ChatbotComponent.isQuotaExhausted` disables the textarea and send button; the left lab-questions
  sidebar and the right AI-chat panel are both hidden (`*ngIf="!isQuotaExhausted"`) with only a
  quota-error card shown centre.
- The chat textarea is **never** disabled by `isLoading` alone (only the send button is) — this
  keeps input usable while the ~15–30s `sendSessionStart` welcome-message fetch is in flight.
  `sendSessionStart` fires only when lab status transitions to `running`, silently (no user bubble).

### Lab component UI (`Frontend/src/app/lab/`)

Three resizable columns — left (questions sidebar), centre (code-server iframe), right (AI chat).
Widths persist to `localStorage` (`rc_left_panel_w` / `rc_right_panel_w`); dragging sets
`document.body.style.userSelect = 'none'`, cleared on `mouseup` **and** `window.blur` (so it can't
stick if the mouse leaves the window mid-drag). `.question-title` uses `min-width: 0` +
`word-break: break-word` so long question text wraps instead of pushing the Ask-AI button offscreen.
