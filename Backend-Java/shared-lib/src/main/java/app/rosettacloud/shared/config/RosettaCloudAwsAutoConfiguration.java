package app.rosettacloud.shared.config;

import app.rosettacloud.shared.aws.AwsProperties;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.enhanced.dynamodb.DynamoDbEnhancedClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;

import java.net.URI;

/** Provides shared AWS SDK v2 clients. Credentials come from {@code DefaultCredentialsProvider}
 * (IRSA in-cluster, profile locally). */
@AutoConfiguration
@EnableConfigurationProperties(AwsProperties.class)
public class RosettaCloudAwsAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public DynamoDbClient dynamoDbClient(AwsProperties props) {
        var builder = DynamoDbClient.builder()
                .region(Region.of(props.getRegion()))
                .credentialsProvider(DefaultCredentialsProvider.create());
        String endpoint = props.getDynamodb().getEndpointOverride();
        if (endpoint != null && !endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint));
        }
        return builder.build();
    }

    @Bean
    @ConditionalOnMissingBean
    public DynamoDbEnhancedClient dynamoDbEnhancedClient(DynamoDbClient dynamoDbClient) {
        return DynamoDbEnhancedClient.builder().dynamoDbClient(dynamoDbClient).build();
    }
}
