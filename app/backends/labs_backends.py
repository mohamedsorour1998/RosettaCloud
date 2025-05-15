"""
Improved Interactive-lab back-end for EKS
Uses individual pods with clean service/ingress mapping
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


# Configuration (can be set via environment variables)
NAMESPACE         = os.getenv("LAB_K8S_NAMESPACE", "openedx")
INGRESS_NAMESPACE = os.getenv("LAB_INGRESS_NAMESPACE", NAMESPACE)
INGRESS_NAME      = os.getenv("LAB_INGRESS_NAME", "rosettacloud-ingress")
POD_IMAGE         = os.getenv("LAB_POD_IMAGE", "339712964409.dkr.ecr.me-central-1.amazonaws.com/interactive-labs:latest")
IMAGE_PULL_SECRET = os.getenv("LAB_IMAGE_PULL_SECRET", "ecr-creds")
WILDCARD_DOMAIN   = os.getenv("LAB_WILDCARD_DOMAIN", "labs.dev.rosettacloud.app")
INGRESS_CLASS     = os.getenv("LAB_INGRESS_CLASS", "nginx")
POD_TTL_SECS      = int(os.getenv("LAB_POD_TTL_SECS", "3600"))
CONCURRENCY       = int(os.getenv("LAB_CONCURRENT_TASKS_LIMIT", "5"))
DEBUG             = os.getenv("LAB_DEBUG", "").lower() in ("1", "true", "yes")

LOG = logging.getLogger("labs_service.eks")
if DEBUG:
    logging.basicConfig(level=logging.DEBUG)
    LOG.setLevel(logging.DEBUG)

def retry_async(max_retries=3, delay=1, backoff=2, exceptions=(Exception,)):
    """Retry decorator for async functions"""
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

def svc_name(lab_id: str) -> str: 
    """Generate service name from lab ID"""
    return f"{lab_id}-svc"

def pod_name(lab_id: str) -> str: 
    """Generate pod name from lab ID"""
    return f"lab-{lab_id}"

def lab_host(lab_id: str) -> str: 
    """Generate hostname from lab ID"""
    return f"{lab_id}.{WILDCARD_DOMAIN}"

class EKSLabs:
    def __init__(self) -> None:
        LOG.debug("Initializing EKSLabs backend")
        self._core: Optional[client.CoreV1Api] = None
        self._apps: Optional[client.AppsV1Api] = None
        self._net: Optional[client.NetworkingV1Api] = None
        self._sem = asyncio.Semaphore(CONCURRENCY)

        # Lab tracking
        self._active: Dict[str, str] = {}    # lab_id → pod_name
        self._created: Dict[str, float] = {} # lab_id → epoch secs
        self._janitor: Optional[asyncio.Task] = None
        
        LOG.debug("EKSLabs backend initialized")

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

    @retry_async(exceptions=(ApiException,))
    async def _create_lab_pod(self, lab_id: str) -> str:
        """Create an individual pod for the lab"""
        LOG.info(f"Creating pod for lab {lab_id}")
        pod_id = pod_name(lab_id)
        
        async with self._k8s() as (core, *_):
            pod = client.V1Pod(
                metadata=client.V1ObjectMeta(
                    name=pod_id,
                    namespace=NAMESPACE,
                    labels={
                        "app": "interactive-labs",
                        "lab-id": lab_id
                    }
                ),
                spec=client.V1PodSpec(
                    containers=[client.V1Container(
                        name="lab",
                        image=POD_IMAGE,
                        ports=[client.V1ContainerPort(container_port=80)],
                        security_context=client.V1SecurityContext(
                            privileged=True,
                            run_as_user=0,
                        ),
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
                    image_pull_secrets=[
                        client.V1LocalObjectReference(name=IMAGE_PULL_SECRET)
                    ] if IMAGE_PULL_SECRET else None,
                    restart_policy="Always"
                )
            )
            
            try:
                await asyncio.to_thread(core.create_namespaced_pod, NAMESPACE, pod)
                LOG.info(f"Pod {pod_id} created successfully")
                
                # Wait for pod to be running
                deadline = dt.datetime.now(dt.timezone.utc).timestamp() + 60
                while dt.datetime.now(dt.timezone.utc).timestamp() < deadline:
                    pod_status = await asyncio.to_thread(
                        core.read_namespaced_pod_status,
                        pod_id,
                        NAMESPACE
                    )
                    status = pod_status.status.phase
                    LOG.debug(f"Pod {pod_id} status: {status}")
                    
                    if status == "Running":
                        LOG.info(f"Pod {pod_id} is running")
                        return pod_id
                    
                    await asyncio.sleep(2)
                
                # If timeout, still return pod name but log a warning
                LOG.warning(f"Timeout waiting for pod {pod_id} to be running")
                return pod_id
                
            except ApiException as e:
                if e.status == 409:  # Already exists
                    LOG.warning(f"Pod {pod_id} already exists")
                    return pod_id
                raise

    @retry_async(exceptions=(ApiException,))
    async def _delete_lab_pod(self, lab_id: str) -> bool:
        """Delete the pod for a lab"""
        pod_id = pod_name(lab_id)
        LOG.info(f"Deleting pod {pod_id}")
        
        async with self._k8s() as (core, *_):
            try:
                await asyncio.to_thread(
                    core.delete_namespaced_pod,
                    pod_id,
                    NAMESPACE,
                    body=client.V1DeleteOptions(
                        grace_period_seconds=5,
                        propagation_policy="Background"
                    )
                )
                LOG.info(f"Pod {pod_id} deleted successfully")
                return True
            except ApiException as e:
                if e.status == 404:  # Not found
                    LOG.warning(f"Pod {pod_id} not found, may have been already deleted")
                    return True
                raise

    @retry_async(exceptions=(ApiException,))
    async def _create_lab_svc(self, lab_id: str):
        """Create a Service for the lab that targets the pod by label"""
        service_id = svc_name(lab_id)
        pod_id = pod_name(lab_id)
        
        LOG.info(f"Creating service {service_id} targeting pod {pod_id}")
        
        async with self._k8s() as (core, *_):
            body = client.V1Service(
                metadata=client.V1ObjectMeta(
                    name=service_id, 
                    namespace=NAMESPACE,
                    labels={"app": "interactive-labs", "lab-id": lab_id}
                ),
                spec=client.V1ServiceSpec(
                    selector={"lab-id": lab_id},  # Target pod by label
                    ports=[client.V1ServicePort(port=80, target_port=80)],
                    type="ClusterIP",
                ),
            )
            
            try:
                await asyncio.to_thread(core.create_namespaced_service, NAMESPACE, body)
                LOG.info(f"Service {service_id} created successfully")
            except ApiException as e:
                if e.status == 409:  # Already exists
                    LOG.warning(f"Service {service_id} already exists")
                else:
                    raise

    @retry_async(exceptions=(ApiException,))
    async def _delete_lab_svc(self, lab_id: str):
        """Delete the Service for a lab"""
        service_id = svc_name(lab_id)
        LOG.info(f"Deleting service {service_id}")
        
        async with self._k8s() as (core, *_):
            try:
                await asyncio.to_thread(core.delete_namespaced_service, service_id, NAMESPACE)
                LOG.info(f"Service {service_id} deleted successfully")
            except ApiException as e:
                if e.status == 404:  # Not found
                    LOG.warning(f"Service {service_id} not found, may have been already deleted")
                else:
                    raise

    @retry_async(exceptions=(ApiException,))
    async def _patch_ingress(self, lab_id: str, add: bool):
        """Add (or remove) an ingress rule for a lab"""
        action = "Adding" if add else "Removing"
        host = lab_host(lab_id)
        service_id = svc_name(lab_id)
    
        LOG.info(f"{action} ingress rule for {host} -> {service_id}")
    
        async with self._k8s() as (*_, net):
            try:
                ing = await asyncio.to_thread(
                    net.read_namespaced_ingress,
                    name=INGRESS_NAME,
                    namespace=INGRESS_NAMESPACE,
                )
                
                # Keep all rules except the one for this host
                rules = ing.spec.rules or []
                rules = [r for r in rules if r.host != host]
                
                # Add the rule if needed
                if add:
                    rules.append(
                        client.V1IngressRule(
                            host=host,
                            http=client.V1HTTPIngressRuleValue(
                                paths=[
                                    client.V1HTTPIngressPath(
                                        path="/",
                                        path_type="Prefix",
                                        backend=client.V1IngressBackend(
                                            service=client.V1IngressServiceBackend(
                                                name=service_id,
                                                port=client.V1ServiceBackendPort(number=80)
                                            )
                                        )
                                    )
                                ]
                            )
                        )
                    )
                
                # Update the ingress rules
                ing.spec.rules = rules
                
                await asyncio.to_thread(
                    net.patch_namespaced_ingress,
                    name=INGRESS_NAME,
                    namespace=INGRESS_NAMESPACE,
                    body=ing,
                )
                
                LOG.info(f"{action} ingress rule for {host} completed successfully")
                
            except ApiException as e:
                if e.status == 404 and not add:
                    LOG.warning(f"Ingress {INGRESS_NAME} not found, nothing to remove")
                else:
                    raise

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

    async def init(self):
        """Initialize the backend"""
        LOG.info("Initializing EKS lab backend")
        await self._init_clients()
        
        try:
            # Start the janitor task
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

    async def launch(self, *, tag: str | None = None) -> str:
        """Launch a new lab pod and return its ID"""
        LOG.info("Launching new lab pod")
        
        # Generate a unique lab ID if not provided
        lab_id = tag or f"lab-{uuid.uuid4().hex[:8]}"
        
        try:
            # Create the pod
            pod_id = await self._create_lab_pod(lab_id)
            
            # Create the service
            await self._create_lab_svc(lab_id)
            
            # Update the ingress
            await self._patch_ingress(lab_id, add=True)
            
            # Track the active lab
            self._active[lab_id] = pod_id
            self._created[lab_id] = dt.datetime.now(dt.timezone.utc).timestamp()
            
            LOG.info(f"Lab {lab_id} launched successfully with pod {pod_id}")
            return lab_id
            
        except Exception as e:
            LOG.error(f"Failed to launch lab {lab_id}: {e}")
            
            # Clean up if needed
            with contextlib.suppress(Exception):
                await self.stop(lab_id)
                
            raise RuntimeError(f"Failed to launch lab: {str(e)}")

    async def stop(self, lab_id: str) -> bool:
        """Stop a lab pod and clean up resources"""
        LOG.info(f"Stopping lab: {lab_id}")
        
        # Check if the lab exists
        if lab_id not in self._active:
            LOG.warning(f"Lab {lab_id} not found, cannot stop")
            return False
            
        # Remove from tracking
        self._active.pop(lab_id, None)
        self._created.pop(lab_id, None)
        
        try:
            # Clean up all resources in parallel
            await asyncio.gather(
                self._patch_ingress(lab_id, add=False),
                self._delete_lab_svc(lab_id),
                self._delete_lab_pod(lab_id)
            )
            
            LOG.info(f"Lab {lab_id} stopped successfully")
            return True
            
        except Exception as e:
            LOG.error(f"Error stopping lab {lab_id}: {e}")
            return False

    async def get_lab_info(self, lab_id: str) -> Optional[Dict[str, Any]]:
        """Get information about a lab"""
        LOG.debug(f"Getting info for lab: {lab_id}")
        
        # Check if the lab exists
        pod_id = self._active.get(lab_id)
        if pod_id is None:
            LOG.debug(f"Lab {lab_id} not found")
            return None
        
        hostname = lab_host(lab_id)
        url = f"https://{hostname}"
        
        # Get pod status
        pod_ip = None
        status = "unknown"
        
        try:
            async with self._k8s() as (core, *_):
                pod = await asyncio.to_thread(
                    core.read_namespaced_pod,
                    pod_id,
                    NAMESPACE
                )
                
                status = (pod.status.phase or "unknown").lower()
                pod_ip = pod.status.pod_ip
                
                # Check if the pod is ready
                if status == "running":
                    if not pod.status.conditions:
                        status = "starting"
                    else:
                        ready = any(
                            cond.type == "Ready" and cond.status == "True"
                            for cond in pod.status.conditions
                        )
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
            "pod_ip": pod_ip or hostname,
            "status": status,
            "pod_name": pod_id,
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

# Factory function
def get_eks_backend() -> EKSLabs:
    """Create and return an EKSLabs backend instance"""
    return EKSLabs()