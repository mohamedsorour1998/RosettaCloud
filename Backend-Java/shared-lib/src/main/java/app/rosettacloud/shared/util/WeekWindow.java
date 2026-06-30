package app.rosettacloud.shared.util;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

/**
 * Weekly quota window anchored to Monday 00:00:00 UTC — a faithful port of the
 * Python backend's week math in {@code users_backends.py} (monday = now - weekday;
 * week_start = midnight UTC of that Monday).
 */
public final class WeekWindow {

    private static final long WEEK_SECONDS = 7L * 24 * 3600;

    private final long nowEpoch;
    private final long weekStartEpoch;

    private WeekWindow(long nowEpoch, long weekStartEpoch) {
        this.nowEpoch = nowEpoch;
        this.weekStartEpoch = weekStartEpoch;
    }

    public static WeekWindow now() {
        return at(Instant.now());
    }

    public static WeekWindow at(Instant instant) {
        long now = instant.getEpochSecond();
        LocalDate today = instant.atZone(ZoneOffset.UTC).toLocalDate();
        // DayOfWeek: Monday=1 ... Sunday=7 → subtract (value-1) days to reach Monday.
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1L);
        long weekStart = monday.atStartOfDay(ZoneOffset.UTC).toEpochSecond();
        return new WeekWindow(now, weekStart);
    }

    public long weekStart() {
        return weekStartEpoch;
    }

    public long weekEnd() {
        return weekStartEpoch + WEEK_SECONDS;
    }

    public long nowEpoch() {
        return nowEpoch;
    }

    /** Whole minutes elapsed since the given epoch-seconds timestamp (never negative). */
    public long minutesSince(long epochSeconds) {
        return Math.max(0, (nowEpoch - epochSeconds) / 60);
    }

    /** True when a stored week-start predates the current week (i.e., the counter should reset). */
    public boolean isStale(long storedWeekStart) {
        return storedWeekStart < weekStartEpoch;
    }
}
