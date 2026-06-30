package app.rosettacloud.shared.util;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class WeekWindowTest {

    // 2026-06-30 is a Tuesday → week anchor is Monday 2026-06-29 00:00:00 UTC.
    private static final Instant TUE = Instant.parse("2026-06-30T10:00:00Z");
    private static final long EXPECTED_WEEK_START =
            LocalDate.of(2026, 6, 29).atStartOfDay(ZoneOffset.UTC).toEpochSecond();

    @Test
    void weekStartIsMondayMidnightUtc() {
        WeekWindow w = WeekWindow.at(TUE);
        assertThat(w.weekStart()).isEqualTo(EXPECTED_WEEK_START);
        assertThat(w.weekEnd()).isEqualTo(EXPECTED_WEEK_START + 7L * 24 * 3600);
    }

    @Test
    void mondayItselfAnchorsToSameDay() {
        Instant monday = Instant.parse("2026-06-29T00:00:00Z");
        assertThat(WeekWindow.at(monday).weekStart()).isEqualTo(EXPECTED_WEEK_START);
    }

    @Test
    void sundayAnchorsToPreviousMonday() {
        Instant sunday = Instant.parse("2026-07-05T23:59:59Z");
        assertThat(WeekWindow.at(sunday).weekStart()).isEqualTo(EXPECTED_WEEK_START);
    }

    @Test
    void minutesSinceIsFlooredAndNonNegative() {
        WeekWindow w = WeekWindow.at(TUE);
        assertThat(w.minutesSince(w.nowEpoch() - 605)).isEqualTo(10); // 605s → 10 min
        assertThat(w.minutesSince(w.nowEpoch() + 100)).isZero();      // future → 0
    }

    @Test
    void isStaleDetectsPriorWeek() {
        WeekWindow w = WeekWindow.at(TUE);
        assertThat(w.isStale(w.weekStart() - 1)).isTrue();
        assertThat(w.isStale(w.weekStart())).isFalse();
        assertThat(w.isStale(0)).isTrue();
    }
}
