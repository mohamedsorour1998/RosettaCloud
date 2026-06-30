package app.rosettacloud.shared.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

/**
 * Security configuration. {@code public-paths} are permitted without a JWT;
 * {@code audience} is the Cognito app client id validated against the token's {@code aud}.
 */
@ConfigurationProperties(prefix = "rosettacloud.security")
public class SecurityProperties {

    private List<String> publicPaths = new ArrayList<>(List.of(
            "/health-check",
            "/actuator/health",
            "/actuator/health/**",
            "/actuator/info",
            "/actuator/prometheus",
            "/public/**",
            // Cluster-internal service-to-service endpoints. NOT exposed via the public API Gateway
            // (excluded in strangler routing) and locked down with a NetworkPolicy in WP-60.
            "/internal/**"));

    private String audience = "";

    public List<String> getPublicPaths() {
        return publicPaths;
    }

    public void setPublicPaths(List<String> publicPaths) {
        this.publicPaths = publicPaths;
    }

    public String getAudience() {
        return audience;
    }

    public void setAudience(String audience) {
        this.audience = audience;
    }
}
