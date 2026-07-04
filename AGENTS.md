# AGENTS.md — RosettaCloud (agent handoff / current state)

> Authoritative, **tracked** context for AI agents (Claude Code et al.) working in this repo.
> Per-directory `AGENTS.md` files add local detail. (`CLAUDE.md` at the root is **gitignored**
> local scratch — this file is the pushed source of truth.)
> Last refreshed: 2026-07-04.

## What this is

RosettaCloud — an event-driven learning platform: an Angular SPA, a set of Spring Boot (Java)
REST microservices, an Amazon Bedrock AgentCore multi-agent tutor, and interactive in-browser
lab pods (code-server + Kind) on Kubernetes. Deployed on AWS.

## Current architecture (post-migration)

- **Frontend/** — **Angular 22** SPA (standalone components, Vitest tests, esbuild `@angular/build`).
- **Backend-Java/** — **Spring Boot 4 / Java 25** REST microservices, one per domain:
  `user-service` (:8081), `lab-service` (:8082), `question-service` (:8083),
  `chat-service` (:8084), `analytics-service` (:8085), plus `shared-lib`. Maven multi-module.
- **Backend/** — the **Python** that remains after the FastAPI monolith was removed:
  `agents/` (Bedrock AgentCore multi-agent runtime — the live tutor/grader/planner),
  `serverless/Lambda/` (document_indexer, agent_tools), `questions/` (shell-script lab content synced to S3).
- **DevSecOps/** — Terraform IaC, K8s manifests, Istio strangler routing, the `interactive-labs` lab image, CI/CD workflows.

> ⚠️ The old **FastAPI monolith (`Backend/app/`) was removed** — every endpoint
> (users/labs/questions/chat/admin/public/health) is now served by the Backend-Java services.
> If you see "FastAPI backend / rosettacloud-backend / be-deployment.yaml / backend-build.yml" in
> older prose/diagrams, that is historical; the live API is Backend-Java.

## Deploy model — IMPORTANT: **NO EKS**

There is **no live EKS cluster** ("NO-EKS mandate"). The verified deploy target is a **k3s cluster
spun up inside the GitHub Actions runner**. `backend-java-deploy.yml` and the full-stack E2E
workflows build images → ECR → import into in-runner k3s → deploy → smoke test. EKS-referencing
steps in workflows are gated (`if aws eks describe-cluster … else skip`). Terraform's EKS module was
removed. Treat any `kubectl … -n dev` against a live cluster as illustrative only.

## Build / test / run

| Component | Toolchain | Commands |
|---|---|---|
| Frontend | **Node 24** (nvm), Angular 22 | `cd Frontend && npm ci`; `npx ng build --configuration=production`; `npx ng test --watch=false` (Vitest via Angular builder — NOT raw `vitest`); `npx ng lint`; `npx playwright test` (deterministic, mocked) |
| Backend-Java | **JDK 25** (Corretto), Maven wrapper | `cd Backend-Java && ./mvnw -B -ntp verify` (all modules); `./mvnw -pl <service> -am verify`; run one: `./mvnw -pl user-service spring-boot:run` |
| Backend (agents) | Python 3.12, `agentcore` CLI | `cd Backend/agents && agentcore status` / `agentcore launch` (see Backend/AGENTS.md) |
| Terraform | Terraform 1.5+ | `cd DevSecOps/Terraform/environments/shared && terraform plan -var-file=terraform.tfvars` |

No Docker locally in the working env — image builds + k3s happen in CI only.

## CI/CD workflows (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|---|---|---|
| `frontend-ci.yml` | push/PR `Frontend/**` | Node 24: `npm ci`, **ESLint**, tsc, prod build, **Vitest + coverage gate**, npm audit, **Playwright e2e** (mocked) |
| `frontend-deploy.yml` | dispatch + push `Frontend/src/**` | Build Angular 22 image → ECR (`rosettacloud-frontend`) → deploy to in-runner k3s (hardened non-root nginx :8080) → curl smoke |
| `backend-java-ci.yml` | push/PR `Backend-Java/**` | JDK 25 `./mvnw verify` — unit + Testcontainers gate |
| `backend-java-deploy.yml` | dispatch | Build 5 service images (test gate) → ECR → in-runner k3s + hardened-securityContext assertions + PSA test + smoke (SKIP_CHAT, no Bedrock) |
| `e2e-k3s.yml` | dispatch + nightly | Full stack on k3s + **real Bedrock Nova** probe |
| `frontend-e2e-fullstack.yml` | dispatch/nightly | SPA + strangler gateway + live backend on k3s (Playwright) |
| `security.yml` | push `Backend-Java/**`,`DevSecOps/**` | Trivy: secret gate, fixable-CRITICAL CVE gate, **8-KSV misconfig regression gate**; Semgrep (informational) |
| `agent-deploy.yml` | push `Backend/agents/**` | `agentcore launch` (CodeBuild ARM64) + update K8s ConfigMap ARN |
| `lambda-deploy.yml` | push `Backend/serverless/Lambda/**` | Build/push document_indexer + agent_tools Lambda images |
| `questions-sync.yml` | push `Backend/questions/**` | Sync questions → S3 → EventBridge → indexing |

All use **GitHub OIDC** (no static creds). ECR push role: `rosettacloud-backend-deploy` (repos `rosettacloud-*`). Account `339712964409`, region `us-east-1`, repo `mohamedsorour1998/RosettaCloud`.

## What was done recently (this work stream)

- **Plan 1 — Angular 19→22 migration + FastAPI→Java API cutover + frontend CI/CD**: Angular 22, Karma→Vitest, ESLint gate, Playwright (mocked + a full-stack variant), coverage baseline gate, `frontend-deploy.yml` (image→ECR→k3s+smoke).
- **Plan 2 — pod securityContext hardening**: all 5 services `restricted` (runAsNonRoot/1000, drop ALL, seccomp RuntimeDefault, readOnlyRootFilesystem+emptyDir); runtime assertions + PSA test in deploy; Trivy 8-KSV regression gate; `labs` namespace isolation (privileged PSA for DinD lab pods) + NetworkPolicies; fe/be manifest hardening.
- **Plan 3 — AgentCore + resilience**: AgentCore runtime rebuilt & READY; Resilience4j circuit breakers via Spring Cloud CircuitBreaker on `lab-service→user-service` (all calls) and `chat-service→AI-plane` (graceful "tutor unavailable" fallback, no quota charge on failure).
- **FastAPI monolith removed** + docs/manifests reconciled to the Java reality.

## Current state

All 7 push/dispatch pipelines were **green** at last run (frontend-ci, frontend-deploy, backend-java-ci, backend-java-deploy, e2e-k3s, frontend-e2e-fullstack, security). Verify with `gh run list`.

## What's left (all optional / lower-priority follow-ups)

- Plan 3 §B.3.2 rest of the circuit-breaker map: `chat→AI-quota`, `question→progress` breakers; a shared-lib `Customizer` bean to centralize CB policy.
- Plan 3 §A.4.3 invoker/breaker alerts — needs a Prometheus scrape pipeline first.
- Plan 1 §9.5 coverage **ratchet** (gate currently at measured baseline).
- Plan 2 Phase 7 sysbox (drop `privileged` on lab pods); §7.4 kube-bench/kubescape benchmarks.
- Doc modernization: conceptual FastAPI narrative (README badges, mermaid request-flow diagrams) still says "FastAPI" — cosmetic, not broken references.

Detailed plans: `Frontend/ANGULAR-22-MIGRATION-AND-API-CUTOVER-PLAN.md`, `DevSecOps/POD-SECURITYCONTEXT-HARDENING-PLAN.md`, `Backend-Java/AGENTCORE-RESILIENCE4J-RUNTIME-PLAN.md`.

## Conventions / gotchas (read before changing things)

- **Keep every pipeline green.** Reproduce gates locally before pushing when possible.
- **Never `git add .`** — stage explicit paths (repo has many untracked scratch files: `image copy*.png`, `demo/`, `.superpowers/`, backups). Commit as `git -c user.email=mohamedsorour1998@gmail.com -c user.name='Mohamed Sorour'`.
- Frontend needs **Node ≥ 24.15**; the Vitest suite runs via `ng test` (Angular `@angular/build:unit-test`), not standalone `vitest`.
- Backend needs **JDK 25** (Corretto). Any service that uses the **Spring Cloud CircuitBreaker** starter must set `spring.cloud.compatibility-verifier.enabled=false` (Spring Cloud 2025.1.0 validates only Boot 4.0.x; we run 4.1.0) — else the pod CrashLoops at startup.
- `bcprov-jdk18on` is pinned to `1.81.1` in the parent POM (transitive CRITICAL CVE-2025-14813 from the CB starter). Keep it.
- The k3s image pattern: pull from ECR → `docker tag … <name>:e2e` → `k3s ctr images import` → manifests use `<name>:e2e` with `imagePullPolicy: IfNotPresent`.
- `backend-java-deploy.yml` is the proven template for "build → ECR → in-runner k3s + smoke".
