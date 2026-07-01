# Pod / Container `securityContext` Hardening Plan — RosettaCloud Kubernetes Workloads

**Status:** Proposed
**Owner:** Platform / DevSecOps
**Scope:** `Backend-Java/*` microservices, runtime‑created lab pods (`Fabric8LabProvisioner`), the e2e k3s stack, and cluster‑level controls in `DevSecOps/K8S/**`.
**Trigger:** Trivy misconfiguration scan (`.github/workflows/security.yml`) reports **AVD‑KSV‑0118 “No Default Security Context” (HIGH)** — *“Relying on default security context may expose vulnerabilities to potential attacks that rely on privileged access.”* — on every workload manifest, plus the associated cluster of KSV checks (root user, writable root FS, un‑dropped capabilities, no seccomp, no CPU limit).

---

## 1. Executive Summary, Threat Model, Standards Alignment, Goals

### 1.1 Executive summary

Every RosettaCloud workload today runs with the Kubernetes **default security context**: containers run as **UID 0 (root)**, with a **writable root filesystem**, **all default Linux capabilities**, **no seccomp profile**, and **privilege escalation allowed**. The five Spring Boot services (`user`, `lab`, `question`, `chat`, `analytics`) inherit this from an `amazoncorretto:25` base image that declares **no `USER`**. The runtime‑created interactive‑lab pods are worse: `Fabric8LabProvisioner.createPod()` explicitly sets **`privileged: true` + `runAsUser: 0`** with **no resource limits**, **no NetworkPolicy**, and the **default ServiceAccount token auto‑mounted** — all in the **same `dev` namespace** as the platform services.

This plan brings the five services to **Pod Security Standards (PSS) `restricted`** compliance (plus `readOnlyRootFilesystem`, which exceeds `restricted` and satisfies NSA/CISA + CIS + Trivy KSV014), isolates the necessarily‑privileged lab pods into a **dedicated namespace with least privilege, quotas, and network isolation**, enforces **Pod Security Admission** and **default‑deny NetworkPolicies**, and wires a **Trivy misconfig regression gate** into CI so the fixes cannot silently regress.

### 1.2 Threat model (what we are defending against)

| # | Threat | Current exposure (grounded) | Control added |
|---|--------|------------------------------|---------------|
| T1 | **Container breakout → node compromise** | Services run as root with full caps + writable rootfs; a RCE in Spring/Jackson/AWS‑SDK gives root‑in‑container, a short hop to the node. | `runAsNonRoot`, drop `ALL` caps, `allowPrivilegeEscalation:false`, `seccompProfile: RuntimeDefault`, `readOnlyRootFilesystem`. |
| T2 | **Lab pod → cluster pivot** | Lab pod is `privileged:true` **and** auto‑mounts the `default` SA token; the image ships `kubectl`. In e2e the `default` SA is bound to `pods/exec`, `services`, `virtualservices` (`e2e-lab-manager`). | `automountServiceAccountToken:false` on lab pods; move labs to a dedicated namespace; default‑deny NetworkPolicy; scoped RBAC. |
| T3 | **Lab pod → node IAM credential theft** | A privileged lab pod on an EC2 node can reach IMDS `169.254.169.254` and assume the **node role**. | Egress NetworkPolicy blocking link‑local + RFC1918; IMDSv2 with `httpPutResponseHopLimit=1` on nodes. |
| T4 | **Noisy‑neighbour / DoS** | Lab pods have **no CPU/memory/ephemeral‑storage limits**; services have **memory limit only, no CPU/ephemeral limit**. One runaway lab (DinD + Kind) can starve the node. | `ResourceQuota` + `LimitRange` in labs ns; complete `requests`/`limits` on services and lab pods. |
| T5 | **Lateral movement between services** | Only one NetworkPolicy exists (`user-service-internal-allowlist`); everything else is open pod‑to‑pod within `dev`. | `default-deny` + per‑service allow‑lists aligned to the existing `/internal` pattern. |
| T6 | **Privilege escalation via SA token** | `user`/`chat`/`analytics` never call the K8s API yet auto‑mount a usable SA token. | `automountServiceAccountToken:false` on the three services that don’t need it. |
| T7 | **Supply‑chain / config drift** | Trivy misconfig runs **informationally** (`--exit-code 0`); nothing blocks a regression. Images pinned to `:latest` (KSV013). | Misconfig regression gate keyed to fixed KSV IDs; SHA image tags. |

**Assumptions / trust boundaries:** students receive an interactive shell **inside** the lab pod (code‑server) and can run arbitrary code and Docker/Kind — the lab pod is **untrusted by design**. The five services are trusted but internet‑adjacent through the Istio gateway and API Gateway (JWT). The node is a shared, multi‑tenant boundary we must protect from the lab pod.

### 1.3 Standards alignment

* **Pod Security Standards `restricted`** (the target for `dev`): `runAsNonRoot:true`, `allowPrivilegeEscalation:false`, `capabilities.drop:["ALL"]`, `seccompProfile.type: RuntimeDefault|Localhost`, no `privileged`, no host namespaces/paths/ports, restricted volume types. *Note:* PSS `restricted` does **not** require `readOnlyRootFilesystem` or a high UID — we add `readOnlyRootFilesystem` and complete resource limits as **defence‑in‑depth** beyond the standard.
* **NSA/CISA Kubernetes Hardening Guide:** non‑root, immutable root FS, drop capabilities, seccomp, network segmentation (default‑deny), resource limits, protect the control plane and node metadata (IMDS).
* **CIS Kubernetes Benchmark v1.x §5.2 (Pod Security) & §5.3 (Network Policies):** minimise root/privileged, drop caps, seccomp, restrict SA token automount, apply NetworkPolicies to all namespaces.
* **Trivy checks in scope:** AVD‑KSV‑0118 (HIGH, default securityContext), KSV001 (privilege escalation), KSV003/KSV106 (drop caps), KSV012 (runAsNonRoot), KSV014 (read‑only root FS), KSV017 (privileged — lab pods), KSV011/KSV015/KSV016/KSV018 (CPU/mem requests+limits), KSV030 (seccomp), KSV013 (`:latest`), KSV020/KSV021 (low UID/GID — informational).

