# WP-10 — user-service (REFERENCE vertical slice)

> Sub-agent brief. Self-contained. Read this + `docs/MIGRATION-PLAN.md` §6,§7 + WP-00 output. No assumptions — web-search & cite if unsure.
> Depends on: WP-00 (shared-lib). This service is the PATTERN every other service copies.
> Verify: `cd Backend-Java && JAVA_HOME=~/tools/jdk25 ./mvnw -q -pl user-service -am verify`

## Objective
Port `users_service.py` + `users_backends.py` (DynamoDB backend) + the user/progress/quota routes of `main.py`
to an enterprise Spring Boot 4 service. Preserve the public HTTP contract and the DynamoDB wire format.

## Source references (read fully)
- `Backend/app/backends/users_backends.py` (DynamoDBUserBackend) — the source of truth for behaviour.
- `Backend/app/main.py` — user/progress/quota endpoints, `_require_user`, Cognito backfill on create.
- `Backend/app/dependencies/auth.py` — identity resolution.

## Data model — `persistence/UserItem.java` (@DynamoDbBean), table `rosettacloud-users`, PK `user_id`, GSI `email-index`
Fields (DynamoDB attr names in quotes): `user_id`(S, PK), `email`(S, GSI `email-index` HASH),
`name`, `role`, `created_at`(N), `updated_at`(N), `password`(S — write-through to match current behaviour),
`labs`(List<String>), `active_lab`(S), `lab_started_at`(N), `lab_week_start`(N), `lab_week_minutes`(N),
`ai_week_start`(N), `ai_week_messages`(N),
`progress` (Map<String,Map<String,Map<String,Boolean>>> — native nested M),
`metadata` (Map<String,Object> via `DynamoMapAttributeConverter` from shared-lib).
- Use `@DynamoDbPartitionKey` on user_id; `@DynamoDbSecondaryPartitionKey(indexNames="email-index")` on email;
  `@DynamoDbConvertedBy(DynamoMapAttributeConverter.class)` on metadata.

## Repository — `persistence/UserRepository.java`
`findById`, `findByEmail` (query GSI), `save`(putItem, conditional create variant for create),
`updateAttributes` (partial update preserving others — use load+save or UpdateItemEnhancedRequest with ignoreNulls),
`delete`. Mirror conditional-create (`attribute_not_exists(user_id)`) and partial-update semantics.

## Service layer
- `UserService` — create (gen 8-char id if absent; set created_at; conditional create; on success call
  `CognitoService.backfillUserId(email,userId)`), get/getByEmail/update/delete/list, labs link/unlink/list,
  progress get/track (nested map upsert).
- `QuotaService` — port EXACTLY (use shared-lib `WeekWindow`):
  - `getLabQuota`: limit 120; used = (stale? 0 : lab_week_minutes) + inFlight(lab_started_at); remaining=max(0,limit-used); week_resets_at=weekEnd.
  - `getAiQuota`: limit 50; used = stale?0:ai_week_messages.
  - `closeLabSession`: atomic — if no lab_started_at → clear active_lab if set, return 0; else duration=max(1,(now-started)/60),
    single update {active_lab=null, lab_started_at=null, lab_week_start=weekStart, lab_week_minutes=(stale?0:cur)+duration}; return duration.
  - `incrementAiMessages`: {ai_week_start=weekStart, ai_week_messages=(stale?0:cur)+1}.
  - `setActiveLab`, `getActiveLab` (treat "null" string as null), `recordLabSession`.
- `CognitoService` — `CognitoIdentityProviderClient.adminUpdateUserAttributes` (userPoolId from issuer-uri tail).
  No-op + warn if pool id unset (parity with FastAPI).

## Web layer — `web/UserController` + DTOs (records, jakarta.validation)
Public + JWT (per §6.3). Identity = `CurrentUser.resolvedUserId()`, NOT the `{userId}` path var (parity).
- `POST /users` (public) — `CreateUserRequest{email @Email,name @NotBlank,password @NotBlank,role?,metadata?}` → 201 `UserResponse`; 400 if email exists.
- `GET /users/{userId}` → 404 if not found (with email fallback like `_require_user`).
- `PUT /users/{userId}` — partial update; `DELETE /users/{userId}` → 204.
- `GET /users/{userId}/labs` → `{labs:[...]}`.
- `GET /users/{userId}/progress?module_uuid&lesson_uuid` → `{progress:{...}}`.
- `POST /users/{userId}/progress/{moduleUuid}/{lessonUuid}/{questionNumber}` body `{completed:bool}` → `{updated:true}`.
- `GET /users/{userId}/lab-quota`, `GET /users/{userId}/ai-quota`.
- `GET /users` (list, limit, last_key) → `{users,count,last_key?}`.
- Also expose `/internal/users/{id}/lab-quota`, `/internal/users/{id}/close-lab-session`, `/internal/users/{id}/active-lab`
  for lab-service (cluster-only; covered by JWT or a network policy — for now JWT-authenticated).

## Config — `application.yml`
`server.port=8081`; `spring.application.name=user-service`; `spring.threads.virtual.enabled=true`;
`rosettacloud.aws.region=${AWS_REGION:us-east-1}`; `spring.security.oauth2.resourceserver.jwt.issuer-uri=${COGNITO_ISSUER_URL:}`;
`rosettacloud.security.audience=${COGNITO_CLIENT_ID:}`; `USERS_TABLE_NAME` via AwsProperties or @Value (default `rosettacloud-users`).
Management endpoints: health, info, prometheus.

## Tests (Definition of Done)
- `QuotaServiceTest` (unit, Mockito repo) — golden cases: fresh week, stale reset, in-flight minutes, closeLabSession idempotency, 0/negative remaining.
- `UserControllerTest` (`@WebMvcTest` + spring-security-test) — public create, 401 unauthenticated, 404, validation 400 (ProblemDetail shape), progress update.
- `UserRepositoryIT` / `UserServiceIT` (`@SpringBootTest` + Testcontainers LocalStack DYNAMODB via `@DynamicPropertySource`
  → `rosettacloud.aws.dynamodb.endpoint-override`) — create table (PK + GSI), round-trip incl. nested `progress` + `metadata`;
  assert a Python-style item (native M maps) round-trips unchanged.

## Packaging
- `Dockerfile` (multistage: build with maven+corretto25, run on `amazoncorretto:25`); expose 8081.
- `k8s/`: `deployment.yaml` (ns dev, SA `rosettacloud-user-service`, ConfigMap env), `service.yaml` (ClusterIP 8081),
  `configmap.yaml` (AWS_REGION, COGNITO_ISSUER_URL, COGNITO_CLIENT_ID, USERS_TABLE_NAME),
  `serviceaccount.yaml` (IRSA annotation → a `rosettacloud-user-service-irsa` role; reuse backend IRSA perms subset: DynamoDB rosettacloud-*, Cognito AdminUpdateUserAttributes).

## Acceptance criteria
- `./mvnw -pl user-service -am verify` GREEN; all tests pass; JaCoCo ≥80% on service/domain.
- Manual: `POST /users` then `GET /users/{id}/lab-quota` returns `{minutes_used,minutes_remaining:120,minutes_limit:120,week_resets_at}`.
- DynamoDB item written by Java is readable by the Python plane (same attribute names/types) — asserted in IT.
