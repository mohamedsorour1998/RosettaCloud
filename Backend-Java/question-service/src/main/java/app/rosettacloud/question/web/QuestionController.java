package app.rosettacloud.question.web;

import app.rosettacloud.question.client.UserProgressClient;
import app.rosettacloud.question.service.QuestionService;
import app.rosettacloud.question.web.dto.QuestionActionResponse;
import app.rosettacloud.question.web.dto.QuestionRequest;
import app.rosettacloud.question.web.dto.QuestionsResponse;
import app.rosettacloud.shared.error.BadRequestException;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class QuestionController {

    private final QuestionService questionService;
    private final UserProgressClient progressClient;

    public QuestionController(QuestionService questionService, UserProgressClient progressClient) {
        this.questionService = questionService;
        this.progressClient = progressClient;
    }

    private static String resolvedId(Jwt jwt) {
        String custom = jwt.getClaimAsString("custom:user_id");
        return (custom != null && !custom.isBlank()) ? custom : jwt.getSubject();
    }

    @GetMapping("/questions/{moduleUuid}/{lessonUuid}")
    public QuestionsResponse getQuestions(@PathVariable String moduleUuid, @PathVariable String lessonUuid) {
        var questions = questionService.getQuestions(moduleUuid, lessonUuid);
        return new QuestionsResponse(questions, questions.size());
    }

    @PostMapping("/questions/{moduleUuid}/{lessonUuid}/{questionNumber}/setup")
    public QuestionActionResponse setup(@PathVariable String moduleUuid,
                                        @PathVariable String lessonUuid,
                                        @PathVariable int questionNumber,
                                        @Valid @RequestBody QuestionRequest req) {
        boolean ok = questionService.executeSetup(req.podName(), moduleUuid, lessonUuid, questionNumber);
        if (!ok) {
            throw new BadRequestException("Failed to execute question " + questionNumber + " setup in the pod");
        }
        return new QuestionActionResponse("success",
                "Question " + questionNumber + " setup executed successfully", true);
    }

    @PostMapping("/questions/{moduleUuid}/{lessonUuid}/{questionNumber}/check")
    public QuestionActionResponse check(@PathVariable String moduleUuid,
                                        @PathVariable String lessonUuid,
                                        @PathVariable int questionNumber,
                                        @Valid @RequestBody QuestionRequest req,
                                        @RequestHeader(value = "Authorization", required = false) String authorization,
                                        @AuthenticationPrincipal Jwt jwt) {
        String userId = resolvedId(jwt);
        boolean ok = questionService.executeCheck(userId, req.podName(), moduleUuid, lessonUuid, questionNumber);
        if (ok) {
            String bearer = (authorization != null && authorization.startsWith("Bearer "))
                    ? authorization.substring(7) : null;
            progressClient.trackProgress(userId, moduleUuid, lessonUuid, questionNumber, bearer);
            return new QuestionActionResponse("success",
                    "Question " + questionNumber + " completed successfully", true);
        }
        return new QuestionActionResponse("error",
                "Failed validation for question " + questionNumber, false);
    }
}
