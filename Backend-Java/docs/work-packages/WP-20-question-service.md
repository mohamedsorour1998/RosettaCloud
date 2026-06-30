# WP-20 — question-service

> Sub-agent brief. Self-contained. Read this + `docs/MIGRATION-PLAN.md` §6,§7 + WP-10 (copy its patterns). No assumptions — web-search & cite if unsure.
> Depends on: WP-00 (shared-lib), WP-10 (pattern + user-service internal client contract).
> Verify: `cd Backend-Java && JAVA_HOME=~/tools/jdk25 ./mvnw -q -pl question-service -am verify`

## Objective
Port `questions_service.py` + `questions_backends.py` + question routes of `main.py`. Fetch shell-script
questions from S3, parse header metadata, cache (TTL), and run per-question `-q`(setup)/`-c`(check) blocks
inside the student's lab pod.

## Source references (read fully)
- `Backend/app/backends/questions_backends.py` — S3 fetch, regex header parsing, block extraction, in-pod exec, per-pod lock, TTL cache.
- `Backend/app/services/questions_service.py`, `Backend/app/main.py` (questions routes).
- `Backend/questions/linux-docker-k8s-101/intro-lesson-01/q*.sh` — example format.

## Key behaviour to preserve
- S3: bucket `rosettacloud-shared-interactive-labs` (env `S3_BUCKET_NAME`), prefix `{module}/{lesson}/`, list `.sh`.
- Parse headers (regex, case-insensitive): `# Question Number:`, `# Question:`, `# Question Type: MCQ|Check`,
  `# Question Difficulty: Easy|Medium|Hard`, `# - answer_N: text`, `# Correct answer: answer_N`. MCQ adds `answer_choices` + `correct_answer`.
- Block extraction: the `if [[ "$1" == "-q" ]] ... fi` / `-c` blocks (balance `if`/`fi`), prepend `#!/bin/bash`, append `exit $?`.
- Cache: in-memory TTL = 3600s (Caffeine recommended; or a simple Map with timestamps mirroring Python `_cache`).
- In-pod exec: **Fabric8** — upload script to `/tmp/{n}_{q|c}_script.sh` (`pods().inNamespace(ns).withName(pod).file(path).upload(tmp)`),
  then `exec("bash","-c","chmod +x ... && ...")` capturing exit code; **per-pod lock** (`ConcurrentHashMap<String,Lock>`),
  30s timeout. (Parity: Python used `kubectl cp`+`kubectl exec`; Fabric8 is the enterprise equivalent — no external kubectl.)
  Namespace from `LAB_K8S_NAMESPACE` (default `dev`).

## Files (mirror WP-10 layout)
- `persistence` — none (S3 + K8s only). `client/UserServiceClient` (`@HttpExchange`) for progress update on check success.
- `service/QuestionService` (get/setup/check), `service/ShellScriptParser` (pure, unit-testable), `service/S3QuestionStore` (TTL cache + S3), `service/PodExecutor` (Fabric8 exec).
- `web/QuestionController` + DTOs.
- `config/application.yml` (port 8083, S3_BUCKET_NAME, LAB_K8S_NAMESPACE), Dockerfile, k8s/ (+ RBAC: `pods/exec` create, `pods` get).

## Endpoints
- `GET /questions/{moduleUuid}/{lessonUuid}` → `{questions:[...], total_count}` (sorted by number). Optionally merge caller progress (via user-service client) like the frontend expects.
- `POST /questions/{m}/{l}/{n}/setup` body `{pod_name}` → `{status,message,completed}`; error→400.
- `POST /questions/{m}/{l}/{n}/check` body `{pod_name}` → on success+completed: call user-service `trackProgress(userId,m,l,n,true)` and (Phase 4) emit `question.correct` event; return `{status,message,completed}`.

## Tests
- `ShellScriptParserTest` (unit) — all q*.sh fixtures parse to expected metadata; block extraction balances if/fi.
- `S3QuestionStoreIT` — Testcontainers LocalStack S3: put q1.sh, fetch+parse, cache hit on 2nd call.
- `QuestionControllerTest` (`@WebMvcTest`) — auth, validation, response shape.
- PodExecutor: unit with a mocked Fabric8 client (verify upload+exec calls); full exec optional under k3s (Phase 2 shared harness).

## Acceptance
- Build GREEN; parser matches Python output for all fixtures; check-success path calls user-service progress update.
