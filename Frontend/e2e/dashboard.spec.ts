import { test, expect } from '@playwright/test';
import { attachErrorSpies, installApiMocks, seedAuth } from './support/mock-api';
import { userFixture } from './fixtures/fixtures';

/**
 * Authenticated dashboard render.
 *
 * Seeds auth in localStorage (idToken/accessToken/userId/currentUser) BEFORE
 * boot so AuthGuard passes, then mocks the exact GETs DashboardComponent.ngOnInit
 * triggers via forkJoin (see dashboard.component.ts loadDashboardData):
 *   - GET /users/{id}            (userService.getUser)
 *   - GET /users/{id}/progress   (userService.getUserProgress -> {progress})
 *   - GET /users/{id}/labs       (userService.getUserLabs -> {labs})
 * plus GET /health-check fired by the UserService/LabService constructors.
 */
test.describe('dashboard (authenticated)', () => {
  test('renders the authenticated dashboard for a logged-in user', async ({ page }) => {
    const user = userFixture();
    await seedAuth(page, user);
    await installApiMocks(page, { user });
    const spies = attachErrorSpies(page);

    await page.goto('/dashboard');

    // Not redirected to /login — the guard let us through.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
      .toBe('/dashboard');

    // Authenticated content: the welcome banner heading with the user's name.
    // (dashboard.component.html: <h1 class="welcome-title">Welcome back, {{ user?.name || 'Student' }}!</h1>)
    const welcome = page.getByRole('heading', { name: /welcome back/i, level: 1 });
    await expect(welcome).toBeVisible({ timeout: 15_000 });
    await expect(welcome).toContainText(user.name);

    // The error state must NOT be shown (data loaded successfully).
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);

    expect(spies.pageErrors, spies.pageErrors.join('\n')).toEqual([]);
    expect(spies.consoleErrors, spies.consoleErrors.join('\n')).toEqual([]);
  });
});
