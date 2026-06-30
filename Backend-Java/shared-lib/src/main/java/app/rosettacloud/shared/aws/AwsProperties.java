package app.rosettacloud.shared.aws;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** AWS client configuration. {@code dynamodb.endpoint-override} is used by LocalStack integration tests. */
@ConfigurationProperties(prefix = "rosettacloud.aws")
public class AwsProperties {

    private String region = "us-east-1";
    private Dynamodb dynamodb = new Dynamodb();

    public String getRegion() {
        return region;
    }

    public void setRegion(String region) {
        this.region = region;
    }

    public Dynamodb getDynamodb() {
        return dynamodb;
    }

    public void setDynamodb(Dynamodb dynamodb) {
        this.dynamodb = dynamodb;
    }

    public static class Dynamodb {
        private String endpointOverride;

        public String getEndpointOverride() {
            return endpointOverride;
        }

        public void setEndpointOverride(String endpointOverride) {
            this.endpointOverride = endpointOverride;
        }
    }
}
