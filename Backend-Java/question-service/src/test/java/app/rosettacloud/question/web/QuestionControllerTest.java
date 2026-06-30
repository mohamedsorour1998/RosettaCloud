package app.rosettacloud.question.web;

import app.rosettacloud.question.client.UserProgressClient;
import app.rosettacloud.question.domain.QuestionData;
import app.rosettacloud.question.service.QuestionService;
import app.rosettacloud.shared.config.RosettaCloudSecurityAutoConfiguration;
import app.rosettacloud.shared.config.RosettaCloudWebAutoConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(QuestionController.class)
@Import({RosettaCloudSecurityAutoConfiguration.class, RosettaCloudWebAutoConfiguration.class})
class QuestionControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    QuestionService questionService;

    @MockitoBean
    UserProgressClient progressClient;

    @MockitoBean
    JwtDecoder jwtDecoder;

    @Test
    void getQuestionsRequiresAuth() throws Exception {
        mvc.perform(get("/questions/m1/l1")).andExpect(status().isUnauthorized());
    }

    @Test
    void getQuestionsReturnsList() throws Exception {
        when(questionService.getQuestions("m1", "l1"))
                .thenReturn(List.of(new QuestionData(1, "Q1", "Check", "Easy", null, null)));
        mvc.perform(get("/questions/m1/l1").with(jwt().jwt(j -> j.subject("u1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total_count").value(1))
                .andExpect(jsonPath("$.questions[0].question_number").value(1))
                .andExpect(jsonPath("$.questions[0].question_type").value("Check"));
    }

    @Test
    void setupFailureReturnsProblem400() throws Exception {
        when(questionService.executeSetup(anyString(), eq("m1"), eq("l1"), eq(1))).thenReturn(false);
        mvc.perform(post("/questions/m1/l1/1/setup")
                        .with(jwt().jwt(j -> j.subject("u1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pod_name\":\"lab-1\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void checkSuccessRecordsProgress() throws Exception {
        when(questionService.executeCheck(anyString(), anyString(), eq("m1"), eq("l1"), eq(1))).thenReturn(true);
        mvc.perform(post("/questions/m1/l1/1/check")
                        .with(jwt().jwt(j -> j.claim("custom:user_id", "u1").subject("u1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pod_name\":\"lab-1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.completed").value(true));
        verify(progressClient).trackProgress(eq("u1"), eq("m1"), eq("l1"), eq(1), any());
    }
}
