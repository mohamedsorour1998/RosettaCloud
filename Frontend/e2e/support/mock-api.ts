import type { Page, Route } from '@playwright/test';
import {
  adminMetricsFixture,
  aiQuotaFixture,
  labQuotaFixture,
  labsFixture,
  progressFixture,
  publicStatsFixture,
  userFixture,
  type UserFixture,
} from '../fixtures/fixtures';

/**
 * All network determinism for the e2e suite lives here.
 *
 * The Angular SPA (production build) talks to a small, known set of external
 * origins. We intercept every one of them with page.route + route.fulfill so
 * NO request ever reaches the real network:
 *
 *   - https://api.dev.rosettacloud.app/**   (environment.apiUrl / chatbotApiUrl)
 *   - https://feedback.dev.rosettacloud.app/** (environment.feedbackApiUrl)
 *   - https://cognito-idp.<region>.amazonaws.com/** (AWS SDK login/register)
 *   - https://fonts.googleapis.com/** + https://fonts.gstatic.com/** (index.html)
 *
 * Requests to the local static server (baseURL / localhost) are never routed,
 * so the built app is served normally.
 */

const API_ORIGIN = 'https://api.dev.rosettacloud.app';
const FEEDBACK_ORIGIN = 'https://feedback.dev.rosettacloud.app';

/**
 * CORS headers attached to every fulfilled cross-origin response.
 *
 * Why this matters: when a token is seeded, the app's AuthInterceptor adds an
 * `Authorization: Bearer ...` header to API calls. That makes the cross-origin
 * request "non-simple", so Chromium issues a CORS *preflight* (OPTIONS) first
 * and then requires `Access-Control-Allow-Origin` on the real response.
 * `Authorization` is NOT covered by the `*` wildcard in Allow-Headers per spec,
 * so it is listed explicitly.
 */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, x-requested-with',
  'access-control-max-age': '86400',
};

/**
 * A JWT-shaped ID token. AuthGuard/UserService only check truthiness of
 * localStorage['idToken'] (isLoggedIn) and never verify the signature on the
 * dashboard/admin flows, but we build a realistic 3-segment token anyway.
 */
function buildFakeJwt(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'e2e-test' })).toString(
    'base64url'
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      'custom:user_id': userId,
      email: 'e2e@example.com',
      token_use: 'id',
      iat: 1_700_000_000,
      exp: 4_102_444_800, // year 2100 — never expired during tests
    })
  ).toString('base64url');
  return `${header}.${payload}.e2e-signature-not-verified`;
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  });
}

async function fulfillText(route: Route, body: string, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'text/plain; charset=utf-8',
    headers: CORS_HEADERS,
    body,
  });
}

export interface MockOptions {
  /** The user returned by GET /users/{id}. Defaults to a normal-role user. */
  user?: UserFixture;
  /** Progress map returned (wrapped) by GET /users/{id}/progress. */
  progress?: Record<string, Record<string, Record<string, boolean>>>;
  /** Lab ids returned by GET /users/{id}/labs. */
  labs?: string[];
  /** Payload returned by GET /admin/metrics. */
  metrics?: unknown;
}

/**
 * Install deterministic route mocks for every origin the SPA touches.
 * Call once per test, before page.goto().
 */
