package app.rosettacloud.shared.events;

/** Publishes lightweight domain events (e.g. {@code lab.started}, {@code chat.message}) for analytics. */
public interface DomainEventPublisher {
    void publish(String type, String userId);
}
