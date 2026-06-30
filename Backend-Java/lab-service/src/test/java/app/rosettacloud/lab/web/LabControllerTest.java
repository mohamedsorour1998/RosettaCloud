package app.rosettacloud.lab.web;

import app.rosettacloud.lab.domain.LabInfo;
import app.rosettacloud.lab.service.LabService;
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
import java.util.Optional;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(LabController.class)
@Import({RosettaCloudSecurityAutoConfiguration.class, RosettaCloudWebAutoConfiguration.class})
class LabControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    LabService labService;

    @MockitoBean
    JwtDecoder jwtDecoder;

    @Test
    void createRequiresAuth() throws Exception {
        mvc.perform(post("/labs")).andExpect(status().isUnauthorized());
    }

    @Test
    void createReturnsLabId() throws Exception {
        when(labService.launch(anyString())).thenReturn("lab-abc123");
        mvc.perform(post("/labs").with(jwt().jwt(j -> j.claim("custom:user_id", "u1").subject("u1"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.lab_id").value("lab-abc123"));
    }

    @Test
    void infoReturnsRunningLab() throws Exception {
        when(labService.info("lab-abc123")).thenReturn(Optional.of(
                new LabInfo("lab-abc123", "lab-lab-abc123", "10.0.0.5",
                        "lab-abc123.labs.dev.rosettacloud.app", "https://lab-abc123.labs.dev.rosettacloud.app",
                        "running", Map.of("minutes", 30, "seconds", 0, "total_seconds", 1800))));
        mvc.perform(get("/labs/lab-abc123").with(jwt().jwt(j -> j.subject("u1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lab_id").value("lab-abc123"))
                .andExpect(jsonPath("$.status").value("running"));
    }

    @Test
    void infoMissingReturnsErrorBodyAndRecordsSession() throws Exception {
        when(labService.info("gone")).thenReturn(Optional.empty());
        mvc.perform(get("/labs/gone").with(jwt().jwt(j -> j.claim("custom:user_id", "u1").subject("u1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.error").value("lab not found"));
        verify(labService).terminate("gone", "u1");
    }

    @Test
    void deleteReturnsDeleted() throws Exception {
        when(labService.terminate(anyString(), anyString())).thenReturn(true);
        mvc.perform(delete("/labs/lab-abc123").with(jwt().jwt(j -> j.subject("u1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(true));
    }
}
