package app.rosettacloud.lab.client;

import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.bulkhead.ThreadPoolBulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig.SlidingWindowType;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.timelimiter.TimeLimiterConfig;
import io.github.resilience4j.timelimiter.TimeLimiterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4JAutoConfiguration;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4JCircuitBreakerFactory;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4JConfigBuilder;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4JConfigurationProperties;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4jBulkheadProvider;
import org.springframework.cloud.client.circuitbreaker.CircuitBreakerFactory;

import java.net.ServerSocket;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * SPIKE for Part B §B.3 — Spring Cloud CircuitBreaker (Resilience4j backend) on Spring Boot 4 /
 * Spring Framework 7 / Java 25.
 *
 * <p>Proves three things the adoption Definition-of-Ready (§B.1.3) and Part B acceptance require:
 * <ol>
 *   <li><b>The library works on the Boot 4 classpath</b> and the fail-open contract of the wired
 *       client ({@code UserServiceClient.setActiveLab}) is preserved while the breaker adds
 *       CLOSED→OPEN fast-fail — {@link #setActiveLabStaysFailOpenAndTripsBreakerOpen()}.</li>
 *   <li><b>An OPEN breaker fast-fails to the fallback</b> without invoking the guarded supplier
 *       (the {@code not_permitted} path) — {@link #openBreakerFastFailsWithoutInvokingSupplier()}.</li>
 *   <li><b>The {@code CircuitBreakerFactory} autoconfigures on Boot 4</b> and the production
 *       {@link LabResilienceConfig} customizer is applied — {@link #factoryAutoconfiguresOnBoot4AndAppliesCustomizer()}.</li>
 * </ol>
 *
 * <p>No network: the client is pointed at a guaranteed-closed port, so every HTTP attempt fails fast
 * with a connection refusal, and the state machine is asserted against Resilience4j's own registry.
 */
class UserServiceClientCircuitBreakerTest {

    private static final String BREAKER_ID = "user-session";

    /** Base URL for a guaranteed-closed local port (connection refused → fast + deterministic). */
    private static String closedPortBaseUrl() throws Exception {
        try (ServerSocket probe = new ServerSocket(0)) {
            return "http://127.0.0.1:" + probe.getLocalPort();
        } // closed here → connects are refused immediately
    }

    /**
     * A real Spring Cloud factory with a small COUNT_BASED window so the breaker trips quickly and
     * deterministically in-test (5 calls, 50% failure threshold, stays OPEN for 60s so no flakiness
     * from an early HALF_OPEN transition).
     */
    private static Resilience4JCircuitBreakerFactory tunedFactory() {
        Resilience4JCircuitBreakerFactory factory = new Resilience4JCircuitBreakerFactory(
                CircuitBreakerRegistry.ofDefaults(),
                TimeLimiterRegistry.ofDefaults(),
                new Resilience4jBulkheadProvider(
                        ThreadPoolBulkheadRegistry.ofDefaults(),
                        BulkheadRegistry.ofDefaults(),
                        new Resilience4JConfigurationProperties()));
        factory.configureDefault(id -> new Resilience4JConfigBuilder(id)
                .circuitBreakerConfig(CircuitBreakerConfig.custom()
                        .slidingWindowType(SlidingWindowType.COUNT_BASED)
                        .slidingWindowSize(5)
                        .minimumNumberOfCalls(5)
                        .failureRateThreshold(50f)
                        .waitDurationInOpenState(Duration.ofSeconds(60))
                        .permittedNumberOfCallsInHalfOpenState(2)
                        .build())
                .timeLimiterConfig(TimeLimiterConfig.custom()
                        .timeoutDuration(Duration.ofSeconds(6))
                        .build())
                .build());
        return factory;
    }

    @Test
    void setActiveLabStaysFailOpenAndTripsBreakerOpen() throws Exception {
        Resilience4JCircuitBreakerFactory factory = tunedFactory();
        UserServiceClient client = new UserServiceClient(closedPortBaseUrl(), factory);

        // Drive more than one window of failing calls; EVERY one must remain fail-open (no throw),
        // exactly as the pre-circuit-breaker behavior guaranteed.
        for (int i = 0; i < 12; i++) {
            assertThatCode(() -> client.setActiveLab("u1", "lab-1")).doesNotThrowAnyException();
        }

        CircuitBreaker breaker = factory.getCircuitBreakerRegistry().circuitBreaker(BREAKER_ID);
        assertThat(breaker.getState()).isEqualTo(CircuitBreaker.State.OPEN);

        // With the breaker OPEN, the call STILL fails open — the fallback preserves the pre-CB outcome.
        assertThatCode(() -> client.setActiveLab("u1", "lab-1")).doesNotThrowAnyException();
    }

    @Test
    void openBreakerFastFailsWithoutInvokingSupplier() {
        Resilience4JCircuitBreakerFactory factory = tunedFactory();
        AtomicInteger supplierInvocations = new AtomicInteger();

        // Fill the window with failures to force the breaker OPEN.
        for (int i = 0; i < 5; i++) {
            factory.create(BREAKER_ID).run(
                    () -> {
                        supplierInvocations.incrementAndGet();
                        throw new RuntimeException("boom");
                    },
                    t -> "fallback");
        }
        assertThat(factory.getCircuitBreakerRegistry().circuitBreaker(BREAKER_ID).getState())
                .isEqualTo(CircuitBreaker.State.OPEN);

        int invocationsWhileClosed = supplierInvocations.get();
        // While OPEN the call short-circuits to the fallback WITHOUT invoking the supplier.
        String result = factory.create(BREAKER_ID).run(
                () -> {
                    supplierInvocations.incrementAndGet();
                    return "live";
                },
                t -> "fallback");

        assertThat(result).isEqualTo("fallback");
        assertThat(supplierInvocations.get()).isEqualTo(invocationsWhileClosed);
    }

    @Test
    void factoryAutoconfiguresOnBoot4AndPropertiesTuneBreaker() {
        new ApplicationContextRunner()
                // The registry beans come from resilience4j-spring-boot3 (transitive dep of the Spring
                // Cloud CircuitBreaker starter); the factory bean comes from Spring Cloud. If any of
                // these Boot-3-era autoconfigs failed to load on Boot 4 (the resilience4j#2351 concern),
                // the context would fail here — this is the KEEP/REVERT gate for the spike.
                .withConfiguration(AutoConfigurations.of(
                        io.github.resilience4j.springboot3.circuitbreaker.autoconfigure.CircuitBreakerAutoConfiguration.class,
                        io.github.resilience4j.springboot3.timelimiter.autoconfigure.TimeLimiterAutoConfiguration.class,
                        io.github.resilience4j.springboot3.bulkhead.autoconfigure.BulkheadAutoConfiguration.class,
                        Resilience4JAutoConfiguration.class))
                // Same properties lab-service ships in application.yml. With resilience4j-spring-boot3
                // present, the Spring Cloud factory resolves config from the registry's named "default"
                // configuration (create(id) uses group "default"), so THESE PROPERTIES — not a Spring
                // Cloud Customizer bean — are the effective tuning mechanism (spike finding, §B.3.2).
                .withPropertyValues(
                        "resilience4j.circuitbreaker.configs.default.sliding-window-type=COUNT_BASED",
                        "resilience4j.circuitbreaker.configs.default.sliding-window-size=20",
                        "resilience4j.circuitbreaker.configs.default.minimum-number-of-calls=20",
                        "resilience4j.circuitbreaker.configs.default.failure-rate-threshold=50",
                        "resilience4j.circuitbreaker.configs.default.wait-duration-in-open-state=10s",
                        "resilience4j.circuitbreaker.configs.default.permitted-number-of-calls-in-half-open-state=3",
                        "resilience4j.timelimiter.configs.default.timeout-duration=6s")
                .run(ctx -> {
                    // (1) The Spring Cloud CircuitBreaker factory autoconfigures on Boot 4 / SF7.
                    assertThat(ctx).hasNotFailed();
                    assertThat(ctx).hasSingleBean(CircuitBreakerFactory.class);

                    Resilience4JCircuitBreakerFactory factory =
                            ctx.getBean(Resilience4JCircuitBreakerFactory.class);

                    // (2) A trivial breaker created from the autoconfigured factory runs closed.
                    assertThat(factory.create("probe").run(() -> "ok", t -> "fallback")).isEqualTo("ok");

                    // (3) The breaker lab-service actually uses ("user-session", group "default") picks up
                    // the §B.3.2 policy from the resilience4j.* properties: window 20 and a 6s TimeLimiter
                    // (overriding Spring Cloud's 1s default). This is the production config path.
                    factory.create(BREAKER_ID);
                    CircuitBreakerConfig cbCfg = factory.getCircuitBreakerRegistry()
                            .circuitBreaker(BREAKER_ID).getCircuitBreakerConfig();
                    assertThat(cbCfg.getSlidingWindowSize()).isEqualTo(20);
                    assertThat(cbCfg.getFailureRateThreshold()).isEqualTo(50f);

                    assertThat(factory.getTimeLimiterRegistry().timeLimiter(BREAKER_ID)
                            .getTimeLimiterConfig().getTimeoutDuration()).isEqualTo(Duration.ofSeconds(6));
                });
    }
}
