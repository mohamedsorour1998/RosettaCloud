# RosettaCloud Frontend — Angular 19 → 22 Migration & FastAPI → Java Microservices Cutover Plan

> **Single source of truth** for (a) migrating the Angular SPA from **19.2 → 20 → 21 → 22** one major at a time, and (b) cutting the SPA over from the legacy **FastAPI** monolith to the **Spring Boot 4 / Java 25** microservices behind the Istio **strangler** VirtualService, with a full **frontend testing strategy** (Vitest + Playwright + contract tests) and CI/CD.
>
> Everything below is grounded in the **actual** repository state as read on 2026-07-02 (file paths and line-level facts are cited inline). Where the original brief and the real code disagree, the real code wins and the discrepancy is called out explicitly.

---

## 0. Document Control & How To Use This Plan

| Field | Value |
|---|---|
| Scope | `Frontend/` Angular SPA + its API contract with `Backend-Java/*` services |
| Out of scope | Java service internals, Terraform/EKS provisioning, AgentCore, `Backend/` FastAPI internals (kept as strangler fallback until decommissioned) |
| Sequencing rule | **Never skip a major.** `19 → 20 → 21 → 22`, each in its own PR, each green in CI before the next starts. |
| Cutover independence | The API cutover (Phase 4) is **decoupled** from the Angular upgrade and is largely a **server-side** concern (Istio VirtualService). It can ship before, during, or after the Angular work. Recommended order: **Phase 4 first** (de-risk the contract on Angular 19 which is known-good), then 1→2→3. |
| Definition of Done | §11 Acceptance Criteria + Final Verification Checklist all checked; CI green; canary at 100% with error-rate < 0.5%. |
| Branching | One long-lived `ng-upgrade` integration branch; one short-lived branch per phase (`ng-upgrade/v20`, `.../v21`, `.../v22`, `api/java-cutover`). |

### ⚠️ Ground-truth corrections to the original brief

These are **material** and change the risk profile — verified against the real files:

1. **The frontend is NOT on the Webpack builder.** `Frontend/angular.json` already uses the esbuild **application builder**: `"builder": "@angular-devkit/build-angular:application"` (build), `":dev-server"` (serve), `":karma"` (test). The v20 "builder migration" is therefore a **package rename** (`@angular-devkit/build-angular` → `@angular/build`), **not** a Webpack→esbuild port. Low risk.
2. **`provideZoneChangeDetection({ eventCoalescing: true })` is already present** in `src/app/app.config.ts`. The v21 "add `provideZoneChangeDetection()`" step is already satisfied — verify-only.
3. **`ApplicationConfig` is already imported from `@angular/core`** (`app.config.ts` line 1). The v21/v22 "ApplicationConfig moves to @angular/core" is already done — verify-only.
4. **`TestBed.inject` is already used** (e.g. `services/user.service.spec.ts`); there is **no** `TestBed.get`, no `InjectFlags`, no `afterRender`/`afterNextRender`, no `DOCUMENT` DI-token import, no `@NgModule`, no `standalone: false`, no `@Component` `moduleId`/`interpolation` anywhere in `src/**`. These v20/v21 migrations are **N/A — verify-only** (confirmed by repo-wide grep).
5. **Signals are already in use** in `services/i18n.service.ts` (`signal()/asReadonly()`), so the toolchain and team are already signal-aware.
6. **Strangler routing is path-based on the same host** (`api.dev.rosettacloud.app`). Therefore **`environment.apiUrl` does not change** for the cutover — the switch is server-side. The real frontend cutover work is **error-shape handling (RFC7807)** + **removing now-server-side calls**, not URL changes.

---

## 1. Executive Summary, Goals, Non-Goals, Principles

### 1.1 Executive summary
The RosettaCloud SPA is a **standalone-component Angular 19.2** app (no NgModules), zone-based with `eventCoalescing`, built by the **esbuild application builder**, tested with **Karma + Jasmine**, on **TypeScript 5.7.2 / RxJS 7.8 / zone.js 0.15**. It authenticates directly against **Cognito** (`@aws-sdk/client-cognito-identity-provider`) and stores the **ID token** in `localStorage`, attached as `Bearer` by a **functional interceptor** to every request whose URL starts with `environment.apiUrl`. It talks to a FastAPI gateway for users, labs, questions, chat, feedback, and metrics.