### 1.4 Goals / Non‑goals

**Goals**
1. Zero **AVD‑KSV‑0118** (and the associated KSV cluster) on the five service manifests and the e2e stack.
2. All five services satisfy **PSS `restricted`**, enforced by Pod Security Admission on `dev`.
3. Lab pods run with **least privilege compatible with DinD/Kind**, isolated by namespace + NetworkPolicy + quota, with a **documented, bounded PSA exception**.
4. **Default‑deny** networking in `dev` and the labs namespace, extending the existing `/internal` allow‑list.
5. A **CI regression gate** (Trivy misconfig) that fails on the fixed KSV IDs; e2e proves the workloads run under the hardened context.

**Non‑goals**
* Rewriting the interactive‑labs image or replacing code‑server.
* Migrating off Istio or changing the strangler routing (`strangler-virtualservice.yaml`).
* Full mTLS/authorization‑policy redesign (Istio `AuthorizationPolicy` is a separate workstream; NetworkPolicy here is the L3/L4 floor).
* Hardening the legacy FastAPI `rosettacloud-backend` and the Angular `rosettacloud-frontend` beyond the **prerequisite** minimum needed to enable `restricted` on `dev` (tracked in §8 as adjacent scope).

---

## 2. Baseline — Current State per Manifest

### 2.1 Inventory (from the real files)

| Service | Manifest | Port | IRSA (SA role‑arn) | Calls K8s API? | Extra RBAC | Replicas / strategy | Probes |
|---------|----------|------|--------------------|----------------|-----------|---------------------|--------|
| user | `Backend-Java/user-service/k8s/user-service.yaml` | 8081 | `rosettacloud-user-service-irsa` | **No** | — | 2 / RollingUpdate | readiness **+ liveness** |
| lab | `Backend-Java/lab-service/k8s/lab-service.yaml` | 8082 | **none** | **Yes** (pods, pods/status, services, virtualservices CRUD) | `Role rosettacloud-lab-manager` | 1 / **Recreate** | readiness |
| question | `Backend-Java/question-service/k8s/question-service.yaml` | 8083 | `rosettacloud-question-service-irsa` | **Yes** (pods get/list, **pods/exec create**) | `Role rosettacloud-question-pod-exec` | 1 / RollingUpdate | readiness |
| chat | `Backend-Java/chat-service/k8s/chat-service.yaml` | 8084 | `rosettacloud-chat-service-irsa` | **No** | — | 2 / RollingUpdate | readiness |
| analytics | `Backend-Java/analytics-service/k8s/analytics-service.yaml` | 8085 | `rosettacloud-analytics-service-irsa` | **No** | — | 1 / RollingUpdate | readiness |

All five already have a **dedicated ServiceAccount** (`rosettacloud-<svc>-service`) — the “per‑service ServiceAccount” goal is *already satisfied*; the gap is **token automount** and **securityContext**.

### 2.2 Trivy findings present on **every** service Deployment

Absent `securityContext` (pod **and** container) fires the following on each of the five manifests and each container in `e2e/k8s/e2e-stack.yaml`:

* **AVD‑KSV‑0118** — No Default Security Context (**HIGH**) ← the headline finding.
* **KSV012** — runs as root (no `runAsNonRoot`).
* **KSV001** — `allowPrivilegeEscalation` not `false`.
* **KSV003 / KSV106** — default capabilities not dropped.
* **KSV014** — root filesystem not read‑only.
* **KSV030** — seccomp `RuntimeDefault` not set.
* **KSV011** — CPU not limited (manifests set a memory limit but **no CPU limit**).
* **KSV013** — image tag `:latest` (prod manifests) — MEDIUM.
* **KSV020 / KSV021** — low UID/GID (will remain if we use UID 1000; informational, out of the HIGH/CRITICAL gate — see §3.3).

> **Baseline capture (do this first, Phase 0):** snapshot the exact IDs your Trivy version emits so the gate is pinned to reality:
> ```bash
> trivy config --format json -o baseline-trivy.json \
>   Backend-Java/user-service/k8s Backend-Java/lab-service/k8s \
>   Backend-Java/question-service/k8s Backend-Java/chat-service/k8s \
>   Backend-Java/analytics-service/k8s Backend-Java/e2e/k8s DevSecOps/K8S
> jq -r '.Results[]?.Misconfigurations[]? | .ID' baseline-trivy.json | sort | uniq -c | sort -rn
> ```

### 2.3 What each workload actually needs (writable paths / ports / caps / API)

Grounded in each `src/main/resources/application.yml`:

* **All five services**: Spring Boot + embedded Tomcat, **console logging only** (no file appender configured), management endpoints `health,info,prometheus` on the **same** server port, `management.endpoint.health.probes.enabled: true`, virtual threads on. **Only writable path required: `/tmp`** — Tomcat work dir (`server.tomcat.basedir` defaults under `java.io.tmpdir`), JVM `hsperfdata`, and any multipart/temp. No service writes to `/app` at runtime (jar is read‑only). **Ports 8081–8085 are all > 1024** → **no `NET_BIND_SERVICE`** needed → `drop: ["ALL"]` is safe.
* **user / chat / analytics**: talk only to AWS (DynamoDB/Bedrock/SQS via **IRSA**), Redis (chat), and each other over HTTP. **No Kubernetes API access** → SA token not needed → `automountServiceAccountToken:false`. IRSA is unaffected (it uses a *separate* projected `sts.amazonaws.com` token injected by the EKS Pod Identity webhook, independent of the default SA token mount).
* **lab‑service**: uses the fabric8 client → **must keep the SA token mounted** (`automountServiceAccountToken:true`). Has **no IRSA** today.
* **question‑service**: `pods/exec` into lab pods via the API server → **must keep the SA token mounted**. Also uses IRSA (S3).
* **Lab pods** (see §5): code‑server + **Docker‑in‑Docker + Kind** → genuinely need elevated privileges for `dockerd`; do **not** apply `readOnlyRootFilesystem`/`runAsNonRoot` blindly.

