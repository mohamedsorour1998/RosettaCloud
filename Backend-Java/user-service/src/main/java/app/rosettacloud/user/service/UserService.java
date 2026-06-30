package app.rosettacloud.user.service;

import app.rosettacloud.shared.error.ConflictException;
import app.rosettacloud.shared.error.ResourceNotFoundException;
import app.rosettacloud.user.persistence.UserItem;
import app.rosettacloud.user.persistence.UserRepository;
import app.rosettacloud.user.web.dto.CreateUserRequest;
import app.rosettacloud.user.web.dto.UpdateUserRequest;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** User CRUD, progress tracking, and lab linkage — replaces DynamoDBUserBackend in users_backends.py. */
@Service
public class UserService {

    private final UserRepository repository;
    private final CognitoService cognitoService;

    public UserService(UserRepository repository, CognitoService cognitoService) {
        this.repository = repository;
        this.cognitoService = cognitoService;
    }

    public UserItem create(CreateUserRequest req) {
        if (repository.findByEmail(req.email()).isPresent()) {
            throw new ConflictException("User with email " + req.email() + " already exists");
        }
        UserItem u = new UserItem();
        u.setUserId(UUID.randomUUID().toString().substring(0, 8));
        u.setEmail(req.email());
        u.setName(req.name());
        u.setRole(req.role() == null || req.role().isBlank() ? "user" : req.role());
        u.setCreatedAt(Instant.now().getEpochSecond());
        u.setMetadata(req.metadata());
        repository.create(u);
        cognitoService.backfillUserId(req.email(), u.getUserId());
        return u;
    }

    /** Fetch by id; fall back to email lookup for first-login tokens that only carry sub. */
    public UserItem require(String userId, String emailFallback) {
        Optional<UserItem> found = repository.findById(userId);
        if (found.isEmpty() && emailFallback != null && !emailFallback.isBlank()) {
            found = repository.findByEmail(emailFallback);
        }
        return found.orElseThrow(() -> new ResourceNotFoundException("User " + userId + " not found"));
    }

    public UserItem update(String userId, UpdateUserRequest req) {
        UserItem u = require(userId, null);
        if (req.email() != null) {
            u.setEmail(req.email());
        }
        if (req.name() != null) {
            u.setName(req.name());
        }
        if (req.role() != null) {
            u.setRole(req.role());
        }
        if (req.metadata() != null) {
            u.setMetadata(req.metadata());
        }
        u.setUpdatedAt(Instant.now().getEpochSecond());
        repository.save(u);
        return u;
    }

    public void delete(String userId) {
        require(userId, null);
        repository.delete(userId);
    }

    public List<UserItem> list(int limit) {
        return repository.scan(limit);
    }

    public List<String> labs(String userId) {
        UserItem u = require(userId, null);
        return u.getLabs() == null ? List.of() : u.getLabs();
    }

    public void linkLab(String userId, String labId) {
        UserItem u = require(userId, null);
        List<String> labs = u.getLabs() == null ? new ArrayList<>() : new ArrayList<>(u.getLabs());
        if (!labs.contains(labId)) {
            labs.add(labId);
            u.setLabs(labs);
            repository.save(u);
        }
    }

    public void unlinkLab(String userId, String labId) {
        UserItem u = require(userId, null);
        if (u.getLabs() != null && u.getLabs().contains(labId)) {
            List<String> labs = new ArrayList<>(u.getLabs());
            labs.remove(labId);
            u.setLabs(labs);
            repository.save(u);
        }
    }

    /** Mirrors users_backends.get_user_progress filtering semantics. */
    @SuppressWarnings("unchecked")
    public Object progress(String userId, String moduleUuid, String lessonUuid) {
        UserItem u = require(userId, null);
        Map<String, Object> progress = u.getProgress() == null ? Map.of() : u.getProgress();
        if (moduleUuid != null && !moduleUuid.isBlank()) {
            Map<String, Object> moduleProgress =
                    (Map<String, Object>) progress.getOrDefault(moduleUuid, Map.of());
            if (lessonUuid != null && !lessonUuid.isBlank()) {
                return moduleProgress.getOrDefault(lessonUuid, Map.of());
            }
            return Map.of(moduleUuid, moduleProgress);
        }
        return progress;
    }

    @SuppressWarnings("unchecked")
    public void trackProgress(String userId, String moduleUuid, String lessonUuid, int questionNumber,
                              boolean completed) {
        UserItem u = require(userId, null);
        Map<String, Object> progress = u.getProgress() == null
                ? new LinkedHashMap<>() : new LinkedHashMap<>(u.getProgress());
        Map<String, Object> moduleMap = new LinkedHashMap<>(
                (Map<String, Object>) progress.getOrDefault(moduleUuid, new LinkedHashMap<>()));
        Map<String, Object> lessonMap = new LinkedHashMap<>(
                (Map<String, Object>) moduleMap.getOrDefault(lessonUuid, new LinkedHashMap<>()));
        lessonMap.put(String.valueOf(questionNumber), completed);
        moduleMap.put(lessonUuid, lessonMap);
        progress.put(moduleUuid, moduleMap);
        u.setProgress(progress);
        repository.save(u);
    }
}
