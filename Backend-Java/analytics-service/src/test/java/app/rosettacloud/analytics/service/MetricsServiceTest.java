package app.rosettacloud.analytics.service;

import app.rosettacloud.analytics.domain.AdminMetrics;
import app.rosettacloud.analytics.domain.PublicStats;
import app.rosettacloud.analytics.persistence.StatsRepository;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class MetricsServiceTest {

    private final StatsRepository repository = mock(StatsRepository.class);
    private final MetricsService service = new MetricsService(repository);

    @Test
    void publicStatsMapsCounters() {
        when(repository.globalCounters()).thenReturn(Map.of(
                "lab_started", 12L, "question_attempted", 40L, "chat_message", 7L, "users_seen", 5L));
        PublicStats s = service.publicStats();
        assertThat(s.labsLaunched()).isEqualTo(12);
        assertThat(s.questionsAnswered()).isEqualTo(40);
        assertThat(s.aiMessages()).isEqualTo(7);
        assertThat(s.totalUsersSeen()).isEqualTo(5);
    }

    @Test
    void adminMetricsComputesAccuracy() {
        when(repository.globalCounters()).thenReturn(Map.of(
                "question_attempted", 40L, "question_correct", 30L, "users_seen", 5L));
        AdminMetrics m = service.adminMetrics();
        assertThat(m.accuracyPct()).isEqualTo(75.0);
        assertThat(m.totalUsers()).isEqualTo(5);
    }

    @Test
    void adminMetricsAccuracyZeroWhenNoAttempts() {
        when(repository.globalCounters()).thenReturn(Map.of());
        assertThat(service.adminMetrics().accuracyPct()).isEqualTo(0.0);
    }
}
