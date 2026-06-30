package app.rosettacloud.question.web.dto;

import jakarta.validation.constraints.NotBlank;

/** Body for setup/check: {@code {"pod_name": "..."}}. */
public record QuestionRequest(@NotBlank String podName) {
}