The migration advances the app to **Angular 22** (OnPush-by-default, `@angular/build`, Vitest, stable `httpResource`/Signal Forms, optional zoneless), and re-points its API consumption to the **Java microservices** via the strangler fig — where the only behavioural contract change visible to the browser is **RFC7807 `application/problem+json`** error bodies (vs FastAPI's `{detail}`) and **snake_case** JSON (already the case).

### 1.2 Goals
- **G1** — App runs on Angular 22 with a clean `ng build` and `ng test` (Vitest), zero deprecation warnings from our own code.
- **G2** — Test runner migrated Karma→Vitest; **meaningful** unit/component coverage on the 4 API services + auth flow (baseline → ratcheted gate).
- **G3** — API cutover to Java services complete for `/users`, `/labs`, `/questions`, `/chat`, `/public/stats`, `/admin/metrics`; error handling normalized to RFC7807; contract tests prove the shapes.
- **G4** — Playwright e2e green against the **k3s in-runner** stack + **mock-OIDC** (mirroring `e2e-k3s.yml`).
- **G5** — New `frontend-ci.yml` (build + lint + Vitest + Playwright + Trivy/npm-audit) and an updated `frontend-build.yml` (image → ECR → rollout), mirroring the backend pipeline's gates.
- **G6** — Every phase independently revertable; documented rollback; no user-visible regression.

### 1.3 Non-goals
- Rewriting components to signals wholesale (opportunistic only; OnPush-`Eager` cleanup is a tracked backlog, not a blocker).
- Going zoneless in the same PR as the v21 upgrade (evaluated in Phase 3; opt-in only after Playwright is green).
- Migrating **feedback** (`feedback.dev.rosettacloud.app` + `/feedback/*`) to Java — **no Java feedback-service exists**; it stays on FastAPI via the strangler default route.
- Replacing the direct-to-Cognito auth (`@aws-sdk/...`) with Amplify/OIDC-code-flow — unchanged.
- Bumping RxJS to 8 (Angular 19–22 all support `~7.8`; deferred — see `retryWhen` note in §2.6).

### 1.4 Principles
1. **One major at a time**, `ng update` drives; never hand-edit versions ahead of the schematic.
2. **Green gate between every step** — build + unit + e2e + typecheck must pass before proceeding.
3. **Ground every change in a real file** — before/after snippets in this doc are from the actual sources.
4. **Server-side cutover first** — the VirtualService lets us move traffic without a frontend deploy; the frontend changes only where the *contract shape* differs.
5. **Additive, reversible commits** — feature-flag / canary the cutover; keep FastAPI reachable until each prefix is proven.
6. **Automate the migrations** — prefer `ng update` + `ng generate` schematics over manual edits; hand-fix only the residue.

---

## 2. Current-State Inventory (verified)

### 2.1 Toolchain & dependencies — `Frontend/package.json`
| Package | Version | Migration relevance |
|---|---|---|
| `@angular/*` (core, common, compiler, forms, router, platform-browser[-dynamic], compiler-cli) | `^19.2.0` | Bumped by `ng update` each phase |
| `@angular-devkit/build-angular` | `^19.2.6` | **Renamed → `@angular/build`** at v20 |
| `@angular/cli` | `^19.2.6` | Bumped each phase |
| `typescript` | `~5.7.2` | → ≥5.8 (v20), ≥5.9 (v21), ≥6.0 (v22) |
| `zone.js` | `~0.15.0` | Kept (zoned) until/unless zoneless (Phase 3) |
| `rxjs` | `~7.8.0` | Kept through v22 |
| `@xterm/xterm` `@xterm/addon-fit` `@xterm/addon-attach` | `^5.5.0 / ^0.10 / ^0.11` | Compat audit per step (§4.5) |
| `bootstrap` / `bootstrap-icons` / `@popperjs/core` / `@types/bootstrap` | `^5.3.6 / ^1.11.3 / ^2.11.8 / ^5.2.10` | JS bundle in `angular.json scripts[]`; audit per step |
| `@aws-sdk/client-cognito-identity-provider` | `^3.533.0` | Compat audit per step; `allowedCommonJsDependencies` note |
| **Test** | `karma ~6.4`, `karma-*`, `jasmine-core ~5.6`, `@types/jasmine ~5.1` | **Removed** at Vitest migration (v21) |
| `@types/node` | `^22.15.3` | Align to CI Node |

### 2.2 Builder & configs
- **Builder (build/serve/test):** `@angular-devkit/build-angular:{application,dev-server,karma}` — `angular.json`.
  - Build options: `browser: src/main.ts`, `polyfills: ["zone.js"]`, `tsConfig: tsconfig.app.json`, global styles include `bootstrap.min.css` + `bootstrap-icons.css`, scripts include `bootstrap.bundle.min.js`, `allowedCommonJsDependencies: ["google-protobuf"]`, assets from `public/`.
  - Configurations: `production` (budgets initial 2MB/5MB, anyComponentStyle 30kB/60kB, `outputHashing:all`), `development`/`uat`/`stg` (fileReplacements to `environment.*.ts`). `defaultConfiguration: production`.
  - **Output path** `dist/rosetta-cloud-frontend`; the Dockerfile copies `dist/rosetta-cloud-frontend/browser` → nginx. (application-builder `browser/` subdir — already correct.)
- **`tsconfig.json`:** `strict:true`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `isolatedModules`, `experimentalDecorators`, **`moduleResolution: "node"`**, `target: ES2022`, `module: ES2022`. `angularCompilerOptions.strictTemplates: true` (**already on**), `strictInjectionParameters`, `strictInputAccessModifiers`.
- **`tsconfig.app.json`:** `files:["src/main.ts"]`. **`tsconfig.spec.json`:** `types:["jasmine"]`, includes `src/**/*.spec.ts` (**changes to Vitest at v21**).

### 2.3 Bootstrap & DI — `src/main.ts`, `src/app/app.config.ts`
```ts
// app.config.ts (CURRENT)
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
```
`main.ts` → `bootstrapApplication(AppComponent, appConfig)`.

### 2.4 Routing — `src/app/app.routes.ts`
- Flat `Routes[]`, `component:`-based, **no lazy `loadComponent`**. Guards used as **class tokens**: `canActivate:[AuthGuard]`, `canActivate:[AuthGuard, AdminGuard]`.
- **Params:** `lab/module/:moduleUuid/lesson/:lessonUuid`; `compare/:slug`. **Route data:** `{ register: true }` on `/register`; `{ title, description }` on protected routes. **Wildcard:** `{ path: '**', redirectTo: '', pathMatch: 'full' }`.
- **v22 relevance:** `paramsInheritanceStrategy` default flips to `'always'` — audit `ActivatedRoute` param/data reads (login reads `queryParams.returnUrl`/`register`; lab reads `route.params`). Mitigation in §7.

### 2.5 Auth flow (verified end-to-end)
- **`services/user.service.ts`** owns Cognito: `SignUpCommand`, `ConfirmSignUpCommand`, `InitiateAuthCommand` (`USER_PASSWORD_AUTH`), `ForgotPasswordCommand`, `ConfirmForgotPasswordCommand`, `ResendConfirmationCodeCommand`. On login it stores `idToken`/`accessToken`/`refreshToken`/`userId`/`currentUser` in `localStorage`, decodes the JWT payload and reads **`custom:user_id` ?? `sub`**. `getAccessToken()` returns **`localStorage.idToken`** (the ID token, by design — carries `aud`=clientId for API-GW).
- **Functional interceptor** `src/app/interceptors/auth.interceptor.ts` (the one wired in): attaches `Authorization: Bearer <idToken>` **only when `req.url.startsWith(environment.apiUrl)`**.
- **Dead/legacy code (not wired):** `src/interceptors/auth.interceptor.ts` (class `AuthInterceptor`, reads `localStorage.auth_token`) and `src/interceptors/error.interceptor.ts` (class `ErrorInterceptor`, redirects on 401/403). **Neither is in `app.config.ts`.** → Cleanup candidate (§8.7); the 401/403 redirect behavior is currently **not active**.
- **Guards:** `AuthGuard` (`isLoggedIn()` = `!!idToken`; supports `route.data.requiredRole`), `AdminGuard` (`currentUser.role === 'admin'`). Both class-based `implements CanActivate`.
- **Java side is compatible:** every controller resolves identity from the JWT (`custom:user_id` ?? `sub`) — `CognitoJwtAuthenticationConverter`; resource server validates `issuer-uri` + `audience` (`aud`=Cognito client id). The ID token satisfies both. `SecurityProperties` public paths: `/health-check`, `/actuator/**`, `/public/**`, `/internal/**`.

### 2.6 Services & every API call (verified)
| Service (file) | Method | Call | Strangler prefix → Java target | Notes |
|---|---|---|---|---|
| UserService | `checkApiConnection` | `GET {apiUrl}/health-check` (text) | *(no prefix)* → FastAPI default | stays on fallback |
| UserService | `listUsers` | `GET /api/users?limit=` | ⚠ **relative `/api` — won't route**; fix to `{apiUrl}/users` → user-service `GET /users` (8081) | pre-existing bug (§8.6) |
| UserService | `register` | `POST {apiUrl}/users` | user-service `POST /users` (201) | body snake_case |
| UserService | `getUser` | `GET {apiUrl}/users/{id}` | user-service `GET /users/{userId}` | id from JWT server-side |
| UserService | `updateUser` | `PUT {apiUrl}/users/{id}` | user-service `PUT /users/{userId}` | |
| UserService | `deleteUser` | `DELETE {apiUrl}/users/{id}` | user-service `DELETE` (204) | |
| UserService | `getUserProgress` | `GET {apiUrl}/users/{id}/progress` (`module_uuid`,`lesson_uuid`) | user-service | returns `{progress}` |
| UserService | `updateUserProgress` | `POST {apiUrl}/users/{id}/progress/{m}/{l}/{q}` | user-service | |
| UserService | `getUserLabs` | `GET {apiUrl}/users/{id}/labs` | user-service `GET /users/{userId}/labs` → `{labs}` | |
| UserService | `linkLabToUser` | `POST {apiUrl}/users/{id}/labs/{labId}` | ⚠ **NO public handler** (internal-only) → 404 under Java | **remove — server-side now** (§8.5) |
| UserService | `unlinkLabFromUser` | `DELETE {apiUrl}/users/{id}/labs/{labId}` | ⚠ **NO public handler** → 404 under Java | **remove — server-side now** (§8.5) |
| LabService | `getLabQuota` | `GET {apiUrl}/users/{id}/lab-quota` | user-service `GET /users/{userId}/lab-quota` → `LabQuota` | |
| ChatbotService | `loadAiQuota` | `GET {apiUrl}/users/{id}/ai-quota` | user-service `GET /users/{userId}/ai-quota` → `AiQuota` | |
| LabService | `launchLab` | `POST {apiUrl}/labs` `{user_id}` | lab-service `POST /labs` (201) → `{lab_id}` | Java ignores body; uses JWT |
| LabService | `getLabInfo` | `GET {apiUrl}/labs/{labId}?user_id=` | lab-service `GET /labs/{labId}` | phantom → `{error}` 200 (handled) |
| LabService | `terminateLab` | `DELETE {apiUrl}/labs/{labId}?user_id=` | lab-service `DELETE /labs/{labId}` → `{deleted}` | |
| LabService | `getQuestions` | `GET {apiUrl}/questions/{m}/{l}?user_id=` | question-service `GET /questions/{m}/{l}` → `{questions,total_count}` | |
| LabService | `setupQuestion` | `POST {apiUrl}/questions/{m}/{l}/{q}/setup` `{pod_name}` | question-service | |
| LabService | `checkQuestion` | `POST {apiUrl}/questions/{m}/{l}/{q}/check` `{pod_name,...}` | question-service — **tracks progress server-side** | **double-write** with `updateUserProgress` (§8.5) |
| ChatbotService | `post` (all types) | `POST {chatbotApiUrl}` = `{apiUrl}/chat` | chat-service `POST /chat` → `{response,agent,session_id}` | quota error shape change (§8.3) |
| PublicMetricsService | `getStats` | `GET {apiUrl}/public/stats` | analytics-service `GET /public/stats` (public) → `PublicStats` | |
| (admin-metrics) | — | `GET {apiUrl}/admin/metrics` | analytics-service `GET /admin/metrics` (admin) → `AdminMetrics` | |
| FeedbackService | `requestFeedback` | `POST {feedbackApiUrl}/feedback/request` | *(diff host, no prefix)* → **FastAPI** | stays on FastAPI |
| FeedbackService | `pollForFeedback` | `GET {apiUrl}/feedback/{id}` | *(no prefix)* → **FastAPI** | stays on FastAPI |

Non-API services: `ThemeService` (`data-bs-theme` via `setAttribute`), `I18nService` (**signals**), `ScrollService`.

**RxJS note:** `lab.component.ts` imports `retryWhen` (deprecated in RxJS 7, removed in RxJS 8). Harmless on `~7.8`; flagged as debt if RxJS 8 is ever adopted.

### 2.7 Components (migration-sensitive)
- **`lab/lab.component.ts`** (~50KB): standalone; imports `CommonModule, FormsModule, FeedbackComponent, ChatbotComponent`; implements `OnInit, OnDestroy, AfterViewInit, HostListener`; constructor-DI incl. `DomSanitizer`, `ElementRef`. Uses `sanitizer.bypassSecurityTrustResourceUrl(url)` for the **code-server iframe** (→ v22 sanitization/SSRF audit). **Snap & Ask**: `navigator.mediaDevices.getDisplayMedia()` → `<canvas>` → `toDataURL('image/jpeg', 0.75)` → `chatbotSv.stagePendingImage()`. Many `document.*` **global** DOM calls (not the DI token). Manual `Subscription` management.
- **`chatbot/chatbot.component.ts`** (~18KB): standalone; **imports `HttpClientModule`** (deprecated — remove, `provideHttpClient` is used) alongside `CommonModule, FormsModule`; uses `ChangeDetectorRef` + `implements AfterViewChecked` + `@ViewChild` (manual CD — key input to OnPush/zoneless decision). Reads `aiQuota.messages_remaining` for `isQuotaExhausted`.
- **`login/login.component.ts`**: standalone; `ReactiveFormsModule`; three `FormGroup`s (login/register/verify) with a cross-field `checkPasswords` validator (→ optional Signal Forms candidate, Phase 3).
- **Change detection:** **no component declares `ChangeDetectionStrategy`** anywhere → all are `Default`. This is the crux of the **v22 OnPush-default** change (§7.4).
- **`data-*` audit:** only `admin-users.component.html` uses `[attr.data-initials]` — these are **attribute** bindings, **not** input bindings → **unaffected** by v22 `data-*` change. ✅

### 2.8 Environments — `src/environments/*`
- `environment.ts` (prod, `production:true`) & `environment.development.ts`: `apiUrl:'https://api.dev.rosettacloud.app'`, `feedbackApiUrl:'https://feedback.dev.rosettacloud.app'`, `chatbotApiUrl:'https://api.dev.rosettacloud.app/chat'`, `labDefaultTimeout`, `pollingInterval`, `cognito:{userPoolId,userPoolClientId,region}`.
- `environment.uat.ts` / `environment.stg.ts`: **only** `cognito{}` (missing `apiUrl` etc.) — incomplete; will break `uat`/`stg` builds if those configs are used. Flagged (§8.4 / §11 risk).

### 2.9 Baseline test reality
- Specs are default schematics (creation checks). **`app.component.spec.ts` has a guaranteed-failing test**: it asserts an `<h1>` contains `Hello, RosettaCloud-Frontend`, but `app.component.html` renders no such heading → baseline is **red**. Must be fixed/removed in Phase 0 to establish a green baseline.
- `lab.component.spec.ts` bootstraps the full `LabComponent` (iframe, `getDisplayMedia`, many injected services) → unreliable under jsdom; will need proper mocking under Vitest (§9).

### 2.10 Packaging & CI (current)
- **`Frontend/Dockerfile`**: `node:24-alpine` → `npm install --legacy-peer-deps --unsafe-perm --force` + global `@angular/cli` → `ng build --configuration=production` → nginx serving `dist/rosetta-cloud-frontend/browser`. (`--force` masks peer-dep breaks — tighten in §10.)
- **`.github/workflows/frontend-build.yml`**: manual/`push` on `Frontend/**` → build `linux/amd64` image → ECR `rosettacloud-frontend` → `kubectl rollout restart deploy/rosettacloud-frontend -n dev` on EKS. **No test/lint/scan gate.**
- Backend reference pipelines to mirror: `backend-java-deploy.yml` (test-gate → ECR → **k3s-in-runner** deploy + smoke), `e2e-k3s.yml` (k3s + LocalStack + **mock-OIDC** :8080 + services 8081-8085 + k6), `security.yml` (Trivy fs vuln/secret/misconfig gate + Semgrep).

---

## 3. Target-State Architecture

### 3.1 Angular 22 target
- **Builder:** `@angular/build:{application,dev-server,unit-test}` (esbuild/Vite). Webpack fully retired (already not used).
- **Test:** **Vitest** (via `@angular/build:unit-test` / `ng test`), jsdom or happy-dom env, V8 coverage. Karma/Jasmine removed.
- **Change detection:** remain **zoned** with `provideZoneChangeDetection({ eventCoalescing:true })` through the upgrade; **OnPush becomes the default** at v22 — auto-migration annotates existing components to preserve `Default` behavior (tracked as an OnPush cleanup backlog). **Zoneless** is a *post-22* opt-in (evaluated in §7.6), gated on Playwright.
- **Signals/modern APIs (opportunistic, not required):** `httpResource()` for simple GETs (`PublicMetricsService`, profile reads); **Signal Forms** for `login.component`; `takeUntilDestroyed()` to replace manual `Subscription` teardown; `inject()` over constructor DI in new/edited code.
- **TypeScript:** ≥6.0; `moduleResolution:"bundler"`; `strictTemplates:true` (already), host-binding type-checking on (v21+).
- **Node:** ≥ 22.22.3 or ≥ 24.15.0 (Dockerfile `node:24-alpine` must resolve to ≥24.15.0; pin — §10).

### 3.2 API architecture (post-cutover)
- Browser → CloudFront → API Gateway (JWT authorizer, Cognito) → ALB → Istio Gateway → **`rosettacloud-backend-strangler` VirtualService** (`DevSecOps/K8S/strangler-virtualservice.yaml`):
  - `/users` → `user-service:8081`
  - `/labs` → `lab-service:8082`
  - `/questions` → `question-service:8083`
  - `/chat` → `chat-service:8084`
  - `/admin/metrics`, `/public/stats` → `analytics-service:8085`
  - **default** → `rosettacloud-backend-service:80` (FastAPI) — keeps `/health-check`, `/feedback/*`, and anything unmigrated working.
- **Contract deltas the browser must handle:**
  1. **Errors = RFC7807** `application/problem+json`: `{type,title,status,detail,instance, code?, payload?, errors?}` (from `GlobalExceptionHandler`). `detail` is a **string**; machine code is top-level **`code`**; structured data is top-level **`payload`**. (FastAPI used `{detail:{...}}`.)
  2. **JSON is snake_case** (`spring.jackson.property-naming-strategy: SNAKE_CASE`, `default-property-inclusion: non_null`) — already what the frontend sends/expects.
  3. **Identity from JWT** — path `{userId}`/`?user_id=`/`{user_id}` bodies are ignored server-side (harmless to keep).
  4. **Lab link/unlink + question-progress are server-side** now (lab-service/question-service call user-service `/internal/**`).
- **Transparency:** because routing is path-based on the **same host**, `environment.apiUrl` is **unchanged**; the cutover ships as a VirtualService edit + a small set of error-handling/redundant-call frontend fixes.

### 3.3 Testing architecture (target)
- **Unit/component:** Vitest + `@angular/build:unit-test`, `HttpTestingController` for services, `TestBed` component tests with mocked services; coverage gate (start at baseline, ratchet).
- **Contract:** Vitest suites asserting **RFC7807** + snake_case shapes for each Java endpoint (fixtures captured from the k3s stack).
- **E2E:** Playwright against the **k3s in-runner** stack + **mock-OIDC** (reuse `Backend-Java/e2e/k8s/e2e-stack.yaml` topology), covering login→dashboard→lab→chat→admin.
- **CI:** `frontend-ci.yml` (lint, unit+coverage, contract, Playwright, Trivy image scan, `npm audit`, dependency review) + hardened `frontend-build.yml`.

---

## 4. Phase 0 — Pre-flight (no version bumps yet)

**Objective:** establish a *green, reproducible baseline* and remove known blockers before any `ng update`.

### 4.0 Exit criteria
- `npm ci` reproducible; `ng build` (prod) green; `ng test --watch=false` **green** (after 4.3 fix); baseline coverage recorded; CI Node matrix pinned; branch + rollback documented; third-party compat matrix filled.

### 4.1 Branch, freeze, rollback
```bash
git checkout -b ng-upgrade/baseline
git tag pre-ng-upgrade-baseline            # immutable rollback anchor
git rev-parse HEAD > Frontend/.upgrade-baseline-sha
# Capture the exact resolved tree for rollback:
cp Frontend/package-lock.json Frontend/package-lock.baseline.json
```
Rollback at any later phase = `git revert` the phase PR (preferred) or `git reset --hard pre-ng-upgrade-baseline` on a hotfix branch. The Docker image is rebuilt from source, so `kubectl rollout undo deployment/rosettacloud-frontend -n dev` restores the previously-serving image instantly (image-level rollback, independent of git).

### 4.2 Pin Node/npm & CI matrix
- Angular 20 floor **Node ≥ 20.11.1**, TS ≥ 5.8; v22 floor **Node ≥ 22.22.3 or ≥ 24.15.0**, TS ≥ 6.0. Standardize on **Node 22 LTS** now (satisfies 20/21) and move to a v22-valid line before the v22 PR.
- Add `Frontend/.nvmrc`:
  ```
  22.22.3
  ```
- Add `engines` to `package.json`:
  ```jsonc
  "engines": { "node": ">=20.11.1", "npm": ">=10.5.0" }
  ```
- CI (see §10) uses a matrix `node: [20.11.1, 22.22.3]` during the upgrade window to catch floor breaks early.

### 4.3 Fix the red baseline (blocker)
`app.component.spec.ts` asserts a non-existent `<h1>`. Make the baseline green:
```ts
// app.component.spec.ts — BEFORE (fails: no such h1)
it('should render title', () => {
  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;
  expect(compiled.querySelector('h1')?.textContent).toContain('Hello, RosettaCloud-Frontend');
});
```
```ts
// AFTER — assert what the component actually exposes
it('should have the RosettaCloud-Frontend title', () => {
  const fixture = TestBed.createComponent(AppComponent);
  expect(fixture.componentInstance.title).toEqual('RosettaCloud-Frontend');
});
```
> `AppComponent` injects `ThemeService`, `Router`, `I18nService`; `TestBed` needs router + HttpClient testing providers. Add `provideRouter([])` (or `RouterTestingModule`) to the spec's `configureTestingModule` so the constructor's `router.events` subscription resolves.

### 4.4 Baseline metrics to record (attach to the PR)
```bash
cd Frontend
npm ci
npx ng version                       # record CLI/core/toolchain
npx ng build --configuration=production   # record bundle sizes vs budgets
npx ng test --watch=false --code-coverage # record baseline coverage %
npx tsc -p tsconfig.app.json --noEmit     # clean typecheck
```
Record: prod bundle sizes (vs 2MB/5MB budgets), per-file coverage, any deprecation warnings. These are the regression yardstick for every subsequent phase.

### 4.5 Third-party compatibility audit (repeat the check at each Angular step)
| Dependency | Angular-peer risk | Check per step | Action |
|---|---|---|---|
| `@xterm/xterm` 5.5 + addons | Framework-agnostic (DOM only) | `npm ls @xterm/*`; lab terminal smoke | Independent of Angular; bump only for its own CVEs |
| `bootstrap` 5.3 (+icons, popper) | Loaded as global CSS/JS via `angular.json` | prod build + visual smoke | No Angular peer; keep |
| `@aws-sdk/client-cognito-identity-provider` 3.x | CommonJS interop / esbuild optimizer | build warnings; login/register/verify flow | If esbuild flags CJS, add to `allowedCommonJsDependencies`; keep pinned |
| `rxjs ~7.8` | Angular 19–22 all accept 7.8 | `npm ls rxjs` after each `ng update` | Keep 7.8; do **not** jump to 8 (removes `retryWhen` used in lab) |
| `@popperjs/core` 2.11 | Bootstrap dep | build | keep |
| `zone.js ~0.15` | Bumped by `ng update` | `npm ls zone.js` | Let schematic set the version |

### 4.6 Snapshot API contract fixtures (feeds Phase 4 contract tests)
Before touching Angular, capture **current FastAPI** responses and, from the k3s stack, **Java** responses for the same routes (success + error). Store under `Frontend/src/testing/fixtures/{fastapi,java}/`. These prove the RFC7807/snake_case deltas empirically instead of by assumption.

---

## 5. Phase 1 — Angular 19 → 20

**Theme:** package rename to `@angular/build`, TS 5.8, `moduleResolution: bundler`, and verify-only for the v20 code migrations that don't apply here.

### 5.1 Run the update
```bash
cd Frontend
git checkout -b ng-upgrade/v20
# Drives package bumps + runs all v20 migration schematics:
npx ng update @angular/core@20 @angular/cli@20
# If build-angular isn't auto-renamed, it is handled by the CLI migration; verify in package.json (5.3).
```
Commit the schematic output separately from hand edits.

### 5.2 v20 breaking-change checklist (applicability against THIS repo)
| v20 change | Applies here? | Action |
|---|---|---|
| `afterRender` → `afterEveryRender` | **No** (0 usages) | verify-only: `grep -rn "afterRender\|afterNextRender" src` = empty |
| `TestBed.get` → `TestBed.inject` | **No** (already `inject`) | verify-only |
| Remove `InjectFlags` | **No** (0 usages) | verify-only |
| `DOCUMENT` moves `@angular/common` → `@angular/core` | **No** (no DI-token import; only global `document`) | verify-only; if any import appears, update source module |
| `@angular-devkit/build-angular` → `@angular/build` | **Yes** (rename) | §5.3 |
| Vitest recommended | Defer to v21 | see §6 |
| Node ≥ 20.11.1 | **Yes** | done in §4.2 |
| TS ≥ 5.8 | **Yes** | §5.4 |
| `moduleResolution: "bundler"` | **Yes** | §5.4 |

### 5.3 Builder migration (package rename — NOT a Webpack port)
The `ng update` CLI migration rewrites the builder strings; confirm the result:
```jsonc
// angular.json — AFTER (verify these three)
"build": { "builder": "@angular/build:application", ... },      // was @angular-devkit/build-angular:application
"serve": { "builder": "@angular/build:dev-server", ... },        // was :dev-server
"test":  { "builder": "@angular/build:karma", ... }              // was :karma (becomes :unit-test at v21)
```
```jsonc
// package.json devDependencies — AFTER
// remove: "@angular-devkit/build-angular": "^19.2.6"
"@angular/build": "^20.0.0",
"@angular/cli": "^20.0.0",
"@angular/compiler-cli": "^20.0.0"
```
Everything else in the `build` options block (`browser`, `polyfills:["zone.js"]`, `styles`, `scripts`, `assets`, `allowedCommonJsDependencies`, budgets, `fileReplacements`) is **unchanged** — the application builder already owns them. **Dockerfile output path `dist/rosetta-cloud-frontend/browser` is unchanged.**

### 5.4 tsconfig updates
```jsonc
// tsconfig.json — BEFORE → AFTER
"moduleResolution": "node"      // → "bundler"
"target": "ES2022"              // keep (or "ES2023"); module stays "ES2022"/"preserve" per schematic
```
```jsonc
// package.json
"typescript": "~5.8.0"   // was ~5.7.2
```
> With `moduleResolution:"bundler"` ensure no code relies on Node's classic resolution quirks; our imports are all path/relative or bare package specifiers — safe.

### 5.5 Verification gate (must all pass before Phase 2)
```bash
npx ng version                              # core/cli/build = 20.x
npx tsc -p tsconfig.app.json --noEmit       # TS 5.8 clean
npx ng build --configuration=production     # green; bundle sizes ≤ baseline+5%
npx ng test --watch=false                   # green (still Karma at this point)
npx ng serve  # manual smoke: login → dashboard → lab (iframe+xterm) → chat → Snap&Ask → admin
grep -rn "afterRender\|afterNextRender\|InjectFlags\|TestBed.get" src   # empty
```
**Gate:** build+test green, no new deprecation warnings from our code, manual smoke of all 5 flows OK, bundles within budget. Tag `v20-green`.

---

## 6. Phase 2 — Angular 20 → 21 (Karma → Vitest, host-binding typecheck)

**Theme:** the test-runner migration is the headline. Zone strategy stays as-is. TS ≥ 5.9.

### 6.1 Run the update
```bash
cd Frontend
git checkout -b ng-upgrade/v21
npx ng update @angular/core@21 @angular/cli@21 @angular/build@21
```

### 6.2 v21 breaking-change checklist
| v21 change | Applies here? | Action |
|---|---|---|
| Karma → Vitest (`ng generate @angular/core:karma-to-vitest`) | **Yes** | §6.3 |
| zone.js opt-out / add `provideZoneChangeDetection()` | **Already present** | verify-only (keep zoned) |
| Remove `@Component` `interpolation`/`moduleId` | **No** (0 usages) | verify-only |
| `ApplicationConfig` moves to `@angular/core` | **Already imported from core** | verify-only |
| TS ≥ 5.9 | **Yes** | bump `typescript` to `~5.9.0` |
| Host-binding type-checking ON | **Yes — audit** | §6.4 |

### 6.3 Karma → Vitest migration (headline)
```bash
# Official schematic rewrites config, test setup, and package wiring:
npx ng generate @angular/core:karma-to-vitest
```
Then finish the residue by hand:
```jsonc
// angular.json — test target AFTER
"test": {
  "builder": "@angular/build:unit-test",
  "options": {
    "tsConfig": "tsconfig.spec.json",
    "buildTarget": "::development",
    "runner": "vitest"
  }
}
```
```jsonc
// package.json — remove Karma/Jasmine, add Vitest stack
// REMOVE: karma, karma-chrome-launcher, karma-coverage, karma-jasmine,
//         karma-jasmine-html-reporter, jasmine-core, @types/jasmine
"devDependencies": {
  "vitest": "^3.0.0",
  "@vitest/coverage-v8": "^3.0.0",
  "jsdom": "^25.0.0"      // or happy-dom
}
```
```jsonc
// tsconfig.spec.json — BEFORE → AFTER
"types": ["jasmine"]     // → ["vitest/globals", "node"]
```
**Spec API deltas (Jasmine → Vitest):**
```ts
// BEFORE (Jasmine)                       // AFTER (Vitest)
jasmine.createSpyObj('LabService',['x'])  // vi.fn() / { x: vi.fn() }
spyOn(obj,'m').and.returnValue(v)          // vi.spyOn(obj,'m').mockReturnValue(v)
jasmine.objectContaining({...})            // expect.objectContaining({...})
// describe/it/expect/beforeEach are global via vitest/globals (config: globals:true)
```
Our specs are creation-only + the fixed `app.component.spec.ts`, so the surface is small. Add `src/test-setup.ts` (Angular TestBed init) referenced by the Vitest config. Delete `karma.conf.js` if present. Re-baseline coverage under V8.

> **`lab.component.spec.ts`**: it bootstraps the real component (iframe, `getDisplayMedia`, 7 injected services). Under Vitest/jsdom this must mock `LabService/UserService/ChatbotService/ThemeService`, stub `navigator.mediaDevices`, and provide `provideRouter([])` + `HttpTestingController`. Convert it to a shallow render or split into service-level specs (§9.2).

### 6.4 Host-binding type-checking audit (now enforced)
`navbar.component.ts` uses `@HostListener('document:keydown.escape', ['$event'])`; other components use `@HostBinding`/`@HostListener`. Build with the stricter templates and fix any newly-surfaced type errors (e.g., untyped `$event`, missing return types). Command:
```bash
npx ng build --configuration=production   # host-binding type errors now fail the build
```

### 6.5 Zoneless decision (defer)
Keep `provideZoneChangeDetection({ eventCoalescing:true })`. **Do not** go zoneless yet: `chatbot.component.ts` relies on `ChangeDetectorRef` + `AfterViewChecked`, and `lab.component.ts` binds `mousemove/mouseup` on `document` expecting zone-driven CD (see its own comment "zone.js-patched → triggers CD"). Zoneless is revisited in §7.6 after OnPush cleanup and Playwright coverage exist.

### 6.6 Verification gate
```bash
npx ng version                      # 21.x
npx ng test --watch=false           # Vitest green; coverage ≥ re-baselined floor
npx ng build --configuration=production
npx tsc -p tsconfig.app.json --noEmit
# manual smoke of all 5 flows
```
**Gate:** Vitest green + coverage recorded, build green (host-binding types clean), smoke OK. Tag `v21-green`.

---

## 7. Phase 3 — Angular 21 → 22 (OnPush default, param inheritance, sanitization)

**Theme:** the biggest *semantic* jump. OnPush becomes default; `paramsInheritanceStrategy` flips; sanitization/SSRF hardening. TS ≥ 6.0, Node ≥ 22.22.3/24.15.0.

### 7.1 Pre-req & run
```bash
# Ensure Node ≥ 22.22.3 (or ≥ 24.15.0) locally & in CI FIRST:
node -v
cd Frontend && git checkout -b ng-upgrade/v22
npx ng update @angular/core@22 @angular/cli@22 @angular/build@22
# bump typescript to ~6.0 (schematic usually does this):
```
```jsonc
// package.json
"typescript": "~6.0.0"
```

### 7.2 v22 breaking-change checklist
| v22 change | Applies here? | Action |
|---|---|---|
| Node ≥ 22.22.3 / ≥ 24.15.0 | **Yes** | §4.2 + Dockerfile pin (§10) |
| TS ≥ 6.0 | **Yes** | bump |
| **OnPush is default** (auto-migration adds `ChangeDetectionStrategy.Eager`) | **Yes — all components** | §7.4 |
| `paramsInheritanceStrategy` default → `'always'` (**breaking**) | **Yes — audit** | §7.5 |
| `strictTemplates` default true | **Already true** | verify-only |
| `data-*` no longer binds to inputs | **No** (only `[attr.data-*]`) | verify-only |
| Webpack builders deprecated | **N/A** (on `@angular/build`) | — |
| Sanitization/SSRF hardening; TransferCache skips credentialed requests | **Audit** (iframe `bypassSecurityTrustResourceUrl`); TransferCache N/A (no SSR) | §7.7 |
| Signal Forms stable / `httpResource` stable / `@Service`+`injectAsync` / WebMCP | **Opportunity/None** | §7.8 |

### 7.3 Run the OnPush auto-migration
The v22 update includes a migration that annotates existing components so their behavior is preserved. Let it run, then review the diff: components that were implicitly `Default` get an explicit **`changeDetection: ChangeDetectionStrategy.Eager`** (the compatibility shim).
```ts
// e.g. chatbot.component.ts — AFTER auto-migration (behavior preserved)
@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule], // HttpClientModule → remove in §7.8 cleanup
  changeDetection: ChangeDetectionStrategy.Eager,          // shim added by migration
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.scss'],
})
```

### 7.4 OnPush/`Eager` cleanup backlog (post-upgrade, not a blocker)
`Eager` = "keep the old always-check behavior". Track a backlog to migrate components to true OnPush, prioritized by risk:
- **Low effort / high value:** presentational components (footer, navbar, pricing, features, about, etc.) → drop `Eager`, adopt OnPush; verify no template relies on mutation-in-place.
- **Careful:** `chatbot.component.ts` — it mutates `messages: ChatMessage[]` and uses `AfterViewChecked` + manual `cdr`. To go OnPush: subscribe to `messagesSubject` with immutable updates (already `[...current, message]` in the service) and call `cdr.markForCheck()` on emissions; drop `AfterViewChecked` scroll hack in favor of `afterEveryRender` or explicit `markForCheck`.
- **Careful:** `lab.component.ts` — heavy stateful timers/polling; keep `Eager` until it is refactored to signals/`toSignal` (largest single item; can be its own follow-up epic).
Acceptance: reduce `Eager` count to 0 over time; each conversion ships with a component test.

### 7.5 `paramsInheritanceStrategy` audit (breaking)
Default flips to `'always'`, changing what a route sees for **inherited** params/data. Audit the readers:
- `login.component.ts`: `route.snapshot.queryParams['returnUrl'|'register']` + `route.data` — query/data are not affected the same way, but verify `register` still resolves for both `/login?register=` and the `/register` data route.
- `lab.component.ts`: reads `route.params` for `moduleUuid`/`lessonUuid` — flat route, low risk, but verify.
**Safe mitigation** (preserve old behavior explicitly) if any regression appears:
```ts
// app.config.ts
import { provideRouter, withRouterConfig } from '@angular/router';
provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly' })),
```
Verify via a router param unit test (§9) and the lab Playwright flow.

### 7.6 Zoneless — evaluate, opt-in only if green
After §7.4 reduces manual-CD reliance, prototype:
```ts
// app.config.ts (experiment on a branch)
import { provideZonelessChangeDetection } from '@angular/core';
providers: [ provideZonelessChangeDetection(), /* remove provideZoneChangeDetection + "zone.js" polyfill */ ]
```
Ship zoneless **only** if the full Playwright suite (login, lab timers/polling, chat streaming, Snap&Ask, admin) is green. Otherwise stay zoned — fully supported in v22.

### 7.7 Sanitization / SSRF hardening audit
`lab.component.ts` builds the code-server iframe URL with `sanitizer.bypassSecurityTrustResourceUrl(url)` where `url` comes from `LabInfoResponse.url` (server-provided `https://<lab-id>.labs.dev.rosettacloud.app`). Under v22 hardening:
- Confirm the iframe still loads (trusted resource URL bypass is explicit and remains valid).
- Add a defensive allowlist check (only bypass hostnames matching `*.labs.dev.rosettacloud.app`) to satisfy SSRF-hardening review.
- **TransferCache:** N/A (no SSR/hydration in this app) — note and move on.

### 7.8 Opportunistic modernization (optional, post-gate)
- **Remove `HttpClientModule`** import from `chatbot.component.ts` (deprecated; `provideHttpClient` already provides it).
- **`httpResource()`** for `PublicMetricsService.getStats()` and read-only profile fetches.
- **Signal Forms** for `login.component.ts` (login/register/verify) once patterns are proven.
- Replace manual `Subscription` teardown with `takeUntilDestroyed()`.
These are **not** gate items; schedule as follow-ups with their own tests.

### 7.9 Verification gate
```bash
npx ng version                     # 22.x ; tsc 6.x ; node ≥ 22.22.3/24.15.0
npx ng build --configuration=production
npx ng test --watch=false          # Vitest green
# Playwright full suite (see §9.3) MUST be green here
grep -rn "ChangeDetectionStrategy.Eager" src | wc -l   # record backlog size
```
**Gate:** build+unit+**Playwright** green, param-inheritance verified, iframe/Snap&Ask smoke OK, `Eager` backlog counted & ticketed. Tag `v22-green`.

---

## 8. Phase 4 — FastAPI → Java Microservices Cutover

**Theme:** mostly server-side (VirtualService). Frontend changes are limited to **error-shape (RFC7807)** handling and **removing calls that are now server-side or mis-routed**. `environment.apiUrl` is **unchanged** (same host, path-based strangler).

### 8.1 Cutover sequencing (per prefix, low→high blast radius)
Move one prefix at a time; verify; keep FastAPI reachable as fallback until each is stable.
1. `/public/stats` (unauthenticated, read-only) → analytics-service
2. `/questions` (read + setup/check) → question-service
3. `/labs` (create/info/terminate) → lab-service
4. `/users` (+ nested progress/labs/quota) → user-service
5. `/chat` → chat-service
6. `/admin/metrics` → analytics-service
The `strangler-virtualservice.yaml` already encodes all of these; cutover = apply the prefix's `match` block; **rollback = remove that block** so the default route sends the prefix back to FastAPI.

### 8.2 RFC7807 error contract — the one real shape change
Java `GlobalExceptionHandler` returns `application/problem+json`:
```json
// Java ProblemDetail (snake_case Jackson; non-null inclusion)
{ "type":"about:blank", "title":"Forbidden", "status":403,
  "detail":"Weekly AI message quota exhausted.",
  "code":"AI_QUOTA_EXHAUSTED",
  "payload": { "messages_used":50,"messages_remaining":0,"messages_limit":50,"week_resets_at":1750000000 } }
```
vs the FastAPI shape the frontend was written for: `{ "detail": { "code":"AI_QUOTA_EXHAUSTED", "quota":{...}, "message":"..." } }`.

**Key facts:**
- `detail` is now a **string** (human message), not an object.
- Machine code is top-level **`code`**; structured data is top-level **`payload`**.
- Validation errors: `code:"VALIDATION_ERROR"` + `errors:{field:msg}`.
- Angular parses `application/problem+json` as JSON (contains `json`), so `HttpErrorResponse.error` is the parsed ProblemDetail object.
- **Lucky compatibility:** `user.service.ts` and `lab.service.ts` `handleError` read `error.error.detail || error.error.message` — since ProblemDetail has a string `detail`, these **still yield the human message**. Only the **structured** reads break.

### 8.3 `handleError` / quota refactor (grounded before/after)

Add a shared typed contract + normalizer (`src/app/core/problem-detail.ts`):
```ts
export interface ProblemDetail {
  type?: string; title?: string; status?: number; instance?: string;
  detail?: string;                    // human message (string)
  code?: string;                      // machine code (was FastAPI detail.code)
  payload?: unknown;                  // structured data (was FastAPI detail.quota / .* )
  errors?: Record<string, string>;    // field validation errors
}
export function problemMessage(err: unknown): string {
  const e = err as { error?: ProblemDetail | string; status?: number; statusText?: string };
  const p = e?.error;
  if (p && typeof p === 'object') {
    if (p.errors) return Object.values(p.errors).join('; ');
    return p.detail ?? p.title ?? `Error ${e.status}: ${e.statusText}`;
  }
  return `Error ${e?.status}: ${e?.statusText}`;
}
export function problemCode(err: unknown): string | undefined {
  const p = (err as { error?: ProblemDetail })?.error;
  return p && typeof p === 'object' ? p.code : undefined;
}
```

**`chatbot.service.ts` — the AI-quota path (the only hard break):**
```ts
// BEFORE (FastAPI nested detail)
error: (err) => {
  if (err.status === 403 && err.error?.detail?.code === 'AI_QUOTA_EXHAUSTED') {
    const quota: AiQuota = err.error.detail.quota;
    this.aiQuotaSubject.next(quota);
    this.addMessage({ role:'error',
      content:`You've used all ${quota.messages_limit} free AI messages ...`, timestamp:new Date() });
  } else { /* generic */ }
  ...
}
```
```ts
// AFTER (RFC7807: top-level code + payload)
import { problemCode, problemMessage, ProblemDetail } from '../core/problem-detail';
error: (err) => {
  const pd = err.error as ProblemDetail | undefined;
  if (err.status === 403 && problemCode(err) === 'AI_QUOTA_EXHAUSTED') {
    const quota = pd?.payload as AiQuota;         // was err.error.detail.quota
    this.aiQuotaSubject.next(quota);
    this.addMessage({ role:'error',
      content:`You've used all ${quota.messages_limit} free AI messages for this week. `
            + `Your quota resets on ${new Date(quota.week_resets_at * 1000).toLocaleDateString()}.`,
      timestamp:new Date() });
  } else {
    this.addMessage({ role:'error', content:`Agent error: ${problemMessage(err)}`, timestamp:new Date() });
  }
  this.loadingSubject.next(false);
}
```
Apply the same `payload`/`code` pattern to the **lab quota** 403 (`LAB_QUOTA_EXHAUSTED`, `payload:{minutes_remaining}`) surfaced by `lab-service` on `POST /labs` (currently `LabService.launchLab` only runs `handleError`; add explicit handling in `lab.component.ts` where launch errors are shown).

**`user.service.ts` / `lab.service.ts` `handleError`:** keep working but make intent explicit and drop the FastAPI-only `.message` assumption:
```ts
// user.service.ts handleError — AFTER
private handleError = (error: HttpErrorResponse) => {
  const msg = problemMessage(error);          // reads ProblemDetail.detail/title/errors
  console.error('API Error:', error);
  return throwError(() => new Error(msg));
};
```

### 8.4 `environment.ts` changes (minimal)
- **`apiUrl` unchanged** (`https://api.dev.rosettacloud.app`) — strangler is server-side.
- Add a **cutover feature flag** block to allow instant client-side fallback toggling during canary and to complete the incomplete `uat/stg` files:
```ts
// environment.ts (add)
apiFlags: { useJavaProblemDetails: true },   // toggles RFC7807-vs-FastAPI parsing during dual-run
```
- **Fix `environment.uat.ts` / `environment.stg.ts`** (currently only contain `cognito{}`) to include `apiUrl`, `feedbackApiUrl`, `chatbotApiUrl`, timeouts — otherwise `--configuration uat|stg` builds fail at runtime. (Pre-existing gap; fix here or in Phase 0.)

