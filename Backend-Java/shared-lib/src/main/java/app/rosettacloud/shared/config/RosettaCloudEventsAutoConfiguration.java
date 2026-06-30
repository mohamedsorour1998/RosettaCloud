package app.rosettacloud.shared.config;

import app.rosettacloud.shared.aws.AwsProperties;
import app.rosettacloud.shared.events.DomainEventPublisher;
import app.rosettacloud.shared.events.EventsProperties;
import app.rosettacloud.shared.events.NoOpDomainEventPublisher;
import app.rosettacloud.shared.events.SnsDomainEventPublisher;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sns.SnsClient;

/** Wires a real SNS publisher when {@code rosettacloud.events.topic-arn} is set; otherwise a no-op. */
@AutoConfiguration
@EnableConfigurationProperties(EventsProperties.class)
public class RosettaCloudEventsAutoConfiguration {

    @Bean
    @ConditionalOnProperty(prefix = "rosettacloud.events", name = "topic-arn")
    @ConditionalOnMissingBean(SnsClient.class)
    public SnsClient snsClient(AwsProperties props) {
        return SnsClient.builder()
                .region(Region.of(props.getRegion()))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }

    @Bean
    @ConditionalOnProperty(prefix = "rosettacloud.events", name = "topic-arn")
    @ConditionalOnMissingBean(DomainEventPublisher.class)
    public DomainEventPublisher snsDomainEventPublisher(SnsClient snsClient, EventsProperties props) {
        return new SnsDomainEventPublisher(snsClient, props.getTopicArn());
    }

    @Bean
    @ConditionalOnMissingBean(DomainEventPublisher.class)
    public DomainEventPublisher noOpDomainEventPublisher() {
        return new NoOpDomainEventPublisher();
    }
}
