package app.rosettacloud.chat.client;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.HashMap;
import java.util.Map;

/** Reads/increments the weekly AI message quota via user-service internal endpoints. */
@Component
public class UserAiQuotaClient {

    private static final Logger log = LoggerFactory.getLogger(UserAiQuotaClient.class);

    private final RestClient http;

    public UserAiQuotaClient(@Value("${rosettacloud.clients.user-service-base-url:http://user-service.dev.svc.cluster.local:8081}") String baseUrl) {
        this.http = RestClient.builder().baseUrl(baseUrl).build();
    }

    /** Returns the quota snapshot (snake-case keys) or a permissive default on failure. */
    public Map<String, Object> aiQuota(String userId) {
        try {
            Map<?, ?> m = http.get().uri("/internal/users/{u}/ai-quota", userId).retrieve().body(Map.class);
            Map<String, Object> out = new HashMap<>();
            if (m != null) {
                m.forEach((k, v) -> out.put(String.valueOf(k), v));
            }
            return out;
        } catch (Exception e) {
            log.warn("ai-quota lookup failed for {}: {}", userId, e.getMessage());
            Map<String, Object> fallback = new HashMap<>();
            fallback.put("messages_remaining", 50);
            fallback.put("messages_limit", 50);
            return fallback;
        }
    }

    public void increment(String userId) {
        try {
            http.post().uri("/internal/users/{u}/ai/increment", userId).retrieve().toBodilessEntity();
        } catch (Exception e) {
            log.warn("ai increment failed for {}: {}", userId, e.getMessage());
        }
    }
}
