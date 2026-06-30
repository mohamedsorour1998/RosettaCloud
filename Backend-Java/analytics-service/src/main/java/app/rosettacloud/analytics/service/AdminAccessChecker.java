package app.rosettacloud.analytics.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

import java.util.Map;

/**
 * DB-backed admin authorization. Cognito tokens don't carry the application role, so admin status is
 * resolved from the user's {@code role} attribute in DynamoDB. This closes the gap where the legacy
 * {@code /admin/metrics} endpoint had NO admin check (any authenticated user could call it).
 */
@Component
public class AdminAccessChecker {

    private static final Logger log = LoggerFactory.getLogger(AdminAccessChecker.class);

    private final DynamoDbClient ddb;
    private final String table;

    public AdminAccessChecker(DynamoDbClient ddb,
                              @Value("${rosettacloud.users.table-name:rosettacloud-users}") String table) {
        this.ddb = ddb;
        this.table = table;
    }

    public boolean isAdmin(String userId) {
        if (userId == null || userId.isBlank()) {
            return false;
        }
        try {
            Map<String, AttributeValue> item = ddb.getItem(b -> b.tableName(table)
                    .key(Map.of("user_id", AttributeValue.fromS(userId)))).item();
            AttributeValue role = item == null ? null : item.get("role");
            return role != null && "admin".equals(role.s());
        } catch (Exception e) {
            log.warn("Admin check failed for {}: {}", userId, e.getMessage());
            return false;
        }
    }
}
