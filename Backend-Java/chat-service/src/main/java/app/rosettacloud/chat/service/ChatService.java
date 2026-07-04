package app.rosettacloud.chat.service;

import app.rosettacloud.chat.client.UserAiQuotaClient;
import app.rosettacloud.chat.web.dto.ChatRequest;
import app.rosettacloud.chat.web.dto.ChatResponse;
import app.rosettacloud.shared.error.QuotaExceededException;
import app.rosettacloud.shared.error.TooManyRequestsException;
import app.rosettacloud.shared.events.DomainEventPublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.client.circuitbreaker.CircuitBreakerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** Chat orchestration: rate limit → AI-quota gate → image validation → agent invoke → history + counter. */
@Service
public class ChatService {

    private static final Logger log = LoggerFactory.getLogger(ChatService.class);

    private static final Set<String> SKIP_HISTORY = Set.of("explain", "session_start");

    /**
     * Graceful-degradation reply returned by the "ai-plane" circuit-breaker fallback (Part B
     * §B.3.2/§B.3.3). Identity matters: {@link #handle} treats a reply that IS this instance as a
     * degraded turn and therefore does NOT charge AI quota, record history, or emit an event — a
     * failed model call must not consume the user's weekly quota. (A parse-level UNAVAILABLE that an
     * invoker returns *normally* is a different instance and stays on the normal path, preserving
     * pre-breaker behavior.)
     */
    private static final AgentInvoker.Reply AI_UNAVAILABLE =
            new AgentInvoker.Reply("The tutor is temporarily unavailable, please retry.", "tutor");

    private final AgentInvoker invoker;
    private final ChatSessionStore sessionStore;
    private final RateLimiter rateLimiter;
    private final UserAiQuotaClient aiQuotaClient;
    private final ImageValidator imageValidator;
    private final DomainEventPublisher events;
    private final CircuitBreakerFactory<?, ?> circuitBreakers;

    public ChatService(AgentInvoker invoker, ChatSessionStore sessionStore, RateLimiter rateLimiter,
                       UserAiQuotaClient aiQuotaClient, ImageValidator imageValidator,
                       DomainEventPublisher events, CircuitBreakerFactory<?, ?> circuitBreakers) {
        this.invoker = invoker;
        this.sessionStore = sessionStore;
        this.rateLimiter = rateLimiter;
        this.aiQuotaClient = aiQuotaClient;
        this.imageValidator = imageValidator;
        this.events = events;
        this.circuitBreakers = circuitBreakers;
    }

    public ChatResponse handle(String userId, ChatRequest req) {
        String type = req.type() == null || req.type().isBlank() ? "chat" : req.type();

        if (!rateLimiter.tryAcquire("chat:" + userId)) {
            throw new TooManyRequestsException(
                    "Rate limit exceeded: max chat messages per hour. Please try again later.");
        }

        if ("chat".equals(type)) {
            Map<String, Object> quota = aiQuotaClient.aiQuota(userId);
            if (asLong(quota.get("messages_remaining")) <= 0) {
                throw new QuotaExceededException(
                        "Weekly AI message quota exhausted.", "AI_QUOTA_EXHAUSTED", quota);
            }
        }

        if (req.image() != null && !req.image().isBlank()) {
            imageValidator.validateJpeg(req.image());
        }

        boolean skipHistory = SKIP_HISTORY.contains(type);
        boolean hasSession = req.sessionId() != null && !req.sessionId().isBlank();
        List<Map<String, String>> history = (!skipHistory && hasSession)
                ? sessionStore.history(req.sessionId()) : List.of();

        AgentInvoker.Invocation inv = new AgentInvoker.Invocation(
                req.message(), userId, req.sessionId(), type,
                req.moduleUuid(), req.lessonUuid(), history,
                req.questionNumber() == null ? 0 : req.questionNumber(), req.result(), req.image());

        // AI-plane circuit breaker (Part B §B.3.2/§B.3.3): wrap the model call (AgentCore or
        // bedrock-direct, whichever invoker is active) so a *sustained* AI-plane outage fast-fails to a
        // friendly reply instead of paying the full model latency and 500-ing /chat on every message.
        // The "ai-plane" TimeLimiter is deliberately generous (resilience4j.timelimiter.configs.default
        // in application.yml) so a slow-but-successful Nova/AgentCore response is NOT falsely cut off.
        AgentInvoker.Reply reply = circuitBreakers.create("ai-plane").run(
                () -> invoker.invoke(inv),
                throwable -> {
                    log.warn("ai-plane breaker fallback for user={} type={}: {}", userId, type, throwable.toString());
                    return AI_UNAVAILABLE;
                });

        // Degrade gracefully: on the breaker fallback, do NOT record history, charge AI quota, or emit
        // the chat.message event — a failed turn must not consume the user's weekly quota.
        if (reply != AI_UNAVAILABLE) {
            if (!skipHistory && hasSession) {
                sessionStore.append(req.sessionId(), req.message(), reply.response());
            }
            if ("chat".equals(type)) {
                aiQuotaClient.increment(userId);
            }
            events.publish("chat.message", userId);
        }

        return new ChatResponse(reply.response(), reply.agent(), req.sessionId());
    }

    private static long asLong(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }
}
