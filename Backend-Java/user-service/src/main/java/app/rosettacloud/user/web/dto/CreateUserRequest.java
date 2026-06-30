package app.rosettacloud.user.web.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

import java.util.Map;

/** Create-user request. {@code password} is accepted for API parity but intentionally NOT persisted
 * (authentication is handled by Cognito; storing plaintext passwords is a security anti-pattern). */
public record CreateUserRequest(
        @NotBlank @Email String email,
        @NotBlank String name,
        @NotBlank String password,
        String role,
        Map<String, Object> metadata) {
}
