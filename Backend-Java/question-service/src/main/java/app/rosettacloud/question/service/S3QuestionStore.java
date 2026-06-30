package app.rosettacloud.question.service;

import app.rosettacloud.question.domain.QuestionData;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.S3Object;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Fetches and parses question shell scripts from S3 ({@code <module>/<lesson>/q*.sh}) with an
 * in-memory TTL cache — replaces the S3 + {@code _cache} logic in questions_backends.py.
 */
@Component
public class S3QuestionStore {

    private record Cached<T>(long expiresAt, T value) {
    }

    private final S3Client s3;
    private final String bucket;
    private final long ttlMillis;

    private final Map<String, Cached<List<QuestionData>>> questionsCache = new ConcurrentHashMap<>();
    private final Map<String, Cached<Map<Integer, String>>> shellCache = new ConcurrentHashMap<>();

    public S3QuestionStore(S3Client s3,
                           @Value("${rosettacloud.questions.s3-bucket:rosettacloud-shared-interactive-labs}") String bucket,
                           @Value("${rosettacloud.questions.cache-ttl-seconds:3600}") long ttlSeconds) {
        this.s3 = s3;
        this.bucket = bucket;
        this.ttlMillis = ttlSeconds * 1000;
    }

    public List<QuestionData> getQuestions(String moduleUuid, String lessonUuid) {
        String key = moduleUuid + "/" + lessonUuid;
        Cached<List<QuestionData>> c = questionsCache.get(key);
        if (c != null && c.expiresAt() > System.currentTimeMillis()) {
            return c.value();
        }
        load(moduleUuid, lessonUuid);
        Cached<List<QuestionData>> reloaded = questionsCache.get(key);
        return reloaded == null ? List.of() : reloaded.value();
    }

    public Optional<String> getShell(String moduleUuid, String lessonUuid, int questionNumber) {
        String key = moduleUuid + "/" + lessonUuid;
        Cached<Map<Integer, String>> c = shellCache.get(key);
        if (c == null || c.expiresAt() <= System.currentTimeMillis()) {
            load(moduleUuid, lessonUuid);
            c = shellCache.get(key);
        }
        return c == null ? Optional.empty() : Optional.ofNullable(c.value().get(questionNumber));
    }

    private void load(String moduleUuid, String lessonUuid) {
        String prefix = moduleUuid + "/" + lessonUuid + "/";
        List<QuestionData> questions = new ArrayList<>();
        Map<Integer, String> byNumber = new LinkedHashMap<>();
        try {
            ListObjectsV2Request req = ListObjectsV2Request.builder().bucket(bucket).prefix(prefix).build();
            for (S3Object obj : s3.listObjectsV2(req).contents()) {
                if (!obj.key().endsWith(".sh")) {
                    continue;
                }
                String content = s3.getObjectAsBytes(b -> b.bucket(bucket).key(obj.key())).asUtf8String();
                QuestionData q = ShellScriptParser.parse(content);
                questions.add(q);
                byNumber.put(q.questionNumber(), content);
            }
        } catch (Exception e) {
            // Mirror Python: fetch failures yield an empty set rather than a hard error.
            questions = new ArrayList<>();
            byNumber = new LinkedHashMap<>();
        }
        questions.sort(Comparator.comparingInt(QuestionData::questionNumber));
        long expiry = System.currentTimeMillis() + ttlMillis;
        String key = moduleUuid + "/" + lessonUuid;
        questionsCache.put(key, new Cached<>(expiry, questions));
        shellCache.put(key, new Cached<>(expiry, byNumber));
    }
}
