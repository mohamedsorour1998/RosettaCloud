package app.rosettacloud.question.client;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.Map;

/** Best-effort call to user-service to record question completion (full client formalised in WP-60). */
@Component
public class UserProgressClient {

    private static final Logger log = LoggerFactory.getLogger(UserProgressClient.class);

    private final RestClient http;

    public UserProgressClient(@Value("${rosettacloud.clients.user-service-base-url:http://user-service.dev.svc.cluster.local:8081}") String baseUrl) {
        var factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(java.time.Duration.ofSeconds(2));
        factory.setReadTimeout(java.time.Duration.ofSeconds(5));
        this.http = RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    public void trackProgress(String userId, String moduleUuid, String lessonUuid, int questionNumber, String bearer) {
        try {
            http.post()
                    .uri("/internal/users/{u}/progress/{m}/{l}/{n}", userId, moduleUuid, lessonUuid, questionNumber)
                    .headers(h -> {
                        if (bearer != null && !bearer.isBlank()) {
                            h.setBearerAuth(bearer);
                        }
                    })
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("completed", true))
                    .retrieve()
                    .toBodilessEntity();
        } catch (Exception e) {
            log.warn("Failed to record progress for user {} q{}: {}", userId, questionNumber, e.getMessage());
        }
    }
}
