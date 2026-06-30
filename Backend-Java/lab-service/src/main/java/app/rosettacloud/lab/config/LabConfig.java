package app.rosettacloud.lab.config;

import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.KubernetesClientBuilder;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(LabProperties.class)
public class LabConfig {

    @Bean(destroyMethod = "close")
    @ConditionalOnMissingBean
    public KubernetesClient kubernetesClient() {
        return new KubernetesClientBuilder().build();
    }
}
