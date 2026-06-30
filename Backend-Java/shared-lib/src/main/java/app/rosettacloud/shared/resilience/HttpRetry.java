package app.rosettacloud.shared.resilience;

import org.springframework.web.client.ResourceAccessException;

import java.util.function.Supplier;

/**
 * Bounded retry for idempotent inter-service HTTP calls. Retries only transient I/O failures
 * (connection refused / read timeout — {@link ResourceAccessException}), which is the common case
 * during rolling deploys in Kubernetes; HTTP status errors (4xx/5xx) propagate immediately and are
 * handled by the caller's fail-open logic. Linear back-off between attempts.
 *
 * <p>Spring Framework 7 ships native {@code @Retryable}/{@code RetryTemplate}, but its method-name
 * surface was still shifting across Boot 4 milestones; this tiny, deterministic helper keeps the
 * retry policy explicit and unit-testable without coupling to that evolving API.
 */
public final class HttpRetry {

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
                    sleep(delayMs * attempt);
                }
            }
        }
        throw last;
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted during retry back-off", ie);
        }
    }
}
