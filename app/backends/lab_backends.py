"""
lab_service – unified async interface to interactive labs on EKS.

This module automatically creates and manages:
----------------------------------------------------------------
• A StatefulSet to host lab pods
• One ClusterIP service *per replica* to target every pod exclusively
• A headless service for stable DNS inside the cluster
• An Ingress that maps <lab-id>.labs.rosettacloud.app → that replica’s service
• A Route 53 A-record that points <lab-id>.labs.rosettacloud.app to the ALB
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
import os
import uuid
from functools import wraps
from typing import Any, Dict, Optional

import boto3
from botocore.exceptions import ClientError
from kubernetes import client, config
from kubernetes.client.rest import ApiException

# --------------------------------------------------------------------------- #
#  CONFIGURATION                                                               #
# --------------------------------------------------------------------------- #
NAMESPACE = os.getenv("LAB_K8S_NAMESPACE", "interactive-labs")
POD_IMAGE = os.getenv(
    "LAB_POD_IMAGE",
    "339712964409.dkr.ecr.me-central-1.amazonaws.com/interactive-labs:latest",
)
WAIT_EKS = int(os.getenv("LAB_WAIT_SECS", "300"))
IMAGE_PULL_SECRET = os.getenv("LAB_IMAGE_PULL_SECRET", "ecr-creds")
POD_TTL_SECS = int(os.getenv("LAB_POD_TTL_SECS", "3600"))
STATEFULSET_NAME = os.getenv("LAB_STATEFULSET_NAME", "interactive-labs")
HEADLESS_SERVICE_NAME = os.getenv("LAB_HEADLESS_SERVICE_NAME", "interactive-labs-headless")
INGRESS_NAME = os.getenv("LAB_INGRESS_NAME", "interactive-labs-ingress")
INGRESS_CLASS = os.getenv("LAB_INGRESS_CLASS", "nginx")
BASE_DOMAIN = os.getenv("LAB_BASE_DOMAIN", "labs.rosettacloud.app")
LOADBALANCER_DNS = os.getenv("LAB_LOADBALANCER_DNS", "51.112.10.4")
ROUTE53_HOSTED_ZONE_ID = os.getenv("LAB_ROUTE53_HOSTED_ZONE_ID", "Z079218314YQ78VCH6R35")
ROUTE53_TTL = int(os.getenv("LAB_ROUTE53_TTL", "60"))
DNS_CREATE_RETRY_COUNT = int(os.getenv("LAB_DNS_CREATE_RETRY_COUNT", "3"))
DNS_CREATE_RETRY_DELAY = int(os.getenv("LAB_DNS_CREATE_RETRY_DELAY", "2"))
CONCURRENT_TASKS_LIMIT = int(os.getenv("LAB_CONCURRENT_TASKS_LIMIT", "5"))

LOG_EKS = logging.getLogger("lab_service.eks")

def retry_async(max_retries=3, delay=1, backoff=2, exceptions=(Exception,)):
    def decorator(fn):
        @wraps(fn)
        async def wrapper(*args, **kw):
            n, t = 0, delay
            while True:
                try:
                    return await fn(*args, **kw)
                except exceptions as e:
                    n += 1
                    if n > max_retries:
                        LOG_EKS.error("%s failed after %d retries – %s", fn.__name__, max_retries, e)
                        raise
                    LOG_EKS.warning("Retrying %s in %ds (%s)", fn.__name__, t, e)
                    await asyncio.sleep(t)
                    t *= backoff

        return wrapper
    return decorator

def pod_name(idx: int) -> str:
    return f"{STATEFULSET_NAME}-{idx}"

def svc_name(lab_id: str) -> str:
    return f"{lab_id}-svc"

def fqdn(lab_id: str) -> str:
    return f"{lab_id}.{BASE_DOMAIN}."


class EKSLabs:
    def __init__(self) -> None:
        self._core: client.CoreV1Api | None = None
        self._apps: client.AppsV1Api | None = None
        self._net: client.NetworkingV1Api | None = None
        self._r53: Any | None = None
        self._sem = asyncio.Semaphore(CONCURRENT_TASKS_LIMIT)
        self._active: Dict[str, int] = {}  # lab-id → pod index
        self._created: Dict[str, float] = {}
        self._janitor_task: asyncio.Task | None = None

    async def _clients(
        self,
    ) -> tuple[client.CoreV1Api, client.AppsV1Api, client.NetworkingV1Api, Any | None]:
        if not all([self._core, self._apps, self._net]):
            try:
                config.load_incluster_config()
            except Exception:
                config.load_kube_config()
            self._core = client.CoreV1Api()
            self._apps = client.AppsV1Api()
            self._net = client.NetworkingV1Api()
            LOG_EKS.info("Kubernetes clients initialised")
        if not self._r53 and ROUTE53_HOSTED_ZONE_ID:
            self._r53 = boto3.client("route53")
        return self._core, self._apps, self._net, self._r53

    @contextlib.asynccontextmanager
    async def _k8s(self):
        async with self._sem:
            try:
                yield await self._clients()
            except ApiException as e:
                LOG_EKS.error("Kubernetes API error: %s", e)
                raise

    async def init(self) -> None:
        await self._clients()
        await asyncio.gather(
            self._ensure_statefulset(),
            self._ensure_headless(),
            self._ensure_ingress(),
        )
        self._janitor_task = asyncio.create_task(self._janitor())
        LOG_EKS.info("EKSLabs backend READY")

    async def close(self) -> None:
        if self._janitor_task:
            self._janitor_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._janitor_task

    # ---------------------- resource: StatefulSet -------------------------- #
    @retry_async(max_retries=3, exceptions=(ApiException,))
    async def _ensure_statefulset(self):
        async with self._k8s() as (_, apps, __, ___):
            try:
                await asyncio.to_thread(
                    apps.read_namespaced_stateful_set, STATEFULSET_NAME, NAMESPACE
                )
                return
            except ApiException as e:
                if e.status != 404:
                    raise
            sts = client.V1StatefulSet(
                metadata=client.V1ObjectMeta(
                    name=STATEFULSET_NAME,
                    namespace=NAMESPACE,
                    labels={"app": "interactive-labs"},
                ),
                spec=client.V1StatefulSetSpec(
                    service_name=HEADLESS_SERVICE_NAME,
                    replicas=0,
                    selector=client.V1LabelSelector(
                        match_labels={"app": "interactive-labs"}
                    ),
                    template=client.V1PodTemplateSpec(
                        metadata=client.V1ObjectMeta(
                            labels={"app": "interactive-labs"}
                        ),
                        spec=client.V1PodSpec(
                            containers=[
                                client.V1Container(
                                    name="lab",
                                    image=POD_IMAGE,
                                    ports=[client.V1ContainerPort(container_port=80)],
                                    resources=client.V1ResourceRequirements(
                                        requests={"cpu": "100m", "memory": "256Mi"},
                                        limits={"cpu": "1", "memory": "1Gi"},
                                    ),
                                )
                            ],
                            image_pull_secrets=[
                                client.V1LocalObjectReference(name=IMAGE_PULL_SECRET)
                            ]
                            if IMAGE_PULL_SECRET
                            else None,
                        ),
                    ),
                ),
            )
            await asyncio.to_thread(
                apps.create_namespaced_stateful_set, NAMESPACE, sts
            )
            LOG_EKS.info("StatefulSet %s created", STATEFULSET_NAME)

    # ------------------------ resource: headless svc ----------------------- #
    @retry_async(max_retries=3, exceptions=(ApiException,))
    async def _ensure_headless(self):
        async with self._k8s() as (core, *_):
            try:
                await asyncio.to_thread(
                    core.read_namespaced_service, HEADLESS_SERVICE_NAME, NAMESPACE
                )
                return
            except ApiException as e:
                if e.status != 404:
                    raise
            svc = client.V1Service(
                metadata=client.V1ObjectMeta(
                    name=HEADLESS_SERVICE_NAME,
                    namespace=NAMESPACE,
                    labels={"app": "interactive-labs"},
                ),
                spec=client.V1ServiceSpec(
                    selector={"app": "interactive-labs"},
                    ports=[client.V1ServicePort(port=80, target_port=80)],
                    cluster_ip="None",  # headless
                    publish_not_ready_addresses=True,
                ),
            )
            await asyncio.to_thread(core.create_namespaced_service, NAMESPACE, svc)
            LOG_EKS.info("Headless service %s created", HEADLESS_SERVICE_NAME)

    # --------------------------- resource: ingress ------------------------- #
    @retry_async(max_retries=3, exceptions=(ApiException,))
    async def _ensure_ingress(self):
        async with self._k8s() as (*_, net, __):
            try:
                await asyncio.to_thread(
                    net.read_namespaced_ingress, INGRESS_NAME, NAMESPACE
                )
                return
            except ApiException as e:
                if e.status != 404:
                    raise
            ing = client.V1Ingress(
                metadata=client.V1ObjectMeta(
                    name=INGRESS_NAME,
                    namespace=NAMESPACE,
                    labels={"app": "interactive-labs"},
                    annotations={
                        "kubernetes.io/ingress.class": INGRESS_CLASS,
                        "nginx.ingress.kubernetes.io/ssl-redirect": "true",
                    },
                ),
                spec=client.V1IngressSpec(
                    default_backend=client.V1IngressBackend(
                        service=client.V1IngressServiceBackend(
                            name=HEADLESS_SERVICE_NAME,
                            port=client.V1ServiceBackendPort(number=80),
                        )
                    ),
                    tls=[
                        client.V1IngressTLS(
                            hosts=[f"*.{BASE_DOMAIN}"],
                            secret_name=f"{INGRESS_NAME}-tls",
                        )
                    ],
                ),
            )
            await asyncio.to_thread(net.create_namespaced_ingress, NAMESPACE, ing)
            LOG_EKS.info("Ingress %s created", INGRESS_NAME)

    # ---------------------------- Route 53 --------------------------------- #
    async def _wait_change(self, change_id: str):
        if self._r53:
            waiter = self._r53.get_waiter("resource_record_sets_changed")
            await asyncio.to_thread(waiter.wait, Id=change_id)

    @retry_async(
        max_retries=DNS_CREATE_RETRY_COUNT,
        delay=DNS_CREATE_RETRY_DELAY,
        exceptions=(ClientError,),
    )
    async def _r53_upsert(self, lab_id: str):
        if not all([ROUTE53_HOSTED_ZONE_ID, LOADBALANCER_DNS, self._r53]):
            return
        resp = await asyncio.to_thread(
            self._r53.change_resource_record_sets,
            HostedZoneId=ROUTE53_HOSTED_ZONE_ID,
            ChangeBatch={
                "Changes": [
                    {
                        "Action": "UPSERT",
                        "ResourceRecordSet": {
                            "Name": fqdn(lab_id),
                            "Type": "A",
                            "TTL": ROUTE53_TTL,
                            "ResourceRecords": [{"Value": LOADBALANCER_DNS}],
                        },
                    }
                ]
            },
        )
        await self._wait_change(resp["ChangeInfo"]["Id"])

    @retry_async(
        max_retries=DNS_CREATE_RETRY_COUNT,
        delay=DNS_CREATE_RETRY_DELAY,
        exceptions=(ClientError,),
    )
    async def _r53_delete(self, lab_id: str):
        if not all([ROUTE53_HOSTED_ZONE_ID, LOADBALANCER_DNS, self._r53]):
            return
        resp = await asyncio.to_thread(
            self._r53.change_resource_record_sets,
            HostedZoneId=ROUTE53_HOSTED_ZONE_ID,
            ChangeBatch={
                "Changes": [
                    {
                        "Action": "DELETE",
                        "ResourceRecordSet": {
                            "Name": fqdn(lab_id),
                            "Type": "A",
                            "TTL": ROUTE53_TTL,
                            "ResourceRecords": [{"Value": LOADBALANCER_DNS}],
                        },
                    }
                ]
            },
        )
        await self._wait_change(resp["ChangeInfo"]["Id"])

    # --------------- per-replica ClusterIP service helpers ---------------- #
    async def _create_lab_svc(self, lab_id: str, idx: int) -> str:
        name = svc_name(lab_id)
        async with self._k8s() as (core, *_):
            body = client.V1Service(
                metadata=client.V1ObjectMeta(name=name, namespace=NAMESPACE),
                spec=client.V1ServiceSpec(
                    selector={"statefulset.kubernetes.io/pod-name": pod_name(idx)},
                    ports=[client.V1ServicePort(port=80, target_port=80)],
                    type="ClusterIP",
                ),
            )
            try:
                await asyncio.to_thread(core.create_namespaced_service, NAMESPACE, body)
            except ApiException as e:
                if e.status != 409:
                    raise
        return name

    async def _delete_lab_svc(self, lab_id: str):
        name = svc_name(lab_id)
        async with self._k8s() as (core, *_):
            with contextlib.suppress(ApiException):
                await asyncio.to_thread(core.delete_namespaced_service, name, NAMESPACE)

    # --------------------------- Ingress patch ----------------------------- #
    async def _patch_ingress(self, lab_id: str, service: str, action: str):
        async with self._k8s() as (*_, net, __):
            ing = await asyncio.to_thread(
                net.read_namespaced_ingress, INGRESS_NAME, NAMESPACE
            )
            ing.spec.rules = ing.spec.rules or []
            host = f"{lab_id}.{BASE_DOMAIN}"
            ing.spec.rules = [r for r in ing.spec.rules if r.host != host]
            if action == "add":
                ing.spec.rules.append(
                    client.V1IngressRule(
                        host=host,
                        http=client.V1HTTPIngressRuleValue(
                            paths=[
                                client.V1HTTPIngressPath(
                                    path="/",
                                    path_type="Prefix",
                                    backend=client.V1IngressBackend(
                                        service=client.V1IngressServiceBackend(
                                            name=service,
                                            port=client.V1ServiceBackendPort(number=80),
                                        )
                                    ),
                                )
                            ]
                        ),
                    )
                )
            await asyncio.to_thread(
                net.patch_namespaced_ingress, INGRESS_NAME, NAMESPACE, ing
            )

    # ----------------------- StatefulSet scaling --------------------------- #
    async def _scale(self, replicas: int):
        async with self._k8s() as (_, apps, __, ___):
            sts = await asyncio.to_thread(
                apps.read_namespaced_stateful_set, STATEFULSET_NAME, NAMESPACE
            )
            if sts.spec.replicas != replicas:
                sts.spec.replicas = replicas
                await asyncio.to_thread(
                    apps.patch_namespaced_stateful_set, STATEFULSET_NAME, NAMESPACE, sts
                )
                LOG_EKS.info("Scaled %s → %d", STATEFULSET_NAME, replicas)

    # ----------------------------- public API ------------------------------ #
    async def launch(self, *, tag: str | None = None) -> str:
        lab_id = tag or f"lab-{uuid.uuid4().hex[:8]}"
        idx = len(self._active)
        await self._scale(idx + 1)
        await self._create_lab_svc(lab_id, idx)
        await self._patch_ingress(lab_id, svc_name(lab_id), "add")
        await self._r53_upsert(lab_id)
        self._active[lab_id] = idx
        self._created[lab_id] = dt.datetime.now(dt.timezone.utc).timestamp()
        return lab_id

    async def stop(self, lab_id: str) -> bool:
        idx = self._active.pop(lab_id, None)
        if idx is None:
            return False
        self._created.pop(lab_id, None)
        await asyncio.gather(
            self._patch_ingress(lab_id, svc_name(lab_id), "remove"),
            self._delete_lab_svc(lab_id),
            self._r53_delete(lab_id),
        )
        if idx == max(self._active.values(), default=-1):
            await self._scale(idx)
        return True

    async def get_ip(self, lab_id: str) -> Optional[str]:
        return f"{lab_id}.{BASE_DOMAIN}" if lab_id in self._active else None

    async def get_time_remaining(self, lab_id: str) -> Optional[Dict[str, int]]:
        ts = self._created.get(lab_id)
        if ts is None:
            return None
        remaining = max(0, POD_TTL_SECS - int(dt.datetime.now(dt.timezone.utc).timestamp() - ts))
        return {"minutes": remaining // 60, "seconds": remaining % 60, "total_seconds": remaining}

    # ------------------------- background janitor -------------------------- #
    async def _janitor(self):
        while True:
            try:
                now = dt.datetime.now(dt.timezone.utc).timestamp()
                for lab_id, ct in list(self._created.items()):
                    if now - ct > POD_TTL_SECS:
                        await self.stop(lab_id)
            except Exception as e:
                LOG_EKS.error("Janitor error: %s", e)
            await asyncio.sleep(60)


# --------------------------------------------------------------------------- #
#  FACTORY                                                                    #
# --------------------------------------------------------------------------- #
def get_eks_backend():
    return EKSLabs()
