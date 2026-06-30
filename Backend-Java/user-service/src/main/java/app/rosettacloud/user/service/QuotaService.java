package app.rosettacloud.user.service;

import app.rosettacloud.shared.util.WeekWindow;
import app.rosettacloud.user.domain.AiQuota;
import app.rosettacloud.user.domain.LabQuota;
import app.rosettacloud.user.persistence.UserItem;
import app.rosettacloud.user.persistence.UserRepository;
import org.springframework.stereotype.Service;

/**
 * Weekly free-tier quota logic, ported faithfully from {@code users_backends.py}:
 * 120 lab minutes/week and 50 AI messages/week, with Monday-00:00-UTC reset and an
 * atomic close-session that records duration and clears active-lab state together.
 */
@Service
public class QuotaService {

    public static final long LAB_MINUTES_LIMIT = 120;
    public static final long AI_MESSAGES_LIMIT = 50;

    private final UserRepository repository;

    public QuotaService(UserRepository repository) {
        this.repository = repository;
    }

    private static long nz(Long v) {
        return v == null ? 0L : v;
    }

    /** Lab quota including in-flight minutes from an active session (matches launch-time enforcement). */
    public LabQuota labQuota(UserItem u) {
        WeekWindow w = WeekWindow.now();
        long used = w.isStale(nz(u.getLabWeekStart())) ? 0 : nz(u.getLabWeekMinutes());
        if (u.getLabStartedAt() != null) {
            used += w.minutesSince(u.getLabStartedAt());
        }
        long remaining = Math.max(0, LAB_MINUTES_LIMIT - used);
        return new LabQuota(used, remaining, LAB_MINUTES_LIMIT, w.weekEnd());
    }

    public AiQuota aiQuota(UserItem u) {
        WeekWindow w = WeekWindow.now();
        long used = w.isStale(nz(u.getAiWeekStart())) ? 0 : nz(u.getAiWeekMessages());
        long remaining = Math.max(0, AI_MESSAGES_LIMIT - used);
        return new AiQuota(used, remaining, AI_MESSAGES_LIMIT, w.weekEnd());
    }

    /**
     * Atomically closes the active lab session: records the session duration against the weekly
     * quota and clears {@code active_lab}/{@code lab_started_at}. Idempotent. Returns minutes recorded.
     */
    public long closeLabSession(UserItem u) {
        Long startedAt = u.getLabStartedAt();
        boolean hasActive = u.getActiveLab() != null && !"null".equals(u.getActiveLab());
        if (startedAt == null) {
            if (hasActive) {
                u.setActiveLab(null);
                repository.save(u);
            }
            return 0;
        }
        WeekWindow w = WeekWindow.now();
        long current = w.isStale(nz(u.getLabWeekStart())) ? 0 : nz(u.getLabWeekMinutes());
        long duration = Math.max(1, (w.nowEpoch() - startedAt) / 60);
        u.setActiveLab(null);
        u.setLabStartedAt(null);
        u.setLabWeekStart(w.weekStart());
        u.setLabWeekMinutes(current + duration);
        repository.save(u);
        return duration;
    }

    public void incrementAiMessages(UserItem u) {
        WeekWindow w = WeekWindow.now();
        long current = w.isStale(nz(u.getAiWeekStart())) ? 0 : nz(u.getAiWeekMessages());
        u.setAiWeekStart(w.weekStart());
        u.setAiWeekMessages(current + 1);
        repository.save(u);
    }

    public void setActiveLab(UserItem u, String labId) {
        u.setActiveLab(labId);
        u.setLabStartedAt(WeekWindow.now().nowEpoch());
        repository.save(u);
    }

    public String activeLab(UserItem u) {
        String lab = u.getActiveLab();
        return (lab != null && !"null".equals(lab)) ? lab : null;
    }
}
