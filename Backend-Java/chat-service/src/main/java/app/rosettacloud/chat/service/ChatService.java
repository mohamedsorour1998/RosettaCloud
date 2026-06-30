package app.rosettacloud.chat.service;

import app.rosettacloud.chat.client.UserAiQuotaClient;
import app.rosettacloud.chat.web.dto.ChatRequest;
import app.rosettacloud.chat.web.dto.ChatResponse;
import app.rosettacloud.shared.error.QuotaExceededException;
import app.rosettacloud.shared.error.TooManyRequestsException;
import app.rosettacloud.shared.events.DomainEventPublisher;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** Chat orchestration: rate limit → AI-quota gate → image validation → agent invoke → history + counter. */
@Service
public class ChatService {

    private static final Set<String> SKIP_HISTORY = Set.of("explain", "session_start");

    private final AgentInvoker invoker;
    private final ChatSessionStore sessionStore;
    private final RateLimiter rateLimiter;
    private final UserAiQuotaClient aiQuotaClient;
    private final ImageValidator imageValidator;
    private final DomainEventPublisher events;

    public ChatService(AgentInvoker invoker, ChatSessionStore sessionStore, RateLimiter rateLimiter,
                       UserAiQuotaClient aiQuotaClient, ImageValidator imageValidator,
                       DomainEventPublisher events) {
        this.invoker = invoker;
        this.sessionStore = sessionStore;
        this.rateLimiter = rateLimiter;
        this.aiQuotaClient = aiQuotaClient;
        this.imageValidator = imageValidator;
        this.events = events;
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

        AgentInvoker.Reply reply = invoker.invoke(new AgentInvoker.Invocation(
                req.message(), userId, req.sessionId(), type,
                req.moduleUuid(), req.lessonUuid(), history,
                req.questionNumber() == null ? 0 : req.questionNumber(), req.result(), req.image()));

        if (!skipHistory && hasSession) {
            sessionStore.append(req.sessionId(), req.message(), reply.response());
        }
        if ("chat".equals(type)) {
            aiQuotaClient.increment(userId);
        }
        events.publish("chat.message", userId);

        return new ChatResponse(reply.response(), reply.agent(), req.sessionId());
    }

    private static long asLong(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }
}
