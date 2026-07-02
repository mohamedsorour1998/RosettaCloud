import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the RosettaCloud Angular SPA e2e harness.
 *
 * The suite is intentionally backend-independent: it serves the *production*
 * build via a tiny committed Node static server (e2e/static-server.mjs) and
 * mocks every outbound API/Cognito call with page.route (see e2e/support).
 * Nothing touches k3s or a live API, so the suite is reliably GREEN in CI.
 *
 * Integrator flow:
 *   npx ng build --configuration=production
 *   npx playwright test
 */

// Bracket access keeps this file clean under the app's strict tsconfig
// (noPropertyAccessFromIndexSignature).
const isCI = !!process.env['CI'];
const PORT = Number(process.env['PORT']) || 4200;
const baseURL = process.env['PW_BASE_URL'] || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Only *.spec.ts files are tests; helpers (support/, fixtures/) and the
  // static server are ignored by this pattern.
  testMatch: /.*\.spec\.ts$/,

  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,

  reporter: [['list'], ['html', { open: 'never' }]],

  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'node e2e/static-server.mjs',
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PORT: String(PORT) },
  },
});
