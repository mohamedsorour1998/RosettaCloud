package app.rosettacloud.shared.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

class SecurityConvertersTest {

    private static Jwt jwt(Consumer<Jwt.Builder> customizer) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "none").subject("sub-1");
        customizer.accept(b);
        return b.build();
    }

    // ── AudienceTokenUseValidator ──────────────────────────────────────────
    @Test
    void validatorAcceptsMatchingClientId() {
        var v = new AudienceTokenUseValidator("client-1");
        OAuth2TokenValidatorResult r = v.validate(jwt(b -> b.claim("client_id", "client-1").claim("token_use", "access")));
        assertThat(r.hasErrors()).isFalse();
    }

    @Test
    void validatorAcceptsMatchingAudience() {
        var v = new AudienceTokenUseValidator("client-1");
        assertThat(v.validate(jwt(b -> b.audience(List.of("client-1")))).hasErrors()).isFalse();
    }

    @Test
    void validatorRejectsWrongAudience() {
        var v = new AudienceTokenUseValidator("client-1");
        assertThat(v.validate(jwt(b -> b.claim("client_id", "other"))).hasErrors()).isTrue();
    }

    @Test
    void validatorRejectsBadTokenUse() {
        var v = new AudienceTokenUseValidator("client-1");
        assertThat(v.validate(jwt(b -> b.claim("client_id", "client-1").claim("token_use", "bogus"))).hasErrors()).isTrue();
    }

    @Test
    void validatorSkipsAudienceCheckWhenBlank() {
        var v = new AudienceTokenUseValidator("");
        assertThat(v.validate(jwt(b -> b.claim("token_use", "id"))).hasErrors()).isFalse();
    }

    // ── CognitoJwtAuthenticationConverter ──────────────────────────────────
    @Test
    void converterPrefersCustomUserId() {
        var c = new CognitoJwtAuthenticationConverter();
        assertThat(c.convert(jwt(b -> b.claim("custom:user_id", "u1"))).getName()).isEqualTo("u1");
    }

    @Test
    void converterFallsBackToSubject() {
        var c = new CognitoJwtAuthenticationConverter();
        assertThat(c.convert(jwt(b -> {})).getName()).isEqualTo("sub-1");
    }

    @Test
    void converterMapsGroupsAndRoleToAuthorities() {
        var c = new CognitoJwtAuthenticationConverter();
        var token = c.convert(jwt(b -> b.claim("cognito:groups", List.of("admin")).claim("custom:role", "teacher")));
        var names = AuthorityUtils.authorityListToSet(token.getAuthorities());
        assertThat(names).contains("ROLE_admin", "ROLE_teacher");
    }
}
