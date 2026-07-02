/**
 * Deterministic, snake_case fixtures that mirror the REAL API response shapes
 * the Angular services expect. Shapes verified against:
 *   - src/app/services/user.service.ts        (User, getUserProgress -> {progress}, getUserLabs -> {labs})
 *   - src/app/services/chatbot.service.ts      (AiQuota)
 *   - src/app/services/lab.service.ts          (getLabQuota)
 *   - src/app/admin-metrics/admin-metrics.component.ts (MetricsResponse)
 */

export interface UserFixture {
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at: number;
  updated_at: number;
  metadata: Record<string, unknown>;
}

/** Normal (non-admin) user — matches `User` in user.service.ts. */
export function userFixture(overrides: Partial<UserFixture> = {}): UserFixture {
  return {
    user_id: 'u_e2e_123',
    email: 'e2e@example.com',
    name: 'E2E Student',
    role: 'user',
    created_at: 1_700_000_000,
    updated_at: 1_700_100_000,
    metadata: {},
    ...overrides,
  };
}

/** Admin user — AdminGuard requires `role === 'admin'`. */
export function adminUserFixture(overrides: Partial<UserFixture> = {}): UserFixture {
  return userFixture({
    user_id: 'u_admin_999',
    email: 'admin@example.com',
    name: 'E2E Admin',
    role: 'admin',
    ...overrides,
  });
}

/**
 * Progress map: module_uuid -> lesson_uuid -> question_number -> completed.
 * The dashboard reads Object.keys()/counts of exactly this nested shape.
 * NOTE: user.service.ts getUserProgress() returns `response.progress`, so the
 * mock must wrap this under a top-level `progress` key (done in mock-api.ts).
 */
export function progressFixture(): Record<string, Record<string, Record<string, boolean>>> {
  return {
    'module-linux-basics': {
      'lesson-shell-navigation': { '1': true, '2': true, '3': false },
      'lesson-file-permissions': { '1': true, '2': false },
    },
    'module-k8s-intro': {
      'lesson-pods-and-deployments': { '1': false, '2': false },
    },
  };
}

/** getUserLabs() returns `{ labs: string[] }`. */
export function labsFixture(): string[] {
  return ['lab-abc123', 'lab-def456'];
}

/** AiQuota shape from chatbot.service.ts. */
export function aiQuotaFixture() {
  return {
    messages_used: 12,
    messages_remaining: 88,
    messages_limit: 100,
    week_resets_at: 4_102_444_800,
  };
}

/** getLabQuota() shape from lab.service.ts. */
export function labQuotaFixture() {
  return {
    minutes_used: 30,
    minutes_remaining: 90,
    minutes_limit: 120,
    week_resets_at: 4_102_444_800,
  };
}

/** MetricsResponse shape from admin-metrics.component.ts. */
export function adminMetricsFixture() {
  return {
    total_users: 42,
    aggregate: {
      lab_started: 128,
      lab_terminated: 110,
      question_attempted: 540,
      question_correct: 402,
      chat_message: 233,
      active_minutes: 3120,
    },
    accuracy_pct: 74.4,
    per_user: {
      u_e2e_123: {
        lab_started: 6,
        lab_terminated: 5,
        question_attempted: 30,
        question_correct: 22,
        chat_message: 14,
        active_minutes: 180,
      },
      u_admin_999: {
        lab_started: 2,
        lab_terminated: 2,
        question_attempted: 8,
        question_correct: 7,
        chat_message: 3,
        active_minutes: 60,
      },
    },
    collected_since: 1_700_000_000,
  };
}

/** Public marketing stats — GET /public/stats (public-metrics.service.ts). */
export function publicStatsFixture() {
  return {
    labs_launched: 12_500,
    questions_answered: 88_200,
    ai_messages: 41_000,
    total_users_seen: 3_400,
  };
}
