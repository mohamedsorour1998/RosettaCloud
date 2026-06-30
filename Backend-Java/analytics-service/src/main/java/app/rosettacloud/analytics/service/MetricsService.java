package app.rosettacloud.analytics.service;

import app.rosettacloud.analytics.domain.AdminMetrics;
import app.rosettacloud.analytics.domain.PublicStats;
import app.rosettacloud.analytics.persistence.StatsRepository;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class MetricsService {

    private final StatsRepository repository;

    public MetricsService(StatsRepository repository) {
        this.repository = repository;
    }

    public PublicStats publicStats() {
        Map<String, Long> c = repository.globalCounters();
        return new PublicStats(
                c.getOrDefault("lab_started", 0L),
                c.getOrDefault("question_attempted", 0L),
                c.getOrDefault("chat_message", 0L),
                c.getOrDefault("users_seen", 0L));
    }

    public AdminMetrics adminMetrics() {
        Map<String, Long> c = repository.globalCounters();
        long attempted = c.getOrDefault("question_attempted", 0L);
        long correct = c.getOrDefault("question_correct", 0L);
        double accuracy = attempted > 0 ? Math.round(correct * 1000.0 / attempted) / 10.0 : 0.0;
        // per_user breakdown is populated by the SQS event consumer in WP-60.
        return new AdminMetrics(c.getOrDefault("users_seen", 0L), c, accuracy, Map.of(), null);
    }
}
