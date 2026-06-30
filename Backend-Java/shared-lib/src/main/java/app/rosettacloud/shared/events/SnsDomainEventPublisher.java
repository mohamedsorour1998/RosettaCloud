package app.rosettacloud.shared.events;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import software.amazon.awssdk.services.sns.SnsClient;

import java.time.Instant;

/** Publishes events as JSON {@code {type,user_id,ts}} to an SNS topic (consumed by analytics-service). */
public class SnsDomainEventPublisher implements DomainEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(SnsDomainEventPublisher.class);

    private final SnsClient sns;
    private final String topicArn;

    public SnsDomainEventPublisher(SnsClient sns, String topicArn) {
        this.sns = sns;
        this.topicArn = topicArn;
    }

    @Override
    public void publish(String type, String userId) {
        String msg = "{\"type\":\"" + esc(type) + "\",\"user_id\":\"" + esc(userId)
                + "\",\"ts\":" + Instant.now().getEpochSecond() + "}";
        try {
            sns.publish(b -> b.topicArn(topicArn).message(msg));
        } catch (Exception e) {
            // Event publishing is best-effort — never fail the request because analytics is down.
            log.warn("Failed to publish event {} for {}: {}", type, userId, e.getMessage());
        }
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
