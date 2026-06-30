package app.rosettacloud.lab.service;

import java.util.Optional;

/** Abstraction over the Kubernetes/Istio lab resources, so LabService is testable without a cluster. */
public interface LabProvisioner {

    record PodView(String phase, boolean ready, String podIp) {
    }

    /** Creates Pod + Service + Istio VirtualService; returns the pod name. */
    String createLab(String labId);

    /** Deletes all lab resources (idempotent). */
    boolean deleteLab(String labId);

    /** Reads current pod status, or empty if the pod does not exist. */
    Optional<PodView> podStatus(String labId);
}
