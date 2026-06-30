package app.rosettacloud.user.persistence;

import app.rosettacloud.shared.aws.DynamoMapAttributeConverter;
import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbAttribute;
import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbBean;
import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbConvertedBy;
import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbPartitionKey;
import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbSecondaryPartitionKey;

import java.util.List;
import java.util.Map;

/**
 * DynamoDB representation of a user in the shared {@code rosettacloud-users} table. Attribute names
 * are pinned to the exact snake_case used by the Python plane so the two can share the table during
 * the strangler cutover. {@code progress} and {@code metadata} are schemaless (native M maps).
 */
@DynamoDbBean
public class UserItem {

    private String userId;
    private String email;
    private String name;
    private String role;
    private Long createdAt;
    private Long updatedAt;
    private List<String> labs;
    private String activeLab;
    private Long labStartedAt;
    private Long labWeekStart;
    private Long labWeekMinutes;
    private Long aiWeekStart;
    private Long aiWeekMessages;
    private Map<String, Object> progress;
    private Map<String, Object> metadata;

    @DynamoDbPartitionKey
    @DynamoDbAttribute("user_id")
    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    @DynamoDbSecondaryPartitionKey(indexNames = "email-index")
    @DynamoDbAttribute("email")
    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    @DynamoDbAttribute("name")
    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    @DynamoDbAttribute("role")
    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }

    @DynamoDbAttribute("created_at")
    public Long getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Long createdAt) {
        this.createdAt = createdAt;
    }

    @DynamoDbAttribute("updated_at")
    public Long getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Long updatedAt) {
        this.updatedAt = updatedAt;
    }

    @DynamoDbAttribute("labs")
    public List<String> getLabs() {
        return labs;
    }

    public void setLabs(List<String> labs) {
        this.labs = labs;
    }

    @DynamoDbAttribute("active_lab")
    public String getActiveLab() {
        return activeLab;
    }

    public void setActiveLab(String activeLab) {
        this.activeLab = activeLab;
    }

    @DynamoDbAttribute("lab_started_at")
    public Long getLabStartedAt() {
        return labStartedAt;
    }

    public void setLabStartedAt(Long labStartedAt) {
        this.labStartedAt = labStartedAt;
    }

    @DynamoDbAttribute("lab_week_start")
    public Long getLabWeekStart() {
        return labWeekStart;
    }

    public void setLabWeekStart(Long labWeekStart) {
        this.labWeekStart = labWeekStart;
    }

    @DynamoDbAttribute("lab_week_minutes")
    public Long getLabWeekMinutes() {
        return labWeekMinutes;
    }

    public void setLabWeekMinutes(Long labWeekMinutes) {
        this.labWeekMinutes = labWeekMinutes;
    }

    @DynamoDbAttribute("ai_week_start")
    public Long getAiWeekStart() {
        return aiWeekStart;
    }

    public void setAiWeekStart(Long aiWeekStart) {
        this.aiWeekStart = aiWeekStart;
    }

    @DynamoDbAttribute("ai_week_messages")
    public Long getAiWeekMessages() {
        return aiWeekMessages;
    }

    public void setAiWeekMessages(Long aiWeekMessages) {
        this.aiWeekMessages = aiWeekMessages;
    }

    @DynamoDbConvertedBy(DynamoMapAttributeConverter.class)
    @DynamoDbAttribute("progress")
    public Map<String, Object> getProgress() {
        return progress;
    }

    public void setProgress(Map<String, Object> progress) {
        this.progress = progress;
    }

    @DynamoDbConvertedBy(DynamoMapAttributeConverter.class)
    @DynamoDbAttribute("metadata")
    public Map<String, Object> getMetadata() {
        return metadata;
    }

    public void setMetadata(Map<String, Object> metadata) {
        this.metadata = metadata;
    }
}
