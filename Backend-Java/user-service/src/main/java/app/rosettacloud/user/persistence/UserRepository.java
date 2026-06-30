package app.rosettacloud.user.persistence;

import app.rosettacloud.shared.error.ConflictException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;
import software.amazon.awssdk.enhanced.dynamodb.DynamoDbEnhancedClient;
import software.amazon.awssdk.enhanced.dynamodb.DynamoDbIndex;
import software.amazon.awssdk.enhanced.dynamodb.DynamoDbTable;
import software.amazon.awssdk.enhanced.dynamodb.Expression;
import software.amazon.awssdk.enhanced.dynamodb.Key;
import software.amazon.awssdk.enhanced.dynamodb.TableSchema;
import software.amazon.awssdk.enhanced.dynamodb.model.PageIterable;
import software.amazon.awssdk.enhanced.dynamodb.model.PutItemEnhancedRequest;
import software.amazon.awssdk.enhanced.dynamodb.model.QueryConditional;
import software.amazon.awssdk.enhanced.dynamodb.model.ScanEnhancedRequest;
import software.amazon.awssdk.services.dynamodb.model.ConditionalCheckFailedException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Persistence for {@link UserItem} against the {@code rosettacloud-users} table + {@code email-index} GSI. */
@Repository
public class UserRepository {

    private final DynamoDbTable<UserItem> table;
    private final DynamoDbIndex<UserItem> emailIndex;

    public UserRepository(DynamoDbEnhancedClient enhancedClient,
                          @Value("${rosettacloud.users.table-name:rosettacloud-users}") String tableName) {
        this.table = enhancedClient.table(tableName, TableSchema.fromBean(UserItem.class));
        this.emailIndex = table.index("email-index");
    }

    public Optional<UserItem> findById(String userId) {
        return Optional.ofNullable(table.getItem(Key.builder().partitionValue(userId).build()));
    }

    public Optional<UserItem> findByEmail(String email) {
        QueryConditional q = QueryConditional.keyEqualTo(Key.builder().partitionValue(email).build());
        return emailIndex.query(r -> r.queryConditional(q).limit(1)).stream()
                .flatMap(page -> page.items().stream())
                .findFirst();
    }

    /** Conditional create; throws {@link ConflictException} if the user id already exists. */
    public void create(UserItem item) {
        try {
            table.putItem(PutItemEnhancedRequest.builder(UserItem.class)
                    .item(item)
                    .conditionExpression(Expression.builder()
                            .expression("attribute_not_exists(user_id)")
                            .build())
                    .build());
        } catch (ConditionalCheckFailedException e) {
            throw new ConflictException("User " + item.getUserId() + " already exists");
        }
    }

    /** Full replace (read-modify-write); null fields are omitted, which clears those attributes. */
    public void save(UserItem item) {
        table.putItem(item);
    }

    public void delete(String userId) {
        table.deleteItem(Key.builder().partitionValue(userId).build());
    }

    public List<UserItem> scan(int limit) {
        PageIterable<UserItem> pages = table.scan(ScanEnhancedRequest.builder().limit(limit).build());
        List<UserItem> out = new ArrayList<>();
        for (var page : pages) {
            out.addAll(page.items());
            if (out.size() >= limit) {
                break;
            }
        }
        return out.size() > limit ? out.subList(0, limit) : out;
    }
}
