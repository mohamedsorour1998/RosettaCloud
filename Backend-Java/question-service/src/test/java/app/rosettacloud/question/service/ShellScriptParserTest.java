package app.rosettacloud.question.service;

import app.rosettacloud.question.domain.QuestionData;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ShellScriptParserTest {

    private static final String CHECK_Q = """
            #!/bin/bash
            # Question Number: 1
            # Question: Create a directory at /home/ubuntu named my_new_directory.
            # Question Type: Check
            # Question Difficulty: Medium
            if [[ "$1" == "-q" ]]; then
                echo "No setup required for this Check."
              exit 0
            fi
            if [[ "$1" == "-c" ]]; then
              if [ -d "/home/ubuntu/my_new_directory" ]; then
                echo "Directory exists"
                exit 0
              else
                echo "Directory does not exist."
                exit 1
              fi
            fi
            """;

    private static final String MCQ_Q = """
            #!/bin/bash
            # Question Number: 3
            # Question: Which command lists pods?
            # Question Type: MCQ
            # Question Difficulty: Easy
            # Possible answers:
            # - answer_1: docker ps
            # - answer_2: kubectl get pods
            # - answer_3: ls pods
            # - answer_4: kubectl pods
            # Correct answer: answer_2
            if [[ "$1" == "-q" ]]; then
              exit 0
            fi
            if [[ "$1" == "-c" ]]; then
              exit 0
            fi
            """;

    @Test
    void parsesCheckQuestionMetadata() {
        QuestionData q = ShellScriptParser.parse(CHECK_Q);
        assertThat(q.questionNumber()).isEqualTo(1);
        assertThat(q.questionType()).isEqualTo("Check");
        assertThat(q.questionDifficulty()).isEqualTo("Medium");
        assertThat(q.question()).contains("Create a directory");
        assertThat(q.answerChoices()).isNull();
        assertThat(q.correctAnswer()).isNull();
    }

    @Test
    void parsesMcqChoicesAndCorrectAnswer() {
        QuestionData q = ShellScriptParser.parse(MCQ_Q);
        assertThat(q.questionType()).isEqualTo("MCQ");
        assertThat(q.questionDifficulty()).isEqualTo("Easy");
        assertThat(q.answerChoices()).containsExactly("docker ps", "kubectl get pods", "ls pods", "kubectl pods");
        assertThat(q.correctAnswer()).isEqualTo("kubectl get pods");
    }

    @Test
    void extractsCheckBlockBalancingNestedIfFi() {
        String body = ShellScriptParser.extractCheckScript(CHECK_Q);
        assertThat(body).contains("if [ -d \"/home/ubuntu/my_new_directory\" ]; then");
        assertThat(body).contains("echo \"Directory does not exist.\"");
        // The opening `if [[ "$1" == "-c" ]]` line and the final closing fi are NOT part of the body.
        assertThat(body).doesNotContain("\"$1\" == \"-c\"");
    }

    @Test
    void extractsQuestionBlock() {
        String body = ShellScriptParser.extractQuestionScript(CHECK_Q);
        assertThat(body).contains("No setup required");
        assertThat(body).doesNotContain("\"$1\" == \"-q\"");
    }

    @Test
    void missingHeadersFallBackToDefaults() {
        QuestionData q = ShellScriptParser.parse("#!/bin/bash\necho hi\n");
        assertThat(q.questionNumber()).isEqualTo(999);
        assertThat(q.questionType()).isEqualTo("Check");
        assertThat(q.questionDifficulty()).isEqualTo("Medium");
        assertThat(q.question()).isEqualTo("Unknown Question");
    }
}
