package app.rosettacloud.shared.security;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;

/**
 * Validates the Cognito {@code aud} (when an audience is configured) and the {@code token_use}
 * claim ({@code id} or {@code access}). Lenient when no audience is configured (e.g., tests).
 */
public final class AudienceTokenUseValidator implements OAuth2TokenValidator<Jwt> {

    private final String audience;

    public AudienceTokenUseValidator(String audience) {
        this.audience = audience;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        if (audience != null && !audience.isBlank()) {
            List<String> aud = jwt.getAudience();
            // Cognito access tokens carry client_id rather than aud.
            String clientId = jwt.getClaimAsString("client_id");
            boolean ok = (aud != null && aud.contains(audience)) || audience.equals(clientId);
            if (!ok) {
                return OAuth2TokenValidatorResult.failure(
                        new OAuth2Error("invalid_token", "Required audience is missing", null));
            }
        }
        String tokenUse = jwt.getClaimAsString("token_use");
        if (tokenUse != null && !tokenUse.equals("id") && !tokenUse.equals("access")) {
            return OAuth2TokenValidatorResult.failure(
                    new OAuth2Error("invalid_token", "Invalid token_use", null));
        }
        return OAuth2TokenValidatorResult.success();
    }
}