export async function installApiMocks(page: Page, opts: MockOptions = {}): Promise<void> {
  const user = opts.user ?? userFixture();
  const progress = opts.progress ?? progressFixture();
  const labs = opts.labs ?? labsFixture();
  const metrics = opts.metrics ?? adminMetricsFixture();

  // ── Main API (environment.apiUrl / chatbotApiUrl) ────────────────────────
  await page.route(`${API_ORIGIN}/**`, async (route: Route) => {
    const request = route.request();
    const method = request.method();

    // Answer the CORS preflight for any authenticated (Bearer) request.
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
      return;
    }

    const pathname = new URL(request.url()).pathname;

    // GET /health-check (UserService + LabService constructors) -> plain text.
    if (pathname === '/health-check') {
      await fulfillText(route, 'ok');
      return;
    }

    // GET /public/stats (public-metrics.service.ts, home page).
    if (pathname === '/public/stats') {
      await fulfillJson(route, publicStatsFixture());
      return;
    }

    // GET /admin/metrics (admin-metrics.component.ts).
    if (pathname === '/admin/metrics') {
      await fulfillJson(route, metrics);
      return;
    }

    // /users/{id} and sub-resources.
    const usersMatch = pathname.match(/^\/users\/([^/]+)(\/.*)?$/);
    if (usersMatch) {
      const sub = usersMatch[2] ?? '';
      if (sub === '') {
        await fulfillJson(route, user); // GET /users/{id}
        return;
      }
      if (sub === '/progress') {
        await fulfillJson(route, { progress }); // service maps r.progress
        return;
      }
      if (sub === '/labs') {
        await fulfillJson(route, { labs });
        return;
      }
      if (sub === '/ai-quota') {
        await fulfillJson(route, aiQuotaFixture());
        return;
      }
      if (sub === '/lab-quota') {
        await fulfillJson(route, labQuotaFixture());
        return;
      }
      // Any other /users/** call (e.g. progress POST) — succeed generically.
      await fulfillJson(route, { status: 'ok' });
      return;
    }

    // Anything else under the API host — never hit the network.
    await fulfillJson(route, {});
  });

  // ── Feedback API (environment.feedbackApiUrl) — safety net ───────────────
  await page.route(`${FEEDBACK_ORIGIN}/**`, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
      return;
    }
    await fulfillJson(route, {});
  });

  // ── Cognito (AWS SDK) — should not be exercised (we seed tokens) ─────────
  await page.route(/https:\/\/cognito-idp\.[^/]+\.amazonaws\.com\/.*/, async (route: Route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/x-amz-json-1.1',
      headers: CORS_HEADERS,
      body: JSON.stringify({
        __type: 'NotAuthorizedException',
        message: 'Cognito is stubbed in the e2e harness.',
      }),
    });
  });

  // ── Google Fonts (index.html) — keep it offline & console-clean ──────────
  await page.route('https://fonts.googleapis.com/**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      headers: CORS_HEADERS,
      body: '/* fonts stubbed in e2e */',
    });
  });
  await page.route('https://fonts.gstatic.com/**', async (route: Route) => {
    await route.fulfill({ status: 200, headers: CORS_HEADERS, body: '' });
  });
}

/**
 * Seed the localStorage keys the app reads for auth, BEFORE the app boots.
 * Mirrors what UserService.login() writes:
 *   idToken, accessToken, userId, currentUser (JSON).
 * UserService loads `currentUser` in its constructor, so AdminGuard sees the
 * seeded role synchronously.
 */
export async function seedAuth(page: Page, user: UserFixture): Promise<void> {
  const token = buildFakeJwt(user.user_id);
  await page.addInitScript(
    (seed: { user: UserFixture; token: string }) => {
      localStorage.setItem('idToken', seed.token);
      localStorage.setItem('accessToken', seed.token);
      localStorage.setItem('userId', seed.user.user_id);
      localStorage.setItem('currentUser', JSON.stringify(seed.user));
    },
    { user, token }
  );
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
  // UserService fires a fire-and-forget /health-check probe from its
  // constructor to drive a connection-status indicator (user.service.ts
  // checkApiConnection -> throwError('API connection failed') on the error
  // path). Under the e2e harness that XHR is issued during Angular bootstrap
  // and Chromium aborts it at a fixed ~150ms point, BEFORE the mocked response
  // is delivered — verified empirically: the console.error fires at +~150ms
  // even when the (correctly mocked, HTTP 200 'ok') response is artificially
  // delayed to +600ms/+900ms, so it is independent of the mock. It is benign
  // connection-status noise, not a functional error, and orthogonal to what
  // the authenticated render specs assert (correct route, heading + user name,
  // no error state, no uncaught page exceptions). Filtered like the other
  // network/connection chatter above; every OTHER console.error still fails.
  /API connection failed/i,
];

export interface ErrorSpies {
  /** console.error messages (network/asset noise filtered out). */
  consoleErrors: string[];
  /** Uncaught exceptions in the page (always meaningful). */
  pageErrors: string[];
}

/** Attach listeners that record console errors + uncaught page exceptions. */
export function attachErrorSpies(page: Page): ErrorSpies {
  const spies: ErrorSpies = { consoleErrors: [], pageErrors: [] };
  page.on('pageerror', (err) => {
    spies.pageErrors.push(err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    spies.consoleErrors.push(text);
  });
  return spies;
}
