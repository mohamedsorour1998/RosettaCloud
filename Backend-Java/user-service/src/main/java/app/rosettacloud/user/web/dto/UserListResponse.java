package app.rosettacloud.user.web.dto;

import java.util.List;

public record UserListResponse(List<UserResponse> users, int count, String lastKey) {
}
