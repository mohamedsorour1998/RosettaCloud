package app.rosettacloud.lab.domain;

import java.util.Map;

public record LabInfo(
        String labId,
        String podName,
        String podIp,
        String hostname,
        String url,
        String status,
        Map<String, Integer> timeRemaining) {
}
