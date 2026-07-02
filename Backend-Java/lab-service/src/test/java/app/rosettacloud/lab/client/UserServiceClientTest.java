package app.rosettacloud.lab.client;

import org.junit.jupiter.api.Test;

import java.net.ServerSocket;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Verifies the fail-open resilience contract of the lab -> user-service client when user-service is
 * unreachable. Points the client at a definitely-closed local port so every call fails fast with a
 * {@code ResourceAccessException} (exhausting the {@code HttpRetry} attempts) and asserts none of the
 * failures propagate to the caller.
 */
class UserServiceClientTest {

    /** A base URL for a port that is guaranteed closed → connection refused (fast, deterministic). */
    private static UserServiceClient clientPointingAtClosedPort() throws Exception {
        int freePort;
        try (ServerSocket probe = new ServerSocket(0)) {
            freePort = probe.getLocalPort();
        } // socket closed here → the port is now free/closed, so connects are refused immediately
        return new UserServiceClient("http://127.0.0.1:" + freePort);
    }

    @Test
    void setActiveLabIsFailOpenWhenUserServiceDown() throws Exception {
        UserServiceClient client = clientPointingAtClosedPort();
        // Regression fix: setActiveLab now swallows a user-service outage instead of propagating it,
        // so a transient blip on this post-provisioning bookkeeping call cannot fail a lab launch.
        assertThatCode(() -> client.setActiveLab("u1", "lab-1")).doesNotThrowAnyException();
    }

    @Test
    void allInterServiceCallsFailOpenWhenUserServiceDown() throws Exception {
        UserServiceClient client = clientPointingAtClosedPort();
        assertThat(client.remainingLabMinutes("u1")).isZero();
        assertThat(client.activeLab("u1")).isEqualTo(Optional.empty());
        assertThat(client.closeLabSession("u1")).isZero();
        assertThatCode(() -> client.setActiveLab("u1", "lab-1")).doesNotThrowAnyException();
        assertThatCode(() -> client.linkLab("u1", "lab-1")).doesNotThrowAnyException();
        assertThatCode(() -> client.unlinkLab("u1", "lab-1")).doesNotThrowAnyException();
    }
}
