# WP-30 — lab-service (hardest; Fabric8 + Istio + janitor)

> Sub-agent brief. Self-contained. Read this + `docs/MIGRATION-PLAN.md` §3.7,§6,§7 + WP-10 pattern. No assumptions — web-search & cite if unsure.
> Depends on: WP-00, WP-10 (user-service internal client). Verify: `JAVA_HOME=~/tools/jdk25 ./mvnw -q -pl lab-service -am verify`

## Objective
Port `labs_service.py` + `labs_backends.py` (EKSLabs) + lab routes of `main.py`. Manage one Kubernetes
Pod + Service + Istio VirtualService per lab, enforce weekly quota at launch, and auto-terminate via a janitor.

## Source references (read fully)
- `Backend/app/backends/labs_backends.py` (EKSLabs: `_create_lab_pod/_create_lab_svc/_create_lab_vs`, `launch`, `stop`, `get_lab_info`, `_janitor_loop`, `_time_left`, tracking dicts).
- `Backend/app/main.py` (POST/GET/DELETE /labs, quota gate, `_on_lab_auto_terminated`).
- `DevSecOps/K8S/backend-serviceaccount.yaml` (RBAC), `DevSecOps/interactive-labs/Dockerfile` (the lab image).

## Dependencies
- Fabric8 `io.fabric8:kubernetes-client` 7.8.0 (add `kubernetes-client-bom` import to PARENT pom dependencyManagement in this WP).
- shared-lib; user-service `@HttpExchange` client.

## Naming/config (parity)
- `svcName=<id>-svc`, `podName=lab-<id>`, `labHost=<id>.${LAB_WILDCARD_DOMAIN:labs.dev.rosettacloud.app}`, `lab_id = "lab-"+uuid8`.
- env: `LAB_K8S_NAMESPACE`(dev), `LAB_POD_IMAGE`, `LAB_ISTIO_GATEWAY`(rosettacloud-gateway), `POD_TTL_SECS`(3600), `LAB_CONCURRENT_TASKS_LIMIT`(5).

## Resource creation (Fabric8, in parallel)
- **Pod** `lab-<id>`: labels `{app:interactive-labs, lab-id:<id>}`, annotation `sidecar.istio.io/inject:"false"`,
  container `lab` image `${LAB_POD_IMAGE}` `imagePullPolicy=IfNotPresent`, port 80, `securityContext{privileged:true,runAsUser:0}`,
  readinessProbe httpGet `/`:80 (initialDelay 3, period 3, timeout 5, failureThreshold 40), restartPolicy Always. Ignore 409.
- **Service** `<id>-svc`: ClusterIP, selector `{lab-id:<id>}`, port 80→80. Ignore 409.
- **Istio VirtualService** via **GenericKubernetesResource** (`ResourceDefinitionContext` group `networking.istio.io`, version `v1`,
  kind `VirtualService`, plural `virtualservices`, namespaced): spec `{hosts:[labHost], gateways:[gateway], http:[{route:[{destination:{host:"<id>-svc.<ns>.svc.cluster.local", port:{number:80}}}]}]}`. Ignore 409.
- Run the 3 creates concurrently (structured concurrency / CompletableFuture); on any failure → `stop(id)` cleanup + throw.

## State & janitor
- Concurrent maps: `active(id→pod)`, `created(id→epoch)`, `owners(id→userId)`, `ttlOverride(id→secs)`.
- `@Scheduled(fixedDelay=60s)` janitor: for each created where `now-created > ttlOverride|POD_TTL_SECS` →
  snapshot owner, call user-service `closeLabSession(owner)` (auto-terminate bookkeeping), then `stop(id)`. Callback failure must NOT block cleanup.
- `getLabInfo`: if not tracked, probe K8s (recover after restart); map status (running+Ready→"running", running+!Ready→"starting", else phase); 404→evict+null; include `time_remaining` from `_time_left`.
- IMPORTANT: lab-service holds in-memory state → deploy **single replica** (parity). Note future: externalize to DynamoDB/Redis.

## Endpoints (parity with main.py)
- `POST /labs` — resolve userId (JWT); rate-limit (lab_create 5/hr — Phase 4 Redis; for now in-memory note);
  reject if user has active lab (user-service `getActiveLab`); `getLabQuota` → 403 `Weekly free-tier lab quota exhausted...` if remaining<=0;
  `ttlSecs=min(remaining*60, POD_TTL_SECS)`; launch; user-service `setActiveLab` + `linkLab`; return `{lab_id}`(201).
- `GET /labs/{id}?user_id=` — info or `{error:"lab not found"}` (+ if missing and user_id given, user-service `closeLabSession`).
- `DELETE /labs/{id}` — stop; user-service `closeLabSession` + `unlinkLab`; `{deleted:true}` or 404.

## Tests
- `EKSLabsTest` (unit, mocked Fabric8) — verifies Pod/Service/VS specs built correctly; janitor expiry logic; ttl clamp.
- Integration: **k3s Testcontainer** (`org.testcontainers:k3s`) — create Pod+Service for real; assert get/delete.
  Istio CRD not present in bare k3s → either `kubectl apply` the VirtualService CRD into the k3s container in test setup, or assert VS spec via a stubbed CRD; document choice.
- user-service calls mocked via WireMock.

## Packaging / RBAC
- Dockerfile + k8s: SA `rosettacloud-lab-service` (IRSA optional — K8s API uses in-cluster SA token, not IRSA);
  Role: `pods,pods/status,services` [create,get,list,watch,delete] + `networking.istio.io/virtualservices` [create,get,list,delete]; RoleBinding. Single-replica Deployment, ClusterIP 8082.

## Acceptance
- Build GREEN; unit + k3s integration pass; quota gate + janitor covered by tests.