### 8.5 Remove now-server-side / redundant calls (verified against Java)
- **`UserService.linkLabToUser` / `unlinkLabFromUser`** (`POST/DELETE /users/{id}/labs/{labId}`): **no public handler** on `UserController` (only `InternalUserController` `/internal/users/{userId}/labs/{labId}`, not routed publicly). `lab-service.LabService.launch()` already calls `userClient.setActiveLab()` + `userClient.linkLab()`, and `terminate()` calls `unlinkLab()`. → **Remove both frontend methods and their call sites**; lab linking is authoritative server-side.
- **`LabService.checkQuestion` double-write:** `question-service.QuestionController.check` already calls `progressClient.trackProgress(...)` server-side on success. The frontend then also calls `userService.updateUserProgress(...)`. → **Remove the client-side `updateUserProgress` in the `check` success path** (keep local UI state update) to avoid a redundant/racy write. Verify progress via `GET /users/{id}/progress`.

### 8.6 Fix mis-routed `listUsers` (pre-existing bug)
```ts
// user.service.ts — BEFORE (relative, "/api" prefix — never hits apiUrl or strangler /users)
listUsers(limit: number): Observable<any> { return this.http.get<any>(`/api/users?limit=${limit}`); }
// AFTER (routes via strangler /users → user-service GET /users → {users,count,last_key})
listUsers(limit = 100): Observable<UserList> {
  return this.http.get<UserList>(`${this.apiUrl}/users?limit=${limit}`).pipe(catchError(this.handleError));
}
```
> Note: `authInterceptor` only attaches the token when `req.url.startsWith(environment.apiUrl)`. The old relative `/api/users` URL **also** missed the token; the fix restores auth too.

