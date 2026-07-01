package app.rosettacloud.user.service;

import app.rosettacloud.shared.error.ConflictException;
import app.rosettacloud.shared.error.ResourceNotFoundException;
import app.rosettacloud.shared.events.NoOpDomainEventPublisher;
import app.rosettacloud.user.persistence.UserItem;
import app.rosettacloud.user.persistence.UserRepository;
import app.rosettacloud.user.web.dto.CreateUserRequest;
import app.rosettacloud.user.web.dto.UpdateUserRequest;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserServiceTest {

    private final UserRepository repo = mock(UserRepository.class);
    private final CognitoService cognito = mock(CognitoService.class);
    private final UserService svc = new UserService(repo, cognito, new NoOpDomainEventPublisher());

    private static UserItem user(String id) {
        UserItem u = new UserItem();
        u.setUserId(id);
        u.setEmail(id + "@rc.app");
        u.setName("N");
        u.setRole("user");
        return u;
    }

    @Test
    void createPersistsGeneratesIdAndBackfills() {
        when(repo.findByEmail("a@rc.app")).thenReturn(Optional.empty());
        UserItem u = svc.create(new CreateUserRequest("a@rc.app", "Alice", "secret123", null, Map.of("k", "v")));
        assertThat(u.getUserId()).hasSize(8);
        assertThat(u.getRole()).isEqualTo("user");
        assertThat(u.getCreatedAt()).isNotNull();
        verify(repo).create(any(UserItem.class));
        verify(cognito).backfillUserId("a@rc.app", u.getUserId());
    }

    @Test
    void createHonoursExplicitRole() {
        when(repo.findByEmail("t@rc.app")).thenReturn(Optional.empty());
        UserItem u = svc.create(new CreateUserRequest("t@rc.app", "Teacher", "secret123", "admin", null));
        assertThat(u.getRole()).isEqualTo("admin");
    }

    @Test
    void createRejectsDuplicateEmail() {
        when(repo.findByEmail("dup@rc.app")).thenReturn(Optional.of(user("x")));
        assertThatThrownBy(() -> svc.create(new CreateUserRequest("dup@rc.app", "D", "secret123", null, null)))
                .isInstanceOf(ConflictException.class);
        verify(repo, never()).create(any());
    }

    @Test
    void requireFallsBackToEmailLookup() {
        when(repo.findById("missing")).thenReturn(Optional.empty());
        when(repo.findByEmail("e@rc.app")).thenReturn(Optional.of(user("real")));
        assertThat(svc.require("missing", "e@rc.app").getUserId()).isEqualTo("real");
    }

    @Test
    void requireThrowsWhenNotFound() {
        when(repo.findById("nope")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> svc.require("nope", null)).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void updateMutatesOnlyProvidedFields() {
        when(repo.findById("u1")).thenReturn(Optional.of(user("u1")));
        UserItem u = svc.update("u1", new UpdateUserRequest(null, "NewName", null, "admin", null));
        assertThat(u.getName()).isEqualTo("NewName");
        assertThat(u.getRole()).isEqualTo("admin");
        assertThat(u.getEmail()).isEqualTo("u1@rc.app"); // unchanged
        assertThat(u.getUpdatedAt()).isNotNull();
        verify(repo).save(u);
    }

    @Test
    void linkThenUnlinkLab() {
        UserItem u = user("u1");
        when(repo.findById("u1")).thenReturn(Optional.of(u));
        svc.linkLab("u1", "lab-1");
        assertThat(u.getLabs()).containsExactly("lab-1");
        svc.linkLab("u1", "lab-1"); // idempotent — no duplicate, no extra save
        svc.unlinkLab("u1", "lab-1");
        assertThat(u.getLabs()).doesNotContain("lab-1");
        verify(repo, times(2)).save(u); // one link + one unlink
    }

    @Test
    void labsReturnsEmptyWhenNull() {
        when(repo.findById("u1")).thenReturn(Optional.of(user("u1")));
        assertThat(svc.labs("u1")).isEmpty();
    }

    @Test
    void trackProgressThenReadFiltered() {
        UserItem u = user("u1");
        when(repo.findById("u1")).thenReturn(Optional.of(u));
        svc.trackProgress("u1", "m1", "l1", 3, true);
        verify(repo).save(u);

        @SuppressWarnings("unchecked")
        Map<String, Object> byModule = (Map<String, Object>) svc.progress("u1", "m1", null);
        @SuppressWarnings("unchecked")
        Map<String, Object> lessons = (Map<String, Object>) byModule.get("m1");
        @SuppressWarnings("unchecked")
        Map<String, Object> qs = (Map<String, Object>) lessons.get("l1");
        assertThat(qs.get("3")).isEqualTo(true);

        // lesson-scoped read returns just that lesson's map
        @SuppressWarnings("unchecked")
        Map<String, Object> lessonScoped = (Map<String, Object>) svc.progress("u1", "m1", "l1");
        assertThat(lessonScoped.get("3")).isEqualTo(true);
    }

    @Test
    void listDelegatesToRepository() {
        when(repo.scan(10)).thenReturn(List.of(user("a"), user("b")));
        assertThat(svc.list(10)).hasSize(2);
    }

    @Test
    void deleteRequiresThenDeletes() {
        when(repo.findById("u1")).thenReturn(Optional.of(user("u1")));
        svc.delete("u1");
        verify(repo).delete("u1");
    }
}
