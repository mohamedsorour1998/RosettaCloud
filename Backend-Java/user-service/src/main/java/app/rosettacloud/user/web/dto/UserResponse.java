package app.rosettacloud.user.web.dto;

import app.rosettacloud.user.persistence.UserItem;

import java.util.Map;

public record UserResponse(
        String userId,
        String email,
        String name,
        String role,
        Long createdAt,
        Long updatedAt,
        Map<String, Object> metadata) {

    public static UserResponse from(UserItem u) {
        return new UserResponse(
                u.getUserId(), u.getEmail(), u.getName(), u.getRole(),
                u.getCreatedAt(), u.getUpdatedAt(), u.getMetadata());
    }
}
