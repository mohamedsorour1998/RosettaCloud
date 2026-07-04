# AGENTS.md — DevSecOps (agent handoff)

> Tracked context for AI agents working under `DevSecOps/`. See root `../AGENTS.md` for the
> whole-repo picture and `POD-SECURITYCONTEXT-HARDENING-PLAN.md` (Plan 2) for the hardening detail.

## What this is

Platform infra for RosettaCloud: **Terraform IaC** (`Terraform/`), **Kubernetes manifests**
(`K8S/`) including **Istio strangler routing**, the **`interactive-labs/`** lab-pod image
(code-server + Docker-in-Docker + Kind), and **CI/CD security scanning** (`security.yml`).

## ⚠️ NO-EKS MANDATE (read first)

There is **no live EKS cluster** (`aws eks list-clusters` → `[]`). In `Terraform/environments/shared/main.tf`
the `module "eks"` block, the EKS OIDC locals, IRSA trust roles, and EKS access-entry blocks are all
**commented out** (the `modules/eks/` dir still exists on disk but is never instantiated). The verified
deploy target is **k3s spun up inside the GitHub Actions runner** (`backend-java-deploy.yml`, `e2e-k3s.yml`,
`frontend-e2e-fullstack.yml`): pull from ECR → `k3s ctr images import` → apply manifests → smoke test.
So `K8S/` is largely EKS-era/illustrative + the source of truth for the in-runner e2e stack; treat any
live `kubectl … -n dev` against a real cluster as illustrative only.

## Terraform (`Terraform/environments/shared`)

- Plan: `cd Terraform/environments/shared && terraform plan -var-file=terraform.tfvars`.
- State: S3 backend `rosettacloud-shared-terraform-backend`, key `terraform.tfstate`, `us-east-1`.
- Manages: VPC, IAM (GitHub-OIDC roles, Lambda/AgentCore/e2e-tester roles), ECR (interactive-labs,
  frontend, backend, 5 `rosettacloud-<service>` repos, lambda repos), S3 (interactive-labs + `-vector`),
  Route53 + ACM + CloudFront, DynamoDB `SessionTable`, EventBridge→document_indexer, SNS/SQS event
  backbone, API Gateway + Cognito (`modules/api-gateway-auth`). **No EKS module.**

## `K8S/` manifests

- `strangler-virtualservice.yaml` — path routing on `api.dev.rosettacloud.app`: `/users`→user-service:8081,
  `/labs`→lab:8082, `/questions`→question:8083, `/chat`→chat:8084, `/admin/metrics`+`/public/stats`→
  analytics:8085. **Strangler COMPLETE**: the FastAPI default fallback route was **REMOVED** (unmatched → 404);
  `/internal/**` is deliberately unrouted. Also carries the `user-service-internal-allowlist` NetworkPolicy.
- `labs-namespace.yaml` — the `labs` ns is **PSA enforce=privileged** (its lab pods are **privileged DinD**,
  which `baseline`/`restricted` would reject) + `ResourceQuota` + `LimitRange`. `backend-java-deploy.yml`
  applies it and **fails fast** if `enforce != privileged`.
- `psa-labels.yaml` — `dev` ns set to **warn/audit=restricted**; `enforce=restricted` is the **gated**
  cutover and stays **commented out** (e2e infra + any legacy pods aren't restricted-compliant). The five
  Java service pods themselves ship restricted-compliant securityContexts (asserted at deploy).
- `networkpolicies-labs.yaml` — default-deny + allow-lists for `labs`; egress permits DNS + public 80/443
  but **blocks cluster RFC1918 and IMDS 169.254.169.254** (anti-pivot / anti-IAM-theft). `networkpolicies-dev.yaml` = dev L3/L4.
- `fe-deployment.yaml` — hardened `nginx-unprivileged` on `:8080` (staged reference; **not** applied by CI —
  the real `rosettacloud-frontend` image is deployed by `frontend-deploy.yml`).
- `istio-*` (gateway/virtualservices/ingress-svc), `rosettacloud-ingress.yaml`, `alb-ingress.yaml` — Istio +
  ingress wiring. **NOTE:** `be-deployment.yaml` (FastAPI) was **REMOVED**; the legacy backend VirtualService is gone.

## `interactive-labs/`

`Dockerfile`: `codercom/code-server:noble` + Docker-in-Docker (`docker:28-dind`) + kubectl + Kind v0.27.0
(pre-pulled `kindest/node:v1.33.0` → `/kind-node.tar`) + Python/Node — the in-browser lab pod image.
`interactive-labs-build.yml` builds + pushes to ECR (`interactive-labs`, tags `:latest` + `:<sha>`); its
"update lab-service ConfigMap / rollout" step is **EKS-gated** (`if aws eks describe-cluster … then … else skip`),
so under NO-EKS it is skipped.

## CI — `security.yml` (triggers on `Backend-Java/**` + `DevSecOps/**`)

Trivy: **secret gate** (fail on ANY committed secret), **fixable-CRITICAL CVE gate** (`--ignore-unfixed`),
and the **8-KSV misconfig regression gate** looping the five service manifests — **KSV-0118, 0012, 0001,
0003, 0014, 0030, 0011, 0106 must stay 0-findings** (Plan 2 §7.3). Semgrep runs informational
(`continue-on-error`). **Editing anything under `DevSecOps/**` triggers this workflow — keep it green.**

## Conventions

- Keep every pipeline green; reproduce gates locally before pushing when possible.
- **Never `git add .`** — stage explicit paths (repo has untracked scratch). Do not run git/docker here without need.