### 8.7 Auth interceptor validation (no code change expected)
- Java resource server validates `issuer-uri` (`COGNITO_ISSUER_URL`) + `audience` (`COGNITO_CLIENT_ID` == token `aud`). The frontend sends the **ID token** (`aud`=clientId) → satisfies both. ✅
- `authInterceptor` attaches `Bearer <idToken>` for all `api.dev.rosettacloud.app` paths → covers every Java service (path-routed). ✅
- **Contract-test the token acceptance** on the k3s stack via **mock-OIDC** (issues tokens accepted by the services): confirm 200 on a protected route with the mock token and 401 without.
- **Optional hardening (now that Java enforces 401/403):** wire the dormant `error.interceptor.ts` into `app.config.ts` so a 401 clears tokens and routes to `/login`:
```ts
provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
```
(Convert `ErrorInterceptor` class → functional `errorInterceptor` to match the functional pattern.) Ship as a small, separately-tested change.

### 8.8 snake_case verification (mostly already aligned)
| Payload | Java (snake_case) | Frontend | Status |
|---|---|---|---|
| `ChatRequest` | `user_id,session_id,module_uuid,lesson_uuid,type,question_number,result,image,message` | sends exactly these | ✅ |
| `ChatResponse` | `{response,agent,session_id}` | reads `response,agent` | ✅ |
| `QuestionRequest` | `{pod_name}` | sends `pod_name` | ✅ |
| `AiQuota` | `messages_used,messages_remaining,messages_limit,week_resets_at` | matches interface | ✅ |
| `PublicStats` | `labs_launched,questions_answered,ai_messages,total_users_seen` | matches interface | ✅ |
| `UserResponse` | `user_id,email,name,role,created_at,updated_at,metadata` | matches `User` | ✅ |
| `LabInfo` | `lab_id,pod_ip,hostname,url,time_remaining,status,pod_name` | matches `LabInfoResponse` | ✅ |
No client-side renames required; contract tests lock this in.

