package app.rosettacloud.chat.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

/** Fixed-window per-key rate limiter (default 30/hour) backed by Redis INCR+EXPIRE. */
@Component
public class RedisRateLimiter implements RateLimiter {

    private static final Logger log = LoggerFactory.getLogger(RedisRateLimiter.class);
    private static final long WINDOW_SECONDS = 3600;

    private final StringRedisTemplate redis;
    private final int limit;

    public RedisRateLimiter(StringRedisTemplate redis,
                            @Value("${rosettacloud.chat.rate-limit-per-hour:30}") int limit) {
        this.redis = redis;
        this.limit = limit;
    }

    @Override
    public boolean tryAcquire(String key) {
        try {
            String redisKey = "ratelimit:" + key;
            Long count = redis.opsForValue().increment(redisKey);
            if (count != null && count == 1L) {
                redis.expire(redisKey, Duration.ofSeconds(WINDOW_SECONDS));
            }
            return count == null || count <= limit;
        } catch (Exception e) {
            // Fail-open on Redis errors so a cache outage doesn't block all chat.
            log.warn("Rate limiter unavailable for {}: {} — allowing", key, e.getMessage());
            return true;
        }
    }
}
