package app.rosettacloud.question.service;

import app.rosettacloud.question.domain.QuestionData;
import app.rosettacloud.shared.events.DomainEventPublisher;
import org.springframework.stereotype.Service;

import java.util.List;

/** Orchestrates question retrieval and in-pod setup/check — replaces QuestionService/QuestionBackend. */
@Service
public class QuestionService {

    private final S3QuestionStore store;
    private final PodExecutor executor;
    private final DomainEventPublisher events;

    public QuestionService(S3QuestionStore store, PodExecutor executor, DomainEventPublisher events) {
        this.store = store;
        this.executor = executor;
        this.events = events;
    }

    public List<QuestionData> getQuestions(String moduleUuid, String lessonUuid) {
        return store.getQuestions(moduleUuid, lessonUuid);
    }

    public boolean executeSetup(String podName, String moduleUuid, String lessonUuid, int questionNumber) {
        String shell = store.getShell(moduleUuid, lessonUuid, questionNumber).orElse(null);
        if (shell == null) {
            return false;
        }
        String body = ShellScriptParser.extractQuestionScript(shell);
        if (body.isBlank()) {
            return false;
        }
        return executor.runScript(podName, body);
    }

    public boolean executeCheck(String userId, String podName, String moduleUuid, String lessonUuid, int questionNumber) {
        events.publish("question.attempted", userId);
        String shell = store.getShell(moduleUuid, lessonUuid, questionNumber).orElse(null);
        if (shell == null) {
            return false;
        }
        String body = ShellScriptParser.extractCheckScript(shell);
        if (body.isBlank()) {
            return false;
        }
        boolean ok = executor.runScript(podName, body);
        if (ok) {
            events.publish("question.correct", userId);
        }
        return ok;
    }
}