---

## 3. Container Hardening — Dockerfiles + `securityContext`

### 3.1 Dockerfile: add a non‑root user (UID/GID 1000)

All five Dockerfiles are identical except the module name and `EXPOSE`. Apply the same change to
`Backend-Java/{user,lab,question,chat,analytics}-service/Dockerfile` (and mirror the runtime stage in `Backend-Java/e2e/Dockerfile.svc`).

**Before** (runtime stage, `user-service/Dockerfile`):
```dockerfile
FROM amazoncorretto:25
WORKDIR /app
COPY --from=build /workspace/user-service/target/*.jar app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "app.jar"]
```

**After:**
```dockerfile
FROM amazoncorretto:25
# --- hardening: run as non-root (uid/gid 1000) ---
# amazoncorretto:25 is Amazon Linux 2023-based and ships shadow-utils (useradd).
RUN groupadd --system --gid 1000 spring \
 && useradd  --system --uid 1000 --gid 1000 --home-dir /app --no-create-home --shell /sbin/nologin spring
WORKDIR /app
COPY --from=build /workspace/user-service/target/*.jar app.jar
# jar stays root-owned & read-only to the runtime user — nothing writes to /app.
USER 1000:1000
EXPOSE 8081
# -XX:+PerfDisableSharedMem avoids /tmp/hsperfdata churn; java.io.tmpdir stays /tmp (the emptyDir mount).
ENTRYPOINT ["java", "-XX:+PerfDisableSharedMem", "-Djava.io.tmpdir=/tmp", "-jar", "app.jar"]
```
*Fallback if `useradd` is unavailable in a future slim base:* drop the `RUN` line and use numeric `USER 1000:1000` — Kubernetes `runAsUser` does not require a `/etc/passwd` entry, and `-XX:+PerfDisableSharedMem` removes the only home/tmp dependency.

**Spring‑side tmp config (belt‑and‑suspenders, optional but recommended)** — add to each `application.yml` so behaviour is explicit even outside the container:
```yaml
server:
  tomcat:
    basedir: /tmp/tomcat        # embedded Tomcat work dir under the writable emptyDir
spring:
  servlet:
    multipart:
      location: /tmp            # multipart spill (chat "Snap & Ask" base64 stays in-memory, but explicit is safe)
```

### 3.2 Reusable `securityContext` (services) — the `restricted` profile

Pod‑level (goes under `spec.template.spec`):
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
  fsGroupChangePolicy: OnRootMismatch
  seccompProfile:
    type: RuntimeDefault
```

Container‑level (goes under each `containers[].securityContext`):
```yaml
securityContext:
  allowPrivilegeEscalation: false
  privileged: false
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  runAsUser: 1000
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault
```

Writable `/tmp` (required once `readOnlyRootFilesystem: true`) — `fsGroup: 1000` makes the `emptyDir` group‑writable for the non‑root user:
```yaml
# spec.template.spec.volumes:
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 256Mi
# containers[].volumeMounts:
volumeMounts:
  - name: tmp
    mountPath: /tmp
```

Complete the resource envelope (adds the missing **CPU limit** → clears KSV011, plus ephemeral‑storage):
```yaml
resources:
  requests:
    cpu: 100m
    memory: 384Mi
    ephemeral-storage: 128Mi
  limits:
    cpu: "1"
    memory: 512Mi
    ephemeral-storage: 512Mi
```

### 3.3 UID 1000 vs Trivy KSV020/KSV021

The task specifies **UID 1000**. PSS `restricted` only requires `runAsNonRoot:true` (any non‑zero UID) — **UID 1000 fully satisfies `restricted` and AVD‑KSV‑0118**. Trivy’s **KSV020/KSV021** (“UID/GID should be ≥ 10000”) are **LOW** severity and therefore **outside the existing HIGH/CRITICAL gate** in `security.yml`. Decision: **use 1000** per the task. If you later want to clear the LOW findings too, change the Dockerfile UID/GID and the manifest `runAsUser/runAsGroup/fsGroup` to `10001` — a one‑line change, no functional impact.

### 3.4 Worked example — `user-service.yaml` Deployment `spec.template`

**Before:**
```yaml
    spec:
      serviceAccountName: rosettacloud-user-service
      containers:
        - name: user-service
          image: 339712964409.dkr.ecr.us-east-1.amazonaws.com/rosettacloud-user-service:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 8081
          envFrom:
            - configMapRef: { name: user-service-config }
          readinessProbe: { httpGet: { path: /actuator/health/readiness, port: 8081 }, initialDelaySeconds: 10, periodSeconds: 5 }
          livenessProbe:  { httpGet: { path: /actuator/health/liveness,  port: 8081 }, initialDelaySeconds: 20, periodSeconds: 10 }
          resources:
            requests: { cpu: 100m, memory: 384Mi }
            limits:   { memory: 512Mi }
```

**After:**
```yaml
    spec:
      serviceAccountName: rosettacloud-user-service
      automountServiceAccountToken: false          # user-service never calls the K8s API; IRSA unaffected
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        fsGroupChangePolicy: OnRootMismatch
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: user-service
          image: 339712964409.dkr.ecr.us-east-1.amazonaws.com/rosettacloud-user-service:latest   # pin to :<sha> in CI (KSV013)
          imagePullPolicy: Always
          ports:
            - containerPort: 8081
          envFrom:
            - configMapRef: { name: user-service-config }
          readinessProbe: { httpGet: { path: /actuator/health/readiness, port: 8081 }, initialDelaySeconds: 10, periodSeconds: 5 }
          livenessProbe:  { httpGet: { path: /actuator/health/liveness,  port: 8081 }, initialDelaySeconds: 20, periodSeconds: 10 }
          securityContext:
            allowPrivilegeEscalation: false
            privileged: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 1000
            capabilities: { drop: ["ALL"] }
            seccompProfile: { type: RuntimeDefault }
          resources:
            requests: { cpu: 100m, memory: 384Mi, ephemeral-storage: 128Mi }
            limits:   { cpu: "1", memory: 512Mi, ephemeral-storage: 512Mi }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: tmp
          emptyDir: { sizeLimit: 256Mi }
