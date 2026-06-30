package app.rosettacloud.chat.service;

import app.rosettacloud.chat.client.UserAiQuotaClient;
import app.rosettacloud.chat.web.dto.ChatRequest;
import app.rosettacloud.chat.web.dto.ChatResponse;
import app.rosettacloud.shared.error.QuotaExceededException;
import app.rosettacloud.shared.error.TooManyRequestsException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatServiceTest {

    private final AgentInvoker invoker = mock(AgentInvoker.class);
    private final ChatSessionStore sessionStore = mock(ChatSessionStore.class);
    private final RateLimiter rateLimiter = mock(RateLimiter.class);
    private final UserAiQuotaClient quotaClient = mock(UserAiQuotaClient.class);
    private final ImageValidator imageValidator = new ImageValidator();
    private ChatService service;

    @BeforeEach
    void setup() {
        service = new ChatService(invoker, sessionStore, rateLimiter, quotaClient, imageValidator,
                new app.rosettacloud.shared.events.NoOpDomainEventPublisher());
        when(rateLimiter.tryAcquire(anyString())).thenReturn(true);
        when(invoker.invoke(any())).thenReturn(new AgentInvoker.Reply("Hello!", "tutor"));
        when(quotaClient.aiQuota(anyString())).thenReturn(Map.of("messages_remaining", 50, "messages_limit", 50));
    }

    private static ChatRequest chat(String type) {
        return new ChatRequest("hi", "", "sess-1", "m", "l", type, 0, "", null);
    }

    @Test
    void chatSuccessUpdatesHistoryAndQuota() {
        ChatResponse res = service.handle("u1", chat("chat"));
        assertThat(res.response()).isEqualTo("Hello!");
        assertThat(res.agent()).isEqualTo("tutor");
        verify(sessionStore).append("sess-1", "hi", "Hello!");
        verify(quotaClient).increment("u1");
    }

    @Test
    void rateLimitExceededThrows429() {
        when(rateLimiter.tryAcquire(anyString())).thenReturn(false);
        assertThatThrownBy(() -> service.handle("u1", chat("chat")))
                .isInstanceOf(TooManyRequestsException.class);
    }

    @Test
    void aiQuotaExhaustedThrows403WithCode() {
        when(quotaClient.aiQuota("u1")).thenReturn(Map.of("messages_remaining", 0, "messages_limit", 50));
        assertThatThrownBy(() -> service.handle("u1", chat("chat")))
                .isInstanceOf(QuotaExceededException.class)
                .satisfies(e -> assertThat(((QuotaExceededException) e).getCode()).isEqualTo("AI_QUOTA_EXHAUSTED"));
    }

    @Test
    void explainTypeSkipsHistoryAndQuota() {
        service.handle("u1", chat("explain"));
        verify(sessionStore, never()).append(anyString(), any(), any());
        verify(quotaClient, never()).increment(anyString());
        verify(invoker).invoke(any());
    }

    @Test
    void gradeTypeDoesNotConsumeAiQuota() {
        service.handle("u1", chat("grade"));
        verify(quotaClient, never()).increment(anyString());
    }
}
