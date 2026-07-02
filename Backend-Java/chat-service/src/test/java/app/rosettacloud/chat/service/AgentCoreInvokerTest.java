package app.rosettacloud.chat.service;

import app.rosettacloud.chat.service.AgentInvoker.Reply;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link AgentCoreInvoker#parseReply(byte[])} — the fail-open response guard
 * (AGENTCORE-RESILIENCE4J-RUNTIME-PLAN.md §A.2.4). No network / SDK client is required because the
 * parsing seam is isolated from the {@code invokeAgentRuntime} call.
 */
class AgentCoreInvokerTest {

    @Test
    void emptyBodyReturnsGracefulFallback() {
        Reply reply = AgentCoreInvoker.parseReply(new byte[0]);
        assertThat(reply).isEqualTo(AgentCoreInvoker.UNAVAILABLE);
        assertThat(reply.response()).contains("temporarily unavailable");
        assertThat(reply.agent()).isEqualTo("tutor");
    }

    @Test
    void nullBodyReturnsGracefulFallback() {
        assertThat(AgentCoreInvoker.parseReply(null)).isEqualTo(AgentCoreInvoker.UNAVAILABLE);
    }

    @Test
    void garbledNonJsonBodyReturnsGracefulFallback() {
        Reply reply = AgentCoreInvoker.parseReply("this is not json".getBytes(StandardCharsets.UTF_8));
        assertThat(reply).isEqualTo(AgentCoreInvoker.UNAVAILABLE);
    }

    @Test
    void validJsonIsParsedIntoResponseAndAgent() {
        byte[] body = "{\"response\":\"Docker is a container runtime.\",\"agent\":\"grader\"}"
                .getBytes(StandardCharsets.UTF_8);
        Reply reply = AgentCoreInvoker.parseReply(body);
        assertThat(reply.response()).isEqualTo("Docker is a container runtime.");
        assertThat(reply.agent()).isEqualTo("grader");
    }

    @Test
    void missingAgentDefaultsToTutor() {
        byte[] body = "{\"response\":\"hello\"}".getBytes(StandardCharsets.UTF_8);
        Reply reply = AgentCoreInvoker.parseReply(body);
        assertThat(reply.response()).isEqualTo("hello");
        assertThat(reply.agent()).isEqualTo("tutor");
    }

    @Test
    void missingResponseYieldsEmptyString() {
        byte[] body = "{\"agent\":\"planner\"}".getBytes(StandardCharsets.UTF_8);
        Reply reply = AgentCoreInvoker.parseReply(body);
        assertThat(reply.response()).isEmpty();
        assertThat(reply.agent()).isEqualTo("planner");
    }
}
