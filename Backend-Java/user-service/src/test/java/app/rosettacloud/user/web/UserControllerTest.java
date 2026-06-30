package app.rosettacloud.user.web;

import app.rosettacloud.shared.config.RosettaCloudSecurityAutoConfiguration;
import app.rosettacloud.shared.config.RosettaCloudWebAutoConfiguration;
import app.rosettacloud.user.domain.LabQuota;
import app.rosettacloud.user.persistence.UserItem;
import app.rosettacloud.user.service.QuotaService;
import app.rosettacloud.user.service.UserService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(UserController.class)
@Import({RosettaCloudSecurityAutoConfiguration.class, RosettaCloudWebAutoConfiguration.class})
class UserControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    UserService userService;

    @MockitoBean
    QuotaService quotaService;

    @MockitoBean
    JwtDecoder jwtDecoder; // satisfies oauth2ResourceServer().jwt(); real tokens injected via jwt() processor

    private static UserItem sample() {
        UserItem u = new UserItem();
        u.setUserId("u123");
        u.setEmail("a@b.com");
        u.setName("Alice");
        u.setRole("user");
        return u;
    }

    @Test
    void createUserIsPublicAndReturns201() throws Exception {
        when(userService.create(any())).thenReturn(sample());
        String body = "{\"email\":\"a@b.com\",\"name\":\"Alice\",\"password\":\"secret123\"}";
        mvc.perform(post("/users").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.user_id").value("u123"))
                .andExpect(jsonPath("$.email").value("a@b.com"));
    }

    @Test
    void createUserWithInvalidEmailReturnsProblemDetail400() throws Exception {
        String body = "{\"email\":\"not-an-email\",\"name\":\"Alice\",\"password\":\"secret123\"}";
        mvc.perform(post("/users").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void getUserWithoutJwtReturns401() throws Exception {
        mvc.perform(get("/users/u123")).andExpect(status().isUnauthorized());
    }

    @Test
    void getUserWithJwtResolvesIdentityFromToken() throws Exception {
        when(userService.require(anyString(), any())).thenReturn(sample());
        mvc.perform(get("/users/ignored-path-id")
                        .with(jwt().jwt(j -> j.claim("custom:user_id", "u123").subject("u123"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user_id").value("u123"));
    }

    @Test
    void labQuotaReturnsSnakeCaseBody() throws Exception {
        when(userService.require(anyString(), any())).thenReturn(sample());
        when(quotaService.labQuota(any())).thenReturn(new LabQuota(0, 120, 120, 1234567890L));
        mvc.perform(get("/users/u123/lab-quota")
                        .with(jwt().jwt(j -> j.claim("custom:user_id", "u123").subject("u123"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.minutes_remaining").value(120))
                .andExpect(jsonPath("$.minutes_limit").value(120))
                .andExpect(jsonPath("$.week_resets_at").value(1234567890L));
    }
}
