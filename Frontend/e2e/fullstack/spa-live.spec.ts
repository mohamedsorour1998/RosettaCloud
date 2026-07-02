import { test, expect } from '@playwright/test';
import {
  attachLiveErrorSpies,
  installGatewayProxy,
  liveAuth,
  seedAuthFromEnv,
} from './support/live-backend';

/**
 * FULL-STACK e2e — the Angular 22 PRODUCTION SPA against the LIVE k3s backend
 * (Plan §9.3). The built SPA (served by ../static-server.mjs) talks to the real
 * microservices through the strangler gateway; only the apiUrl origin is
 * re-targeted at the gateway (installGatewayProxy) — responses are 100% real.
 *
 * Coverage is scoped to what the e2e-stack serves deterministically:
 *   • login-token-injected → dashboard loads REAL user data (user-service)
 *   • public marketing stats render from REAL analytics-service data
 *
 * SCOPED OUT (documented): the UI lab flow. Navigating to /lab/... auto-launches
 * a lab, but the code-server <iframe> src is an unresolvable wildcard host
 * (`<lab-id>.labs.dev.rosettacloud.app`) in CI, and the lab component's heavy
 * init (xterm, chatbot, polling) is not deterministic headless. The lab
 * lifecycle is instead proven at the API/gateway level in
 * gateway-routing.spec.ts (FULLSTACK_LAB=1).
 */
test.describe('SPA ⇄ live k3s backend (via strangler gateway)', () => {
  test('login-token-injected → dashboard renders REAL user data', async ({ page, request }) => {
    const { name } = liveAuth();

    // Inject the mock-OIDC token the way UserService.login() would, then point
    // the SPA's apiUrl at the live gateway.
    await seedAuthFromEnv(page);
    await installGatewayProxy(page, request);
    const spies = attachLiveErrorSpies(page);

    await page.goto('/dashboard');

    // AuthGuard let us through (real idToken present) — not bounced to /login.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
      .toBe('/dashboard');

    // dashboard.component.html: <h1 class="welcome-title">Welcome back, {{ user?.name }}!</h1>
    // user?.name comes from a REAL GET /users/{sub} on user-service (via gateway).
    const welcome = page.getByRole('heading', { name: /welcome back/i, level: 1 });
    await expect(welcome).toBeVisible({ timeout: 20_000 });
    await expect(welcome).toContainText(name);

    // Data loaded → the dashboard error state is not shown.
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
    await expect(page.getByText(/could not load user data/i)).toHaveCount(0);

    // No uncaught exceptions (console errors from optional/empty sub-resources
    // are tolerated for a live backend — see IGNORED_CONSOLE).
    expect(spies.pageErrors, spies.pageErrors.join('\n')).toEqual([]);
  });

  test('/stats renders REAL public platform stats (analytics-service)', async ({ page, request }) => {
    await installGatewayProxy(page, request);
    const spies = attachLiveErrorSpies(page);

    // Capture the REAL response the SPA receives through the gateway.
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/public/stats'), { timeout: 20_000 }),
      page.goto('/stats'),
    ]);

    expect(resp.status()).toBe(200);
    const stats = await resp.json();
    expect(typeof stats.labs_launched, 'labs_launched is a real number').toBe('number');
    expect(typeof stats.questions_answered).toBe('number');
    expect(typeof stats.ai_messages).toBe('number');

    // The SPA bootstrapped and consumed the data without crashing.
    await expect(page.locator('app-root')).toBeAttached();
    expect(spies.pageErrors, spies.pageErrors.join('\n')).toEqual([]);
  });
});
