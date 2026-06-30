package app.rosettacloud.user.service;

import app.rosettacloud.shared.util.WeekWindow;
import app.rosettacloud.user.domain.AiQuota;
import app.rosettacloud.user.domain.LabQuota;
import app.rosettacloud.user.persistence.UserItem;
import app.rosettacloud.user.persistence.UserRepository;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class QuotaServiceTest {

    private final UserRepository repository = mock(UserRepository.class);
    private final QuotaService quota = new QuotaService(repository);

    private static long thisWeekStart() {
        return WeekWindow.now().weekStart();
    }

    private static long nowEpoch() {
        return WeekWindow.now().nowEpoch();
    }

    @Test
    void freshUserHasFullLabQuota() {
        LabQuota q = quota.labQuota(new UserItem());
        assertThat(q.minutesUsed()).isZero();
        assertThat(q.minutesRemaining()).isEqualTo(120);
        assertThat(q.minutesLimit()).isEqualTo(120);
    }

    @Test
    void staleWeekResetsLabUsage() {
        UserItem u = new UserItem();
        u.setLabWeekStart(0L); // long ago → stale
        u.setLabWeekMinutes(100L);
        assertThat(quota.labQuota(u).minutesUsed()).isZero();
    }

    @Test
    void committedMinutesThisWeekCount() {
        UserItem u = new UserItem();
        u.setLabWeekStart(thisWeekStart());
        u.setLabWeekMinutes(40L);
        LabQuota q = quota.labQuota(u);
        assertThat(q.minutesUsed()).isEqualTo(40);
        assertThat(q.minutesRemaining()).isEqualTo(80);
    }

    @Test
    void inFlightMinutesAreIncluded() {
        UserItem u = new UserItem();
        u.setLabWeekStart(thisWeekStart());
        u.setLabWeekMinutes(40L);
        u.setLabStartedAt(nowEpoch() - 600); // ~10 min in flight
        long used = quota.labQuota(u).minutesUsed();
        assertThat(used).isBetween(50L, 51L);
    }

    @Test
    void aiQuotaCountsThisWeek() {
        UserItem u = new UserItem();
        u.setAiWeekStart(thisWeekStart());
        u.setAiWeekMessages(10L);
        AiQuota q = quota.aiQuota(u);
        assertThat(q.messagesUsed()).isEqualTo(10);
        assertThat(q.messagesRemaining()).isEqualTo(40);
        assertThat(q.messagesLimit()).isEqualTo(50);
    }

    @Test
    void closeLabSessionWithNoActiveSessionRecordsNothing() {
        assertThat(quota.closeLabSession(new UserItem())).isZero();
    }

    @Test
    void closeLabSessionRecordsDurationAndClearsState() {
        UserItem u = new UserItem();
        u.setActiveLab("lab-abc");
        u.setLabStartedAt(nowEpoch() - 3600); // ~60 min
        u.setLabWeekStart(thisWeekStart());
        u.setLabWeekMinutes(10L);

        long duration = quota.closeLabSession(u);

        assertThat(duration).isBetween(60L, 61L);
        assertThat(u.getActiveLab()).isNull();
        assertThat(u.getLabStartedAt()).isNull();
        assertThat(u.getLabWeekMinutes()).isBetween(70L, 71L);
        verify(repository).save(u);
    }

    @Test
    void incrementAiMessagesAddsOne() {
        UserItem u = new UserItem();
        u.setAiWeekStart(thisWeekStart());
        u.setAiWeekMessages(5L);
        quota.incrementAiMessages(u);
        assertThat(u.getAiWeekMessages()).isEqualTo(6);
        verify(repository).save(u);
    }

    @Test
    void incrementAiMessagesResetsStaleWeek() {
        UserItem u = new UserItem();
        u.setAiWeekStart(0L);
        u.setAiWeekMessages(49L);
        quota.incrementAiMessages(u);
        assertThat(u.getAiWeekMessages()).isEqualTo(1);
    }
}
