package app.rosettacloud.question.service;

import app.rosettacloud.question.domain.QuestionData;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses RosettaCloud question shell scripts — a faithful port of the regex logic in
 * {@code questions_backends.py} (header metadata + the {@code -q}/{@code -c} bash block extraction).
 */
public final class ShellScriptParser {

    private static final Pattern NUMBER =
            Pattern.compile("#\\s*Question\\s+Number:\\s*(\\d+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern TEXT =
            Pattern.compile("#\\s*Question:\\s*(.*?)(?:\\r?\\n|$)");
    private static final Pattern TYPE =
            Pattern.compile("#\\s*Question\\s+Type:\\s*(MCQ|Check)", Pattern.CASE_INSENSITIVE);
    private static final Pattern DIFFICULTY =
            Pattern.compile("#\\s*Question\\s+Difficulty:\\s*(Easy|Medium|Hard)", Pattern.CASE_INSENSITIVE);
    private static final Pattern ANSWER =
            Pattern.compile("#\\s*-\\s*answer_\\d+:\\s*(.*?)(?:\\r?\\n|$)");
    private static final Pattern CORRECT_ID =
            Pattern.compile("#\\s*Correct answer:\\s*(answer_\\d+)");

    private ShellScriptParser() {
    }

    public static QuestionData parse(String content) {
        int number = matchInt(NUMBER, content, 999);
        String text = matchString(TEXT, content, "Unknown Question");
        String type = matchString(TYPE, content, "Check");
        // Normalise type casing to MCQ / Check
        type = type.equalsIgnoreCase("MCQ") ? "MCQ" : "Check";
        String difficulty = capitalize(matchString(DIFFICULTY, content, "Medium"));

        List<String> choices = null;
        String correctAnswer = null;
        if ("MCQ".equals(type)) {
            choices = new ArrayList<>();
            Matcher m = ANSWER.matcher(content);
            while (m.find()) {
                choices.add(m.group(1).strip());
            }
            correctAnswer = resolveCorrectAnswer(content);
        }
        return new QuestionData(number, text, type, difficulty, choices, correctAnswer);
    }

    private static String resolveCorrectAnswer(String content) {
        Matcher idm = CORRECT_ID.matcher(content);
        if (!idm.find()) {
            return null;
        }
        String answerId = idm.group(1);
        Matcher textm = Pattern.compile("#\\s*-\\s*" + Pattern.quote(answerId) + ":\\s*(.*?)(?:\\r?\\n|$)")
                .matcher(content);
        return textm.find() ? textm.group(1).strip() : null;
    }

    /** Extracts the body of the {@code if [[ "$1" == "-q" ]] ... fi} block, balancing nested if/fi. */
    public static String extractQuestionScript(String content) {
        return extractBlock(content, "-q");
    }

    public static String extractCheckScript(String content) {
        return extractBlock(content, "-c");
    }

    private static String extractBlock(String content, String flag) {
        String marker = "\"$1\" == \"" + flag + "\"";
        boolean collecting = false;
        int depth = 0;
        List<String> body = new ArrayList<>();
        Pattern ifWord = Pattern.compile("\\bif\\b");
        Pattern fiStart = Pattern.compile("^\\s*fi\\b");

        for (String line : content.split("\\r?\\n", -1)) {
            if (!collecting) {
                if (line.contains(marker) && line.contains("if")) {
                    collecting = true;
                    depth = 1;
                }
                continue;
            }
            if (ifWord.matcher(line).find()) {
                depth++;
            }
            if (fiStart.matcher(line).find()) {
                depth--;
                if (depth == 0) {
                    break;
                }
                body.add(line);
                continue;
            }
            body.add(line);
        }
        return String.join("\n", body).strip();
    }

    private static int matchInt(Pattern p, String content, int dflt) {
        Matcher m = p.matcher(content);
        return m.find() ? Integer.parseInt(m.group(1)) : dflt;
    }

    private static String matchString(Pattern p, String content, String dflt) {
        Matcher m = p.matcher(content);
        return m.find() ? m.group(1).strip() : dflt;
    }

    private static String capitalize(String s) {
        if (s == null || s.isEmpty()) {
            return s;
        }
        return Character.toUpperCase(s.charAt(0)) + s.substring(1).toLowerCase();
    }
}
