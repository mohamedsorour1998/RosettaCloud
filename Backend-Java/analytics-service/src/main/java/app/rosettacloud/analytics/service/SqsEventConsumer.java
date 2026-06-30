package app.rosettacloud.analytics.service;

import app.rosettacloud.analytics.persistence.StatsRepository;
import app.rosettacloud.shared.events.EventsProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Polls the analytics SQS queue and increments the durable {@code STATS#global} counters. Only active
 * when {@code rosettacloud.events.queue-url} is configured (so tests/local/e2e stay self-contained).
 */
@Component
@ConditionalOnProperty(prefix = "rosettacloud.events", name = "queue-url")
public class SqsEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(SqsEventConsumer.class);
    private static final Pattern TYPE = Pattern.compile("\"type\"\\s*:\\s*\"([^\"]+)\"");

    private final SqsClient sqs;
    private final String queueUrl;
    private final StatsRepository stats;

    public SqsEventConsumer(SqsClient sqs, EventsProperties props, StatsRepository stats) {
        this.sqs = sqs;
        this.queueUrl = props.getQueueUrl();
        this.stats = stats;
    }

    /** Maps a domain event type to its STATS#global counter attribute, or null to ignore. */
    public static String fieldFor(String type) {
        return switch (type == null ? "" : type) {
            case "lab.started" -> "lab_started";
            case "lab.terminated" -> "lab_terminated";
            case "question.attempted" -> "question_attempted";
            case "question.correct" -> "question_correct";
            case "chat.message" -> "chat_message";
            case "user.created" -> "users_seen";
            default -> null;
        };
    }

    @Scheduled(fixedDelayString = "${rosettacloud.events.poll-ms:5000}")
    public void poll() {
        ReceiveMessageRequest req = ReceiveMessageRequest.builder()
                .queueUrl(queueUrl).maxNumberOfMessages(10).waitTimeSeconds(2).build();
        for (Message m : sqs.receiveMessage(req).messages()) {
            try {
                Matcher mt = TYPE.matcher(m.body());
                if (mt.find()) {
                    String field = fieldFor(mt.group(1));
                    if (field != null) {
                        stats.increment(field);
                    }
                }
            } catch (Exception e) {
                log.warn("Failed to process event: {}", e.getMessage());
            } finally {
                sqs.deleteMessage(DeleteMessageRequest.builder()
                        .queueUrl(queueUrl).receiptHandle(m.receiptHandle()).build());
            }
        }
    }
}
