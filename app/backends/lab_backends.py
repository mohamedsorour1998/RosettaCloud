"""
Concrete back‑end factories for lab_service.

• EKS  – fully implemented.
"""
from __future__ import annotations
import asyncio, logging, os, uuid, datetime as dt
from typing import Optional, Dict, Any

from kubernetes import client, config
from kubernetes.client.rest import ApiException

NAMESPACE     = os.getenv("LAB_K8S_NAMESPACE", "interactive-labs")
POD_IMAGE     = os.getenv("LAB_POD_IMAGE", "339712964409.dkr.ecr.me-central-1.amazonaws.com/interactive-labs:latest")
WAIT_EKS      = int(os.getenv("LAB_WAIT_SECS", "300"))
IMAGE_PULL_SECRET = os.getenv("LAB_IMAGE_PULL_SECRET", "ecr-creds")
POD_TTL_SECS  = 3600
LOG_EKS = logging.getLogger("lab_service.eks")

def get_eks_backend():
    class EKSLabs:
        def __init__(self):
            self._api = None
            self._pods: Dict[str,str] = {}
            self._creation_times: Dict[str,float] = {}
            self._pod_ips: Dict[str,str] = {}
            self._created: Dict[str,float] = {}
            self._ips: Dict[str,str] = {}
            self._cleanup_task = None
            
        async def _client(self):
            if self._api:
                return self._api
            try:
                config.load_incluster_config()
            except Exception:
                config.load_kube_config()
            self._api = client.CoreV1Api()
            LOG_EKS.info("K8s client ready")
            return self._api

        async def init(self):
            await self._client()
            self._cleanup_task = asyncio.create_task(self.cleanup_expired_pods())

        async def close(self):
            if self._cleanup_task:
                self._cleanup_task.cancel()
                try:
                    await self._cleanup_task
                except asyncio.CancelledError:
                    pass

        async def launch(self, *, tag: str | None = None) -> str:
            k8s = await self._client()
            lab_id = tag or f"lab-{uuid.uuid4().hex[:8]}"
            pod = client.V1Pod(
                  api_version="v1",
                  kind="Pod",
                  metadata=client.V1ObjectMeta(
                      name=lab_id,
                      namespace=NAMESPACE,
                      labels={
                          "app": "interactive-labs",
                          "lab_id": lab_id
                      }
                  ),
                  spec=client.V1PodSpec(
                      containers=[
                          client.V1Container(
                              name="interactive-labs",
                              image=POD_IMAGE,
                              ports=[client.V1ContainerPort(container_port=80)],
                              security_context=client.V1SecurityContext(
                                  privileged=True,
                                  run_as_user=0
                              )
                          )
                      ],
                      image_pull_secrets=[client.V1LocalObjectReference(name="ecr-creds")] if IMAGE_PULL_SECRET else None,
                      restart_policy="Never"
                  ),
              )
              
            try:
                await asyncio.to_thread(
                    k8s.create_namespaced_pod,
                    namespace=NAMESPACE,
                    body=pod
                )
                self._pods[lab_id] = lab_id 
                self._creation_times[lab_id] = dt.datetime.now(dt.timezone.utc).timestamp()
                LOG_EKS.info(f"Created pod {lab_id} in namespace {NAMESPACE} with 1-hour TTL")
                deadline = dt.datetime.now(dt.timezone.utc).timestamp() + WAIT_EKS
                while dt.datetime.now(dt.timezone.utc).timestamp() < deadline:
                    pod_status = await asyncio.to_thread(
                    k8s.read_namespaced_pod,
                    name=lab_id,
                    namespace=NAMESPACE
                )
                    if pod_status.status.phase == "Running" and pod_status.status.pod_ip:
                        self._pod_ips[lab_id] = pod_status.status.pod_ip
                        LOG_EKS.info(f"Pod {lab_id} is running with IP {pod_status.status.pod_ip}, storing in _pod_ips")
                        return lab_id
        
                    await asyncio.sleep(2)
                await self.stop(lab_id)
                raise RuntimeError(f"Kubernetes pod {lab_id} didn't reach Running state in time")
            except ApiException as e:
                LOG_EKS.error(f"Error creating pod: {e}")
                raise RuntimeError(f"Failed to create Kubernetes pod: {e}")

        async def stop(self, lab_id: str) -> bool:
            k8s = await self._client()
            name = self._pods.pop(lab_id, lab_id)
            try:
                await asyncio.to_thread(
                    k8s.delete_namespaced_pod,
                    name=name,
                    namespace=NAMESPACE,
                    body=client.V1DeleteOptions()
                )
                LOG_EKS.info(f"Stopped lab {lab_id} (deleted pod {name})")
                return True
            except ApiException as e:
                LOG_EKS.error(f"Error stopping lab {lab_id}: {e}")
                return False

        async def get_ip(self, lab_id: str) -> Optional[str]:
            return self._pod_ips.get(lab_id)

        async def get_time_remaining(self, lab_id: str) -> Optional[Dict[str,int]]:
            created = self._creation_times.get(lab_id)
            if not created:
                return None
            left = max(0, POD_TTL_SECS - (dt.datetime.now(dt.timezone.utc).timestamp() - created))
            m, s = divmod(int(left), 60)
            return {"minutes": m, "seconds": s, "total_seconds": int(left)}
        
        async def cleanup_expired_pods(self):
            while True:
              now = dt.datetime.now(dt.timezone.utc).timestamp()
              expired_pods = [
                  lab_id for lab_id, created in self._creation_times.items()
                  if now - created > POD_TTL_SECS
              ]
              for lab_id in expired_pods:
                  LOG_EKS.info(f"Pod {lab_id} exceeded TTL and will be deleted.")
                  await self.stop(lab_id)
              await asyncio.sleep(60)
        
        async def get_lab_info(self, lab_id: str) -> Optional[Dict[str,Any]]:
            ip = await self.get_ip(lab_id)
            tr = await self.get_time_remaining(lab_id)
            is_running = lab_id in self._pods
            status = "Running" if is_running else "Unknown"
            LOG_EKS.info(f"Get lab info for {lab_id}: IP={ip}, running={is_running}, status={status}")
            return {"lab_id": lab_id, "pod_ip": ip, "time_remaining": tr, "status": status}
    
    return EKSLabs()
