package app.rosettacloud.lab.client;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.Map;
import java.util.Optional;

/** Calls user-service cluster-internal endpoints for quota/active-lab/session bookkeeping. */
@Component
public class UserServiceClient {

    private static final Logger log = LoggerFactory.getLogger(UserServiceClient.class);

    private final RestClient http;

    public UserServiceClient(@Value("${rosettacloud.clients.user-service-base-url:http://user-service.dev.svc.cluster.local:8081}") String baseUrl) {
        this.http = RestClient.builder().baseUrl(baseUrl).build();
    }

    public long remainingLabMinutes(String userId) {
        try {
            Map<?, ?> m = http.get().uri("/internal/users/{u}/lab-quota", userId).retrieve().body(Map.class);
            Object v = m == null ? null : m.get("minutes_remaining");
            return v instanceof Number n ? n.longValue() : 0;
        } catch (Exception e) {
            log.warn("lab-quota lookup failed for {}: {}", userId, e.getMessage());
            return 0;
        }
    }

    public Optional<String> activeLab(String userId) {
        try {
            Map<?, ?> m = http.get().uri("/internal/users/{u}/active-lab", userId).retrieve().body(Map.class);
            Object v = m == null ? null : m.get("active_lab");
            return Optional.ofNullable(v == null ? null : v.toString());
        } catch (Exception e) {
            log.warn("active-lab lookup failed for {}: {}", userId, e.getMessage());
            return Optional.empty();
        }
    }

    public void setActiveLab(String userId, String labId) {
        http.post().uri("/internal/users/{u}/active-lab/{l}", userId, labId).retrieve().toBodilessEntity();
    }

    public long closeLabSession(String userId) {
        try {
            Map<?, ?> m = http.post().uri("/internal/users/{u}/close-lab-session", userId)
                    .retrieve().body(Map.class);
            Object v = m == null ? null : m.get("minutes_recorded");
            return v instanceof Number n ? n.longValue() : 0;
        } catch (Exception e) {
            log.warn("close-lab-session failed for {}: {}", userId, e.getMessage());
            return 0;
        }
    }

    public void linkLab(String userId, String labId) {
        try {
            http.post().uri("/internal/users/{u}/labs/{l}", userId, labId).retrieve().toBodilessEntity();
        } catch (Exception e) {
            log.warn("linkLab failed: {}", e.getMessage());
        }
    }

    public void unlinkLab(String userId, String labId) {
        try {
            http.delete().uri("/internal/users/{u}/labs/{l}", userId, labId).retrieve().toBodilessEntity();
        } catch (Exception e) {
            log.warn("unlinkLab failed: {}", e.getMessage());
        }
    }
}
