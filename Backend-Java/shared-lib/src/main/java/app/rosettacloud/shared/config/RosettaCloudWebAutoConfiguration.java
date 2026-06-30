package app.rosettacloud.shared.config;

import app.rosettacloud.shared.error.GlobalExceptionHandler;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;

/** Registers the shared RFC-7807 exception handler for every service. */
@AutoConfiguration
public class RosettaCloudWebAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public GlobalExceptionHandler rosettaCloudGlobalExceptionHandler() {
        return new GlobalExceptionHandler();
    }
}
