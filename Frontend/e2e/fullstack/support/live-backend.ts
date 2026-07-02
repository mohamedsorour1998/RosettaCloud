import type { APIRequestContext, Page, Route } from '@playwright/test';

/**
 * FULL-STACK e2e support (Plan §9.3).
 *
 * Unlike the deterministic mocked suite (../support/mock-api.ts), NOTHING here
 * fabricates API responses. Instead we point the Angular SPA's single origin
 * (environment.apiUrl = https://api.dev.rosettacloud.app) at the LIVE strangler
 * gateway (nginx) that fronts the five k3s microservices, so the built SPA
 * exercises the REAL backend end-to-end.
 *
 * The SPA is a production build (apiUrl is compiled in), so rather than a build
 * flag we use a RUNTIME network shim: Playwright intercepts the apiUrl origin
 * and proxies each request, unchanged (method + Authorization + body), to the
 * gateway origin (a `kubectl port-forward` of svc/strangler-gateway, default
 * http://localhost:8088). The real gateway path-routes to the right service and
 * the real bytes are returned to the SPA. The auth interceptor still runs for
 * real (it attaches the Bearer token because the request URL still starts with
 * apiUrl — we only re-target at the network layer, after the interceptor).
 *
 * Only non-backend origins (Google Fonts, Cognito) are stubbed offline — they
 * are not part of the k3s stack and we authenticate via an injected mock-OIDC
 * token, never a live Cognito call.
 */

/** environment.apiUrl / chatbotApiUrl origin the SPA is built against. */
export const API_ORIGIN = 'https://api.dev.rosettacloud.app';
/** environment.feedbackApiUrl — no Java feedback-service; kept offline. */
export const FEEDBACK_ORIGIN = 'https://feedback.dev.rosettacloud.app';

/**
 * CORS headers for every fulfilled cross-origin response. The SPA (served from
 * localhost) calls the apiUrl host cross-origin; once a Bearer token is present
 * Chromium issues a preflight, and `Authorization` is not covered by the `*`
 * Allow-Headers wildcard, so it is listed explicitly (mirrors mock-api.ts).
 */
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, x-requested-with',
  'access-control-max-age': '86400',
};

