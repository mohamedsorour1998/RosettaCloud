package app.rosettacloud.lab.service;

import app.rosettacloud.lab.client.UserServiceClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;

/**
 * Auto-terminates expired labs every 60s. Before deleting, records the session against the owner's
 * weekly quota (parity with the EKSLabs janitor + main._on_lab_auto_terminated callback).
 */
@Component
public class LabJanitor {

    private static final Logger log = LoggerFactory.getLogger(LabJanitor.class);

    private final LabRegistry registry;
    private final LabProvisioner provisioner;
    private final UserServiceClient userClient;

    public LabJanitor(LabRegistry registry, LabProvisioner provisioner, UserServiceClient userClient) {
        this.registry = registry;
        this.provisioner = provisioner;
        this.userClient = userClient;
    }

    @Scheduled(fixedDelayString = "${rosettacloud.lab.janitor-interval-ms:60000}")
    public void sweep() {
        long now = Instant.now().getEpochSecond();
        for (String labId : registry.findExpired(now)) {
            String owner = registry.ownerOf(labId);
            log.info("Janitor auto-terminating expired lab {} (owner={})", labId, owner);
            try {
                if (owner != null && !owner.isBlank()) {
                    userClient.closeLabSession(owner);
                }
            } catch (Exception e) {
                // Callback failure must not block cleanup.
                log.error("Auto-terminate bookkeeping failed for {}: {}", labId, e.getMessage());
            }
            try {
                provisioner.deleteLab(labId);
            } catch (Exception e) {
                log.error("Error deleting expired lab {}: {}", labId, e.getMessage());
            }
            registry.remove(labId);
        }
    }
}