```

Apply the **identical** block to `chat-service.yaml` (port 8084) and `analytics-service.yaml` (port 8085) — both also get `automountServiceAccountToken: false`.

### 3.5 lab‑service & question‑service — same profile, **keep the SA token**

Both are byte‑identical to §3.4 **except** they must retain API access:
```yaml
    spec:
      serviceAccountName: rosettacloud-lab-service        # or rosettacloud-question-service
      automountServiceAccountToken: true                  # REQUIRED: fabric8 / pods:exec use the SA token
      securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, seccompProfile: { type: RuntimeDefault } }
      # containers[].securityContext + tmp emptyDir + resources exactly as §3.2
```
Neither service reads/writes local files beyond `/tmp`, so `readOnlyRootFilesystem: true` is safe for both. (The fabric8 client reads the SA token from the projected volume at `/var/run/secrets/kubernetes.io/serviceaccount`, which is a read‑only mount and unaffected by a read‑only root FS.)

---

## 4. Pod‑level Hardening — Token Automount & ServiceAccounts

| Service | `automountServiceAccountToken` | Rationale |
|---------|-------------------------------|-----------|
| user | **false** | No K8s API use; AWS via IRSA projected token. |
| chat | **false** | No K8s API use; Bedrock/Redis/HTTP only. |
| analytics | **false** | No K8s API use; DynamoDB/SQS via IRSA. |
| lab | **true** | fabric8 CRUD on pods/services/virtualservices. |
| question | **true** | `pods/exec` into lab pods. |

* **Per‑service ServiceAccounts already exist** — no change needed beyond the automount flag above.
* Set the flag on the **Pod spec** (not the SA) so the intent is explicit per‑workload and visible in `kubectl get deploy -o yaml`.
* **e2e stack** currently uses the `default` SA bound to the broad `e2e-lab-manager` Role. This is acceptable for the ephemeral cluster, but for parity add `automountServiceAccountToken: false` to the `user`/`chat`/`analytics` e2e Deployments in `e2e/k8s/e2e-stack.yaml` (leave `lab`/`question` mounting the token). Do **not** remove the `e2e-lab-manager` binding — the probe’s lab launch + exec depend on it.

---

## 5. The Lab‑Pod Special Case (`Fabric8LabProvisioner`)

### 5.1 Current reality (grounded)

`Backend-Java/lab-service/src/main/java/app/rosettacloud/lab/service/Fabric8LabProvisioner.java#createPod()` builds a Pod in `props.getNamespace()` (= `LAB_K8S_NAMESPACE`, currently **`dev`**) with:
```java
.withNewSecurityContext().withPrivileged(true).withRunAsUser(0L).endSecurityContext()
```
and **no resources**, **no `automountServiceAccountToken`** (defaults to true → `default` SA token mounted), label `app=interactive-labs`, annotation `sidecar.istio.io/inject=false`, container port 80. The image (`DevSecOps/interactive-labs/Dockerfile`) is code‑server (`codercom/code-server:noble`) **+ `docker:28-dind` + Kind + kubectl + helm + AWS CLI + Caddy**; `start.sh` launches code‑server (as `coder`), Caddy, then `dockerd` and `kind create cluster`. **`dockerd` genuinely needs privileged** in the default runc runtime.

> **Trivy note:** the lab pod is created **at runtime from Java**, not from a YAML file, so `trivy config`/`fs --scanners misconfig` does **not** scan it (it would otherwise flag KSV017 “Privileged container”, CRITICAL). Its hardening is enforced by **runtime PSA + NetworkPolicy + code review**, not the file scanner.

### 5.2 Do **not** blindly apply `restricted`

`readOnlyRootFilesystem`, `runAsNonRoot`, and `drop:["ALL"]` **will break** code‑server (writes to `/home/coder`, `/data`) and DinD (`dockerd`, iptables, overlayfs). The lab pod is intentionally a `privileged`/`baseline`+ workload. The strategy is **isolate + bound**, not `restricted`.

### 5.3 Interim hardening (keep privileged DinD) — provisioner diff

Even while privileged, we can drastically cut blast radius. Edit `createPod()`:

```java
import io.fabric8.kubernetes.api.model.Quantity;   // add import

Pod pod = new PodBuilder()
    .withNewMetadata()
        .withName(LabNaming.podName(labId))
        .withNamespace(ns)                                  // ns now = "labs" (see §5.5)
        .addToLabels("app", "interactive-labs")
        .addToLabels("lab-id", labId)
        .addToAnnotations("sidecar.istio.io/inject", "false")
    .endMetadata()
    .withNewSpec()
        .withRestartPolicy("Always")
        .withAutomountServiceAccountToken(false)            // (T2) privileged pod must NOT hold an API token
        .withEnableServiceLinks(false)                      // don't leak service env vars into the untrusted pod
        .addNewContainer()
            .withName("lab")
            .withImage(props.getPodImage())
            .withImagePullPolicy("IfNotPresent")
            .addNewPort().withContainerPort(80).endPort()
            .withNewSecurityContext()
                .withPrivileged(true)                       // required by dockerd until sysbox/gVisor (§5.4)
                .withRunAsUser(0L)
                .withAllowPrivilegeEscalation(true)
            .endSecurityContext()
            .withNewResources()                             // (T4) bound CPU/mem/ephemeral
                .addToRequests("cpu", new Quantity("500m"))
                .addToRequests("memory", new Quantity("1Gi"))
                .addToLimits("cpu", new Quantity("2"))
                .addToLimits("memory", new Quantity("3Gi"))
                .addToLimits("ephemeral-storage", new Quantity("8Gi"))
            .endResources()
            .withNewReadinessProbe()
                .withNewHttpGet().withPath("/").withNewPort(80).endHttpGet()
                .withInitialDelaySeconds(3).withPeriodSeconds(3).withTimeoutSeconds(5).withFailureThreshold(40)
            .endReadinessProbe()
        .endContainer()
    .endSpec()
    .build();
```
Make the resource quantities configurable via `LabProperties` (`rosettacloud.lab.resources.*`) so they can be tuned without a rebuild.

