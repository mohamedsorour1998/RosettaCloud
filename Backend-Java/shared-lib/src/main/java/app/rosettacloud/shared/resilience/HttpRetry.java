package app.rosettacloud.shared.resilience;

import org.springframework.web.client.ResourceAccessException;

import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/**
 * Bounded retry for idempotent inter-service HTTP calls. Retries only transient I/O failures
 * (connection refused / read timeout — {@link ResourceAccessException}), which is the common case
 * during rolling deploys in Kubernetes; HTTP status errors (4xx/5xx) propagate immediately and are
 * handled by the caller's fail-open logic.
 *
 * <p>Back-off between attempts is linear ({@code delayMs × attempt}) with <em>full jitter</em> and a
 * hard {@link #MAX_BACKOFF_MS} cap. The jitter de-synchronizes retries across pods so a user-service
 * restart during a rolling deploy cannot trigger a coordinated retry storm (thundering herd), and the
 * cap bounds the worst-case latency added to a fail-open call. The retry <em>policy</em> (attempt
 * count and exception selectivity) is unchanged, so this composes cleanly with a future circuit
 * breaker that would wrap {@code withRetry} — transient blips are retried while only a sustained
 * failure rate trips the breaker (see AGENTCORE-RESILIENCE4J-RUNTIME-PLAN §B.3.2).
 *
 * <p>Spring Framework 7 ships native {@code @Retryable}/{@code RetryTemplate}, but its method-name
 * surface was still shifting across Boot 4 milestones; this tiny, deterministic helper keeps the
 * retry policy explicit and unit-testable without coupling to that evolving API.
 */
public final class HttpRetry {

    /**
     * Upper bound on any single back-off sleep. Guarantees a large {@code delayMs} or attempt count
     * can never translate into an unbounded stall on a latency-sensitive fail-open path.
     */
    static final long MAX_BACKOFF_MS = 2_000L;

    private HttpRetry() {
    }

    /**
     * @param maxAttempts total attempts including the first (e.g. 2 = one retry)
     * @param delayMs     base delay between attempts; multiplied by the attempt number (linear back-off)
     * @param op          the HTTP call to execute
     */
    public static <T> T withRetry(int maxAttempts, long delayMs, Supplier<T> op) {
        ResourceAccessException last = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return op.get();
            } catch (ResourceAccessException transientFailure) {
                last = transientFailure;
                if (attempt < maxAttempts) {
                    sleep(backoffMillis(delayMs, attempt));
                }
            }
        }
        throw last;
    }

    /**
     * Linear back-off with full jitter, capped at {@link #MAX_BACKOFF_MS}. Returns a value uniformly
     * distributed in {@code [0, min(delayMs × attempt, MAX_BACKOFF_MS)]}; a non-positive target
     * yields {@code 0} (no sleep). Package-private so the bound can be asserted in unit tests.
     */
    static long backoffMillis(long delayMs, int attempt) {
        long target = Math.min(delayMs * (long) attempt, MAX_BACKOFF_MS);
        if (target <= 0L) {
            return 0L;
        }
        // Full jitter: uniformly random in [0, target] (nextLong's bound is exclusive, so add 1).
        return ThreadLocalRandom.current().nextLong(target + 1L);
    }

    private static void sleep(long ms) {
        if (ms <= 0L) {
            return;
        }
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted during retry back-off", ie);
        }
    }
}