### 8.9 Strangler dual-run / canary & rollback
- **Dual-run:** deploy Java services alongside FastAPI; flip one `match` prefix at a time in the VirtualService. Because it's Istio routing, use **weighted** destinations for a canary:
```yaml
# example: 10% of /questions to Java, 90% to FastAPI during bake
- match: [{ uri: { prefix: /questions } }]
  route:
    - destination: { host: question-service.dev.svc.cluster.local, port: { number: 8083 } }
      weight: 10
    - destination: { host: rosettacloud-backend-service.dev.svc.cluster.local, port: { number: 80 } }
      weight: 90
```
- **Client flag:** `environment.apiFlags.useJavaProblemDetails` lets the SPA parse both shapes during the bake (the `problemMessage`/`problemCode` helpers already tolerate both: FastAPI `{detail}` string vs object is handled by the type guards).
- **Rollback:** set weight back to 0 / delete the Java `match` block → prefix returns to FastAPI within seconds, no frontend deploy.
- **Observability:** watch per-prefix 4xx/5xx and latency (Istio telemetry) + browser error events during each bake.

### 8.10 Contract tests (see §9.4 for placement)
For each endpoint: assert **status, snake_case body keys, and RFC7807 error shape** against fixtures captured from the k3s stack (§4.6). The AI-quota 403 and lab-quota 403 get dedicated cases proving `code`/`payload` parsing.

