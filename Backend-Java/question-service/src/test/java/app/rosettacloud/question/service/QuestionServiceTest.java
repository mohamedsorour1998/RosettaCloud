package app.rosettacloud.question.service;

import app.rosettacloud.question.domain.QuestionData;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class QuestionServiceTest {

    private final S3QuestionStore store = mock(S3QuestionStore.class);
    private final PodExecutor executor = mock(PodExecutor.class);
    private final QuestionService service = new QuestionService(store, executor,
            new app.rosettacloud.shared.events.NoOpDomainEventPublisher());

    private static final String SHELL = """
            # Question Number: 1
            # Question Type: Check
            if [[ "$1" == "-q" ]]; then
              echo setup
              exit 0
            fi
            if [[ "$1" == "-c" ]]; then
              echo check
              exit 0
            fi
            """;

    @Test
    void getQuestionsDelegatesToStore() {
        var q = new QuestionData(1, "Q", "Check", "Easy", null, null);
        when(store.getQuestions("m", "l")).thenReturn(List.of(q));
        assertThat(service.getQuestions("m", "l")).containsExactly(q);
    }

    @Test
    void setupRunsExtractedQuestionBlock() {
        when(store.getShell("m", "l", 1)).thenReturn(Optional.of(SHELL));
        when(executor.runScript(eq("pod-1"), anyString())).thenReturn(true);
        assertThat(service.executeSetup("pod-1", "m", "l", 1)).isTrue();
    }

    @Test
    void checkReturnsFalseWhenShellMissing() {
        when(store.getShell("m", "l", 9)).thenReturn(Optional.empty());
        assertThat(service.executeCheck("u1", "pod-1", "m", "l", 9)).isFalse();
    }

    @Test
    void checkRunsExtractedCheckBlock() {
        when(store.getShell("m", "l", 1)).thenReturn(Optional.of(SHELL));
        when(executor.runScript(eq("pod-1"), anyString())).thenReturn(true);
        assertThat(service.executeCheck("u1", "pod-1", "m", "l", 1)).isTrue();
    }
}
