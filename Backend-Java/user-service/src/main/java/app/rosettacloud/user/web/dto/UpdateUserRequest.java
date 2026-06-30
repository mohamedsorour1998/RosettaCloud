package app.rosettacloud.user.web.dto;

import jakarta.validation.constraints.Email;

import java.util.Map;

public record UpdateUserRequest(
        @Email String email,
        String name,
        String password,
        String role,
        Map<String, Object> metadata) {
}