### 5.4 Eliminating `privileged` (medium/long term) — options

| Option | How | DinD/Kind support | Tradeoff |
|--------|-----|-------------------|----------|
| **Sysbox** (recommended for DinD) | Install `sysbox` runtime on nodes; set `runtimeClassName: sysbox-runc`; drop `privileged`. | **Full** — designed to run Docker/Kind unprivileged. | Requires a node daemonset/AMI change; not on Fargate; extra memory per pod. |
| **gVisor (runsc)** | `RuntimeClass runsc`; strong syscall sandbox. | **Partial** — nested Docker/Kind is limited/unsupported. | Best for “run untrusted code” labs *without* DinD; some syscall/perf gaps. |
| **Rootless DinD** | `docker:dind-rootless`, user namespaces, `slirp4netns`/`fuse-overlayfs` (image already ships `fuse-overlayfs`). | **Most** — some Kind/networking quirks. | Still needs `/dev/fuse` + some caps; more brittle than sysbox. |
| **Keep privileged, isolate hard** (interim) | §5.3 + dedicated ns + NetworkPolicy + IMDS lockdown. | Full. | Privileged remains; mitigated by isolation. |

**Recommendation:** ship §5.3 + §5.5 now (isolation), then adopt **sysbox** to drop `privileged` and downgrade the labs namespace from PSA `privileged` → `baseline`. Provisioner change for sysbox:
```java
.withNewSpec()
    .withRuntimeClassName("sysbox-runc")
    // securityContext: drop withPrivileged(true); keep runAsUser(0) (sysbox remaps to non-root on the host)
```
For a **code‑server‑only** lab variant (no DinD), a least‑privilege context is achievable today:
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000            # 'coder'
  allowPrivilegeEscalation: false
  capabilities: { drop: ["ALL"] }
  seccompProfile: { type: RuntimeDefault }
  # readOnlyRootFilesystem NOT set — code-server writes /home/coder & /data
```

### 5.5 Namespace isolation, quota, limits, network — the labs namespace

**Why a separate namespace is mandatory:** PSS `privileged` is required for a privileged pod. You cannot enforce `restricted` (or even `baseline`) on `dev` while lab pods live there. Therefore lab pods **must** move to a dedicated namespace so `dev` can be `restricted`.

Create `DevSecOps/K8S/labs-namespace.yaml`:
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: labs
  labels:
    # DinD phase: privileged. After sysbox migration, change enforce -> baseline.
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/warn: baseline
    pod-security.kubernetes.io/audit: baseline
---
apiVersion: v1
kind: ResourceQuota
metadata: { name: labs-quota, namespace: labs }
spec:
  hard:
    pods: "50"
    requests.cpu: "25"
    requests.memory: 50Gi
    limits.cpu: "100"
    limits.memory: 150Gi
    requests.ephemeral-storage: 200Gi
---
apiVersion: v1
kind: LimitRange
metadata: { name: labs-defaults, namespace: labs }
spec:
  limits:
    - type: Container
      default:        { cpu: "2",   memory: 3Gi, ephemeral-storage: 8Gi }   # applied if provisioner omits
      defaultRequest: { cpu: 500m,  memory: 1Gi, ephemeral-storage: 2Gi }
      max:            { cpu: "4",   memory: 6Gi, ephemeral-storage: 16Gi }
---
# default-deny everything in labs
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: labs-default-deny, namespace: labs }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
# ingress: only the Istio ingress gateway may reach lab pods :80 (they have sidecar injection disabled)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: labs-allow-ingress-gateway, namespace: labs }
spec:
  podSelector: { matchLabels: { app: interactive-labs } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: istio-system } }
      ports: [{ protocol: TCP, port: 80 }]
---
# egress: DNS + internet (docker/apt), but BLOCK cluster RFC1918 and IMDS (T3)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: labs-egress-guardrail, namespace: labs }
spec:
  podSelector: { matchLabels: { app: interactive-labs } }
  policyTypes: [Egress]
  egress:
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
              - 169.254.169.254/32     # IMDS — steal node role creds
      ports: [{ protocol: TCP, port: 443 }, { protocol: TCP, port: 80 }]
```

**Node‑level IMDS lockdown (defence‑in‑depth, T3)** — NetworkPolicy egress to link‑local is not enforced by every CNI, so also require IMDSv2 with a 1‑hop limit on the EKS node launch template (Terraform, `DevSecOps/Terraform/modules/eks`):
```hcl
metadata_options {
  http_endpoint               = "enabled"
  http_tokens                 = "required"   # IMDSv2
  http_put_response_hop_limit = 1            # pods (2nd hop) cannot reach IMDS
}
```

**Provisioner + wiring changes to move labs → `labs`:**
1. Set `LAB_K8S_NAMESPACE: "labs"` in `lab-service-config` (and the e2e `lab-service` env) — `props.getNamespace()` then targets `labs`.
2. **RBAC:** move `rosettacloud-lab-manager` Role+Binding into the `labs` namespace (subject stays the `rosettacloud-lab-service` SA in `dev` — a RoleBinding in `labs` may reference a subject SA in `dev`). Add a Role+Binding in `labs` granting `rosettacloud-question-service` (in `dev`) `pods` get/list + `pods/exec` create (question‑service execs into lab pods that now live in `labs`).
3. **VirtualService gateway reference:** the VS is created in `labs` but the Istio `Gateway` lives elsewhere (`dev`/`istio-system`). Update `createVirtualService()` so `gateways` uses the **namespaced** form, e.g. `dev/rosettacloud-gateway`, via a new `LabProperties.istioGatewayRef`. The lab `Service` DNS becomes `<svc>.labs.svc.cluster.local` — already derived from `ns`, so `createService()` needs no change.
4. **e2e:** create the `labs` namespace (PSA `baseline` — the `lab-stub` is not privileged) in the e2e job before `kubectl apply`, and add the `labs`‑scoped RBAC. See §7.2.

