package app.rosettacloud.user.persistence;

import app.rosettacloud.user.service.UserService;
import app.rosettacloud.user.web.dto.CreateUserRequest;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeDefinition;
import software.amazon.awssdk.services.dynamodb.model.BillingMode;
import software.amazon.awssdk.services.dynamodb.model.GlobalSecondaryIndex;
import software.amazon.awssdk.services.dynamodb.model.KeySchemaElement;
import software.amazon.awssdk.services.dynamodb.model.KeyType;
import software.amazon.awssdk.services.dynamodb.model.Projection;
import software.amazon.awssdk.services.dynamodb.model.ProjectionType;
import software.amazon.awssdk.services.dynamodb.model.ScalarAttributeType;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test against LocalStack DynamoDB. Auto-skips when Docker is unavailable (e.g., this
 * dev sandbox) and runs in CI where Docker is present. Verifies the schemaless progress/metadata
 * round-trip and Python-compatible native-Map wire format.
 */
@Testcontainers
@EnabledIf("dockerAvailable")
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.NONE,
        properties = {
                "spring.autoconfigure.exclude=app.rosettacloud.shared.config.RosettaCloudSecurityAutoConfiguration",
                "rosettacloud.users.table-name=rosettacloud-users"
        })
class UserRepositoryIT {

    static final String TABLE = "rosettacloud-users";

    static boolean dockerAvailable() {
        try {
            return DockerClientFactory.instance().isDockerAvailable();
        } catch (Throwable t) {
            return false;
        }
    }

    static {
        // LocalStack ignores credentials, but the SDK's DefaultCredentialsProvider needs *some*.
        System.setProperty("aws.accessKeyId", "test");
        System.setProperty("aws.secretAccessKey", "test");
    }

    @Container
    static final LocalStackContainer LOCALSTACK = new LocalStackContainer(
            DockerImageName.parse("localstack/localstack:3"))
            .withServices(LocalStackContainer.Service.DYNAMODB);

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("rosettacloud.aws.region", LOCALSTACK::getRegion);
        registry.add("rosettacloud.aws.dynamodb.endpoint-override",
                () -> LOCALSTACK.getEndpoint().toString());
    }

    @Autowired
    DynamoDbClient dynamoDbClient;

    @Autowired
    UserService userService;

    @Autowired
    UserRepository repository;

    @BeforeAll
    static void createTable(@Autowired DynamoDbClient client) {
        client.createTable(b -> b.tableName(TABLE)
                .attributeDefinitions(
                        AttributeDefinition.builder().attributeName("user_id")
                                .attributeType(ScalarAttributeType.S).build(),
                        AttributeDefinition.builder().attributeName("email")
                                .attributeType(ScalarAttributeType.S).build())
                .keySchema(KeySchemaElement.builder().attributeName("user_id")
                        .keyType(KeyType.HASH).build())
                .globalSecondaryIndexes(GlobalSecondaryIndex.builder()
                        .indexName("email-index")
                        .keySchema(KeySchemaElement.builder().attributeName("email")
                                .keyType(KeyType.HASH).build())
                        .projection(Projection.builder().projectionType(ProjectionType.ALL).build())
                        .build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .build());
        client.waiter().waitUntilTableExists(b -> b.tableName(TABLE));
    }

    @Test
    void createAndFindRoundTrip() {
        var created = userService.create(new CreateUserRequest(
                "round@trip.com", "Round Trip", "pw12345678", "user",
                Map.of("country", "EG", "notifications", Map.of("email", true))));

        var found = repository.findById(created.getUserId()).orElseThrow();
        assertThat(found.getEmail()).isEqualTo("round@trip.com");
        assertThat(found.getRole()).isEqualTo("user");
        assertThat(found.getMetadata()).containsEntry("country", "EG");
        @SuppressWarnings("unchecked")
        Map<String, Object> notifications = (Map<String, Object>) found.getMetadata().get("notifications");
        assertThat(notifications).containsEntry("email", true);

        var byEmail = repository.findByEmail("round@trip.com").orElseThrow();
        assertThat(byEmail.getUserId()).isEqualTo(created.getUserId());
    }

    @Test
    void nestedProgressRoundTripsAsNativeMaps() {
        var u = userService.create(new CreateUserRequest(
                "prog@trip.com", "Prog", "pw12345678", "user", null));
        userService.trackProgress(u.getUserId(), "linux-docker-k8s-101", "intro-lesson-01", 1, true);
        userService.trackProgress(u.getUserId(), "linux-docker-k8s-101", "intro-lesson-01", 2, false);

        var reloaded = repository.findById(u.getUserId()).orElseThrow();
        @SuppressWarnings("unchecked")
        Map<String, Object> module = (Map<String, Object>) reloaded.getProgress().get("linux-docker-k8s-101");
        @SuppressWarnings("unchecked")
        Map<String, Object> lesson = (Map<String, Object>) module.get("intro-lesson-01");
        assertThat(lesson).containsEntry("1", true).containsEntry("2", false);
    }
}
