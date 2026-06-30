package app.rosettacloud.lab.service;

import app.rosettacloud.lab.client.UserServiceClient;
import app.rosettacloud.lab.config.LabProperties;
import app.rosettacloud.lab.domain.LabInfo;
import app.rosettacloud.shared.error.ConflictException;
import app.rosettacloud.shared.error.QuotaExceededException;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LabServiceTest {

    private final LabRegistry registry = new LabRegistry();
    private final LabProvisioner provisioner = mock(LabProvisioner.class);
    private final UserServiceClient userClient = mock(UserServiceClient.class);
    private final LabProperties props = new LabProperties();
    private final LabService service = new LabService(registry, provisioner, userClient, props);

    @Test
    void launchSucceedsWithinQuota() {
        when(userClient.activeLab("u1")).thenReturn(Optional.empty());
        when(userClient.remainingLabMinutes("u1")).thenReturn(90L);
        when(provisioner.createLab(anyString())).thenAnswer(inv -> "lab-" + inv.getArgument(0));

        String labId = service.launch("u1");

        assertThat(labId).startsWith("lab-");
        assertThat(registry.isTracked(labId)).isTrue();
        verify(userClient).setActiveLab("u1", labId);
        verify(userClient).linkLab("u1", labId);
    }

    @Test
    void launchRejectedWhenQuotaExhausted() {
        when(userClient.activeLab("u1")).thenReturn(Optional.empty());
        when(userClient.remainingLabMinutes("u1")).thenReturn(0L);
        assertThatThrownBy(() -> service.launch("u1"))
                .isInstanceOf(QuotaExceededException.class)
                .hasMessageContaining("quota exhausted");
    }

    @Test
    void launchRejectedWhenActiveLabExists() {
        when(userClient.activeLab("u1")).thenReturn(Optional.of("lab-existing"));
        assertThatThrownBy(() -> service.launch("u1")).isInstanceOf(ConflictException.class);
    }

    @Test
    void terminateClosesSessionAndUnlinks() {
        when(provisioner.deleteLab("lab-1")).thenReturn(true);
        boolean ok = service.terminate("lab-1", "u1");
        assertThat(ok).isTrue();
        verify(userClient).closeLabSession("u1");
        verify(userClient).unlinkLab("u1", "lab-1");
    }

    @Test
    void infoMapsRunningStatus() {
        when(provisioner.podStatus("lab-1"))
                .thenReturn(Optional.of(new LabProvisioner.PodView("running", true, "10.0.0.5")));
        LabInfo info = service.info("lab-1").orElseThrow();
        assertThat(info.status()).isEqualTo("running");
        assertThat(info.podIp()).isEqualTo("10.0.0.5");
        assertThat(info.url()).startsWith("https://lab-1.");
    }

    @Test
    void infoStartingWhenNotReady() {
        when(provisioner.podStatus("lab-2"))
                .thenReturn(Optional.of(new LabProvisioner.PodView("running", false, null)));
        assertThat(service.info("lab-2").orElseThrow().status()).isEqualTo("starting");
    }

    @Test
    void infoEmptyWhenPodGone() {
        when(provisioner.podStatus("lab-3")).thenReturn(Optional.empty());
        assertThat(service.info("lab-3")).isEmpty();
    }
}
