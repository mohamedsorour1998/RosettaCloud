package app.rosettacloud.question.web.dto;

import app.rosettacloud.question.domain.QuestionData;

import java.util.List;

public record QuestionsResponse(List<QuestionData> questions, int totalCount) {
}
