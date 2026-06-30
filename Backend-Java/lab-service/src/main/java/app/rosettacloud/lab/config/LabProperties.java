package app.rosettacloud.lab.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "rosettacloud.lab")
public class LabProperties {

    private String namespace = "dev";
    private String podImage = "339712964409.dkr.ecr.us-east-1.amazonaws.com/interactive-labs:latest";
    private String wildcardDomain = "labs.dev.rosettacloud.app";
    private String istioGateway = "rosettacloud-gateway";
    private long podTtlSeconds = 3600;

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
}
