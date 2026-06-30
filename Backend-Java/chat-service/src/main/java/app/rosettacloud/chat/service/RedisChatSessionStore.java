package app.rosettacloud.chat.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Redis-backed conversation history (TTL + max-messages), replacing the FastAPI in-process dict. */
@Component
public class RedisChatSessionStore implements ChatSessionStore {

    private static final Logger log = LoggerFactory.getLogger(RedisChatSessionStore.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper = new ObjectMapper();
    private final long ttlSeconds;
    private final int maxMessages;

    public RedisChatSessionStore(StringRedisTemplate redis,
                                 @Value("${rosettacloud.chat.session-ttl-seconds:14400}") long ttlSeconds,
                                 @Value("${rosettacloud.chat.history-max-messages:40}") int maxMessages) {
        this.redis = redis;
        this.ttlSeconds = ttlSeconds;
        this.maxMessages = maxMessages;
    }

    private static String key(String sessionId) {
        return "chat:hist:" + sessionId;
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<Map<String, String>> history(String sessionId) {
        try {
            String json = redis.opsForValue().get(key(sessionId));
            if (json == null || json.isBlank()) {
                return new ArrayList<>();
            }
            return mapper.readValue(json, List.class);
        } catch (Exception e) {
            log.warn("Failed to read session history {}: {}", sessionId, e.getMessage());
            return new ArrayList<>();
        }
    }

    @Override
    public void append(String sessionId, String userText, String assistantText) {
        try {
            List<Map<String, String>> history = history(sessionId);
            history.add(turn("user", userText));
            history.add(turn("assistant", assistantText));
            while (history.size() > maxMessages) {
                history.remove(0);
            }
            redis.opsForValue().set(key(sessionId), mapper.writeValueAsString(history), Duration.ofSeconds(ttlSeconds));
        } catch (Exception e) {
            log.warn("Failed to append session history {}: {}", sessionId, e.getMessage());
        }
    }

    private static Map<String, String> turn(String role, String text) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("role", role);
        m.put("text", text == null ? "" : text);
        return m;
    }
}
