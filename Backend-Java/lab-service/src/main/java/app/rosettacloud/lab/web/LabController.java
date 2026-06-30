package app.rosettacloud.lab.web;

import app.rosettacloud.lab.domain.LabInfo;
import app.rosettacloud.lab.service.LabService;
import app.rosettacloud.lab.web.dto.LaunchResponse;
import app.rosettacloud.shared.error.ResourceNotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;

@RestController
public class LabController {

    private final LabService labService;

    public LabController(LabService labService) {
        this.labService = labService;
    }

    private static String resolvedId(Jwt jwt) {
        String custom = jwt.getClaimAsString("custom:user_id");
        return (custom != null && !custom.isBlank()) ? custom : jwt.getSubject();
    }

    @PostMapping("/labs")
    @ResponseStatus(HttpStatus.CREATED)
    public LaunchResponse create(@AuthenticationPrincipal Jwt jwt) {
        return new LaunchResponse(labService.launch(resolvedId(jwt)));
    }

    @GetMapping("/labs/{labId}")
    public ResponseEntity<?> info(@PathVariable String labId, @AuthenticationPrincipal Jwt jwt) {
        Optional<LabInfo> info = labService.info(labId);
        if (info.isEmpty()) {
            // Phantom-lab recovery: pod gone → record the session against the user's quota.
            labService.terminate(labId, resolvedId(jwt));
            return ResponseEntity.ok(Map.of("error", "lab not found"));
        }
        return ResponseEntity.ok(info.get());
    }

    @DeleteMapping("/labs/{labId}")
    public Map<String, Object> terminate(@PathVariable String labId, @AuthenticationPrincipal Jwt jwt) {
        boolean deleted = labService.terminate(labId, resolvedId(jwt));
        if (!deleted) {
            throw new ResourceNotFoundException("Lab not found.");
        }
        return Map.of("deleted", true);
    }
}
