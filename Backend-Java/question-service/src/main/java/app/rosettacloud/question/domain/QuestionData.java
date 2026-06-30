package app.rosettacloud.question.domain;

import java.util.List;

/** Parsed question metadata (snake_case JSON: question_number, question_type, answer_choices, ...). */
public record QuestionData(
        int questionNumber,
        String question,
        String questionType,        // "MCQ" | "Check"
        String questionDifficulty,  // Easy | Medium | Hard
        List<String> answerChoices, // MCQ only (null otherwise)
        String correctAnswer) {     // MCQ only (null otherwise)
}
