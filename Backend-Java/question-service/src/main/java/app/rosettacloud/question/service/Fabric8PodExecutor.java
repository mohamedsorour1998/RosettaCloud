package app.rosettacloud.question.service;

import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.KubernetesClientBuilder;
import io.fabric8.kubernetes.client.dsl.ExecWatch;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Executes the extracted {@code -q}/{@code -c} block inside the student's lab pod via the Fabric8
 * exec API (the enterprise equivalent of the Python {@code kubectl cp}+{@code kubectl exec}). The
 * script is base64-encoded and decoded in-pod to avoid quoting issues; per-pod locking serialises
 * concurrent execs; a timeout guards against hangs.
 */
@Component
public class Fabric8PodExecutor implements PodExecutor {

    private static final Logger log = LoggerFactory.getLogger(Fabric8PodExecutor.class);
    private static final long TIMEOUT_SECONDS = 30;

    private final String namespace;
    private final Map<String, Object> podLocks = new ConcurrentHashMap<>();
    private volatile KubernetesClient client;

    public Fabric8PodExecutor(@Value("${rosettacloud.lab.namespace:dev}") String namespace) {
        this.namespace = namespace;
    }

    private KubernetesClient client() {
        if (client == null) {
            synchronized (this) {
                if (client == null) {
                    client = new KubernetesClientBuilder().build();
                }
            }
        }
        return client;
    }

    @Override
    public boolean runScript(String podName, String scriptBody) {
        String wrapped = "#!/bin/bash\n" + scriptBody + "\nexit $?\n";
        String b64 = Base64.getEncoder().encodeToString(wrapped.getBytes(StandardCharsets.UTF_8));
        String cmd = "echo " + b64 + " | base64 -d > /tmp/rc_script.sh "
                + "&& chmod +x /tmp/rc_script.sh && /tmp/rc_script.sh";

        Object lock = podLocks.computeIfAbsent(podName, k -> new Object());
        synchronized (lock) {
            try (ByteArrayOutputStream out = new ByteArrayOutputStream();
                 ByteArrayOutputStream err = new ByteArrayOutputStream();
                 ExecWatch watch = client().pods().inNamespace(namespace).withName(podName)
                         .writingOutput(out).writingError(err)
                         .exec("bash", "-c", cmd)) {
                Integer code = watch.exitCode().get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
                return code != null && code == 0;
            } catch (Exception e) {
                log.error("In-pod exec failed on {}: {}", podName, e.getMessage());
                return false;
            }
        }
    }
}
