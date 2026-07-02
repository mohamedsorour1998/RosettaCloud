import { test, expect } from '@playwright/test';
import { attachErrorSpies, installApiMocks } from './support/mock-api';

/**
 * Auth routing & guard behavior (no real Cognito login — that is a direct AWS
 * SDK call and is not automatable headless; see the harness design notes).
 *
 * Grounded in:
 *   - AuthGuard (src/app/guards/auth.guard.ts): isLoggedIn() checks
 *     localStorage['idToken']; when absent it redirects to
 *     /login?returnUrl=<attempted-url>.
 *   - LoginComponent (src/app/login/*): reactive login + register forms.
 *     '/register' renders the register form via route data { register: true }.
 */
test.describe('auth & route guards', () => {
  test.beforeEach(async ({ page }) => {
    // No seedAuth here — the guard must see an unauthenticated visitor.
    await installApiMocks(page);
  });

  test('visiting a protected route without a token redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');

    // AuthGuard -> createUrlTree(['/login'], { queryParams: { returnUrl } }).
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
      .toBe('/login');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('returnUrl'))
      .toBe('/dashboard');

    // Login form actually rendered.
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('the login route renders its form controls', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /remember me/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('the register route renders the registration form', async ({ page }) => {
    const spies = attachErrorSpies(page);

    await page.goto('/register');

    // Register-only controls (see login.component.html register block).
    await expect(page.getByLabel('Full Name')).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();

    expect(spies.pageErrors, spies.pageErrors.join('\n')).toEqual([]);
  });
});
