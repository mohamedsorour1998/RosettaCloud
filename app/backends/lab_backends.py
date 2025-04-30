"""
Interactive-lab back-end for EKS
--------------------------------
* single wildcard DNS record – no runtime Route 53 calls
* resources are created lazily and idempotently
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
import os
import uuid
from functools import wraps
from typing import Any, Dict, List, Optional

from kubernetes import client, config
from kubernetes.client.rest import ApiException

# ──────────────────────────────────────────────────────────────────
# Settings (env-overridable)
# ──────────────────────────────────────────────────────────────────
NAMESPACE             = os.getenv("LAB_K8S_NAMESPACE",            "interactive-labs")
POD_IMAGE             = os.getenv("LAB_POD_IMAGE",                "339712964409.dkr.ecr.me-central-1.amazonaws.com/interactive-labs:latest")
IMAGE_PULL_SECRET     = os.getenv("LAB_IMAGE_PULL_SECRET",        "ecr-creds")
WILDCARD_DOMAIN       = os.getenv("LAB_WILDCARD_DOMAIN",          "dev.labs.rosettacloud.app")
STATEFULSET_NAME      = os.getenv("LAB_STATEFULSET_NAME",         "interactive-labs")
HEADLESS_SERVICE_NAME = os.getenv("LAB_HEADLESS_SERVICE_NAME",    "interactive-labs-headless")
INGRESS_NAME          = os.getenv("LAB_INGRESS_NAME",             "interactive-labs-ingress")
INGRESS_CLASS         = os.getenv("LAB_INGRESS_CLASS",            "nginx")
POD_TTL_SECS          = int(os.getenv("LAB_POD_TTL_SECS",         "3600"))
CONCURRENCY           = int(os.getenv("LAB_CONCURRENT_TASKS_LIMIT","5"))
DEBUG                 = os.getenv("LAB_DEBUG", "").lower() in ("1", "true", "yes")

LOG = logging.getLogger("lab_service.eks")
if DEBUG:
    logging.basicConfig(level=logging.DEBUG)
    LOG.setLevel(logging.DEBUG)

# ──────────────────────────────────────────────────────────────────
# Helper decorators & small helpers
# ──────────────────────────────────────────────────────────────────
def retry_async(max_retries=3, delay=1, backoff=2, exceptions=(Exception,)):
    def deco(fn):
        @wraps(fn)
        async def wrap(*args, **kw):
            n, t = 0, delay
            while True:
                try:
                    return await fn(*args, **kw)
                except exceptions as e:
                    n += 1
                    if n >= max_retries:
                        LOG.error(f"Failed after {max_retries} retries: {str(e)}")
                        raise
                    LOG.warning(f"Retrying in {t}s after error: {str(e)}")
                    await asyncio.sleep(t)
                    t *= backoff
        return wrap
    return deco

def pod_name(i: int) -> str: return f"{STATEFULSET_NAME}-{i}"
def svc_name(l: str) -> str: return f"{l}-svc"
def lab_host(l: str) -> str: return f"{l}.{WILDCARD_DOMAIN}"

# ──────────────────────────────────────────────────────────────────
# Back-end class
# ──────────────────────────────────────────────────────────────────
class EKSLabs:
    def __init__(self) -> None:
        LOG.debug("Initializing EKSLabs backend")
        self._core: Optional[client.CoreV1Api] = None
        self._apps: Optional[client.AppsV1Api] = None
        self._net: Optional[client.NetworkingV1Api] = None
        self._sem = asyncio.Semaphore(CONCURRENCY)

        # Lab tracking
        self._active: Dict[str, int] = {}    # lab_id → replica index
        self._created: Dict[str, float] = {} # lab_id → epoch secs
        self._janitor: Optional[asyncio.Task] = None
        
        LOG.debug("EKSLabs backend initialized")

    # ──────────────────────────────────────────────────────────────
    # Kubernetes client plumbing
    # ──────────────────────────────────────────────────────────────
    async def _init_clients(self):
        """Initialize Kubernetes client objects"""
        LOG.debug("Initializing Kubernetes clients")
        try:
            config.load_incluster_config()
            LOG.info("Loaded in-cluster Kubernetes configuration")
        except Exception:
            config.load_kube_config()
            LOG.info("Loaded local Kubernetes configuration")
        
        self._core = client.CoreV1Api()
        self._apps = client.AppsV1Api()
        self._net = client.NetworkingV1Api()
        LOG.debug("Kubernetes clients initialized successfully")

    async def _get_clients(self):
        """Get or initialize Kubernetes client objects"""
        if self._core is None or self._apps is None or self._net is None:
            await self._init_clients()
        return self._core, self._apps, self._net

    @contextlib.asynccontextmanager
    async def _k8s(self):
        """Context manager to get Kubernetes clients with concurrency control"""
        async with self._sem:
            yield await self._get_clients()

    # ──────────────────────────────────────────────────────────────
    # Resource bootstrap (idempotent)
    # ──────────────────────────────────────────────────────────────
    @retry_async(exceptions=(ApiException,))
    async def _ensure_statefulset(self):
        """Ensure the StatefulSet exists, creating it if necessary"""
        LOG.info(f"Ensuring StatefulSet {STATEFULSET_NAME} exists")
        async with self._k8s() as (_, apps, _):
            try:
                await asyncio.to_thread(apps.read_namespaced_stateful_set, STATEFULSET_NAME, NAMESPACE)
                LOG.debug(f"StatefulSet {STATEFULSET_NAME} already exists")
                return
            except ApiException as e:
                if e.status != 404:
                    raise
                LOG.info(f"Creating StatefulSet {STATEFULSET_NAME}")
            
            body = client.V1StatefulSet(
                metadata=client.V1ObjectMeta(
                    name=STATEFULSET_NAME,
                    namespace=NAMESPACE,
                    labels={"app": "interactive-labs"},
                ),
                spec=client.V1StatefulSetSpec(
                    service_name=HEADLESS_SERVICE_NAME,
                    replicas=0,
                    selector=client.V1LabelSelector(match_labels={"app": "interactive-labs"}),
                    template=client.V1PodTemplateSpec(
                        metadata=client.V1ObjectMeta(labels={"app": "interactive-labs"}),
                        spec=client.V1PodSpec(
                            containers=[client.V1Container(
                                name="lab",
                                image=POD_IMAGE,
                                ports=[client.V1ContainerPort(container_port=80)],
                                readiness_probe=client.V1Probe(
                                    http_get=client.V1HTTPGetAction(
                                        path="/",
                                        port=80
                                    ),
                                    initial_delay_seconds=5,
                                    period_seconds=5,
                                    timeout_seconds=3,
                                    failure_threshold=3,
                                ),
                            )],
                            image_pull_secrets=[client.V1LocalObjectReference(name=IMAGE_PULL_SECRET)] if IMAGE_PULL_SECRET else None,
                        ),
                    ),
                ),
            )
            await asyncio.to_thread(apps.create_namespaced_stateful_set, NAMESPACE, body)
            LOG.info(f"Created StatefulSet {STATEFULSET_NAME}")

    @retry_async(exceptions=(ApiException,))
    async def _ensure_headless(self):
        """Ensure the headless service exists, creating it if necessary"""
        LOG.info(f"Ensuring headless service {HEADLESS_SERVICE_NAME} exists")
        async with self._k8s() as (core, *_):
            try:
                await asyncio.to_thread(core.read_namespaced_service, HEADLESS_SERVICE_NAME, NAMESPACE)
                LOG.debug(f"Headless service {HEADLESS_SERVICE_NAME} already exists")
                return
            except ApiException as e:
                if e.status != 404:
                    raise
                LOG.info(f"Creating headless service {HEADLESS_SERVICE_NAME}")
            
            body = client.V1Service(
                metadata=client.V1ObjectMeta(name=HEADLESS_SERVICE_NAME, namespace=NAMESPACE),
                spec=client.V1ServiceSpec(
                    selector={"app": "interactive-labs"},
                    cluster_ip="None",
                    publish_not_ready_addresses=True,
                    ports=[client.V1ServicePort(port=80, target_port=80)],
                ),
            )
            await asyncio.to_thread(core.create_namespaced_service, NAMESPACE, body)
            LOG.info(f"Created headless service {HEADLESS_SERVICE_NAME}")

    @retry_async(exceptions=(ApiException,))
    async def _ensure_ingress(self):
        """Ensure the ingress exists, creating it if necessary"""
        LOG.info(f"Ensuring ingress {INGRESS_NAME} exists")
        async with self._k8s() as (*_, net):
            try:
                await asyncio.to_thread(net.read_namespaced_ingress, INGRESS_NAME, NAMESPACE)
                LOG.debug(f"Ingress {INGRESS_NAME} already exists")
                return
            except ApiException as e:
                if e.status != 404:
                    raise
                LOG.info(f"Creating ingress {INGRESS_NAME}")
            
            body = client.V1Ingress(
                metadata=client.V1ObjectMeta(
                    name=INGRESS_NAME,
                    namespace=NAMESPACE,
                    annotations={
                        "kubernetes.io/ingress.class": INGRESS_CLASS,
                        "nginx.ingress.kubernetes.io/ssl-redirect": "true",
                    },
                ),
                spec=client.V1IngressSpec(
                    tls=[client.V1IngressTLS(
                        hosts=[f"*.{WILDCARD_DOMAIN}"],
                        secret_name=f"{INGRESS_NAME}-tls",
                    )],
                    rules=[], # We'll add rules as labs are created
                ),
            )
            await asyncio.to_thread(net.create_namespaced_ingress, NAMESPACE, body)
            LOG.info(f"Created ingress {INGRESS_NAME}")

    # ──────────────────────────────────────────────────────────────
    # Lifecycle
    # ──────────────────────────────────────────────────────────────
    async def init(self):
        """Initialize the backend"""
        LOG.info("Initializing EKS lab backend")
        await self._init_clients()
        try:
            await asyncio.gather(
                self._ensure_statefulset(),
                self._ensure_headless(),
                self._ensure_ingress(),
            )
            self._janitor = asyncio.create_task(self._janitor_loop())
            LOG.info("EKS lab backend initialized successfully")
        except Exception as e:
            LOG.error(f"Failed to initialize EKS lab backend: {e}")
            raise

    async def close(self):
        """Shutdown the backend"""
        LOG.info("Shutting down EKS lab backend")
        if self._janitor:
            self._janitor.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._janitor
        LOG.info("EKS lab backend shut down")

    # ──────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────
    @retry_async(exceptions=(ApiException, RuntimeError))
    async def _scale(self, replicas: int):
        """Scale the StatefulSet to the desired number of replicas"""
        LOG.info(f"Scaling StatefulSet to {replicas} replicas")
        if replicas < 0:
            replicas = 0
            
        async with self._k8s() as (_, apps, _):
            # First check current replicas
            sts = await asyncio.to_thread(apps.read_namespaced_stateful_set, STATEFULSET_NAME, NAMESPACE)
            current = sts.spec.replicas or 0
            
            if current == replicas:
                LOG.debug(f"StatefulSet already has {replicas} replicas, no scaling needed")
                return
                
            # Scale the StatefulSet
            patch_body = {"spec": {"replicas": replicas}}
            await asyncio.to_thread(
                apps.patch_namespaced_stateful_set,
                name=STATEFULSET_NAME,
                namespace=NAMESPACE,
                body=patch_body,
            )
            
            # Wait for pods to be ready if scaling up
            if replicas > current:
                LOG.debug(f"Waiting for StatefulSet to scale up to {replicas} replicas")
                deadline = dt.datetime.now(dt.timezone.utc).timestamp() + 60
                while dt.datetime.now(dt.timezone.utc).timestamp() < deadline:
                    sts = await asyncio.to_thread(apps.read_namespaced_stateful_set, STATEFULSET_NAME, NAMESPACE)
                    ready = sts.status.ready_replicas or 0
                    LOG.debug(f"StatefulSet has {ready}/{replicas} ready replicas")
                    if ready >= replicas:
                        LOG.info(f"StatefulSet successfully scaled to {replicas} replicas")
                        return
                    await asyncio.sleep(2)
                
                # If we get here, timeout occurred
                msg = f"Timed out waiting for StatefulSet to scale to {replicas} replicas"
                LOG.error(msg)
                raise RuntimeError(msg)
            else:
                LOG.info(f"StatefulSet scaling down to {replicas} replicas initiated")

    @retry_async(exceptions=(ApiException,))
    async def _create_lab_svc(self, lab_id: str, idx: int):
        """Create a Service for the lab"""
        LOG.info(f"Creating service for lab {lab_id} pointing to pod index {idx}")
        async with self._k8s() as (core, *_):
            body = client.V1Service(
                metadata=client.V1ObjectMeta(
                    name=svc_name(lab_id), 
                    namespace=NAMESPACE,
                    labels={"app": "interactive-labs", "lab-id": lab_id}
                ),
                spec=client.V1ServiceSpec(
                    selector={"statefulset.kubernetes.io/pod-name": pod_name(idx)},
                    ports=[client.V1ServicePort(port=80, target_port=80)],
                    type="ClusterIP",
                ),
            )
            try:
                await asyncio.to_thread(core.create_namespaced_service, NAMESPACE, body)
                LOG.info(f"Service for lab {lab_id} created successfully")
            except ApiException as e:
                if e.status != 409:  # Already exists
                    raise
                LOG.warning(f"Service for lab {lab_id} already exists")

    @retry_async(exceptions=(ApiException,))
    async def _delete_lab_svc(self, lab_id: str):
        """Delete the Service for a lab"""
        LOG.info(f"Deleting service for lab {lab_id}")
        async with self._k8s() as (core, *_):
            try:
                await asyncio.to_thread(core.delete_namespaced_service, svc_name(lab_id), NAMESPACE)
                LOG.info(f"Service for lab {lab_id} deleted successfully")
            except ApiException as e:
                if e.status != 404:  # Not found
                    raise
                LOG.warning(f"Service for lab {lab_id} not found, may have been already deleted")

    @retry_async(exceptions=(ApiException,))
    async def _patch_ingress(self, lab_id: str, add: bool):
        """Add or remove an ingress rule for a lab"""
        action = "Adding" if add else "Removing"
        LOG.info(f"{action} ingress rule for lab {lab_id}")
        
        async with self._k8s() as (*_, net):
            # Get current ingress
            ing = await asyncio.to_thread(net.read_namespaced_ingress, INGRESS_NAME, NAMESPACE)
            
            # Initialize rules list if None
            if ing.spec.rules is None:
                ing.spec.rules = []
                
            # Host for this lab
            host = lab_host(lab_id)
            
            # Remove existing rule for this host if any
            ing.spec.rules = [r for r in ing.spec.rules if r.host != host]
            
            # Add new rule if requested
            if add:
                ing.spec.rules.append(
                    client.V1IngressRule(
                        host=host,
                        http=client.V1HTTPIngressRuleValue(
                            paths=[client.V1HTTPIngressPath(
                                path="/",
                                path_type="Prefix",
                                backend=client.V1IngressBackend(
                                    service=client.V1IngressServiceBackend(
                                        name=svc_name(lab_id),
                                        port=client.V1ServiceBackendPort(number=80),
                                    )
                                ),
                            )]
                        ),
                    )
                )
                
            # Update ingress
            await asyncio.to_thread(net.patch_namespaced_ingress, INGRESS_NAME, NAMESPACE, ing)
            LOG.info(f"Ingress {action.lower()} for lab {lab_id} completed")

    async def _get_active_pods(self) -> List[int]:
        """Get indices of currently active pods"""
        indices = []
        try:
            async with self._k8s() as (core, *_):
                pods = await asyncio.to_thread(
                    core.list_namespaced_pod,
                    namespace=NAMESPACE,
                    label_selector="app=interactive-labs"
                )
                
                for pod in pods.items:
                    if pod.metadata.name.startswith(f"{STATEFULSET_NAME}-"):
                        try:
                            idx = int(pod.metadata.name.split('-')[-1])
                            indices.append(idx)
                        except (ValueError, IndexError):
                            pass
        except Exception as e:
            LOG.error(f"Error getting active pods: {e}")
            
        return indices

    async def _find_available_index(self) -> int:
        """Find the next available pod index"""
        # Get currently active indices
        active_indices = set(await self._get_active_pods())
        
        # Find lowest unused index
        idx = 0
        while idx in active_indices:
            idx += 1
            
        LOG.debug(f"Found available pod index: {idx}")
        return idx

    async def _time_left(self, lab_id: str) -> Optional[Dict[str, int]]:
        """Calculate time remaining for a lab"""
        ts = self._created.get(lab_id)
        if ts is None:
            return None
            
        now = dt.datetime.now(dt.timezone.utc).timestamp()
        left = max(0, POD_TTL_SECS - int(now - ts))
        
        return {
            "minutes": left // 60,
            "seconds": left % 60,
            "total_seconds": left
        }

    # ──────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────
    async def launch(self, *, tag: str | None = None) -> str:
        """Launch a new lab pod and return its ID"""
        LOG.info("Launching new lab pod")
        
        # Generate lab ID if not provided
        lab_id = tag or f"lab-{uuid.uuid4().hex[:8]}"
        LOG.debug(f"Using lab ID: {lab_id}")
        
        try:
            # Ensure required resources exist
            await self._ensure_statefulset()
            
            # Find available pod index
            idx = await self._find_available_index()
            LOG.debug(f"Using pod index {idx} for lab {lab_id}")
            
            # Scale up if needed
            max_index = max(self._active.values(), default=-1)
            if idx > max_index:
                await self._scale(idx + 1)
            
            # Create service and patch ingress
            await self._create_lab_svc(lab_id, idx)
            await self._patch_ingress(lab_id, add=True)
            
            # Register lab
            self._active[lab_id] = idx
            self._created[lab_id] = dt.datetime.now(dt.timezone.utc).timestamp()
            
            LOG.info(f"Lab {lab_id} launched successfully with pod index {idx}")
            return lab_id
            
        except Exception as e:
            LOG.error(f"Failed to launch lab: {e}")
            # Clean up any partial resources that may have been created
            with contextlib.suppress(Exception):
                await self.stop(lab_id)
            raise RuntimeError(f"Failed to launch lab: {str(e)}")

    async def stop(self, lab_id: str) -> bool:
        """Stop a lab pod"""
        LOG.info(f"Stopping lab: {lab_id}")
        
        # Check if lab exists
        idx = self._active.pop(lab_id, None)
        if idx is None:
            LOG.warning(f"Lab {lab_id} not found, cannot stop")
            return False
            
        # Remove from created list
        self._created.pop(lab_id, None)
        
        try:
            # Remove from ingress and delete service
            await self._patch_ingress(lab_id, add=False)
            await self._delete_lab_svc(lab_id)
            
            # Scale down if this was the highest indexed pod
            highest_idx = max(self._active.values(), default=-1)
            if idx > highest_idx:
                await self._scale(highest_idx + 1)
                
            LOG.info(f"Lab {lab_id} stopped successfully")
            return True
            
        except Exception as e:
            # Put back in active list if cleanup failed
            self._active[lab_id] = idx
            LOG.error(f"Error stopping lab {lab_id}: {e}")
            return False

    async def get_lab_info(self, lab_id: str) -> Optional[Dict[str, Any]]:
        """Get information about a lab"""
        LOG.debug(f"Getting info for lab: {lab_id}")
        
        # Check if lab exists
        idx = self._active.get(lab_id)
        if idx is None:
            LOG.debug(f"Lab {lab_id} not found")
            return None

        # Host information
        hostname = lab_host(lab_id)
        url = f"https://{hostname}"
        
        # Pod status
        pod_ip = None
        status = "unknown"
        try:
            async with self._k8s() as (core, *_):
                pod = await asyncio.to_thread(
                    core.read_namespaced_pod,
                    pod_name(idx),
                    NAMESPACE
                )
                status = (pod.status.phase or "unknown").lower()
                pod_ip = pod.status.pod_ip
                
                # Check if running but not ready
                if status == "running":
                    if not pod.status.conditions:
                        status = "starting"
                    else:
                        ready = False
                        for cond in pod.status.conditions:
                            if cond.type == "Ready" and cond.status == "True":
                                ready = True
                                break
                        if not ready:
                            status = "starting"
                
        except ApiException as e:
            LOG.error(f"Error getting pod status for lab {lab_id}: {e}")
            status = f"error-{e.status}"
        
        # Return info
        return {
            "lab_id": lab_id,
            "hostname": hostname,
            "url": url,
            "pod_ip": hostname,
            "status": status,
            "index": idx,
            "time_remaining": await self._time_left(lab_id),
            "domain": WILDCARD_DOMAIN
        }

    async def get_ip(self, lab_id: str) -> Optional[str]:
        """Get the hostname for a lab"""
        if lab_id not in self._active:
            return None
        return lab_host(lab_id)

    async def get_time_remaining(self, lab_id: str) -> Optional[Dict[str, int]]:
        """Get time remaining before automatic termination"""
        return await self._time_left(lab_id)

    # ──────────────────────────────────────────────────────────────
    # Background janitor
    # ──────────────────────────────────────────────────────────────
    async def _janitor_loop(self):
        """Background task to clean up expired labs"""
        LOG.info("Starting janitor loop")
        while True:
            try:
                now = dt.datetime.now(dt.timezone.utc).timestamp()
                
                # Find expired labs
                expired = []
                for lab_id, created_at in list(self._created.items()):
                    if now - created_at > POD_TTL_SECS:
                        LOG.info(f"Lab {lab_id} has expired (created {int(now - created_at)}s ago)")
                        expired.append(lab_id)
                
                # Stop expired labs
                for lab_id in expired:
                    try:
                        await self.stop(lab_id)
                    except Exception as e:
                        LOG.error(f"Error stopping expired lab {lab_id}: {e}")
                
            except Exception as e:
                LOG.error(f"Error in janitor loop: {e}")
                
            # Wait before next check
            await asyncio.sleep(60)

# ──────────────────────────────────────────────────────────────────
# Factory
# ──────────────────────────────────────────────────────────────────
def get_eks_backend() -> EKSLabs:
    """Create and return an EKSLabs backend instance"""
    return EKSLabs()