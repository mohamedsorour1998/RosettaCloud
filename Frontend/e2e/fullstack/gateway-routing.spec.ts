import { test, expect } from '@playwright/test';
import { gatewayOrigin, liveAuth, liveModuleLesson } from './support/live-backend';

/**
 * FULL-STACK e2e — strangler gateway routing (Plan §9.3).
 *
 * Hits the LIVE strangler gateway (nginx, port-forwarded) directly with
 * Playwright's APIRequestContext and asserts each path lands on the right
 * microservice — i.e. the CI gateway (Frontend/e2e/fullstack/strangler-gateway.ci.yaml)
 * mirrors DevSecOps/K8S/strangler-virtualservice.yaml onto one origin:
 *
 *   /health-check         -> synthetic 200 (FastAPI-fallback shim; VS default)
 *   /public/stats         -> analytics-service:8085   (public)
 *   /users/{id}/lab-quota -> user-service:8081         (JWT enforced)
 *   /questions/{m}/{l}     -> question-service:8083     (S3-backed)
 *   /admin/metrics         -> analytics-service:8085    (admin-only -> 403)
 *   /labs (+poll)          -> lab-service:8082          (lab-stub; env-gated)
 *
 * These are the endpoints the e2e-stack serves deterministically (health,
 * users, questions, analytics). The heavier lab-launch flow is gated behind
 * FULLSTACK_LAB=1 (see the last test).
 */
test.describe('strangler gateway → live k3s microservices', () => {
  const gw = gatewayOrigin();

  test('/health-check → 200 "ok" (FastAPI-fallback shim)', async ({ request }) => {
    const r = await request.get(`${gw}/health-check`);
    expect(r.status()).toBe(200);
    expect((await r.text()).trim()).toBe('ok');
  });

  test('/public/stats → analytics-service (public, real numbers)', async ({ request }) => {
    const r = await request.get(`${gw}/public/stats`);
    expect(r.status()).toBe(200);
    const stats = await r.json();
    for (const key of ['labs_launched', 'questions_answered', 'ai_messages', 'total_users_seen']) {
      expect(typeof stats[key], `public/stats.${key}`).toBe('number');
    }
  });

  test('/users/{id}/lab-quota → user-service, and JWT is enforced', async ({ request }) => {
    const { token, userId } = liveAuth();

    const authed = await request.get(`${gw}/users/${userId}/lab-quota`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(authed.status()).toBe(200);
    expect(typeof (await authed.json()).minutes_remaining).toBe('number');

    // No Authorization header → the real resource server rejects with 401.
    const anon = await request.get(`${gw}/users/${userId}/lab-quota`);
    expect(anon.status()).toBe(401);
  });

  test('/questions/{module}/{lesson} → question-service (parsed from S3)', async ({ request }) => {
    const { token } = liveAuth();
    const { module, lesson } = liveModuleLesson();
    const r = await request.get(`${gw}/questions/${module}/${lesson}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).total_count).toBeGreaterThanOrEqual(1);
  });

  test('/admin/metrics → analytics-service (403 for a non-admin token)', async ({ request }) => {
    const { token } = liveAuth();
    const r = await request.get(`${gw}/admin/metrics`, {
      headers: { authorization: `Bearer ${token}` },
    });
    // The seeded user has role "user"; analytics-service enforces admin here.
    expect(r.status()).toBe(403);
  });

  test('/labs → lab-service: launch, poll to running, terminate', async ({ request }) => {
    test.skip(
      process.env['FULLSTACK_LAB'] !== '1',
      'lab launch needs the lab-stub pod to schedule; enable with FULLSTACK_LAB=1'
    );
    test.setTimeout(240_000);

    const { token } = liveAuth();
    const auth = { authorization: `Bearer ${token}` };

    const created = await request.post(`${gw}/labs`, { headers: auth });
    expect(created.status()).toBe(201);
    const labId = (await created.json()).lab_id as string;
    expect(labId, 'POST /labs must return a lab_id').toBeTruthy();

    // Poll GET /labs/{id} (mirrors scripts/e2e/test_e2e.py: 40 × 5s).
    let status = '';
    for (let i = 0; i < 40; i++) {
      const info = await request.get(`${gw}/labs/${labId}`, { headers: auth });
      if (info.status() === 200) {
        const body = await info.json();
        if (!body.error) {
          status = body.status;
          if (status === 'running') break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    expect(status, `lab ${labId} never reached running`).toBe('running');

    const deleted = await request.delete(`${gw}/labs/${labId}`, { headers: auth });
    expect(deleted.status()).toBe(200);
    expect((await deleted.json()).deleted).toBeTruthy();
  });
});
