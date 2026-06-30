package app.rosettacloud.chat.web;

import app.rosettacloud.chat.service.ChatService;
import app.rosettacloud.chat.web.dto.ChatResponse;
import app.rosettacloud.shared.config.RosettaCloudSecurityAutoConfiguration;
import app.rosettacloud.shared.config.RosettaCloudWebAutoConfiguration;
import app.rosettacloud.shared.error.QuotaExceededException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ChatController.class)
@Import({RosettaCloudSecurityAutoConfiguration.class, RosettaCloudWebAutoConfiguration.class})
class ChatControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    ChatService chatService;

    @MockitoBean
    JwtDecoder jwtDecoder;

    @Test
    void chatRequiresAuth() throws Exception {
        mvc.perform(post("/chat").contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"hi\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void chatReturnsAgentReply() throws Exception {
        when(chatService.handle(anyString(), any())).thenReturn(new ChatResponse("Hello!", "tutor", "sess-1"));
        mvc.perform(post("/chat")
                        .with(jwt().jwt(j -> j.claim("custom:user_id", "u1").subject("u1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"hi\",\"session_id\":\"sess-1\",\"type\":\"chat\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.response").value("Hello!"))
                .andExpect(jsonPath("$.agent").value("tutor"))
                .andExpect(jsonPath("$.session_id").value("sess-1"));
    }

    @Test
    void aiQuotaExhaustedMapsTo403WithCode() throws Exception {
        when(chatService.handle(anyString(), any())).thenThrow(
                new QuotaExceededException("Weekly AI message quota exhausted.", "AI_QUOTA_EXHAUSTED",
                        Map.of("messages_remaining", 0)));
        mvc.perform(post("/chat")
                        .with(jwt().jwt(j -> j.subject("u1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"hi\",\"type\":\"chat\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("AI_QUOTA_EXHAUSTED"));
    }
}
