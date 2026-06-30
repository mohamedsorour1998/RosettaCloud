package app.rosettacloud.user.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AttributeType;

/**
 * Backfills {@code custom:user_id} into the Cognito user so the ID token resolves on next login.
 * Mirrors the best-effort behaviour in main.py: a failure (or unconfigured pool) is logged, not fatal.
 */
@Service
public class CognitoService {

    private static final Logger log = LoggerFactory.getLogger(CognitoService.class);

    private final CognitoIdentityProviderClient client;
    private final String userPoolId;

    public CognitoService(CognitoIdentityProviderClient client,
                          @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri:}") String issuerUri) {
        this.client = client;
        // issuer = https://cognito-idp.<region>.amazonaws.com/<pool-id>
        this.userPoolId = (issuerUri != null && issuerUri.contains("/"))
                ? issuerUri.substring(issuerUri.lastIndexOf('/') + 1)
                : "";
    }

    public void backfillUserId(String email, String userId) {
        if (userPoolId == null || userPoolId.isBlank()) {
            log.debug("Cognito pool id not configured; skipping custom:user_id backfill for {}", email);
            return;
        }
        try {
            client.adminUpdateUserAttributes(b -> b
                    .userPoolId(userPoolId)
                    .username(email)
                    .userAttributes(AttributeType.builder()
                            .name("custom:user_id")
                            .value(userId)
                            .build()));
        } catch (Exception e) {
            log.warn("Could not set custom:user_id in Cognito for {}: {}", email, e.getMessage());
        }
    }
}
