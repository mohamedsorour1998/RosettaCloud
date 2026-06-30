package app.rosettacloud.lab.service;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class LabRegistryTest {

    private final LabRegistry registry = new LabRegistry();

    @Test
    void recordsAndComputesTimeRemaining() {
        long now = 1_000_000L;
        registry.record("lab-1", "lab-lab-1", "u1", now - 60, 3600);
        Map<String, Integer> tr = registry.timeRemaining("lab-1", now).orElseThrow();
        assertThat(tr.get("total_seconds")).isEqualTo(3540);
        assertThat(tr.get("minutes")).isEqualTo(59);
    }

    @Test
    void findExpiredHonoursPerLabTtl() {
        long now = 1_000_000L;
        registry.record("expired", "p", "u1", now - 100, 50);   // 100s old, ttl 50 → expired
        registry.record("fresh", "p", "u2", now - 10, 3600);    // 10s old → not expired
        assertThat(registry.findExpired(now)).containsExactly("expired");
    }

    @Test
    void removeStopsTracking() {
        registry.record("lab-x", "p", "u", 1L, 60);
        registry.remove("lab-x");
        assertThat(registry.isTracked("lab-x")).isFalse();
        assertThat(registry.timeRemaining("lab-x", 2L)).isEmpty();
    }

    @Test
    void ownerLookup() {
        registry.record("lab-y", "p", "owner-1", 1L, 60);
        assertThat(registry.ownerOf("lab-y")).isEqualTo("owner-1");
        assertThat(registry.ownerOf("missing")).isNull();
    }
}
