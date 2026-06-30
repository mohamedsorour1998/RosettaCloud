package app.rosettacloud.shared.events;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Event backbone config: {@code topic-arn} (publishers) and {@code queue-url} (analytics consumer). */
@ConfigurationProperties(prefix = "rosettacloud.events")
public class EventsProperties {

    private String topicArn = "";
    private String queueUrl = "";
    private String endpointOverride = "";

    public String getEndpointOverride() {
        return endpointOverride;
    }

    public void setEndpointOverride(String endpointOverride) {
        this.endpointOverride = endpointOverride;
    }

    public String getTopicArn() {
        return topicArn;
    }

    public void setTopicArn(String topicArn) {
        this.topicArn = topicArn;
    }

    public String getQueueUrl() {
        return queueUrl;
    }

    public void setQueueUrl(String queueUrl) {
        this.queueUrl = queueUrl;
    }
}
