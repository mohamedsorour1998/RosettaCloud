package app.rosettacloud.analytics.web;

import app.rosettacloud.analytics.domain.AdminMetrics;
import app.rosettacloud.analytics.domain.PublicStats;
import app.rosettacloud.analytics.service.AdminAccessChecker;
import app.rosettacloud.analytics.service.MetricsService;
import app.rosettacloud.shared.error.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AnalyticsController {

    private final MetricsService metricsService;
    private final AdminAccessChecker adminAccessChecker;

    public AnalyticsController(MetricsService metricsService, AdminAccessChecker adminAccessChecker) {
        this.metricsService = metricsService;
        this.adminAccessChecker = adminAccessChecker;
    }

    private static String resolvedId(Jwt jwt) {
        String custom = jwt.getClaimAsString("custom:user_id");
        return (custom != null && !custom.isBlank()) ? custom : jwt.getSubject();
    }

    /** Public, no auth — landing page live counters. */
    @GetMapping("/public/stats")
    public PublicStats publicStats() {
        return metricsService.publicStats();
    }

    /** Admin only — authenticated (API GW JWT) AND DB-backed admin role check. */
    @GetMapping("/admin/metrics")
    public AdminMetrics adminMetrics(@AuthenticationPrincipal Jwt jwt) {
        if (!adminAccessChecker.isAdmin(resolvedId(jwt))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Admin access required", "FORBIDDEN");
        }
        return metricsService.adminMetrics();
    }
}
