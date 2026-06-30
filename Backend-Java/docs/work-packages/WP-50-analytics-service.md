# WP-50 — analytics-service

> Sub-agent brief. Self-contained. Read this + `docs/MIGRATION-PLAN.md` §6,§7 + WP-10 pattern. No assumptions — web-search & cite if unsure.
> Depends on: WP-00, WP-10. Verify: `JAVA_HOME=~/tools/jdk25 ./mvnw -q -pl analytics-service -am verify`

## Objective
Port `/public/stats` and `/admin/metrics` from `main.py`. Replace single-replica in-process counters with a
durable store (DynamoDB `STATS#global` + per-user metrics), fed by events (Phase 4). **Fix** the missing
admin authorization on `/admin/metrics`.

## Source references
- `Backend/app/main.py` — `_metrics`, `_metrics_global`, `_load_stats_from_dynamodb`, `_flush_stats_to_dynamodb`,
  `_track_event`, `admin_metrics`, `public_stats`, `health_check`.

## Behaviour (parity + fix)
- `GET /public/stats` (public) → `{labs_launched, questions_answered, ai_messages, total_users_seen}`.
- `GET /admin/metrics` → `{total_users, aggregate, accuracy_pct, per_user{...}, collected_since}`.
  **AUTH FIX**: require admin. Since Cognito tokens may not carry roles, implement a DB-backed check:
  `@PreAuthorize` + custom `AdminAccessChecker` that loads the caller's `role` from `rosettacloud-users`
  (via user-service internal client OR direct DynamoDB read) and requires `role=="admin"` → else 403.
  (This closes the gap documented in the audit: today any authenticated user can call it.)
- Counters: DynamoDB `STATS#global` item (`lab_started`,`question_attempted`,`chat_message`,`updated_at`) seeded on startup;
  per-user metrics map. Phase 4 wires SQS consumers (`lab.started`,`question.attempted`,`question.correct`,`chat.message`)
  to increment; until then expose read of `STATS#global`. Periodic flush (`@Scheduled`) if counters held in memory/Redis.

## Files
- `persistence/StatsRepository` (DynamoDB STATS#global), `service/MetricsService`, `service/AdminAccessChecker`.
- `web/AnalyticsController` (+ `/health-check` via actuator). `client/UserServiceClient` (role lookup) — or shared DynamoDB read.
- `config/application.yml` (port 8085, USERS_TABLE_NAME, AWS_REGION), Dockerfile, k8s/ (IRSA: DynamoDB rosettacloud-*).
- (Phase 4) `messaging/` SQS listeners.

## Tests
- `AnalyticsControllerTest` (`@WebMvcTest`) — `/public/stats` public; `/admin/metrics` 403 for non-admin, 200 for admin (mock checker).
- `MetricsServiceIT` — Testcontainers LocalStack DynamoDB: read/increment STATS#global, accuracy_pct computation.

## Acceptance
- Build GREEN; **admin-role enforcement test passes (non-admin → 403)**; public stats reads counters.