---

## 9. Frontend Testing Strategy

**Pyramid:** many Vitest unit/component tests → a focused contract-test layer (RFC7807/snake_case) → a thin Playwright e2e layer against the real k3s stack. Introduce Vitest at Phase 2; grow coverage continuously; Playwright gates Phase 3 & the cutover.

### 9.1 Targets & priorities
| Area | Kind | Priority | Why |
|---|---|---|---|
| `UserService` (auth + CRUD + progress) | unit (HttpTestingController + Cognito mock) | P0 | auth is the highest-risk flow |
| `ChatbotService` (quota 403, message add, image) | unit | P0 | the RFC7807 break lives here |
| `LabService` (launch/info/terminate/questions, phantom `{error}`) | unit | P0 | drives the lab UX + double-write removal |
| `authInterceptor` / `AuthGuard` / `AdminGuard` | unit | P0 | token attach + route protection |
| `problem-detail` helpers | unit | P0 | shared error normalization |
| `login.component` (login/register/verify state machine) | component | P1 | complex form flows |
| `chatbot.component` (OnPush behavior, quota banner) | component | P1 | validates OnPush/`Eager` migration |
| `PublicMetricsService`, `FeedbackService` | unit | P2 | small but real |
| `lab.component` | shallow component | P2 | huge; test logic units, not the iframe |

### 9.2 Vitest examples (grounded in real services)

**`ChatbotService` — RFC7807 quota exhaustion (the critical case):**
```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChatbotService } from './chatbot.service';
import { environment } from '../../environments/environment';

describe('ChatbotService quota (RFC7807)', () => {
  let svc: ChatbotService; let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ChatbotService, provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(ChatbotService); http = TestBed.inject(HttpTestingController);
  });
  it('parses top-level code + payload on 403', () => {
    svc.setUserId('u1');
    http.expectOne(`${environment.apiUrl}/users/u1/ai-quota`).flush({ messages_used:0,messages_remaining:5,messages_limit:5,week_resets_at:0 });
    let last: any; svc.messages$.subscribe(m => last = m.at(-1));
    svc.sendMessage('hi');
    http.expectOne(environment.chatbotApiUrl).flush(
      { type:'about:blank', title:'Forbidden', status:403,
        detail:'Weekly AI message quota exhausted.', code:'AI_QUOTA_EXHAUSTED',
        payload:{ messages_used:5,messages_remaining:0,messages_limit:5,week_resets_at:1750000000 } },
      { status:403, statusText:'Forbidden' });
    expect(last.role).toBe('error');
    expect(last.content).toContain('all 5 free AI messages');
  });
  afterEach(() => http.verify());
});
```

**`LabService` — phantom-lab `{error}` 200 + question flow:**
```ts
it('maps phantom {error} body to a thrown error', () => {
  let err: any;
  svc.getLabInfo('lab-x').subscribe({ error: e => err = e });
  http.expectOne(`${environment.apiUrl}/labs/lab-x?user_id=guest`)
    .flush({ error: 'lab not found' });   // lab-service returns this with HTTP 200
  expect(err.message).toBe('lab not found');
});
```

**`authInterceptor` — attaches ID token only for apiUrl host:**
```ts
it('adds Bearer idToken for apiUrl requests, skips others', () => {
  localStorage.setItem('idToken', 'JWT');
  TestBed.inject(HttpClient).get(`${environment.apiUrl}/users/u1`).subscribe();
  const r = http.expectOne(`${environment.apiUrl}/users/u1`);
  expect(r.request.headers.get('Authorization')).toBe('Bearer JWT');
  r.flush({});
});
```

**`UserService.login` — Cognito mocked, ID token decoded:** mock `@aws-sdk/client-cognito-identity-provider` with `vi.mock(...)` so `InitiateAuthCommand` resolves an `AuthenticationResult.IdToken`; assert `localStorage.idToken` set and `getUser` called with `custom:user_id`.

**Component (`login.component`)** — drive the reactive forms: invalid submit shows validators; `UserService.register` (spied) success flips to verify mode; `confirmSignUp` success returns to login mode.

### 9.3 Playwright e2e (against the k3s stack + mock-OIDC)
Reuse the backend's proven topology (`Backend-Java/e2e/k8s/e2e-stack.yaml`: LocalStack + Redis + **mock-OIDC:8080** + services 8081-8085). Serve the built SPA (nginx image or `ng serve`) pointed at a gateway that fronts the services with the strangler paths.
```ts
// e2e/lab-flow.spec.ts (Playwright)
import { test, expect, request } from '@playwright/test';
test('login → dashboard → launch lab → chat', async ({ page }) => {
  // 1) obtain a mock-OIDC token (client_credentials), inject as the app does
  const api = await request.newContext();
  const tok = await (await api.post('http://mock-oidc:8080/default/token',
    { form: { grant_type:'client_credentials', client_id:'e2e-user-1', client_secret:'x', scope:'openid' } })).json();
  await page.addInitScript(t => { localStorage.setItem('idToken', t); localStorage.setItem('userId','e2e-user-1'); }, tok.access_token);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/dashboard/);
  await page.goto('/lab/module/m1/lesson/l1');
  await page.getByRole('button', { name: /launch/i }).click();
  await expect(page.locator('iframe')).toBeVisible({ timeout: 30_000 });
});
```
Suites: **auth** (login/register/verify, guard redirects), **lab** (launch, poll to running, question setup/check, timer), **chat** (send, quota banner via seeded quota, Snap&Ask staging), **admin** (metrics gated by role). Run headless in CI; trace-on-failure.
> **Snap & Ask** uses `getDisplayMedia` (needs user gesture / not automatable headless). Test the **staging** path deterministically: call `chatbotService.stagePendingImage(<fixture base64>)` and assert the preview + send builds the `image` field; leave the actual screen-capture to a manual checklist.

### 9.4 Contract tests (RFC7807 + snake_case lock-in)
Place under `src/app/**/contract/*.contract.spec.ts`; feed fixtures captured in §4.6.
```ts
it('question-service check success shape', () => {
  svc.checkQuestion('pod-1','m','l',1).subscribe(r => {
    expect(r).toEqual({ status:'success', message: expect.stringContaining('completed'), completed:true });
  });
  const req = http.expectOne(u => u.url.endsWith('/questions/m/l/1/check?user_id=guest'));
  expect(req.request.body).toEqual({ pod_name:'pod-1' });        // snake_case body
  req.flush({ status:'success', message:'Question 1 completed successfully', completed:true });
});
it('RFC7807 validation error exposes errors map', () => {
  // 400 { code:VALIDATION_ERROR, errors:{pod_name:"must not be blank"} } → problemMessage joins values
});
```
Also a **generic ProblemDetail** suite for `problem-detail.ts` (403 quota, 400 validation, 404, 500) proving `problemMessage`/`problemCode` across shapes (incl. FastAPI `{detail}` during dual-run).

