# AGENTS.md — RosettaCloud Frontend (agent handoff)

> Concise, tracked context for AI agents working in the Angular SPA.
> Root context: [`../AGENTS.md`](../AGENTS.md). Migration plan: `ANGULAR-22-MIGRATION-AND-API-CUTOVER-PLAN.md`.

## What this is

**Angular 22** SPA — standalone components, bootstrapped in `src/main.ts`, esbuild
builder (`@angular/build:application`). It talks to the **Backend-Java** microservices
through the **strangler gateway** as a single origin: `environment.apiUrl`
(`https://api.dev.rosettacloud.app`). SCSS + Bootstrap 5, xterm.js for the lab terminal.

**Auth = Amazon Cognito via the direct AWS SDK** (`@aws-sdk/client-cognito-identity-provider`
in `src/app/services/user.service.ts` — no browser credentials). The Cognito **ID token is
stored in `localStorage` (`idToken`)** and attached as `Authorization: Bearer <idToken>` by a
**functional interceptor** (`authInterceptor`, `HttpInterceptorFn`) wired via
`provideHttpClient(withInterceptors([...]))` in `src/app/app.config.ts`. It only decorates
requests to `environment.apiUrl`.
> Gotcha: the LIVE interceptor is `src/app/interceptors/auth.interceptor.ts`. The class-based
> files under `src/interceptors/` are legacy/unwired — don't edit those.

## Requirements

- **Node ≥ 24.15** (Angular 22 floor). Use `nvm`. No global tooling needed beyond `npx`.

## Build / test / run

| Task | Command |
|---|---|
| Install (locked) | `npm ci` |
| Prod build | `npx ng build --configuration=production` → `dist/rosetta-cloud-frontend/browser` |
| Unit tests | `npx ng test --watch=false` |
| Coverage (for gate) | `npx ng test --watch=false --coverage` (alias `npm run test:coverage`) |
| Lint | `npx ng lint` (`@angular-eslint/builder:lint`, ESLint 10 + typescript-eslint) |
| E2E (mocked) | `npx ng build --configuration=production` then `npx playwright test` |

## TESTING GOTCHA (read this)

- **Unit tests are Vitest, but run VIA Angular's `@angular/build:unit-test` builder** (`ng test`).
  Do **NOT** run standalone `vitest run` — it fails (no `vitest.config`; the builder injects the
  TestBed/jsdom/globals and `src/testing/vitest-providers.ts`).
- **Playwright default suite** = `e2e/*.spec.ts` — deterministic & backend-independent: serves the
  committed prod build via `e2e/static-server.mjs`, mocks every API/Cognito call with `page.route`
  (`e2e/support/`), and injects a fake token. Config ignores `**/fullstack/**`. Reliably green in CI.
- **Full-stack suite** = `e2e/fullstack/**` — SEPARATE config
  (`e2e/fullstack/playwright.fullstack.config.ts`), runs against the LIVE k3s backend through the
  strangler gateway (needs `E2E_ID_TOKEN`/`FULLSTACK_GATEWAY_URL`/etc.). Heavy — dispatch/nightly only.

## Coverage gate

`scripts/check-coverage.mjs` is a **regression guard** at the measured baseline (2026-07-02):
**lines 41 / statements 43 / functions 20 / branches 29** (floors; override via `COV_MIN_*` env).
Reads `coverage/<project>/coverage-summary.json`. Keep it green; ratchet UP when coverage rises.

## Docker / nginx

- Multi-stage `Dockerfile`: `node:24-bookworm-slim` (build → `npm ci`, `npm run build`) →
  `nginx:1.27-alpine` runtime. **`USER 1000`**, **listens `:8080`**, serves the SPA with an
  index fallback. `nginx.conf` is the full main config: `pid` + all temp paths under `/tmp`, logs
  to stdout/stderr — **`readOnlyRootFilesystem`-compatible** (mount an `emptyDir` at `/tmp`).

## CI/CD (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|---|---|---|
| `frontend-ci.yml` | push/PR `Frontend/**` | `npm ci`, ESLint, tsc, prod build, Vitest + coverage gate, `npm audit`, Playwright mocked e2e |
| `frontend-deploy.yml` | dispatch + push `Frontend/src/**` | Build image → ECR `rosettacloud-frontend` → in-runner **k3s** hardened non-root Pod `:8080` → curl smoke. **NO EKS.** |
| `frontend-e2e-fullstack.yml` | dispatch / nightly | Full-stack Playwright against live k3s backend via strangler gateway |

## Conventions

- **Keep every pipeline green** — reproduce gates locally before pushing.
- **Never `git add .`** — stage explicit paths (repo has untracked scratch/report dirs).
- Match existing standalone-component + service patterns; strict tsconfig
  (`noPropertyAccessFromIndexSignature` — use bracket access for `process.env`).
