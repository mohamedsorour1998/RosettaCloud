package app.rosettacloud.lab.client;

import app.rosettacloud.shared.resilience.HttpRetry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.client.circuitbreaker.CircuitBreakerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.Map;
import java.util.Optional;

/**
 * Calls user-service cluster-internal endpoints for quota/active-lab/session bookkeeping.
 *
 * <p>Resilience (Part B §B.3.2/§B.3.3): every cross-boundary call is wrapped in a Spring Cloud
 * CircuitBreaker (Resilience4j backend) so a <em>sustained</em> user-service outage fast-fails
 * (instead of paying connect+read timeouts on every lab launch/terminate), while transient
 * rolling-deploy blips are still absorbed by {@link HttpRetry} <em>inside</em> the breaker (retry
 * and CB compose). Two per-id instances share the "user-*" policy vocabulary: reads use
 * {@code "user-quota"} and session/lifecycle mutations use {@code "user-session"}. Crucially, every
 * fallback returns the SAME fail-open value the previous try/catch returned, so the breaker changes
 * only <em>when</em> we give up, never <em>what</em> we do on failure — the non-regression guarantee.
 */
@Component
public class UserServiceClient {

    private static final Logger log = LoggerFactory.getLogger(UserServiceClient.class);

    private final RestClient http;
    private final CircuitBreakerFactory<?, ?> circuitBreakers;

    public UserServiceClient(
            @Value("${rosettacloud.clients.user-service-base-url:http://user-service.dev.svc.cluster.local:8081}") String baseUrl,
            CircuitBreakerFactory<?, ?> circuitBreakers) {
        var requestFactory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(java.time.Duration.ofSeconds(2));
        requestFactory.setReadTimeout(java.time.Duration.ofSeconds(5));
        this.http = RestClient.builder().baseUrl(baseUrl).requestFactory(requestFactory).build();
        this.circuitBreakers = circuitBreakers;
    }

    public long remainingLabMinutes(String userId) {
        return circuitBreakers.create("user-quota").run(
                () -> {
                    Map<?, ?> m = HttpRetry.withRetry(2, 150,
                            () -> http.get().uri("/internal/users/{u}/lab-quota", userId).retrieve().body(Map.class));
                    Object v = m == null ? null : m.get("minutes_remaining");
                    return v instanceof Number n ? n.longValue() : 0L;
                },
                throwable -> {
                    log.warn("lab-quota lookup failed for {}: {}", userId, throwable.getMessage());
                    return 0L;
                });
    }

    public Optional<String> activeLab(String userId) {
        return circuitBreakers.create("user-session").run(
                () -> {
                    Map<?, ?> m = HttpRetry.withRetry(2, 150,
                            () -> http.get().uri("/internal/users/{u}/active-lab", userId).retrieve().body(Map.class));
                    Object v = m == null ? null : m.get("active_lab");
                    return Optional.ofNullable(v == null ? null : v.toString());
                },
                throwable -> {
                    log.warn("active-lab lookup failed for {}: {}", userId, throwable.getMessage());
                    return Optional.<String>empty();
                });
    }

    public void setActiveLab(String userId, String labId) {
        // Fail-open: this runs AFTER the pod is provisioned and tracked in LabService.launch(); a
        // user-service blip must not fail an otherwise-successful launch (consistent with linkLab below).
        //
        // Circuit breaker (Part B §B.3.2/§B.3.3): the "user-session" breaker wraps the existing
        // HttpRetry so a *sustained* user-service outage fast-fails (instead of paying connect+read
        // timeouts on every launch), while transient rolling-deploy blips are still absorbed by
        // HttpRetry *inside* the breaker (retry and CB compose). The fallback returns the SAME
        // fail-open outcome as before (log + swallow), so the breaker changes only *when* we give up,
        // never *what* we do on failure — the non-regression guarantee from §B.3.2.
        circuitBreakers.create("user-session").run(
                () -> {
                    HttpRetry.withRetry(2, 150,
                            () -> http.post().uri("/internal/users/{u}/active-lab/{l}", userId, labId).retrieve().toBodilessEntity());
                    return Boolean.TRUE;
                },
                throwable -> {
                    log.warn("setActiveLab failed for {} -> {}: {}", userId, labId, throwable.toString());
                    return Boolean.FALSE;
                });
    }

    public long closeLabSession(String userId) {
        return circuitBreakers.create("user-session").run(
                () -> {
                    Map<?, ?> m = HttpRetry.withRetry(2, 150,
                            () -> http.post().uri("/internal/users/{u}/close-lab-session", userId)
                                    .retrieve().body(Map.class));
                    Object v = m == null ? null : m.get("minutes_recorded");
                    return v instanceof Number n ? n.longValue() : 0L;
                },
                throwable -> {
                    log.warn("close-lab-session failed for {}: {}", userId, throwable.getMessage());
                    return 0L;
                });
    }

    public void linkLab(String userId, String labId) {
        circuitBreakers.create("user-session").run(
                () -> {
                    HttpRetry.withRetry(2, 150,
                            () -> http.post().uri("/internal/users/{u}/labs/{l}", userId, labId).retrieve().toBodilessEntity());
                    return Boolean.TRUE;
                },
                throwable -> {
                    log.warn("linkLab failed: {}", throwable.getMessage());
                    return Boolean.FALSE;
                });
    }

    public void unlinkLab(String userId, String labId) {
        circuitBreakers.create("user-session").run(
                () -> {
                    HttpRetry.withRetry(2, 150,
                            () -> http.delete().uri("/internal/users/{u}/labs/{l}", userId, labId).retrieve().toBodilessEntity());
                    return Boolean.TRUE;
                },
                throwable -> {
                    log.warn("unlinkLab failed: {}", throwable.getMessage());
                    return Boolean.FALSE;
                });
    }
}
