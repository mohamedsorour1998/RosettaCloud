package app.rosettacloud.lab.service;

import app.rosettacloud.lab.config.LabProperties;
import app.rosettacloud.lab.domain.LabNaming;
import io.fabric8.kubernetes.api.model.GenericKubernetesResource;
import io.fabric8.kubernetes.api.model.GenericKubernetesResourceBuilder;
import io.fabric8.kubernetes.api.model.Pod;
import io.fabric8.kubernetes.api.model.PodBuilder;
import io.fabric8.kubernetes.api.model.Service;
import io.fabric8.kubernetes.api.model.ServiceBuilder;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.KubernetesClientException;
import io.fabric8.kubernetes.client.dsl.base.ResourceDefinitionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/** Fabric8 implementation of the lab lifecycle (Pod + ClusterIP Service + Istio VirtualService). */
@Component
public class Fabric8LabProvisioner implements LabProvisioner {

    private static final Logger log = LoggerFactory.getLogger(Fabric8LabProvisioner.class);

    private final KubernetesClient client;
    private final LabProperties props;

    public Fabric8LabProvisioner(KubernetesClient client, LabProperties props) {
        this.client = client;
        this.props = props;
    }

    private ResourceDefinitionContext virtualServiceContext() {
        return new ResourceDefinitionContext.Builder()
                .withGroup("networking.istio.io")
                .withVersion("v1")
                .withKind("VirtualService")
                .withPlural("virtualservices")
                .withNamespaced(true)
                .build();
    }

    @Override
    public String createLab(String labId) {
        String ns = props.getNamespace();
        String podName = LabNaming.podName(labId);
        try {
            CompletableFuture.allOf(
                    CompletableFuture.runAsync(() -> createPod(labId)),
                    CompletableFuture.runAsync(() -> createService(labId)),
                    CompletableFuture.runAsync(() -> createVirtualService(labId))
            ).join();
            log.info("Lab {} resources created in namespace {}", labId, ns);
            return podName;
        } catch (Exception e) {
            log.error("Failed to create lab {}: {} — cleaning up", labId, e.getMessage());
            deleteLab(labId);
            throw new IllegalStateException("Failed to launch lab: " + e.getMessage(), e);
        }
    }

    private void createPod(String labId) {
        String ns = props.getNamespace();
        Pod pod = new PodBuilder()
                .withNewMetadata()
                    .withName(LabNaming.podName(labId))
                    .withNamespace(ns)
                    .addToLabels("app", "interactive-labs")
                    .addToLabels("lab-id", labId)
                    .addToAnnotations("sidecar.istio.io/inject", "false")
                .endMetadata()
                .withNewSpec()
                    .withRestartPolicy("Always")
                    .addNewContainer()
                        .withName("lab")
                        .withImage(props.getPodImage())
                        .withImagePullPolicy("IfNotPresent")
                        .addNewPort().withContainerPort(80).endPort()
                        .withNewSecurityContext().withPrivileged(true).withRunAsUser(0L).endSecurityContext()
                        .withNewReadinessProbe()
                            .withNewHttpGet().withPath("/").withNewPort(80).endHttpGet()
                            .withInitialDelaySeconds(3).withPeriodSeconds(3)
                            .withTimeoutSeconds(5).withFailureThreshold(40)
                        .endReadinessProbe()
                    .endContainer()
                .endSpec()
                .build();
        ignoreConflict(() -> client.pods().inNamespace(ns).resource(pod).create());
    }

    private void createService(String labId) {
        String ns = props.getNamespace();
        Service svc = new ServiceBuilder()
                .withNewMetadata()
                    .withName(LabNaming.serviceName(labId))
                    .withNamespace(ns)
                    .addToLabels("app", "interactive-labs")
                    .addToLabels("lab-id", labId)
                .endMetadata()
                .withNewSpec()
                    .withType("ClusterIP")
                    .addToSelector("lab-id", labId)
                    .addNewPort().withPort(80).withNewTargetPort(80).endPort()
                .endSpec()
                .build();
        ignoreConflict(() -> client.services().inNamespace(ns).resource(svc).create());
    }

    private void createVirtualService(String labId) {
        String ns = props.getNamespace();
        String destHost = LabNaming.serviceName(labId) + "." + ns + ".svc.cluster.local";
        Map<String, Object> spec = Map.of(
                "hosts", List.of(LabNaming.host(labId, props.getWildcardDomain())),
                "gateways", List.of(props.getIstioGateway()),
                "http", List.of(Map.of("route", List.of(Map.of(
                        "destination", Map.of("host", destHost, "port", Map.of("number", 80)))))));
        GenericKubernetesResource vs = new GenericKubernetesResourceBuilder()
                .withApiVersion("networking.istio.io/v1")
                .withKind("VirtualService")
                .withNewMetadata().withName(labId).withNamespace(ns).endMetadata()
                .addToAdditionalProperties("spec", spec)
                .build();
        ignoreConflict(() -> client.genericKubernetesResources(virtualServiceContext())
                .inNamespace(ns).resource(vs).create());
    }

    @Override
    public boolean deleteLab(String labId) {
        String ns = props.getNamespace();
        try {
            ignoreMissing(() -> client.genericKubernetesResources(virtualServiceContext())
                    .inNamespace(ns).withName(labId).delete());
            ignoreMissing(() -> client.services().inNamespace(ns)
                    .withName(LabNaming.serviceName(labId)).delete());
            ignoreMissing(() -> client.pods().inNamespace(ns)
                    .withName(LabNaming.podName(labId)).delete());
            return true;
        } catch (Exception e) {
            log.error("Error deleting lab {}: {}", labId, e.getMessage());
            return false;
        }
    }

    @Override
    public Optional<PodView> podStatus(String labId) {
        String ns = props.getNamespace();
        Pod p = client.pods().inNamespace(ns).withName(LabNaming.podName(labId)).get();
        if (p == null || p.getStatus() == null) {
            return p == null ? Optional.empty() : Optional.of(new PodView("unknown", false, null));
        }
        String phase = p.getStatus().getPhase() == null ? "unknown" : p.getStatus().getPhase().toLowerCase();
        String ip = p.getStatus().getPodIP();
        boolean ready = p.getStatus().getConditions() != null && p.getStatus().getConditions().stream()
                .anyMatch(c -> "Ready".equals(c.getType()) && "True".equals(c.getStatus()));
        return Optional.of(new PodView(phase, ready, ip));
    }

    private void ignoreConflict(Runnable action) {
        try {
            action.run();
        } catch (KubernetesClientException e) {
            if (e.getCode() != 409) {
                throw e;
            }
        }
    }

    private void ignoreMissing(Runnable action) {
        try {
            action.run();
        } catch (KubernetesClientException e) {
            if (e.getCode() != 404) {
                throw e;
            }
        }
    }
}
