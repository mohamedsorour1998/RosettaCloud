package app.rosettacloud.user.domain;

/** Weekly lab-time quota snapshot (serialised as snake_case: minutes_used, minutes_remaining, ...). */
public record LabQuota(long minutesUsed, long minutesRemaining, long minutesLimit, long weekResetsAt) {
}
