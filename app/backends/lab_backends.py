"""
ECS back‑end for *lab_service* – one Fargate task per lab + ECS‑Exec shell.
"""

from __future__ import annotations

import asyncio, datetime as dt, logging, os, uuid
from typing import Any, Dict, Optional

import aioboto3
from botocore.exceptions import ClientError
import inspect, websockets                               # ← detect parameter

# ──────────────────────────── configuration ───────────────────────────────
REGION     = os.getenv("AWS_REGION",          "me-central-1")
CLUSTER    = os.getenv("LAB_ECS_CLUSTER",     "interactive-labs-cluster")
TASK_DEF   = os.getenv("LAB_TASK_DEF",        "interactive-labs")
SUBNETS  = os.getenv("LAB_SUBNETS", "subnet-0a0f4e717f6b0caca,subnet-0f671aadf4df2b6d8,subnet-0506473196ebc6cdf").split(",")
SEC_GRP       = os.getenv("LAB_SG", "sg-01c911f5aea2071c3")                    # may be empty
CONTAINER  = os.getenv("LAB_CONTAINER",       "lab")
WAIT_SECONDS   = int(os.getenv("LAB_WAIT_SECS",   "300"))                # 5 min
LOG        = logging.getLogger("lab_service.ecs")

# What header kw does *this* websockets build expect?
_WS_SIG = inspect.signature(websockets.connect)
_HDR_KW = "headers" if "headers" in _WS_SIG.parameters else "extra_headers"

# ──────────────────────────── factory ─────────────────────────────────────
def get_ecs_backend():
    class ECSLabs:
        _session: Optional[aioboto3.Session] = None
        _ecs     = None                           # aioboto3 client
        _labs: Dict[str, str] = {}                # lab_id → taskArn

        # ────────── helpers ────────────────────────────────────────────
        async def _client(self):
            if self._ecs:
                return self._ecs
            self._session = aioboto3.Session()
            self._ecs = await self._session.client(
                "ecs", region_name=REGION
            ).__aenter__()
            LOG.info("connected to ECS %s", REGION)
            return self._ecs

        async def _task_for_lab(self, lab_id: str) -> Optional[str]:
            """
            Resolve *lab_id* → task‑ARN (works after hot‑reload or on another
            API replica).
            """
            ecs = await self._client()

            # 1) quick path – the task we started ourselves
            resp = await ecs.list_tasks(
                cluster=CLUSTER, desiredStatus="RUNNING", startedBy=lab_id
            )
            arns = resp["taskArns"]

            # 2) slow path – scan all running tasks
            if not arns:
                arns = (await ecs.list_tasks(cluster=CLUSTER))["taskArns"]

            if not arns:
                return None

            desc = await ecs.describe_tasks(cluster=CLUSTER, tasks=arns)
            for t in desc["tasks"]:
                for tag in t.get("tags", []):
                    if tag["key"] == "lab_id" and tag["value"] == lab_id:
                        return t["taskArn"]
            return None

        # ────────── lifecycle (called by facade) ───────────────────────
        async def init(self):  await self._client()
        async def close(self):
            if self._ecs:
                await self._ecs.__aexit__(None, None, None)

        # ────────── public API ─────────────────────────────────────────
        async def launch(self, *, tag: str | None = None) -> str:
            ecs    = await self._client()
            lab_id = tag or uuid.uuid4().hex

            resp = await ecs.run_task(
                cluster=CLUSTER,
                taskDefinition=TASK_DEF,
                launchType="FARGATE",
                enableExecuteCommand=True,
                networkConfiguration={
                    "awsvpcConfiguration": {
                        "subnets": SUBNETS,
                        **({"securityGroups": [SEC_GRP]} if SEC_GRP else {}),
                        "assignPublicIp": "ENABLED",
                    }
                },
                startedBy=lab_id,                    # <‑‑ makes lookup trivial
                tags=[{"key": "lab_id", "value": lab_id}],
            )
            if not resp["tasks"]:
                raise RuntimeError("ECS couldn’t start the Fargate task")
            task_arn = resp["tasks"][0]["taskArn"]
            self._labs[lab_id] = task_arn

            # Wait until RUNNING (async‑friendly loop)
            deadline = dt.datetime.now(dt.timezone.utc).timestamp() + WAIT_SECONDS
            while dt.datetime.now(dt.timezone.utc).timestamp() < deadline:
                status = (
                    await ecs.describe_tasks(cluster=CLUSTER, tasks=[task_arn])
                )["tasks"][0]["lastStatus"]
                if status == "RUNNING":
                    LOG.info("lab %s RUNNING – task %s", lab_id, task_arn)
                    return lab_id
                await asyncio.sleep(3)

            await self.stop(lab_id)
            raise RuntimeError("ECS task didn’t reach RUNNING state in time")

        async def exec_stream(self, lab_id: str) -> Dict[str, Any]:
            ecs = await self._client()
            task_arn = self._labs.get(lab_id) or await self._task_for_lab(lab_id)
            if not task_arn:
                raise RuntimeError("unknown lab_id")

            # SSM channel sometimes needs a few seconds – retry
            for _ in range(10):
                try:
                    resp = await ecs.execute_command(
                        cluster=CLUSTER,
                        task=task_arn,
                        container=CONTAINER,
                        command="/bin/bash",
                        interactive=True,
                    )
                    break
                except ClientError as e:
                    if e.response["Error"]["Code"] == "TargetNotConnectedException":
                        await asyncio.sleep(2)
                        continue
                    raise
            else:
                raise RuntimeError("ECS‑Exec channel not ready after retries")

            return {
                "uri": resp["session"]["streamUrl"],
                "subprotocols": ["aws.exec"],
                # NB: websockets.connect wants **extra_headers**
                "extra_headers": [("X-aws-ecscmd-token", resp["session"]["tokenValue"])],
                "ping_interval": None,   # SSM handles keep‑alive
            }

        async def stop(self, lab_id: str) -> None:
            ecs = await self._client()
            task_arn = self._labs.pop(lab_id, None) or await self._task_for_lab(lab_id)
            if task_arn:
                await ecs.stop_task(cluster=CLUSTER, task=task_arn,
                                    reason="lab finished")
                LOG.info("stopped lab %s", lab_id)

    return ECSLabs()
# ─────────── placeholder EKS backend ──────────────────────────────────────
def get_eks_backend():
    class _Stub:
        async def init(self):  ...
        async def close(self): ...
        async def _todo(self, *a, **k): raise NotImplementedError("EKS backend TBD")
        launch = exec_stream = stop = _todo
    logging.getLogger("lab_service.eks").warning("EKS backend is only a stub.")
    return _Stub()
