package app.rosettacloud.lab.domain;

/** Deterministic naming for lab resources (parity with labs_backends.py). */
public final class LabNaming {

    private LabNaming() {
    }

    public static String podName(String labId) {
        return "lab-" + labId;
    }

    public static String serviceName(String labId) {
        return labId + "-svc";
    }

    public static String host(String labId, String wildcardDomain) {
        return labId + "." + wildcardDomain;
    }
}