### 9.5 Coverage gate
- Re-baseline coverage the moment Vitest lands (Phase 2). Set the initial gate at the measured baseline, then **ratchet**: P0 services/interceptor/guards/helpers to **≥ 85% lines / ≥ 80% branches**; global floor **≥ 60%** rising to **≥ 75%**.
```jsonc
// vitest coverage thresholds (vitest.config.ts)
coverage: { provider:'v8', thresholds:{ lines:75, branches:70, functions:75, statements:75 } }
```
CI fails under threshold. New/edited files must not lower their file-level coverage (diff-coverage check).

---

## 10. CI/CD

Mirror the backend's gate philosophy (`backend-java-deploy.yml`: mandatory test gate → ECR → **k3s-in-runner** deploy + smoke; `security.yml`: Trivy gate). Two workflows: a **PR gate** (`frontend-ci.yml`) and a hardened **deploy** (`frontend-build.yml`).

### 10.1 New — `.github/workflows/frontend-ci.yml` (PR gate)
```yaml
name: Frontend CI
on:
  pull_request:
    paths: ["Frontend/**", ".github/workflows/frontend-ci.yml"]
  push:
    branches: [main, spring-boot-migration]
    paths: ["Frontend/**"]
permissions: { contents: read }
jobs:
  build-test:
    runs-on: ubuntu-latest
    strategy:
      matrix: { node: ["20.11.1", "22.22.3"] }   # upgrade-window floors; drop 20.x after v22 ships
    defaults: { run: { working-directory: Frontend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ matrix.node }}", cache: npm, cache-dependency-path: Frontend/package-lock.json }
      - run: npm ci
      - run: npx ng lint || echo "lint not configured yet"    # add @angular-eslint (§10.4)
      - run: npx tsc -p tsconfig.app.json --noEmit
      - run: npx ng build --configuration=production
      - run: npx ng test --watch=false --code-coverage        # Vitest (post-Phase 2); enforces thresholds
      - uses: actions/upload-artifact@v4
        with: { name: coverage-${{ matrix.node }}, path: Frontend/coverage }
  e2e:
    needs: build-test
    runs-on: ubuntu-latest
    timeout-minutes: 40
    env: { KUBECONFIG: /etc/rancher/k3s/k3s.yaml }
    steps:
      - uses: actions/checkout@v4
      - name: Free disk space
        run: sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc || true
      - name: Install k3s + deploy backend stack (mock-OIDC, no Bedrock)
        run: |
          curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644 --disable traefik
          sudo ln -sf /usr/local/bin/k3s /usr/local/bin/kubectl
          kubectl apply -f Backend-Java/e2e/k8s/istio-crd.yaml
          kubectl wait --for condition=established --timeout=60s crd/virtualservices.networking.istio.io
          kubectl create namespace dev --dry-run=client -o yaml | kubectl apply -f -
          kubectl apply -f Backend-Java/e2e/k8s/e2e-stack.yaml
          for d in localstack redis mock-oidc user-service lab-service question-service chat-service analytics-service; do
            kubectl rollout status deploy/$d -n dev --timeout=300s; done
          echo "127.0.0.1 mock-oidc" | sudo tee -a /etc/hosts
          for p in 8081 8082 8083 8084 8085; do kubectl port-forward -n dev svc/$(kubectl get svc -n dev -o name | sed -n "s#service/##p" | grep -m1 -E 'user|lab|question|chat|analytics' ) $p:$p & done
          kubectl port-forward -n dev svc/mock-oidc 8080:8080 & sleep 8
      - uses: actions/setup-node@v4
        with: { node-version: "22.22.3", cache: npm, cache-dependency-path: Frontend/package-lock.json }
      - name: Build SPA + run Playwright
        working-directory: Frontend
        run: |
          npm ci
          npx playwright install --with-deps chromium
          npx ng build --configuration=production
          npx http-server dist/rosetta-cloud-frontend/browser -p 4200 &   # or nginx image
          npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-trace, path: Frontend/test-results }
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22.22.3", cache: npm, cache-dependency-path: Frontend/package-lock.json }
      - working-directory: Frontend
        run: |
          npm ci
          npm audit --omit=dev --audit-level=high    # dependency CVE gate
      - name: Trivy fs (secrets/misconfig gate — mirrors security.yml)
        run: |
          curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sudo sh -s -- -b /usr/local/bin
          trivy fs --scanners secret --exit-code 1 --no-progress Frontend
          trivy fs --scanners vuln,misconfig --severity HIGH,CRITICAL --exit-code 0 --no-progress Frontend
```

### 10.2 Hardened — `.github/workflows/frontend-build.yml` (deploy)
Add a **test gate** + **image scan** before ECR push; keep the existing OIDC/ECR/EKS rollout.
```yaml
# BEFORE: checkout → docker build → push → kubectl rollout restart   (NO gate)
# AFTER: insert prior to "Build & push":
      - uses: actions/setup-node@v4
        with: { node-version: "22.22.3", cache: npm, cache-dependency-path: Frontend/package-lock.json }
      - name: TEST GATE (build + unit)
        working-directory: Frontend
        run: |
          npm ci
          npx ng build --configuration=production
          npx ng test --watch=false --code-coverage      # Vitest thresholds
      - name: Trivy image scan (gate on fixable CRITICAL)
        run: |
          IMAGE=${{ steps.login.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ inputs.image_tag || 'latest' }}
          docker build --platform linux/amd64 -f Frontend/Dockerfile Frontend -t "$IMAGE"
          curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sudo sh -s -- -b /usr/local/bin
          trivy image --scanners vuln --severity CRITICAL --ignore-unfixed --exit-code 1 --no-progress "$IMAGE"
          docker push "$IMAGE"
      # keep: kubectl rollout restart deploy/rosettacloud-frontend -n dev ; rollout status
      # rollback: kubectl rollout undo deployment/rosettacloud-frontend -n dev
```

### 10.3 Dockerfile hardening (§2.10 fixes)
```dockerfile
# BEFORE
FROM node:24-alpine AS builder
RUN npm install -g @angular/cli && npm install --legacy-peer-deps --unsafe-perm --force && ng build --configuration=production
# AFTER — reproducible, no --force masking, pinned node ≥ 24.15.0 (v22 floor)
FROM node:24.15.0-alpine AS builder
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci                                   # reproducible; fails on peer breaks (surface, don't mask)
COPY . .
RUN npx ng build --configuration=production  # local CLI, not global
# (unchanged) nginx stage copies dist/rosetta-cloud-frontend/browser
```
> Keeping `--legacy-peer-deps`/`--force` hides exactly the peer-dependency breaks these upgrades introduce. Remove them; if a real peer conflict exists, fix it explicitly.

### 10.4 Add linting (currently none)
`package.json` has no `lint`. Add during Phase 1: `ng add @angular-eslint/schematics`, commit `.eslintrc`/`eslint.config.js`, wire `npm run lint`, and enable the `ng lint` step in `frontend-ci.yml`.

### 10.5 Pipeline gates summary
| Stage | Gate | Blocks merge/deploy? |
|---|---|---|
| typecheck | `tsc --noEmit` clean | yes |
| build | `ng build` prod within budgets | yes |
| unit | Vitest green + coverage thresholds | yes |
| e2e | Playwright green vs k3s stack | yes (PR + pre-deploy) |
| deps | `npm audit --audit-level=high` | yes |
| secrets | `trivy fs --scanners secret` | yes |
| image | `trivy image` fixable CRITICAL | yes (deploy) |
| SAST | Semgrep (extend `security.yml` to `Frontend`) | informational |

---

## 11. Risk Register, Effort, Sequencing & Acceptance

### 11.1 Risk register (per phase) with mitigation + rollback
| # | Phase | Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|---|---|
| R1 | 0 | Red baseline (`app.component.spec`) hides regressions | High (confirmed) | Med | Fix spec first (§4.3) | n/a |
| R2 | 0 | `uat/stg` env files lack `apiUrl` → runtime break | High (confirmed) | Med | Complete env files (§8.4) | revert env commit |
| R3 | 1 | Builder rename misses a target string | Low | High (no build) | Verify 3 builder strings (§5.3); CI build | `git revert` v20 PR |
| R4 | 1 | `moduleResolution: bundler` surfaces import errors | Low | Med | `tsc --noEmit` in gate | revert tsconfig hunk |
| R5 | 1 | `@aws-sdk` CJS interop warning under esbuild | Med | Low | `allowedCommonJsDependencies`; login smoke | add-to-allowlist |
| R6 | 2 | Karma→Vitest schematic leaves broken specs (esp. `lab.component.spec`) | High | Med | Mock services, shallow render (§9.2); re-baseline coverage | keep Karma target on a branch until Vitest green |
| R7 | 2 | Host-binding typecheck breaks build (`navbar` `@HostListener`) | Med | Med | Fix types in gate (§6.4) | revert offending edit |
| R8 | 3 | OnPush default breaks views relying on mutation (`chatbot`, `lab`) | High | High | `Eager` shim preserves behavior; convert gradually (§7.4) | keep `Eager` |
| R9 | 3 | `paramsInheritanceStrategy:'always'` changes param reads | Med | Med | Audit + `withRouterConfig({paramsInheritanceStrategy:'emptyOnly'})` (§7.5) | apply the config |
| R10 | 3 | iframe blocked by sanitization/SSRF hardening | Low | High (lab unusable) | Verify bypass + hostname allowlist (§7.7); Playwright lab test | revert hardening tweak |
| R11 | 3 | Zoneless regressions (timers/polling/chat) | Med (if attempted) | High | Opt-in only after Playwright green (§7.6) | stay zoned |
| R12 | 4 | AI/lab **quota 403** parsed wrong (RFC7807) → broken UX | High (confirmed shape change) | High | `problem-detail` helpers + dedicated tests (§8.3/§9.2) | client flag → parse FastAPI shape; VS weight→0 |
| R13 | 4 | `linkLabToUser`/`unlinkLabFromUser` 404 under Java | High (confirmed no public handler) | Med | Remove calls; server-side linking (§8.5) | VS weight→0 (FastAPI) |
| R14 | 4 | Double progress write on `check` | High (confirmed) | Low/Med | Remove client `updateUserProgress` (§8.5) | idempotent server write tolerates it |
| R15 | 4 | `listUsers` `/api` mis-route (admin) | High (confirmed bug) | Med | Fix to `${apiUrl}/users` (§8.6) | revert |
| R16 | 4 | ID-token `aud`/`token_use` rejected by resource server | Low | High (all calls 401) | Contract-test token accept via mock-OIDC (§8.7) | VS weight→0 |
| R17 | 4 | `/feedback` accidentally routed to Java | Low | Med | Confirm no strangler prefix; stays FastAPI (§2.6) | n/a |
| R18 | all | Third-party peer break (xterm/bootstrap/aws-sdk) | Med | Med | Compat audit each step (§4.5); `npm ci` (no `--force`) | pin last-good version |

