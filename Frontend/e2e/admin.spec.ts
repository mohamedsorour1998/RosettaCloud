import { test, expect } from '@playwright/test';
import { attachErrorSpies, installApiMocks, seedAuth } from './support/mock-api';
import { adminUserFixture, userFixture } from './fixtures/fixtures';

/**
 * Admin route guard.
 *
 * The admin routes ('/admin/metrics', '/admin/users') use
 * canActivate: [AuthGuard, AdminGuard]. AdminGuard (src/app/guards/admin.guard.ts)
 * allows only currentUser.role === 'admin', otherwise navigates to
 * /unauthorized. currentUser is loaded from localStorage['currentUser'] in the
 * UserService constructor, so seeding it before boot is sufficient.
 *
 * AdminMetricsComponent.ngOnInit fetches GET /admin/metrics (mocked).
 */
test.describe('admin route guard', () => {
  test('an admin can view the admin metrics page', async ({ page }) => {
    const admin = adminUserFixture();
    await seedAuth(page, admin);
    await installApiMocks(page, { user: admin });
    const spies = attachErrorSpies(page);

    await page.goto('/admin/metrics');

    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
      .toBe('/admin/metrics');

    // admin-metrics.component.html: <h1 class="banner-title">... Platform Metrics</h1>.
    // level:1 pins to the loaded banner and avoids the loading-state
    // <h4>Loading platform metrics</h4>.
    await expect(
      page.getByRole('heading', { name: /platform metrics/i, level: 1 })
    ).toBeVisible({ timeout: 15_000 });

    expect(spies.pageErrors, spies.pageErrors.join('\n')).toEqual([]);
    expect(spies.consoleErrors, spies.consoleErrors.join('\n')).toEqual([]);
  });

  test('a non-admin is blocked from the admin route and redirected to /unauthorized', async ({
    page,
  }) => {
    const user = userFixture(); // role: 'user'
    await seedAuth(page, user);
    await installApiMocks(page, { user });

    await page.goto('/admin/metrics');

    // AuthGuard passes (token present); AdminGuard fails -> /unauthorized.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
      .toBe('/unauthorized');

    // The admin-only content must never render.
    await expect(page.getByRole('heading', { name: /platform metrics/i })).toHaveCount(0);
  });
});
