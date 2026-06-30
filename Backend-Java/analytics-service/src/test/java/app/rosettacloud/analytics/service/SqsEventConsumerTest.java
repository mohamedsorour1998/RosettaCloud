package app.rosettacloud.analytics.service;

import app.rosettacloud.analytics.persistence.StatsRepository;
import app.rosettacloud.shared.events.EventsProperties;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SqsEventConsumerTest {

    @Test
    void mapsEventTypesToCounters() {
        assertThat(SqsEventConsumer.fieldFor("lab.started")).isEqualTo("lab_started");
        assertThat(SqsEventConsumer.fieldFor("question.correct")).isEqualTo("question_correct");
        assertThat(SqsEventConsumer.fieldFor("chat.message")).isEqualTo("chat_message");
        assertThat(SqsEventConsumer.fieldFor("user.created")).isEqualTo("users_seen");
        assertThat(SqsEventConsumer.fieldFor("unknown")).isNull();
    }

    @Test
    void pollIncrementsCounterAndDeletesMessage() {
        SqsClient sqs = mock(SqsClient.class);
        StatsRepository stats = mock(StatsRepository.class);
        EventsProperties props = new EventsProperties();
        props.setQueueUrl("http://localhost/q");

        ReceiveMessageResponse resp = ReceiveMessageResponse.builder()
                .messages(Message.builder()
                        .body("{\"type\":\"chat.message\",\"user_id\":\"u1\",\"ts\":1}")
                        .receiptHandle("rh-1").build())
                .build();
        when(sqs.receiveMessage(any(ReceiveMessageRequest.class))).thenReturn(resp);

        new SqsEventConsumer(sqs, props, stats).poll();

        verify(stats).increment("chat_message");
        verify(sqs).deleteMessage(any(DeleteMessageRequest.class));
    }
}
