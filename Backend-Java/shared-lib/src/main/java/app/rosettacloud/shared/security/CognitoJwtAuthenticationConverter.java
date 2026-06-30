package app.rosettacloud.shared.security;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Converts a Cognito {@link Jwt} into a {@link JwtAuthenticationToken} whose principal name is the
 * resolved user id ({@code custom:user_id} else {@code sub}) and whose authorities derive from
 * {@code cognito:groups} and {@code custom:role} (mapped to {@code ROLE_*}).
 */
public final class CognitoJwtAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        Set<GrantedAuthority> authorities = new LinkedHashSet<>();

        Object groups = jwt.getClaim("cognito:groups");
        if (groups instanceof Collection<?> collection) {
            for (Object g : collection) {
                if (g != null) {
                    authorities.add(new SimpleGrantedAuthority("ROLE_" + g));
                }
            }
        }
        String role = jwt.getClaimAsString("custom:role");
        if (role != null && !role.isBlank()) {
            authorities.add(new SimpleGrantedAuthority("ROLE_" + role));
        }

        String principal = jwt.getClaimAsString("custom:user_id");
        if (principal == null || principal.isBlank()) {
            principal = jwt.getSubject();
        }
        return new JwtAuthenticationToken(jwt, authorities, principal);
    }
}
