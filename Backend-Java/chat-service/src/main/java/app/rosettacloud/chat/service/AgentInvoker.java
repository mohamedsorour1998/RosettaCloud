package app.rosettacloud.chat.service;

import java.util.List;
import java.util.Map;

/** Provider-agnostic agent invocation. */
public interface AgentInvoker {

    record Invocation(
            String message,
            String userId,
            String sessionId,
            String type,
            String moduleUuid,
            String lessonUuid,
            List<Map<String, String>> history,
            int questionNumber,
            String result,
            String imageBase64) {
    }

    record Reply(String response, String agent) {
    }

    Reply invoke(Invocation invocation);
}