---

## 6. Cluster Controls — Pod Security Admission + NetworkPolicies

### 6.1 Pod Security Admission

`dev` — enforce `restricted` (phased; start non‑blocking, then flip):
```yaml
# Phase A (observe): add to the dev Namespace
metadata:
  labels:
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/audit: restricted
# Phase B (enforce) once all dev workloads comply:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
```
`labs` — `privileged` (DinD) with `baseline` warn/audit for visibility (see §5.5). After sysbox: `enforce: baseline`.

* **EKS:** PSA is built into the API server (≥ v1.25) and driven **entirely by namespace labels** — no control‑plane access required, works on EKS Auto Mode.
* **k3s (e2e):** PSA is likewise built in; labels apply. To prove enforcement in CI, label `dev` `restricted` **after** deploying the hardened stack (§7.2).
* **Blocker:** the legacy `rosettacloud-backend` (FastAPI, root, `:80`) and `rosettacloud-frontend` (nginx, root, `:80`) in `dev` will be **rejected** by `enforce: restricted`. Options: (a) harden them (see §8 adjacent scope) before Phase B, or (b) move them to a `legacy` namespace kept at `baseline` until the strangler retires them. Until then keep `dev` at **warn/audit only**.

### 6.2 NetworkPolicies for `dev` (extend the existing `/internal` allow‑list)

The existing `user-service-internal-allowlist` (in `DevSecOps/K8S/strangler-virtualservice.yaml`) already restricts ingress to `user-service:8081` to the four sibling apps + `istio-system`. Generalise that pattern to a **default‑deny + explicit allow** model. Create `DevSecOps/K8S/networkpolicies-dev.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny-all, namespace: dev }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-dns-egress, namespace: dev }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
---
# Istio ingress gateway -> each service's port (public traffic path)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-istio-to-services, namespace: dev }
spec:
  podSelector:
    matchExpressions:
      - { key: app, operator: In, values: [
          rosettacloud-user-service, rosettacloud-lab-service, rosettacloud-question-service,
          rosettacloud-chat-service, rosettacloud-analytics-service ] }
  policyTypes: [Ingress]
  ingress:
    - from: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: istio-system } } }]
---
# user-service:8081 <- siblings (keeps the existing /internal allow-list; move it here)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: user-service-internal-allowlist, namespace: dev }
spec:
  podSelector: { matchLabels: { app: rosettacloud-user-service } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchExpressions:
              - { key: app, operator: In, values: [
                  rosettacloud-lab-service, rosettacloud-question-service,
                  rosettacloud-chat-service, rosettacloud-analytics-service ] }
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: istio-system } }
      ports: [{ protocol: TCP, port: 8081 }]
---
# chat-service -> Redis:6379 (egress on chat, ingress on redis)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: redis-allow-chat, namespace: dev }
spec:
  podSelector: { matchLabels: { app: redis } }      # prod Redis pod label
  policyTypes: [Ingress]
  ingress:
    - from: [{ podSelector: { matchLabels: { app: rosettacloud-chat-service } } }]
      ports: [{ protocol: TCP, port: 6379 }]
---
# Egress to AWS APIs + user-service + redis + API server for the app tier
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: services-egress, namespace: dev }
spec:
  podSelector:
    matchExpressions:
      - { key: app, operator: In, values: [
          rosettacloud-user-service, rosettacloud-lab-service, rosettacloud-question-service,
          rosettacloud-chat-service, rosettacloud-analytics-service ] }
  policyTypes: [Egress]
  egress:
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } } }]   # DNS
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
    - to: [{ podSelector: { matchLabels: { app: rosettacloud-user-service } } }]                    # inter-svc
      ports: [{ protocol: TCP, port: 8081 }]
    - to: [{ podSelector: { matchLabels: { app: redis } } }]
      ports: [{ protocol: TCP, port: 6379 }]
    - to: [{ ipBlock: { cidr: 0.0.0.0/0 } }]     # AWS DynamoDB/Bedrock/S3/SQS/STS + EKS API server (443)
      ports: [{ protocol: TCP, port: 443 }]
```
* **lab‑service / question‑service** reach the **EKS API server** on 443 — covered by the `0.0.0.0/0:443` egress above (tighten later to the API server endpoint / VPC‑endpoint CIDRs).
* **CNI enforcement caveat (critical):** NetworkPolicy is a **no‑op** unless a policy‑enforcing CNI is active. **k3s** enforces via its built‑in kube‑router controller (e2e is covered). **EKS with the Amazon VPC CNI** enforces only when the **network policy feature is enabled** (VPC CNI ≥ 1.14, `enableNetworkPolicy=true`) or Calico/Cilium is installed; **EKS Auto Mode** supports it. **Verify before relying on it** (§7.4) — otherwise the policies exist but do nothing.

---

## 7. Verification — CI/CD, Trivy Gate, Runtime Assertions

### 7.1 Local pre‑merge checks
```bash
# 1) manifests parse & schema-valid
kubeconform -strict Backend-Java/*/k8s/*.yaml Backend-Java/e2e/k8s/*.yaml DevSecOps/K8S/*.yaml
# 2) misconfig delta (should show 0 of the targeted KSV IDs on service manifests)
trivy config --severity HIGH,CRITICAL Backend-Java/*/k8s DevSecOps/K8S Backend-Java/e2e/k8s
# 3) images run non-root
docker run --rm --entrypoint id 339712964409.dkr.ecr.us-east-1.amazonaws.com/rosettacloud-user-service:latest   # uid=1000
```

### 7.2 Extend `backend-java-deploy.yml` (deploy_k3s) and `e2e-k3s.yml`

