package app.rosettacloud.chat.service;

import java.util.List;
import java.util.Map;

/** Conversation history store (keyed by session id). Entries are {role, text} maps. */
public interface ChatSessionStore {

    List<Map<String, String>> history(String sessionId);

    void append(String sessionId, String userText, String assistantText);
}
