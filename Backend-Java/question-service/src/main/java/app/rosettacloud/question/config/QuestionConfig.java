package app.rosettacloud.question.config;

import app.rosettacloud.shared.aws.AwsProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

import java.net.URI;

@Configuration
public class QuestionConfig {

    @Bean
    @ConditionalOnMissingBean
    public S3Client s3Client(AwsProperties props,
                             @Value("${rosettacloud.aws.s3.endpoint-override:}") String endpointOverride) {
        var builder = S3Client.builder()
                .region(Region.of(props.getRegion()))
                .credentialsProvider(DefaultCredentialsProvider.create());
        if (endpointOverride != null && !endpointOverride.isBlank()) {
            builder.endpointOverride(URI.create(endpointOverride)).forcePathStyle(true);
        }
        return builder.build();
    }
}