Run the existing smoke/probe **under the hardened context** to prove nothing broke:
1. Before `kubectl apply -f .../e2e-stack.yaml`, create the `labs` namespace (`baseline`) and its RBAC; set `LAB_K8S_NAMESPACE=labs` for the e2e `lab-service`.
2. Deploy the (now hardened) `e2e-stack.yaml`, wait for rollouts (readiness proves `readOnlyRootFilesystem` + `/tmp` emptyDir work).
3. **After** rollout, label `dev` `restricted` and run a **negative PSA test**:
```yaml
- name: PSA restricted is enforced on dev
  run: |
    kubectl label ns dev pod-security.kubernetes.io/enforce=restricted --overwrite
    # a root/privileged pod MUST be rejected:
    if kubectl -n dev run psa-probe --image=busybox --restart=Never --command -- sleep 1 2>/tmp/psa.err; then
      echo "FAIL: restricted did not block a default (root) pod"; kubectl -n dev delete pod psa-probe --ignore-not-found; exit 1
    fi
    grep -qi "violates PodSecurity" /tmp/psa.err && echo "OK: restricted enforced"
- name: assert hardened securityContext on services
  run: |
    for d in user-service chat-service analytics-service lab-service question-service; do
      ronly=$(kubectl -n dev get deploy $d -o jsonpath='{.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem}')
      nonroot=$(kubectl -n dev get deploy $d -o jsonpath='{.spec.template.spec.securityContext.runAsNonRoot}')
      [ "$ronly" = "true" ] && [ "$nonroot" = "true" ] || { echo "FAIL $d not hardened"; exit 1; }
    done
```
4. `scripts/e2e/test_e2e.py` is unchanged — its lab launch → poll running → `pods/exec` setup/check → terminate flow now runs against a lab pod in `labs`, proving the namespace move + RBAC + NetworkPolicy still allow the real behaviour.

### 7.3 Trivy misconfig **regression gate** (`.github/workflows/security.yml`)

Today misconfig runs with `--exit-code 0` (informational). Add a gate keyed to the **fixed KSV IDs** so they can’t regress:
```yaml
- name: Trivy misconfig regression gate (fails if a fixed KSV ID reappears on workload manifests)
  run: |
    set -euo pipefail
    trivy config --format json -o mc.json \
      Backend-Java/user-service/k8s Backend-Java/lab-service/k8s \
      Backend-Java/question-service/k8s Backend-Java/chat-service/k8s \
      Backend-Java/analytics-service/k8s Backend-Java/e2e/k8s
    # IDs we fixed for the SERVICE manifests (lab pods are runtime-created, not scanned here):
    FIXED='AVD-KSV-0118 AVD-KSV-0012 AVD-KSV-0001 AVD-KSV-0003 AVD-KSV-0014 AVD-KSV-0030 AVD-KSV-0011 AVD-KSV-0106'
    hits=$(jq -r '.Results[]?.Misconfigurations[]?.ID' mc.json | sort -u)
    fail=0
    for id in $FIXED; do
      if grep -qx "$id" <<<"$hits"; then echo "REGRESSION: $id present"; fail=1; fi
    done
    exit $fail
```
Keep the existing HIGH/CRITICAL informational report and the secret/CVE gates unchanged.

### 7.4 Optional cluster benchmarks (add as informational, then gate)
* **kube-bench** (CIS Kubernetes Benchmark) on nodes — assert §5.2/§5.3 controls.
* **kubescape** `framework nsa,cis,mitre` + `--controls-config` for PSS — machine‑readable pass/fail; run in `security.yml` (`continue-on-error: true` first, then gate on the securityContext controls).
* **NetworkPolicy enforcement probe** (EKS): from a throwaway pod, `curl` a blocked destination and assert it times out — proves the CNI actually enforces (guards the §6.2 caveat).

---

## 8. Rollout, Risk Register, Rollback, Acceptance, Effort

### 8.1 Rollout order (each phase independently deployable & reversible)

| Phase | Change | Verify |
|-------|--------|--------|
| **0** | Baseline capture (`baseline-trivy.json`, ID inventory) | IDs enumerated |
| **1** | Dockerfiles → non‑root UID 1000 (+ `Dockerfile.svc`); build/push `:<sha>` | image `id`=1000; e2e green (still writable rootfs) |
| **2** | Service manifests → securityContext + `/tmp` emptyDir + resources + automount flags | rollouts ready; §7.2 assertions; Trivy 0 KSV0118 |
| **3** | Create `labs` ns (quota/limitrange/NetPol/PSA); move lab pods; provisioner diff (§5.3); RBAC + VS gateway ref | e2e lab launch/exec/terminate green |
| **4** | `dev` NetworkPolicies (default‑deny + allow‑lists); confirm CNI enforcement | e2e green; NetPol probe |
| **5** | PSA `dev`: warn/audit=restricted → harden/relocate be+fe → **enforce=restricted** | PSA negative test; legacy pods running |
| **6** | Trivy misconfig gate + PSA test + kubescape/kube‑bench in CI | gate fails on injected regression |
| **7** (opt) | sysbox → drop `privileged`; labs ns → `baseline` | DinD/Kind still work under sysbox |

### 8.2 Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `readOnlyRootFilesystem` breaks an unknown write path | Med | Med | `/tmp` emptyDir covers Tomcat/JVM; roll Phase 2 one service at a time; `kubectl logs` on CrashLoop; revert manifest. |
| `automountServiceAccountToken:false` breaks IRSA | Low | High | IRSA uses a separate projected token — unaffected; e2e user/analytics DynamoDB calls prove it. |
| NetworkPolicy not enforced on EKS (VPC CNI) | Med | High | Verify feature flag / Calico/Cilium (§7.4) before trusting; policies are safe no‑ops until then. |
| Egress default‑deny blocks AWS/API‑server/DNS | Med | High | `services-egress` opens DNS+443+inter‑svc; validate each service’s health after apply; revert `default-deny` first if broken. |
| PSA `restricted` rejects legacy be/fe | High | Med | Phase 5 starts warn/audit only; relocate to `legacy` ns or harden before enforce. |
| Lab namespace move breaks VS routing / exec RBAC | Med | High | Namespaced gateway ref + `labs` RBAC for lab & question SAs; e2e exercises the full path. |
| lab‑service is single‑replica `Recreate` | Low | Low | Brief restart‑time gap is pre‑existing; deploy in a maintenance window. |
| sysbox not available on node type / Fargate | Med | Med | Keep privileged+isolation (Phase 3) as the supported fallback; sysbox is opt‑in Phase 7. |