/** The port-forwarded strangler gateway origin (single backend origin). */
export function gatewayOrigin(): string {
  return process.env['FULLSTACK_GATEWAY_URL'] || 'http://localhost:8088';
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env ${name}. The full-stack suite is driven by the ` +
        'frontend-e2e-fullstack.yml workflow, which mints a mock-OIDC token and ' +
        'seeds the backend before running. Do not run this suite standalone.'
    );
  }
  return v;
}

/** Mock-OIDC identity injected by the workflow (token + seeded user). */
export function liveAuth(): { token: string; userId: string; name: string } {
  return {
    token: required('E2E_ID_TOKEN'),
    userId: required('E2E_USER_ID'),
    name: process.env['E2E_USER_NAME'] || 'E2E Student',
  };
}

/** Seeded module/lesson whose question shell script exists in S3/LocalStack. */
export function liveModuleLesson(): { module: string; lesson: string } {
  return {
    module: process.env['E2E_MODULE'] || 'linux-docker-k8s-101',
    lesson: process.env['E2E_LESSON'] || 'intro-lesson-01',
  };
}

/**
 * Seed the localStorage keys the app reads for auth BEFORE the app boots —
 * mirrors UserService.login() (idToken/accessToken/userId/currentUser). The
 * token is a REAL mock-OIDC JWT the Java resource servers accept; getUser()
 * then fetches the REAL seeded user from user-service.
 */
export async function seedAuthFromEnv(page: Page): Promise<void> {
  const { token, userId, name } = liveAuth();
  await page.addInitScript(
    (seed: { token: string; userId: string; name: string }) => {
      localStorage.setItem('idToken', seed.token);
      localStorage.setItem('accessToken', seed.token);
      localStorage.setItem('userId', seed.userId);
      localStorage.setItem(
        'currentUser',
        JSON.stringify({
          user_id: seed.userId,
          email: 'e2e@rc.app',
          name: seed.name,
          role: 'user',
          created_at: 0,
          updated_at: 0,
          metadata: {},
        })
      );
    },
    { token, userId, name }
  );
}

/** Headers worth forwarding upstream (avoid host/content-length/origin noise). */
const FORWARD_HEADERS = ['authorization', 'content-type', 'accept'];

/**
 * Reroute the SPA's apiUrl origin to the LIVE gateway, and keep the two
 * non-backend origins (fonts, Cognito) offline. Call once per test, before
 * page.goto(). `request` is Playwright's APIRequestContext (Node side), which
 * reaches the port-forwarded gateway on localhost.
 */
export async function installGatewayProxy(page: Page, request: APIRequestContext): Promise<void> {
  const gateway = gatewayOrigin();

  await page.route(`${API_ORIGIN}/**`, async (route: Route) => {
    const req = route.request();
    const method = req.method();

    // Preflight — the auth interceptor's Bearer header makes API calls non-simple.
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
      return;
    }

    const { pathname, search } = new URL(req.url());
    const target = `${gateway}${pathname}${search}`;

    const incoming = req.headers();
    const headers: Record<string, string> = {};
    for (const key of FORWARD_HEADERS) {
      const val = incoming[key];
      if (val) headers[key] = val;
    }

    try {
      const upstream = await request.fetch(target, {
        method,
        headers,
        data: req.postDataBuffer() ?? undefined,
        timeout: 60_000,
      });
      const body = await upstream.body();
      const contentType = upstream.headers()['content-type'] ?? 'application/json; charset=utf-8';
      await route.fulfill({
        status: upstream.status(),
        headers: { ...CORS_HEADERS, 'content-type': contentType },
        body,
      });
    } catch (err) {
      // Surface a proxy failure as a loud 502 rather than a hang.
      await route.fulfill({
        status: 502,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'gateway_proxy_failed', detail: String(err), target }),
      });
    }
  });

  // Feedback host — no Java service; safety-net offline (never part of the stack).
  await page.route(`${FEEDBACK_ORIGIN}/**`, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: '{}',
    });
  });

  // Cognito — we inject a mock-OIDC token, so a live Cognito call is a bug.
  await page.route(/https:\/\/cognito-idp\.[^/]+\.amazonaws\.com\/.*/, async (route: Route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/x-amz-json-1.1',
      headers: CORS_HEADERS,
      body: JSON.stringify({ __type: 'NotAuthorizedException', message: 'Cognito stubbed in fullstack e2e.' }),
    });
  });

  // Google Fonts (index.html) — keep offline & console-clean.
  await page.route('https://fonts.googleapis.com/**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', headers: CORS_HEADERS, body: '/* fonts stubbed */' });
  });
  await page.route('https://fonts.gstatic.com/**', async (route: Route) => {
    await route.fulfill({ status: 200, headers: CORS_HEADERS, body: '' });
  });
}

/** Console/page-error noise we deliberately ignore (network/asset chatter). */
const IGNORED_CONSOLE: RegExp[] = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /ERR_BLOCKED_BY_CLIENT/i,
  /favicon/i,
  /fonts?\.(googleapis|gstatic)\.com/i,
  /downloadable font/i,
  /Content Security Policy/i,
  // UserService's constructor fires a fire-and-forget /health-check probe; under
  // the harness Chromium may abort it before the (real) response lands. Benign
  // connection-status noise — see mock-api.ts for the full rationale.
  /API connection failed/i,
];

export interface ErrorSpies {
  consoleErrors: string[];
  pageErrors: string[];
}

/** Record uncaught page exceptions (always meaningful) + filtered console errors. */
export function attachLiveErrorSpies(page: Page): ErrorSpies {
  const spies: ErrorSpies = { consoleErrors: [], pageErrors: [] };
  page.on('pageerror', (err) => spies.pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    spies.consoleErrors.push(text);
  });
  return spies;
}
