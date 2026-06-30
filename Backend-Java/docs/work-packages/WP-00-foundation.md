# WP-00 — Foundation & shared-lib platform starter

> Sub-agent brief. Self-contained. Read this + `docs/MIGRATION-PLAN.md` §3,§6. No assumptions — web-search & cite if unsure.
> Module: `Backend-Java/shared-lib` (parent POM + wrapper already DONE).
> Verify: `cd Backend-Java && JAVA_HOME=~/tools/jdk25 ./mvnw -q -pl shared-lib -am verify`

## Objective
Build the cross-cutting platform starter every service depends on: RFC-7807 error model, Cognito JWT
resource-server security (auto-configured), AWS client beans (DynamoDB Enhanced), schemaless `metadata`
converter, and the `WeekWindow` quota-time utility. Delivered as **auto-configuration** (services get it
without component-scanning `app.rosettacloud.shared`).

## Source references (read for exact semantics)
- `Backend/app/dependencies/auth.py` — JWT claim resolution (`custom:user_id` ?: `sub` → resolved_user_id).
- `Backend/app/backends/users_backends.py` — week-window math (`record_lab_session`, `get_lab_quota`).

## Files to create
```
shared-lib/src/main/java/app/rosettacloud/shared/
  error/ApiException.java                 # RuntimeException(HttpStatus status, String detail, String code)
  error/ResourceNotFoundException.java    # 404
  error/BadRequestException.java          # 400
  error/ConflictException.java            # 409
  error/QuotaExceededException.java       # 403 + Object payload (e.g. quota map) + code
  error/TooManyRequestsException.java     # 429
  error/GlobalExceptionHandler.java       # @RestControllerAdvice → ProblemDetail (RFC7807)
  security/SecurityProperties.java        # @ConfigurationProperties("rosettacloud.security") public-paths, admin-paths, audience
  security/CognitoJwtAuthenticationConverter.java  # Jwt→JwtAuthenticationToken; principal=custom:user_id?:sub; authorities from cognito:groups/custom:role
  security/AudienceTokenUseValidator.java # OAuth2TokenValidator<Jwt>: aud contains clientId AND token_use==id (configurable, lenient if unset)
  security/CurrentUser.java               # static resolvedUserId(): reads SecurityContext principal
  aws/AwsProperties.java                  # @ConfigurationProperties("rosettacloud.aws") region, dynamodb.endpoint-override (test)
  aws/DynamoMapAttributeConverter.java    # AttributeConverter<Map<String,Object>> ⇄ native DynamoDB M (recursive: String/Number/Bool/Map/List/null)
  util/WeekWindow.java                    # currentWeekStartEpoch()/currentWeekEndEpoch() = Monday 00:00 UTC; minutesSince(epoch)
  config/RosettaCloudWebAutoConfiguration.java      # @AutoConfiguration; @Bean GlobalExceptionHandler
  config/RosettaCloudSecurityAutoConfiguration.java # @AutoConfiguration; @EnableWebSecurity @EnableMethodSecurity; @EnableConfigurationProperties(SecurityProperties); @Bean SecurityFilterChain, JwtAuthenticationConverter; @Bean(@ConditionalOnProperty issuer-uri) JwtDecoder w/ DelegatingOAuth2TokenValidator(default+audience)
  config/RosettaCloudAwsAutoConfiguration.java      # @AutoConfiguration; @EnableConfigurationProperties(AwsProperties); @Bean DynamoDbClient (DefaultCredentialsProvider, region, optional endpointOverride), DynamoDbEnhancedClient
shared-lib/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
  # lists the 3 @AutoConfiguration FQCNs
shared-lib/src/test/java/app/rosettacloud/shared/
  util/WeekWindowTest.java                # Monday-anchor cases, reset boundary, in-flight minutes
  aws/DynamoMapAttributeConverterTest.java# round-trip nested map ⇄ AttributeValue M (string/number/bool/nested/list)
```

## Security spec (exact)
- `SecurityFilterChain`: `csrf.disable()`, `sessionManagement(STATELESS)`,
  `authorizeHttpRequests`: permitAll `SecurityProperties.publicPaths` (default `POST /users`, `/health-check`,
  `/actuator/health`, `/actuator/info`, `/public/**`, `OPTIONS /**`); everything else `authenticated()`.
  `oauth2ResourceServer(o -> o.jwt(j -> j.jwtAuthenticationConverter(converter)))`.
- `JwtDecoder` bean only when `spring.security.oauth2.resourceserver.jwt.issuer-uri` is set
  (`NimbusJwtDecoder.withIssuerLocation(issuer)` + `setJwtValidator(new DelegatingOAuth2TokenValidator<>(
  JwtValidators.createDefaultWithIssuer(issuer), new AudienceTokenUseValidator(props)))`). Tests provide their own.
- Converter: authorities = `ROLE_` + each of `cognito:groups` (list) and `custom:role` (string) if present;
  principal name = `custom:user_id` else `sub`.

## WeekWindow spec (match Python EXACTLY)
- `now = Instant.now()`; `weekStart` = most recent Monday at 00:00:00 UTC as epoch seconds; `weekEnd = weekStart + 7*24*3600`.
- Provide `long minutesSince(long epochSecs)` = `max(0,(now-epochSecs)/60)` and `boolean isStale(long storedWeekStart)` = `storedWeekStart < weekStart`.

## Acceptance criteria
- `./mvnw -pl shared-lib -am verify` GREEN; WeekWindow + converter tests pass.
- No `@ComponentScan` needed by consumers — auto-config imports file present and lists all 3 configs.
- `ApiException` hierarchy + handler produce `ProblemDetail` with `status`, `detail`, and `properties.code` when set.
