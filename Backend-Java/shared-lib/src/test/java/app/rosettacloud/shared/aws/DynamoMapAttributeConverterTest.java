package app.rosettacloud.shared.aws;

import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class DynamoMapAttributeConverterTest {

    private final DynamoMapAttributeConverter converter = new DynamoMapAttributeConverter();

    @Test
    void roundTripsNestedStringBoolMapsAndLists() {
        Map<String, Object> input = Map.of(
                "country", "EG",
                "notifications", Map.of("email", true, "sms", false),
                "tags", List.of("docker", "k8s"));

        AttributeValue av = converter.transformFrom(input);
        assertThat(av.hasM()).isTrue();

        Map<String, Object> out = converter.transformTo(av);
        assertThat(out).isEqualTo(input);
    }

    @Test
    void progressLikeNestedBooleanMapRoundTrips() {
        Map<String, Object> progress = Map.of(
                "linux-docker-k8s-101", Map.of(
                        "intro-lesson-01", Map.of("1", true, "2", false, "3", true)));

        Map<String, Object> out = converter.transformTo(converter.transformFrom(progress));
        assertThat(out).isEqualTo(progress);
    }

    @Test
    void integralNumbersComeBackAsLong() {
        Map<String, Object> input = Map.of("count", 5L, "score", 100L);
        Map<String, Object> out = converter.transformTo(converter.transformFrom(input));
        assertThat(out.get("count")).isEqualTo(5L);
        assertThat(out.get("score")).isEqualTo(100L);
    }

    @Test
    void nullMapBecomesNulAttribute() {
        AttributeValue av = converter.transformFrom(null);
        assertThat(av.nul()).isTrue();
        assertThat(converter.transformTo(av)).isNull();
    }

    @Test
    void nativeWireFormatMatchesPythonRepresentation() {
        // A Map written by the Python plane uses native M/S/BOOL — assert our output is identical.
        AttributeValue produced = converter.transformFrom(Map.of("k", Map.of("done", true)));
        AttributeValue expected = AttributeValue.fromM(Map.of(
                "k", AttributeValue.fromM(Map.of("done", AttributeValue.fromBool(true)))));
        assertThat(produced).isEqualTo(expected);
    }
}
