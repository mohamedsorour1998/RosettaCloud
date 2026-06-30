# WP-80 — Full-stack E2E on a PUBLIC GitHub runner (k3s, real Nova Lite 2)

> Sub-agent brief. Read this + `docs/MIGRATION-PLAN.md` §9. Depends on WP-10..WP-60. No assumptions — web-search & cite if unsure.
> Modeled on the user's "Astrolabe k3s full-stack e2e" pattern: install k3s IN a public ubuntu-latest runner (never self-hosted),
> deploy the entire platform, run full frontend + backend + end-to-end tests. Triggered manually + nightly (uses real Bedrock).

## Capability facts (VERIFIED 2026-06-30, this environment)
- JDK 25 (Corretto) at `~/tools/jdk25`; Maven wrapper works.
- AWS CLI works on account 339712964409; **`aws bedrock-runtime converse --model-id us.amazon.nova-2-lite-v1:0` returns live output.**
- IAM role **`arn:aws:iam::339712964409:role/rosettacloud-e2e-tester`** (OIDC, least-privilege Bedrock Nova Lite 2 + AgentCore)
  exists; ARN stored in GitHub var+secret **`E2E_AWS_ROLE_ARN`**. The e2e assumes this role (no static keys).

## E2E topology (all in k3s-in-runner)
| Component | How (CI) |
|-----------|----------|
| DynamoDB / S3 / SNS / SQS | **LocalStack** pod (no AWS creds); tables/buckets seeded; `Backend/questions/` synced to S3 |
| Cognito/JWT | **mock OIDC issuer** (e.g. `ghcr.io/navikt/mock-oauth2-server`); probe mints an ID token (`custom:user_id`, `aud=test-client`, `token_use=id`) |
| 5 Java services | built locally (Dockerfile/Jib) → `docker save` → `sudo k3s ctr images import`; `imagePullPolicy: Never`; profile `e2e` |
| chat-service AI | **real Bedrock Nova Lite 2** via `BedrockDirectInvoker` (WP-40); pod gets the OIDC-assumed temp creds as a k8s secret |
| lab pod | **lab-stub image** (`e2e/lab-stub/`): tiny HTTP server on :80 (readiness) + bash + writable `/home/coder/lab` so setup/check scripts run; NOT the heavy DinD/Kind image (infeasible on a 2-vCPU runner) |
| Istio | apply **Istio CRDs only** so `VirtualService` creation succeeds (no full mesh); probe reaches services via ClusterIP/port-forward |
| frontend | `ng build` (apiUrl → in-cluster gateway via NodePort/port-forward) → served pod; Playwright drives the real UI |

## Files to produce
```
.github/workflows/e2e-k3s.yml          # the workflow (skeleton below)
scripts/e2e/test_e2e.py                # httpx backend probe (like Astrolabe scripts/test_local_e2e.py)
scripts/e2e/frontend.spec.ts           # Playwright frontend e2e
e2e/lab-stub/Dockerfile                # lightweight lab pod stand-in (bash + :80)
e2e/k8s/                               # e2e overlays: localstack.yaml, mock-oidc.yaml, *-service e2e manifests, frontend.yaml, lab-stub configmap
e2e/seed/                              # LocalStack table/bucket creation + questions sync script
```

## Workflow skeleton (.github/workflows/e2e-k3s.yml)
```yaml
name: E2E (k3s full stack)
on:
  workflow_dispatch:
  schedule: [{ cron: "0 6 * * *" }]          # nightly; uses real Bedrock so NOT per-PR
concurrency: { group: e2e-${{ github.ref }}, cancel-in-progress: true }
permissions: { contents: read, id-token: write }   # id-token: OIDC role assume
jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    env: { KUBECONFIG: /etc/rancher/k3s/k3s.yaml, AWS_REGION: us-east-1 }
    steps:
      - uses: actions/checkout@v4
      - name: Free disk space         # remove dotnet/android/ghc/codeql like the reference
        run: sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL || true
      - uses: aws-actions/configure-aws-credentials@v4
        with: { role-to-assume: ${{ secrets.E2E_AWS_ROLE_ARN }}, aws-region: us-east-1 }
      - uses: actions/setup-java@v4
        with: { distribution: corretto, java-version: 25, cache: maven }
      - name: Build + test all services (TEST GATE)
        run: cd Backend-Java && ./mvnw -q verify                 # ALL pipelines run tests
      - name: Build images → import into k3s
        run: |                                                   # docker build each svc + frontend + lab-stub; docker save; k3s ctr images import
          ...
      - name: Install k3s (in-runner)
        run: curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644 --disable traefik
      - name: kubectl + helm + Istio CRDs
        run: |
          sudo ln -sf /usr/local/bin/k3s /usr/local/bin/kubectl
          kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.29/manifests/charts/base/crds/crd-all.gen.yaml
      - name: Deploy LocalStack + seed (DynamoDB tables+GSI, S3 buckets, questions sync, SNS/SQS)
        run: kubectl apply -f e2e/k8s/localstack.yaml && ./e2e/seed/seed.sh
      - name: Deploy mock OIDC issuer
        run: kubectl apply -f e2e/k8s/mock-oidc.yaml
      - name: Create Bedrock creds secret (from assumed OIDC creds) for chat-service
        run: kubectl create secret generic aws-bedrock-creds -n dev
             --from-literal=AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
             --from-literal=AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
             --from-literal=AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN --dry-run=client -o yaml | kubectl apply -f -
      - name: Deploy services + frontend + lab-stub (profile e2e)
        run: kubectl apply -f e2e/k8s/ && for d in user lab question chat analytics frontend; do kubectl rollout status deploy/rosettacloud-$d -n dev --timeout=300s; done
      - name: Backend e2e probe
        run: pip install httpx pyjwt && python scripts/e2e/test_e2e.py
      - name: Frontend e2e (Playwright)
        run: cd Frontend && npm ci && npx playwright install --with-deps chromium && npx playwright test
      - name: Diagnostics on failure
        if: failure()
        run: kubectl get pods -A -o wide; kubectl get events -A --sort-by=.lastTimestamp | tail -50; for d in $(kubectl get deploy -n dev -o name); do kubectl logs -n dev $d --tail=80 --all-containers || true; done
```

## Backend probe (scripts/e2e/test_e2e.py) — assertions
1. `/actuator/health` of all 5 services == UP.
2. `POST /users` (public) → 201; user in LocalStack DynamoDB.
3. mint JWT (mock issuer) → `GET /users/{id}/lab-quota` == `minutes_remaining:120`.
4. `POST /labs` → poll `GET /labs/{id}` until `running` (lab-stub readiness); Pod+Service(+VS) exist.
5. `GET /questions/{m}/{l}` → parsed questions from S3; `POST .../q1/setup` then `/check` → completed; progress updated.
6. `POST /chat {type:chat}` → **real Nova Lite 2** response non-empty, `agent` set; `ai-quota` decremented; 2nd over-limit path returns 403 `AI_QUOTA_EXHAUSTED` (after forcing limit).
7. `GET /public/stats` increments; `GET /admin/metrics` → 403 non-admin, 200 admin.

## Frontend e2e (Playwright) — flows
register → email-less mock login (or token injection) → dashboard renders → open lab route (iframe stub) → chatbot send → assert agent reply rendered.

## Acceptance
- Workflow green on `workflow_dispatch`: k3s up, all rollouts ready, backend probe + Playwright pass, real Nova Lite 2 call succeeds, diagnostics print on failure.
- Documented that nightly schedule uses real Bedrock (cost) → not per-PR; a lighter PR e2e may stub chat via WireMock.
