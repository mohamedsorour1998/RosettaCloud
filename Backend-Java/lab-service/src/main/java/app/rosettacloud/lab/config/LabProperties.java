package app.rosettacloud.lab.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "rosettacloud.lab")
public class LabProperties {

    private String namespace = "dev";
    private String podImage = "339712964409.dkr.ecr.us-east-1.amazonaws.com/interactive-labs:latest";
    private String wildcardDomain = "labs.dev.rosettacloud.app";
    private String istioGateway = "rosettacloud-gateway";
    private long podTtlSeconds = 3600;

    /** Resource requests/limits for the lab pod (T4 — noisy-neighbour bound; §5.3). */
    private Resources resources = new Resources();

    public String getNamespace() {
        return namespace;
    }

    public void setNamespace(String namespace) {
        this.namespace = namespace;
    }

    public String getPodImage() {
        return podImage;
    }

    public void setPodImage(String podImage) {
        this.podImage = podImage;
    }

    public String getWildcardDomain() {
        return wildcardDomain;
    }

    public void setWildcardDomain(String wildcardDomain) {
        this.wildcardDomain = wildcardDomain;
    }

    public String getIstioGateway() {
        return istioGateway;
    }

    public void setIstioGateway(String istioGateway) {
        this.istioGateway = istioGateway;
    }

    public long getPodTtlSeconds() {
        return podTtlSeconds;
    }

    public void setPodTtlSeconds(long podTtlSeconds) {
        this.podTtlSeconds = podTtlSeconds;
    }

    public Resources getResources() {
        return resources;
    }

    public void setResources(Resources resources) {
        this.resources = resources;
    }

    /**
     * Lab-pod resource envelope, tunable without a rebuild via
     * {@code rosettacloud.lab.resources.*}. Defaults track §5.3 of the hardening plan
     * (privileged DinD/Kind needs headroom), with an explicit ephemeral-storage *request*
     * so the pod stays schedulable even outside the {@code labs} LimitRange.
     */
    public static class Resources {
        private String requestsCpu = "500m";
        private String requestsMemory = "1Gi";
        private String requestsEphemeralStorage = "2Gi";
        private String limitsCpu = "2";
        private String limitsMemory = "3Gi";
        private String limitsEphemeralStorage = "8Gi";

        public String getRequestsCpu() {
            return requestsCpu;
        }

        public void setRequestsCpu(String requestsCpu) {
            this.requestsCpu = requestsCpu;
        }

        public String getRequestsMemory() {
            return requestsMemory;
        }

        public void setRequestsMemory(String requestsMemory) {
            this.requestsMemory = requestsMemory;
        }

        public String getRequestsEphemeralStorage() {
            return requestsEphemeralStorage;
        }

        public void setRequestsEphemeralStorage(String requestsEphemeralStorage) {
            this.requestsEphemeralStorage = requestsEphemeralStorage;
        }

        public String getLimitsCpu() {
            return limitsCpu;
        }

        public void setLimitsCpu(String limitsCpu) {
            this.limitsCpu = limitsCpu;
        }

        public String getLimitsMemory() {
            return limitsMemory;
        }

        public void setLimitsMemory(String limitsMemory) {
            this.limitsMemory = limitsMemory;
        }

        public String getLimitsEphemeralStorage() {
            return limitsEphemeralStorage;
        }

        public void setLimitsEphemeralStorage(String limitsEphemeralStorage) {
            this.limitsEphemeralStorage = limitsEphemeralStorage;
        }
    }
}
