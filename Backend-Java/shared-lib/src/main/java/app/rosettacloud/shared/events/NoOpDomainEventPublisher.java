package app.rosettacloud.shared.events;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Default publisher used when {@code rosettacloud.events.topic-arn} is not set (tests/local). */
public class NoOpDomainEventPublisher implements DomainEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(NoOpDomainEventPublisher.class);

    @Override
    public void publish(String type, String userId) {
        log.debug("event (no-op): {} user={}", type, userId);
    }
}
