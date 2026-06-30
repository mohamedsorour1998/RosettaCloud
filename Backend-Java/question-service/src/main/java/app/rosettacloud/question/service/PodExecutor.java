package app.rosettacloud.question.service;

/** Runs a (wrapped) bash script inside a lab pod and reports whether it exited 0. */
public interface PodExecutor {
    boolean runScript(String podName, String scriptBody);
}
