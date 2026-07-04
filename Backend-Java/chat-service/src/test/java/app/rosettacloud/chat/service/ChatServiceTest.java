package app.rosettacloud.chat.service;

import app.rosettacloud.chat.client.UserAiQuotaClient;
import app.rosettacloud.chat.web.dto.ChatRequest;
import app.rosettacloud.chat.web.dto.ChatResponse;
import app.rosettacloud.shared.error.QuotaExceededException;
import app.rosettacloud.shared.error.TooManyRequestsException;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.bulkhead.ThreadPoolBulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.timelimiter.TimeLimiterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4JCircuitBreakerFactory;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4JConfigurationProperties;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4jBulkheadProvider;

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

    /**
     * A real Spring Cloud {@link Resilience4JCircuitBreakerFactory} (defaults) — same type the
     * autoconfiguration wires in production. Using the real factory keeps these assertions honest:
     * the "ai-plane" breaker stays CLOSED across the handful of calls here, and the fallback fires
     * only when the guarded invoke actually throws.
     */
    static Resilience4JCircuitBreakerFactory newCircuitBreakerFactory() {
        return new Resilience4JCircuitBreakerFactory(
                CircuitBreakerRegistry.ofDefaults(),
                TimeLimiterRegistry.ofDefaults(),
                new Resilience4jBulkheadProvider(
                        ThreadPoolBulkheadRegistry.ofDefaults(),
                        BulkheadRegistry.ofDefaults(),
                        new Resilience4JConfigurationProperties()));
    }

    @BeforeEach
    void setup() {
        service = new ChatService(invoker, sessionStore, rateLimiter, quotaClient, imageValidator,
                new app.rosettacloud.shared.events.NoOpDomainEventPublisher(), newCircuitBreakerFactory());
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

    @Test
    void aiPlaneFailureReturnsFriendlyReplyAndDoesNotChargeQuotaOrHistory() {
        // A model-plane transport failure (AgentCore/Bedrock down or slow) must degrade gracefully:
        // the "ai-plane" breaker fallback returns a friendly HTTP-200 reply instead of a 500, and the
        // failed turn must NOT consume the user's weekly AI quota, be recorded in history, or emit an event.
        when(invoker.invoke(any())).thenThrow(new RuntimeException("bedrock unavailable"));

        ChatResponse res = service.handle("u1", chat("chat"));

        assertThat(res.response()).containsIgnoringCase("temporarily unavailable");
        assertThat(res.agent()).isEqualTo("tutor");
        verify(quotaClient, never()).increment(anyString());
        verify(sessionStore, never()).append(anyString(), any(), any());
    }
}
