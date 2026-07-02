import { test, expect } from '@playwright/test';
import { attachErrorSpies, installApiMocks } from './support/mock-api';

/**
 * Boot + routing smoke tests.
 *
 * Verifies the production build serves a valid HTML document, Angular
 * bootstraps <app-root>, and the wildcard route ({ path: '**', redirectTo: '' }
 * — see src/app/app.routes.ts) sends unknown URLs back to the home view.
 */
test.describe('routing & SPA bootstrap', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test('boots the SPA at "/" with app-root and a valid HTML document', async ({ page }) => {
    const spies = attachErrorSpies(page);

    const response = await page.goto('/');
    // The static server returns index.html (200) for the app shell.
    expect(response?.status() ?? 0).toBeLessThan(400);

    // A well-formed HTML document was served.
    const doctype = await page.evaluate(() => document.doctype?.name ?? null);
    expect(doctype).toBe('html');
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('en');

    // Angular bootstrapped the root component and the (non-lab) shell chrome.
    await expect(page.locator('app-root')).toBeAttached();
    await expect(page.locator('app-navbar')).toBeAttached({ timeout: 15_000 });

    // No uncaught exceptions during boot.
    expect(spies.pageErrors, spies.pageErrors.join('\n')).toEqual([]);
  });

  test('an unknown route falls through the wildcard to the home view', async ({ page }) => {
    const spies = attachErrorSpies(page);

    await page.goto('/no-such-page');

    // Wildcard redirectTo '' (pathMatch full) normalizes the URL to root.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
      .toBe('/');

    await expect(page.locator('app-root')).toBeAttached();
    await expect(page.locator('app-navbar')).toBeAttached({ timeout: 15_000 });

    expect(spies.pageErrors, spies.pageErrors.join('\n')).toEqual([]);
  });
});
