package app.rosettacloud.chat.web.dto;

/** Chat request (snake_case JSON). {@code message} may be empty for grade/session_start types. */
public record ChatRequest(
        String message,
        String userId,
        String sessionId,
        String moduleUuid,
        String lessonUuid,
        String type,
        Integer questionNumber,
        String result,
        String image) {
}
