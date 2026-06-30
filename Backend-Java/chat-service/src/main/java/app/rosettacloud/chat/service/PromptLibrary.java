package app.rosettacloud.chat.service;

/** Maps a chat {@code type} to an agent name + a concise system prompt (used by the direct-Bedrock invoker). */
public final class PromptLibrary {

    private PromptLibrary() {
    }

    public static String agentFor(String type) {
        if (type == null) {
            return "tutor";
        }
        return switch (type) {
            case "grade" -> "grader";
            case "session_start" -> "planner";
            default -> "tutor";
        };
    }

    public static String systemPrompt(String agent) {
        return switch (agent) {
            case "grader" -> "You are the RosettaCloud Grader. Give concise (<150 words), specific, encouraging "
                    + "feedback on the student's DevOps work. Point out one concrete fix.";
            case "planner" -> "You are the RosettaCloud Curriculum Planner. Recommend a clear, specific next "
                    + "learning step for the student in Linux/Docker/Kubernetes. Be brief and encouraging.";
            default -> "You are the RosettaCloud Tutor, a DevOps educator. Use a hint-first approach: guide the "
                    + "student with a leading question or conceptual hint rather than giving the full answer.";
        };
    }
}
