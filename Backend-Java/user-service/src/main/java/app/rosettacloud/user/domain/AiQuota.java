package app.rosettacloud.user.domain;

/** Weekly AI-message quota snapshot (serialised as snake_case: messages_used, messages_remaining, ...). */
public record AiQuota(long messagesUsed, long messagesRemaining, long messagesLimit, long weekResetsAt) {
}
