package app.rosettacloud.chat.service;

import app.rosettacloud.shared.aws.AwsProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.core.sync.ResponseTransformer;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockagentcore.BedrockAgentCoreClient;
import software.amazon.awssdk.services.bedrockagentcore.model.InvokeAgentRuntimeRequest;
import software.amazon.awssdk.services.bedrockagentcore.model.InvokeAgentRuntimeResponse;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Invokes the managed Python AgentCore Runtime (Strands/Nova multi-agent) via IAM — the production
 * path, equivalent to the boto3 {@code invoke_agent_runtime} call in main.py.
 */
@Component
@ConditionalOnProperty(name = "rosettacloud.chat.invoker", havingValue = "agentcore", matchIfMissing = true)
public class AgentCoreInvoker implements AgentInvoker {

    private final BedrockAgentCoreClient client;
    private final String agentRuntimeArn;
    private final ObjectMapper mapper = new ObjectMapper();

    public AgentCoreInvoker(AwsProperties props,
                            @Value("${rosettacloud.chat.agent-runtime-arn:}") String agentRuntimeArn) {
        this.client = BedrockAgentCoreClient.builder()
                .region(Region.of(props.getRegion()))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
        this.agentRuntimeArn = agentRuntimeArn;
    }

    @Override
    public Reply invoke(Invocation inv) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("message", inv.message());
        payload.put("user_id", inv.userId());
        payload.put("session_id", inv.sessionId());
        payload.put("type", inv.type());
        payload.put("module_uuid", inv.moduleUuid());
        payload.put("lesson_uuid", inv.lessonUuid());
        payload.put("conversation_history", inv.history());
        if ("grade".equals(inv.type())) {
            payload.put("question_number", inv.questionNumber());
            payload.put("result", inv.result());
        }
        if (inv.imageBase64() != null && !inv.imageBase64().isBlank()) {
            payload.put("image", inv.imageBase64());
        }

        String json = mapper.writeValueAsString(payload);
        String sessionId = inv.sessionId() == null ? "" : inv.sessionId();
        String runtimeSessionId = sessionId.length() >= 33
                ? sessionId
                : sessionId + "-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);

        InvokeAgentRuntimeRequest request = InvokeAgentRuntimeRequest.builder()
                .agentRuntimeArn(agentRuntimeArn)
                .runtimeSessionId(runtimeSessionId)
                .qualifier("DEFAULT")
                .payload(SdkBytes.fromUtf8String(json))
                .build();

        ResponseBytes<InvokeAgentRuntimeResponse> bytes =
                client.invokeAgentRuntime(request, ResponseTransformer.toBytes());
        Map<?, ?> out = mapper.readValue(bytes.asByteArray(), Map.class);
        Object response = out.get("response");
        Object agent = out.get("agent");
        return new Reply(
                response == null ? "" : String.valueOf(response),
                agent == null ? "tutor" : String.valueOf(agent));
    }
}
