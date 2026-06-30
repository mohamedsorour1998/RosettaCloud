package app.rosettacloud.chat.service;

import app.rosettacloud.shared.aws.AwsProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.ContentBlock;
import software.amazon.awssdk.services.bedrockruntime.model.ConversationRole;
import software.amazon.awssdk.services.bedrockruntime.model.ConverseRequest;
import software.amazon.awssdk.services.bedrockruntime.model.ConverseResponse;
import software.amazon.awssdk.services.bedrockruntime.model.InferenceConfiguration;
import software.amazon.awssdk.services.bedrockruntime.model.Message;
import software.amazon.awssdk.services.bedrockruntime.model.SystemContentBlock;

/**
 * Invokes Amazon Bedrock Nova Lite 2 directly via the Converse API. Used for local dev and the k3s
 * e2e (where the managed Python AgentCore runtime is not deployed) — exercises the REAL model.
 */
@Component
@ConditionalOnProperty(name = "rosettacloud.chat.invoker", havingValue = "bedrock-direct")
public class BedrockDirectInvoker implements AgentInvoker {

    private final BedrockRuntimeClient client;
    private final String modelId;

    public BedrockDirectInvoker(AwsProperties props,
                                @Value("${rosettacloud.chat.model-id:us.amazon.nova-2-lite-v1:0}") String modelId) {
        this.client = BedrockRuntimeClient.builder()
                .region(Region.of(props.getRegion()))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
        this.modelId = modelId;
    }

    @Override
    public Reply invoke(Invocation inv) {
        String agent = PromptLibrary.agentFor(inv.type());
        String message = (inv.message() == null || inv.message().isBlank())
                ? "Please help me with my current lab." : inv.message();

        ConverseRequest request = ConverseRequest.builder()
                .modelId(modelId)
                .system(SystemContentBlock.fromText(PromptLibrary.systemPrompt(agent)))
                .messages(Message.builder()
                        .role(ConversationRole.USER)
                        .content(ContentBlock.fromText(message))
                        .build())
                .inferenceConfig(InferenceConfiguration.builder()
                        .maxTokens(1024)
                        .temperature(0.3f)
                        .build())
                .build();

        ConverseResponse response = client.converse(request);
        String text = response.output().message().content().get(0).text();
        return new Reply(text, agent);
    }
}
