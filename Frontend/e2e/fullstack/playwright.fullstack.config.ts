import { defineConfig, devices } from '@playwright/test';

/**
 * DEDICATED Playwright config for the FULL-STACK e2e (Plan §9.3).
 *
 * This is a SEPARATE config from Frontend/playwright.config.ts. It is invoked
 * ONLY by the frontend-e2e-fullstack.yml workflow:
 *
 *   npx playwright test --config e2e/fullstack/playwright.fullstack.config.ts
 *
 * The default suite is unaffected: the root config runs the deterministic
 * mocked specs (e2e/*.spec.ts) and explicitly ignores this folder
 * (testIgnore: '**​/fullstack/**'), while this config's testDir is scoped to
 * e2e/fullstack only. Both serve the same production build via the shared,
 * committed static server (../static-server.mjs).
 *
 * Unlike the mocked suite, these specs require a LIVE backend: the workflow
 * stands up k3s + the e2e-stack + the strangler gateway, port-forwards the
 * gateway, seeds a user, and exports E2E_ID_TOKEN / E2E_USER_ID / E2E_MODULE /
 * E2E_LESSON / FULLSTACK_GATEWAY_URL. Running it standalone will fail fast with
 * a clear "Missing env …" message.
 */

// Bracket access keeps this clean under the app's strict tsconfig
// (noPropertyAccessFromIndexSignature).
const isCI = !!process.env['CI'];
const PORT = Number(process.env['PORT']) || 4200;
const baseURL = process.env['PW_BASE_URL'] || `http://localhost:${PORT}`;

export default defineConfig({
  // Resolved relative to THIS file → Frontend/e2e/fullstack only.
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,

  // The live backend is a single shared, rate-limited resource — run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-fullstack' }],
  ],
  outputDir: 'test-results-fullstack',

  // Live backend + pod scheduling are slower than mocks.
  timeout: 90_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure', // uploaded on failure by the workflow
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },

  projects: [{ name: 'chromium-fullstack', use: { ...devices['Desktop Chrome'] } }],

  // Reuse the committed zero-dependency static server (serves the prod build
  // from ../../dist/rosetta-cloud-frontend/browser regardless of cwd).
  webServer: {
    command: 'node ../static-server.mjs',
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PORT: String(PORT) },
  },
});
