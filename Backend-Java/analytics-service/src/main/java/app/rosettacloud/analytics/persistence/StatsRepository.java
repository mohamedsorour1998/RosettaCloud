package app.rosettacloud.analytics.persistence;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.AttributeValueUpdate;
import software.amazon.awssdk.services.dynamodb.model.GetItemResponse;

import java.util.LinkedHashMap;
import java.util.Map;

/** Global platform counters stored as the {@code STATS#global} item in the users table. */
@Repository
public class StatsRepository {

    private static final String PK = "STATS#global";
    private static final String[] FIELDS = {
            "lab_started", "lab_terminated", "question_attempted", "question_correct", "chat_message", "users_seen"
    };

    private final DynamoDbClient ddb;
    private final String table;

    public StatsRepository(DynamoDbClient ddb,
                           @Value("${rosettacloud.users.table-name:rosettacloud-users}") String table) {
        this.ddb = ddb;
        this.table = table;
    }

    public Map<String, Long> globalCounters() {
        Map<String, Long> out = new LinkedHashMap<>();
        try {
            GetItemResponse resp = ddb.getItem(b -> b.tableName(table)
                    .key(Map.of("user_id", AttributeValue.fromS(PK))));
            Map<String, AttributeValue> item = resp.item();
            for (String f : FIELDS) {
                AttributeValue v = item == null ? null : item.get(f);
                out.put(f, (v != null && v.n() != null) ? Long.parseLong(v.n()) : 0L);
            }
        } catch (Exception e) {
            for (String f : FIELDS) {
                out.putIfAbsent(f, 0L);
            }
        }
        return out;
    }

    /** Atomic ADD increment of a single counter (used by event consumers in WP-60). */
    public void increment(String field) {
        ddb.updateItem(b -> b.tableName(table)
                .key(Map.of("user_id", AttributeValue.fromS(PK)))
                .attributeUpdates(Map.of(field, AttributeValueUpdate.builder()
                        .value(AttributeValue.fromN("1"))
                        .action(software.amazon.awssdk.services.dynamodb.model.AttributeAction.ADD)
                        .build())));
    }
}
