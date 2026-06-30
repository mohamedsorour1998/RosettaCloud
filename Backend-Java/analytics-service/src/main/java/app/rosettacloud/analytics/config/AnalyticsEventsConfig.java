package app.rosettacloud.analytics.config;

import app.rosettacloud.shared.aws.AwsProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;

@Configuration
public class AnalyticsEventsConfig {

    @Bean
    @ConditionalOnProperty(prefix = "rosettacloud.events", name = "queue-url")
    @ConditionalOnMissingBean
    public SqsClient sqsClient(AwsProperties props,
                               app.rosettacloud.shared.events.EventsProperties events) {
        var builder = SqsClient.builder()
                .region(Region.of(props.getRegion()))
                .credentialsProvider(DefaultCredentialsProvider.create());
        if (events.getEndpointOverride() != null && !events.getEndpointOverride().isBlank()) {
            builder.endpointOverride(java.net.URI.create(events.getEndpointOverride()));
        }
        return builder.build();
    }
}
