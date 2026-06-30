package app.rosettacloud.shared.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;

/** Accessor for the authenticated caller's resolved user id (principal name set by the converter). */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static Optional<String> resolvedUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            return Optional.empty();
        }
        String name = auth.getName();
        return (name == null || name.isBlank()) ? Optional.empty() : Optional.of(name);
    }

    public static String requireUserId() {
        return resolvedUserId().orElseThrow(
                () -> new IllegalStateException("No authenticated user in security context"));
    }
}
