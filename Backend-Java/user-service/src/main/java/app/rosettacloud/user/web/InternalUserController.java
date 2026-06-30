package app.rosettacloud.user.web;

import app.rosettacloud.user.domain.AiQuota;
import app.rosettacloud.user.domain.LabQuota;
import app.rosettacloud.user.persistence.UserItem;
import app.rosettacloud.user.service.QuotaService;
import app.rosettacloud.user.service.UserService;
import app.rosettacloud.user.web.dto.ProgressUpdateRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * Cluster-internal endpoints consumed by lab-service / question-service / chat-service. The caller
 * has already resolved the user id, so these operate on the path {@code userId} directly. Still
 * JWT-authenticated (see shared-lib security); tighten with a NetworkPolicy in WP-60.
 */
@RestController
@RequestMapping("/internal/users/{userId}")
public class InternalUserController {

    private final UserService userService;
    private final QuotaService quotaService;

    public InternalUserController(UserService userService, QuotaService quotaService) {
        this.userService = userService;
        this.quotaService = quotaService;
    }

    @GetMapping("/lab-quota")
    public LabQuota labQuota(@PathVariable String userId) {
        return quotaService.labQuota(userService.require(userId, null));
    }

    @GetMapping("/ai-quota")
    public AiQuota aiQuota(@PathVariable String userId) {
        return quotaService.aiQuota(userService.require(userId, null));
    }

    @PostMapping("/ai/increment")
    public Map<String, Object> incrementAi(@PathVariable String userId) {
        quotaService.incrementAiMessages(userService.require(userId, null));
        return Map.of("ok", true);
    }

    @GetMapping("/active-lab")
    public Map<String, Object> activeLab(@PathVariable String userId) {
        String lab = quotaService.activeLab(userService.require(userId, null));
        Map<String, Object> body = new HashMap<>();
        body.put("active_lab", lab);
        return body;
    }

    @PostMapping("/active-lab/{labId}")
    public Map<String, Object> setActiveLab(@PathVariable String userId, @PathVariable String labId) {
        quotaService.setActiveLab(userService.require(userId, null), labId);
        return Map.of("ok", true);
    }

    @PostMapping("/close-lab-session")
    public Map<String, Object> closeLabSession(@PathVariable String userId) {
        long minutes = quotaService.closeLabSession(userService.require(userId, null));
        return Map.of("minutes_recorded", minutes);
    }

    @PostMapping("/labs/{labId}")
    public Map<String, Object> linkLab(@PathVariable String userId, @PathVariable String labId) {
        userService.linkLab(userId, labId);
        return Map.of("ok", true);
    }

    @DeleteMapping("/labs/{labId}")
    public Map<String, Object> unlinkLab(@PathVariable String userId, @PathVariable String labId) {
        userService.unlinkLab(userId, labId);
        return Map.of("ok", true);
    }

    @PostMapping("/progress/{moduleUuid}/{lessonUuid}/{questionNumber}")
    public Map<String, Object> trackProgress(@PathVariable String userId,
                                             @PathVariable String moduleUuid,
                                             @PathVariable String lessonUuid,
                                             @PathVariable int questionNumber,
                                             @RequestBody ProgressUpdateRequest req) {
        userService.trackProgress(userId, moduleUuid, lessonUuid, questionNumber, req.completed());
        return Map.of("updated", true);
    }
}
