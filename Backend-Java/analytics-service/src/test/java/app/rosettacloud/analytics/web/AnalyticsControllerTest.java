package app.rosettacloud.analytics.web;

import app.rosettacloud.analytics.domain.AdminMetrics;
import app.rosettacloud.analytics.domain.PublicStats;
import app.rosettacloud.analytics.service.AdminAccessChecker;
import app.rosettacloud.analytics.service.MetricsService;
import app.rosettacloud.shared.config.RosettaCloudSecurityAutoConfiguration;
import app.rosettacloud.shared.config.RosettaCloudWebAutoConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(AnalyticsController.class)
@Import({RosettaCloudSecurityAutoConfiguration.class, RosettaCloudWebAutoConfiguration.class})
class AnalyticsControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    MetricsService metricsService;

    @MockitoBean
    AdminAccessChecker adminAccessChecker;

    @MockitoBean
    JwtDecoder jwtDecoder;

    @Test
    void publicStatsIsPublic() throws Exception {
        when(metricsService.publicStats()).thenReturn(new PublicStats(12, 40, 7, 5));
        mvc.perform(get("/public/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.labs_launched").value(12))
                .andExpect(jsonPath("$.questions_answered").value(40));
    }

    @Test
    void adminMetricsRequiresAuth() throws Exception {
        mvc.perform(get("/admin/metrics")).andExpect(status().isUnauthorized());
    }

    @Test
    void adminMetricsForbiddenForNonAdmin() throws Exception {
        when(adminAccessChecker.isAdmin(anyString())).thenReturn(false);
        mvc.perform(get("/admin/metrics").with(jwt().jwt(j -> j.claim("custom:user_id", "u1").subject("u1"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    void adminMetricsOkForAdmin() throws Exception {
        when(adminAccessChecker.isAdmin(anyString())).thenReturn(true);
        when(metricsService.adminMetrics()).thenReturn(new AdminMetrics(5, Map.of("lab_started", 12L), 75.0, Map.of(), null));
        mvc.perform(get("/admin/metrics").with(jwt().jwt(j -> j.claim("custom:user_id", "admin1").subject("admin1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accuracy_pct").value(75.0))
                .andExpect(jsonPath("$.total_users").value(5));
    }
}
