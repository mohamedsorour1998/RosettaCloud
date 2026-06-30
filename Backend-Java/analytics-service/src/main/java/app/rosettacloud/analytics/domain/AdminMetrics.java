package app.rosettacloud.analytics.domain;

import java.util.Map;

public record AdminMetrics(
        long totalUsers,
        Map<String, Long> aggregate,
        double accuracyPct,
        Map<String, Object> perUser,
        Long collectedSince) {
}
