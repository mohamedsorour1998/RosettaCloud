# WP-70 — Hardening, CI/CD (tests in EVERY pipeline), IaC, docs, decommission

> Sub-agent brief. Read this + `docs/MIGRATION-PLAN.md`. Depends on WP-10..WP-60. No assumptions — web-search & cite if unsure.

## Objective
Production-harden the system: per-service CI/CD with a MANDATORY test gate, codify new infra in Terraform,
load tests, documentation, and the FastAPI decommission plan.

## 1. CI/CD — one workflow per Java service (+ frontend), tests REQUIRED
Mirror the existing `.github/workflows/backend-build.yml` (GitHub OIDC `github-actions-role`, account 339712964409),
but **every pipeline MUST run tests before building/pushing** (the legacy Python backend had no tests — this is a hard upgrade).
Per-service `.github/workflows/<svc>-build.yml`:
```
on: push (paths: Backend-Java/<svc>/**, Backend-Java/shared-lib/**, Backend-Java/pom.xml) + workflow_dispatch
permissions: { id-token: write, contents: read }
steps:
  - checkout
  - setup JDK 25 (actions/setup-java temurin/corretto 25) + cache ~/.m2
  - configure-aws-credentials (role-to-assume: github-actions-role)   # OIDC, no static keys
  - TEST GATE:  cd Backend-Java && ./mvnw -q -pl <svc> -am verify       # unit+slice+integration(Testcontainers; Docker present on ubuntu-latest) + jacoco
  - fail if JaCoCo coverage < threshold
  - ECR login → docker build (or mvn spring-boot:build-image) → push rosettacloud-<svc>:{latest,SHA}
  - aws eks update-kubeconfig → kubectl rollout restart deploy/rosettacloud-<svc> -n dev → rollout status
```
- Frontend `frontend-build.yml`: ADD a test gate before build — `npm ci && ng lint && ng test --watch=false --browsers=ChromeHeadless`, then existing image build/push/rollout.
- Optionally a single reusable workflow (`workflow_call`) parameterized by service to avoid duplication.

## 2. Terraform (codify everything created out-of-band)
Add under `DevSecOps/Terraform/environments/shared/` (or a new module):
- **e2e IAM role** (already created live as `rosettacloud-e2e-tester`; import it): OIDC-assumable by
  `repo:mohamedsorour1998/RosettaCloud:*`, inline policy = Bedrock Nova Lite 2 (`bedrock:InvokeModel*`,`Converse*` on
  `arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0` + `inference-profile/us.amazon.nova-2-lite-v1:0`) +
  `bedrock-agentcore:InvokeAgentRuntime`. `terraform import aws_iam_role.e2e_tester rosettacloud-e2e-tester`.
- **Per-service IRSA roles** (`rosettacloud-<svc>-irsa`): least privilege —
  user/analytics: DynamoDB `rosettacloud-*` (+ Cognito AdminUpdateUserAttributes for user); chat: `bedrock-agentcore:InvokeAgentRuntime` + Bedrock Nova invoke; question: S3 read; lab: none (in-cluster SA token for K8s API).
- **New ECR repos**: `rosettacloud-{user,lab,question,chat,analytics}-service` (lifecycle keep last 5).
- **SNS topic** `rosettacloud-events` + **SQS** `rosettacloud-analytics` (+ subscription) for WP-60 events.

## 3. Load testing
- `Backend-Java/loadtest/` k6 (or Gatling) scenarios: lab launch+poll, chat turn (Nova Lite 2), questions fetch.
  Run against the e2e stack (WP-80) or a staging cluster; assert p95 latency + error rate budgets.

## 4. Docs & ADRs
- `docs/architecture.md` (system + sequence diagrams), `docs/runbook.md` (deploy/rollback/oncall), ADRs for the
  6 decisions + DynamoDB schemaless modelling + polyglot AI plane + AgentInvoker abstraction.

## 5. FastAPI decommission plan
- Document cutover order (read-only `/public/stats` first → `/users` → `/labs` → `/questions` → `/chat` → `/admin/metrics`),
  per-route parity verification (compare Java vs FastAPI responses + DynamoDB items on a shadow user), rollback (revert Istio route),
  and final removal of the FastAPI Deployment + `backend-build.yml` once all routes are stable for N days.

## Acceptance
- Each service workflow fails the build if tests fail or coverage < threshold (prove with an intentionally failing test in a throwaway branch — then revert).
- `terraform plan` clean after importing the e2e role; new ECR/SNS/SQS planned.
- Decommission runbook reviewed.
