package app.rosettacloud.user.web;

import app.rosettacloud.user.domain.AiQuota;
import app.rosettacloud.user.domain.LabQuota;
import app.rosettacloud.user.persistence.UserItem;
import app.rosettacloud.user.service.QuotaService;
import app.rosettacloud.user.service.UserService;
import app.rosettacloud.user.web.dto.CreateUserRequest;
import app.rosettacloud.user.web.dto.ProgressUpdateRequest;
import app.rosettacloud.user.web.dto.UpdateUserRequest;
import app.rosettacloud.user.web.dto.UserListResponse;
import app.rosettacloud.user.web.dto.UserResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Public user API. The authenticated caller's identity comes from the JWT (resolved user id),
 * NOT the {@code {userId}} path variable — matching the FastAPI behaviour.
 */
@RestController
public class UserController {

    private final UserService userService;
    private final QuotaService quotaService;

    public UserController(UserService userService, QuotaService quotaService) {
        this.userService = userService;
        this.quotaService = quotaService;
    }

    private static String resolvedId(Jwt jwt) {
        String custom = jwt.getClaimAsString("custom:user_id");
        return (custom != null && !custom.isBlank()) ? custom : jwt.getSubject();
    }

    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    public UserResponse create(@Valid @RequestBody CreateUserRequest req) {
        return UserResponse.from(userService.create(req));
    }

    @GetMapping("/users/{userId}")
    public UserResponse get(@PathVariable String userId, @AuthenticationPrincipal Jwt jwt) {
        return UserResponse.from(userService.require(resolvedId(jwt), jwt.getClaimAsString("email")));
    }

    @PutMapping("/users/{userId}")
    public UserResponse update(@PathVariable String userId, @Valid @RequestBody UpdateUserRequest req,
                               @AuthenticationPrincipal Jwt jwt) {
        return UserResponse.from(userService.update(resolvedId(jwt), req));
    }

    @DeleteMapping("/users/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String userId, @AuthenticationPrincipal Jwt jwt) {
        userService.delete(resolvedId(jwt));
    }

    @GetMapping("/users")
    public UserListResponse list(@RequestParam(defaultValue = "100") int limit) {
        List<UserResponse> users = userService.list(limit).stream().map(UserResponse::from).toList();
        return new UserListResponse(users, users.size(), null);
    }

    @GetMapping("/users/{userId}/labs")
    public Map<String, Object> labs(@PathVariable String userId, @AuthenticationPrincipal Jwt jwt) {
        return Map.of("labs", userService.labs(resolvedId(jwt)));
    }

    @GetMapping("/users/{userId}/progress")
    public Map<String, Object> progress(@PathVariable String userId,
                                        @RequestParam(name = "module_uuid", required = false) String moduleUuid,
                                        @RequestParam(name = "lesson_uuid", required = false) String lessonUuid,
                                        @AuthenticationPrincipal Jwt jwt) {
        return Map.of("progress", userService.progress(resolvedId(jwt), moduleUuid, lessonUuid));
    }

    @PostMapping("/users/{userId}/progress/{moduleUuid}/{lessonUuid}/{questionNumber}")
    public Map<String, Object> updateProgress(@PathVariable String userId,
                                              @PathVariable String moduleUuid,
                                              @PathVariable String lessonUuid,
                                              @PathVariable int questionNumber,
                                              @RequestBody ProgressUpdateRequest req,
                                              @AuthenticationPrincipal Jwt jwt) {
        userService.trackProgress(resolvedId(jwt), moduleUuid, lessonUuid, questionNumber, req.completed());
        return Map.of("updated", true);
    }

    @GetMapping("/users/{userId}/lab-quota")
    public LabQuota labQuota(@PathVariable String userId, @AuthenticationPrincipal Jwt jwt) {
        UserItem u = userService.require(resolvedId(jwt), null);
        return quotaService.labQuota(u);
    }

    @GetMapping("/users/{userId}/ai-quota")
    public AiQuota aiQuota(@PathVariable String userId, @AuthenticationPrincipal Jwt jwt) {
        UserItem u = userService.require(resolvedId(jwt), null);
        return quotaService.aiQuota(u);
    }
}