### 8.3 Rollback
* Phases are **additive files** or **manifest field additions** → `git revert` the phase commit and `kubectl apply` the prior manifest.
* PSA: remove the `enforce` label (`kubectl label ns dev pod-security.kubernetes.io/enforce-`) → instantly non‑blocking.
* NetworkPolicy: delete `default-deny-all` → all traffic restored immediately.
* Labs ns move: revert `LAB_K8S_NAMESPACE` to `dev` and the provisioner/RBAC commit.

### 8.4 Acceptance criteria
1. `trivy config --severity HIGH,CRITICAL` on the five service manifests + `e2e-stack.yaml` reports **0 AVD‑KSV‑0118** and 0 of the §7.3 fixed IDs.
2. `kubectl get ns dev -o jsonpath='{.metadata.labels}'` shows `enforce=restricted`; the PSA negative test rejects a root pod.
3. All five services: `runAsNonRoot=true`, `readOnlyRootFilesystem=true`, `capabilities.drop=[ALL]`, `seccompProfile=RuntimeDefault`, complete `requests`/`limits`; pods Ready.
4. `scripts/e2e/test_e2e.py` passes (5 services + lab launch/exec/terminate) under the hardened context, lab pods in `labs`.
5. `default-deny-all` active in `dev` **and** `labs`; siblings still reachable; a lab pod **cannot** reach `169.254.169.254` or cluster RFC1918.
6. CI misconfig gate **fails** on an injected regression (drop a container `securityContext` → red).

### 8.5 Effort estimate

| Phase | Effort |
|-------|--------|
| 0 Baseline | 0.5 d |
| 1 Dockerfiles ×5 + Dockerfile.svc | 0.5 d |
| 2 Service manifests ×5 + verify | 1.5 d |
| 3 Labs ns + provisioner + RBAC + VS ref | 2.5 d |
| 4 NetworkPolicies + CNI verification | 1.5 d |
| 5 PSA phased + legacy be/fe prerequisite | 2.0 d |
| 6 CI gates (Trivy/PSA/kubescape) | 1.0 d |
| 7 sysbox (optional) | 2.0 d |
| **Total** | **~9.5 d core (+2 d optional)** |

**Adjacent scope (prerequisite for Phase 5 enforce):** harden `DevSecOps/K8S/fe-deployment.yaml` (switch to `nginxinc/nginx-unprivileged:alpine` on `:8080`, add restricted securityContext + resources) and `be-deployment.yaml` (run uvicorn as non‑root on `:8080`, add securityContext) **or** relocate both to a `legacy` namespace at `baseline` until the strangler removes them. ~1.5 d.

---

## 9. Appendix

### 9.1 Reusable `restricted` securityContext snippet (services)
```yaml
# spec.template.spec
automountServiceAccountToken: false        # true for lab-service & question-service
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
  fsGroupChangePolicy: OnRootMismatch
  seccompProfile: { type: RuntimeDefault }
# containers[]
    securityContext:
      allowPrivilegeEscalation: false
      privileged: false
      readOnlyRootFilesystem: true
      runAsNonRoot: true
      runAsUser: 1000
      capabilities: { drop: ["ALL"] }
      seccompProfile: { type: RuntimeDefault }
    resources:
      requests: { cpu: 100m, memory: 384Mi, ephemeral-storage: 128Mi }
      limits:   { cpu: "1",  memory: 512Mi, ephemeral-storage: 512Mi }
    volumeMounts: [{ name: tmp, mountPath: /tmp }]
# volumes
  volumes: [{ name: tmp, emptyDir: { sizeLimit: 256Mi } }]
```

### 9.2 PSA labels
```yaml
# dev (target)
pod-security.kubernetes.io/enforce: restricted
pod-security.kubernetes.io/enforce-version: latest
pod-security.kubernetes.io/warn: restricted
pod-security.kubernetes.io/audit: restricted
# labs (DinD phase)                     # after sysbox: enforce=baseline
pod-security.kubernetes.io/enforce: privileged
pod-security.kubernetes.io/warn: baseline
pod-security.kubernetes.io/audit: baseline
```

### 9.3 Sample per‑service NetworkPolicy (template)
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: <svc>-ingress, namespace: dev }
spec:
  podSelector: { matchLabels: { app: rosettacloud-<svc>-service } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: istio-system } }
        - podSelector: { matchExpressions: [{ key: app, operator: In, values: [<callers>] }] }
      ports: [{ protocol: TCP, port: <port> }]
```

### 9.4 References
* Pod Security Standards — https://kubernetes.io/docs/concepts/security/pod-security-standards/
* Pod Security Admission — https://kubernetes.io/docs/concepts/security/pod-security-admission/
* Configure a Security Context — https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
* NSA/CISA Kubernetes Hardening Guide — https://media.defense.gov/2022/Aug/29/2003066362/-1/-1/0/CTR_KUBERNETES_HARDENING_GUIDANCE_1.2_20220829.PDF
* CIS Kubernetes Benchmark — https://www.cisecurity.org/benchmark/kubernetes
* Trivy AVD‑KSV‑0118 “No Default Security Context” (HIGH) — https://avd.aquasec.com/misconfig/kubernetes/general/avd-ksv-0118/
* Trivy Kubernetes checks (KSV*) — https://avd.aquasec.com/misconfig/kubernetes/
* EKS IRSA & the projected token — https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html
* EKS VPC CNI Network Policy — https://docs.aws.amazon.com/eks/latest/userguide/cni-network-policy.html
* Sysbox (unprivileged DinD/Kind) — https://github.com/nestybox/sysbox
* gVisor RuntimeClass — https://gvisor.dev/docs/user_guide/quick_start/kubernetes/
* IMDSv2 / hop limit — https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html
```