### 11.2 Effort & timeline (1 senior FE engineer; calendar incl. bake time)
| Phase | Work | Est. |
|---|---|---|
| 0 Pre-flight | baseline fix, env fix, CI Node, fixtures, compat audit | 2–3 d |
| 1 v19→20 | update, builder rename, tsconfig, verify | 1–2 d |
| 2 v20→21 | update, **Karma→Vitest**, spec rewrites, host-binding | 3–5 d |
| 3 v21→22 | update, OnPush triage, param audit, sanitization, Playwright green | 4–6 d |
| 4 Cutover | RFC7807 refactor, remove server-side calls, contract tests, canary bakes | 3–5 d + 3–5 d bake |
| Testing buildout | Vitest suites to threshold + Playwright suites | 4–6 d (overlaps 2–4) |
| CI/CD | `frontend-ci.yml`, harden `frontend-build.yml`, Dockerfile, eslint | 2–3 d |
| **Total** | | **~4–6 weeks** incl. canary bake; OnPush→signals/zoneless are separate follow-up epics |

### 11.3 Recommended sequencing
1. **Phase 0** on `main`-based branch (baseline + env + CI). 
2. **Phase 4 cutover on Angular 19** first (lowest framework risk; contract is the real unknown) — canary each prefix. *If org prefers, cutover can instead trail the upgrade; the plan supports either since they're decoupled.*
3. **Phase 1 → 2 → 3** upgrades, each its own PR + tag (`v20/21/22-green`).
4. Post-22 follow-ups: OnPush cleanup, `httpResource`/Signal Forms, zoneless evaluation.

### 11.4 Acceptance criteria
- **A1** `ng version` shows Angular 22.x, TS 6.x, `@angular/build`; `ng build` prod green within budgets.
- **A2** `ng test` = Vitest green; coverage ≥ thresholds (§9.5); P0 areas ≥ 85%.
- **A3** Playwright suite green vs k3s stack (auth, lab, chat, admin).
- **A4** All migrated prefixes served by Java at 100% weight; browser handles RFC7807 (quota banners correct); no 404s from removed link/unlink; single progress write.
- **A5** `frontend-ci.yml` gates PRs; `frontend-build.yml` has test+scan gate; Dockerfile uses `npm ci` (no `--force`).
- **A6** No console errors in the 5 core flows; error-rate < 0.5% through canary; `Eager` backlog ticketed.

### 11.5 Final verification checklist
```
[ ] pre-ng-upgrade-baseline tag + package-lock.baseline.json committed
[ ] app.component.spec green; uat/stg env files complete
[ ] v20: builder strings @angular/build x3; tsc bundler clean; smoke x5; tag v20-green
[ ] v21: Vitest green; coverage re-baselined; host-binding types clean; tag v21-green
[ ] v22: node/tsc floors met; OnPush Eager diff reviewed; param strategy verified;
        iframe + Snap&Ask smoke; Playwright green; tag v22-green
[ ] problem-detail.ts + tests; chatbot quota 403 (code/payload) test green
[ ] removed linkLabToUser/unlinkLabFromUser + call sites
[ ] removed client updateUserProgress in check() success path
[ ] listUsers → ${apiUrl}/users
[ ] mock-OIDC token accepted (200 protected / 401 unauth) contract test
[ ] strangler weights 100% Java per prefix; /feedback still FastAPI; /health-check still resolves
[ ] frontend-ci.yml + hardened frontend-build.yml + Dockerfile npm ci + eslint
[ ] canary error-rate < 0.5%; rollback (VS weight→0 / rollout undo) rehearsed
```

---

## 12. Appendices

### Appendix A — Per-step dependency version matrix (floors; let `ng update` resolve exact patches)
| Package | v19 (now) | v20 | v21 | v22 |
|---|---|---|---|---|
| `@angular/*` core/common/router/forms/compiler(-cli)/platform-browser | ^19.2 | ^20.0 | ^21.0 | ^22.0 |
| builder | `@angular-devkit/build-angular` ^19.2.6 | **`@angular/build` ^20** | ^21 | ^22 |
| `@angular/cli` | ^19.2.6 | ^20 | ^21 | ^22 |
| `typescript` | ~5.7.2 | ~5.8 | ~5.9 | ~6.0 |
| Node (floor) | 18.19/20+ | **≥20.11.1** | ≥20.11.1 | **≥22.22.3 or ≥24.15.0** |
| `zone.js` | ~0.15 | (schematic) | ~0.15 (or zoneless) | ~0.15 (or zoneless) |
| `rxjs` | ~7.8 | ~7.8 | ~7.8 | ~7.8 |
| test runner | Karma+Jasmine | Karma | **Vitest** | Vitest |
| `vitest`/`@vitest/coverage-v8`/`jsdom` | — | — | ^3 / ^3 / ^25 | ^3 / ^3 / ^25 |
| `moduleResolution` | node | **bundler** | bundler | bundler |
| `@xterm/*`, `bootstrap` 5.3, `@aws-sdk/...` | as-is | audit | audit | audit |

### Appendix B — Command cheat-sheet
```bash
# Baseline
git tag pre-ng-upgrade-baseline && (cd Frontend && npm ci && npx ng build --configuration=production && npx ng test --watch=false --code-coverage)
# Per major (repeat 20,21,22)
npx ng update @angular/core@N @angular/cli@N @angular/build@N
npx tsc -p tsconfig.app.json --noEmit && npx ng build --configuration=production && npx ng test --watch=false
# v21 test migration
npx ng generate @angular/core:karma-to-vitest
# v22 param safety (if needed)
#   provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly' }))
# Cutover canary (Istio) — edit weight in strangler-virtualservice.yaml then:
kubectl apply -f DevSecOps/K8S/strangler-virtualservice.yaml
# Rollback
kubectl rollout undo deployment/rosettacloud-frontend -n dev     # image
git revert <phase-PR-merge>                                       # code
# grep guards
grep -rn "afterRender\|InjectFlags\|TestBed.get\|standalone: false\|moduleId:" Frontend/src   # expect empty
grep -rn "ChangeDetectionStrategy.Eager" Frontend/src            # v22 cleanup backlog size
```

### Appendix C — File-by-file change index
| File | Phase | Change |
|---|---|---|
| `app.component.spec.ts` | 0 | fix failing assertion; add router/http providers |
| `environment.uat.ts`,`environment.stg.ts` | 0/4 | add `apiUrl`/`feedbackApiUrl`/`chatbotApiUrl`/timeouts |
| `.nvmrc`, `package.json engines` | 0 | pin Node |
| `angular.json` | 1/2 | builder strings → `@angular/build` (`application`,`dev-server`,`unit-test`) |
| `package.json` | 1–3 | swap build-angular→`@angular/build`; TS bumps; remove Karma/Jasmine, add Vitest |
| `tsconfig.json` | 1 | `moduleResolution: bundler` |
| `tsconfig.spec.json` | 2 | `types: ["vitest/globals","node"]` |
| `src/test-setup.ts` | 2 | new Vitest/TestBed setup |
| all `*.component.ts` | 3 | OnPush auto-migration `Eager` shim; cleanup backlog |
| `app.config.ts` | 3/4 | (opt) `withRouterConfig`; (opt) add `errorInterceptor` |
| `chatbot.component.ts` | 3 | remove `HttpClientModule`; OnPush conversion |
| `src/app/core/problem-detail.ts` | 4 | **new** RFC7807 helpers |
| `services/chatbot.service.ts` | 4 | quota 403 → `code`/`payload` |
| `services/user.service.ts` | 4 | `handleError` via `problemMessage`; `listUsers` URL; remove link/unlink |
| `services/lab.service.ts` | 4 | `handleError` normalize; remove double `updateUserProgress` in `check` |
| `lab.component.ts` | 3/4 | iframe hostname allowlist; surface lab-quota 403; remove unlink call site |
| `.github/workflows/frontend-ci.yml` | 10 | **new** |
| `.github/workflows/frontend-build.yml` | 10 | add test+scan gate |
| `Frontend/Dockerfile` | 10 | `npm ci`, pin node 24.15.0, drop `--force` |

### Appendix D — References
- Repo (verified): `Frontend/{package.json,angular.json,tsconfig*.json}`, `Frontend/src/app/{app.config.ts,app.routes.ts}`, `services/{user,lab,chatbot,feedback,public-metrics,i18n,theme}.service.ts`, `interceptors/auth.interceptor.ts` (functional) + `src/interceptors/*` (dormant), `guards/{auth,admin}.guard.ts`, `{lab,chatbot,login}.component.ts`, `environments/*`, `Dockerfile`, `nginx.conf`.
- Java contracts: `Backend-Java/{user,lab,question,chat,analytics}-service/**/web/*Controller.java`, `shared-lib/**/error/{GlobalExceptionHandler,ApiException,QuotaExceededException}.java`, `shared-lib/**/security/CognitoJwtAuthenticationConverter.java`, `*/src/main/resources/application.yml` (SNAKE_CASE), `lab-service/**/UserServiceClient.java`.
- Infra/CI: `DevSecOps/K8S/strangler-virtualservice.yaml`, `Backend-Java/e2e/k8s/e2e-stack.yaml`, `.github/workflows/{frontend-build,backend-java-deploy,e2e-k3s,security}.yml`.
- External (consult exact notes at execution time): Angular Update Guide (`angular.dev/update-guide`) for 19→20→21→22; `@angular/build` builder; `karma-to-vitest` schematic; `provideZonelessChangeDetection`; `httpResource`/Signal Forms; RFC 7807 `application/problem+json`.

> **Living document.** Update the `Eager` backlog count, coverage numbers, and canary weights as each phase lands.
