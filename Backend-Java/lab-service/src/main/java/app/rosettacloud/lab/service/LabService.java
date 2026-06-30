package app.rosettacloud.lab.service;

import app.rosettacloud.lab.client.UserServiceClient;
import app.rosettacloud.lab.config.LabProperties;
import app.rosettacloud.lab.domain.LabInfo;
import app.rosettacloud.lab.domain.LabNaming;
import app.rosettacloud.shared.error.ConflictException;
import app.rosettacloud.shared.error.QuotaExceededException;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Lab lifecycle orchestration — quota gate, single-active-lab enforcement, launch/info/terminate. */
@Service
public class LabService {

    private final LabRegistry registry;
    private final LabProvisioner provisioner;
    private final UserServiceClient userClient;
    private final LabProperties props;

    public LabService(LabRegistry registry, LabProvisioner provisioner,
                      UserServiceClient userClient, LabProperties props) {
        this.registry = registry;
        this.provisioner = provisioner;
        this.userClient = userClient;
        this.props = props;
    }

    public String launch(String userId) {
        if (userClient.activeLab(userId).isPresent()) {
            throw new ConflictException(
                    "You already have an active lab. Please terminate the existing lab first.");
        }
        long remaining = userClient.remainingLabMinutes(userId);
        if (remaining <= 0) {
            throw new QuotaExceededException(
                    "Weekly free-tier lab quota exhausted. Quota resets on next Monday.",
                    "LAB_QUOTA_EXHAUSTED", Map.of("minutes_remaining", 0));
        }
        long ttl = Math.min(remaining * 60, props.getPodTtlSeconds());
        String labId = "lab-" + UUID.randomUUID().toString().substring(0, 8);
        String podName = provisioner.createLab(labId);
        registry.record(labId, podName, userId, Instant.now().getEpochSecond(), ttl);
        userClient.setActiveLab(userId, labId);
        userClient.linkLab(userId, labId);
        return labId;
    }

    public Optional<LabInfo> info(String labId) {
        Optional<LabProvisioner.PodView> status = provisioner.podStatus(labId);
        if (status.isEmpty()) {
            registry.remove(labId);
            return Optional.empty();
        }
        LabProvisioner.PodView pv = status.get();
        long now = Instant.now().getEpochSecond();
        if (!registry.isTracked(labId)) {
            // Recover tracking after a restart so TTL/janitor keep working.
            registry.recordIfAbsent(labId, LabNaming.podName(labId), "", now, props.getPodTtlSeconds());
        }
        String statusStr = "running".equals(pv.phase())
                ? (pv.ready() ? "running" : "starting")
                : pv.phase();
        String host = LabNaming.host(labId, props.getWildcardDomain());
        Map<String, Integer> timeRemaining = registry.timeRemaining(labId, now).orElse(null);
        return Optional.of(new LabInfo(
                labId,
                LabNaming.podName(labId),
                pv.podIp() != null ? pv.podIp() : host,
                host,
                "https://" + host,
                statusStr,
                timeRemaining));
    }

    public boolean terminate(String labId, String userId) {
        boolean deleted = provisioner.deleteLab(labId);
        registry.remove(labId);
        if (deleted && userId != null && !userId.isBlank()) {
            userClient.closeLabSession(userId);
            userClient.unlinkLab(userId, labId);
        }
        return deleted;
    }
}
