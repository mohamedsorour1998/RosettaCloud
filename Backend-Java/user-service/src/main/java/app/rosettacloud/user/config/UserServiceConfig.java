package app.rosettacloud.user.config;

import app.rosettacloud.shared.aws.AwsProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;

@Configuration
public class UserServiceConfig {

    @Bean
    @ConditionalOnMissingBean
    public CognitoIdentityProviderClient cognitoIdentityProviderClient(AwsProperties props) {
        return CognitoIdentityProviderClient.builder()
                .region(Region.of(props.getRegion()))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }
}
