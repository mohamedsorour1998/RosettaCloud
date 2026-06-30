package app.rosettacloud.chat.service;

/** Returns true if the action is allowed for the key within the current window. */
public interface RateLimiter {
    boolean tryAcquire(String key);
}
