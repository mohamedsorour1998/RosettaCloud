"""
Concrete back-end factories for cache_events_service.

- redis_sqs – Redis for cache + SQS for pub/sub.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import AsyncGenerator, Optional

import boto3
import redis.asyncio as aioredis

_DEFAULT_CACHE = os.getenv("CACHE_EVENTS_DEFAULT_CACHE", "interactive-labs")
_DEFAULT_TTL   = int(os.getenv("CACHE_EVENTS_DEFAULT_TTL", "900"))


def get_redis_sqs_backend():

    class RedisSqsCacheEvents:
        _log = logging.getLogger("cache_events_service.redis_sqs")

        _redis: Optional[aioredis.Redis] = None
        _sqs_client = None
        _queue_url: str = ""

        async def init(self) -> None:
            if self._redis:
                return

            redis_host = os.getenv("REDIS_HOST", "redis-service")
            redis_port = int(os.getenv("REDIS_PORT", "6379"))
            self._redis = aioredis.Redis(
                host=redis_host, port=redis_port, decode_responses=True
            )
            await self._redis.ping()

            self._queue_url = os.getenv("SQS_QUEUE_URL", "")
            if self._queue_url:
                self._sqs_client = boto3.client(
                    "sqs",
                    region_name=os.getenv("AWS_REGION", "us-east-1"),
                    config=boto3.session.Config(
                        connect_timeout=5,
                        read_timeout=25,
                        retries={"max_attempts": 0},
                    ),
                )

            self._log.info(
                "Redis+SQS backend ready (redis=%s:%s, queue=%s)",
                redis_host, redis_port, self._queue_url,
            )

        async def close(self) -> None:
            if self._redis:
                await self._redis.aclose()
                self._redis = None

        async def set(self, cache: str, key: str, value: str, ttl: int | None = None) -> None:
            effective_ttl = ttl or _DEFAULT_TTL
            await self._redis.setex(f"cache:{cache}:{key}", effective_ttl, value)

        async def get(self, cache: str, key: str) -> str | None:
            return await self._redis.get(f"cache:{cache}:{key}")

        async def publish(self, topic: str, payload: str, cache: str = _DEFAULT_CACHE) -> None:
            # If the payload contains a feedback_id, also store the result in Redis
            # so the frontend can poll for it
            try:
                data = json.loads(payload)
                feedback_id = data.get("feedback_id")
                if feedback_id:
                    await self._redis.setex(
                        f"cache:feedback:{feedback_id}", 600, payload
                    )
            except (json.JSONDecodeError, TypeError):
                pass

        async def subscribe(self, topic: str, cache: str = _DEFAULT_CACHE) -> AsyncGenerator[str, None]:
            """Long-poll SQS for messages on the given topic."""
            if not self._queue_url:
                self._log.warning("SQS_QUEUE_URL not set, subscribe is disabled")
                while True:
                    await asyncio.sleep(3600)
                return

            while True:
                try:
                    resp = await asyncio.to_thread(
                        self._sqs_client.receive_message,
                        QueueUrl=self._queue_url,
                        MaxNumberOfMessages=10,
                        WaitTimeSeconds=20,
                    )
                    for msg in resp.get("Messages", []):
                        yield msg["Body"]
                        await asyncio.to_thread(
                            self._sqs_client.delete_message,
                            QueueUrl=self._queue_url,
                            ReceiptHandle=msg["ReceiptHandle"],
                        )
                except Exception as exc:
                    self._log.error("SQS receive error: %s", exc)
                    await asyncio.sleep(5)

    return RedisSqsCacheEvents()
