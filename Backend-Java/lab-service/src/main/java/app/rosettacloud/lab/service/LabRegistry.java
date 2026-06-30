package app.rosettacloud.lab.service;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory lab tracking (pod name, owner, created-at, effective TTL) — a pure, unit-testable port
 * of the EKSLabs tracking dicts + {@code _time_left}/janitor expiry logic.
 */
@Component
public class LabRegistry {

    public record Entry(String podName, String ownerId, long createdAt, long ttlSeconds) {
    }

    private final Map<String, Entry> labs = new ConcurrentHashMap<>();

    public void record(String labId, String podName, String ownerId, long createdAt, long ttlSeconds) {
        labs.put(labId, new Entry(podName, ownerId, createdAt, ttlSeconds));
    }

    public void recordIfAbsent(String labId, String podName, String ownerId, long createdAt, long ttlSeconds) {
        labs.putIfAbsent(labId, new Entry(podName, ownerId, createdAt, ttlSeconds));
    }

    public Optional<Entry> get(String labId) {
        return Optional.ofNullable(labs.get(labId));
    }

    public boolean isTracked(String labId) {
        return labs.containsKey(labId);
    }

    public void remove(String labId) {
        labs.remove(labId);
    }

    /** Remaining time as {minutes, seconds, total_seconds}, or empty if not tracked. */
    public Optional<Map<String, Integer>> timeRemaining(String labId, long nowEpoch) {
        Entry e = labs.get(labId);
        if (e == null) {
            return Optional.empty();
        }
        long left = Math.max(0, e.ttlSeconds() - (nowEpoch - e.createdAt()));
        Map<String, Integer> m = new LinkedHashMap<>();
        m.put("minutes", (int) (left / 60));
        m.put("seconds", (int) (left % 60));
        m.put("total_seconds", (int) left);
        return Optional.of(m);
    }

    /** Lab ids whose effective TTL has elapsed as of {@code nowEpoch}. */
    public List<String> findExpired(long nowEpoch) {
        List<String> expired = new ArrayList<>();
        for (Map.Entry<String, Entry> e : labs.entrySet()) {
            if (nowEpoch - e.getValue().createdAt() > e.getValue().ttlSeconds()) {
                expired.add(e.getKey());
            }
        }
        return expired;
    }

    public String ownerOf(String labId) {
        Entry e = labs.get(labId);
        return e == null ? null : e.ownerId();
    }
}
