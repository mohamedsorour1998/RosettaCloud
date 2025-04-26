"""
Concrete back‑end factories for cache_events_service.

• Momento  – fully implemented.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import timedelta
from typing import AsyncGenerator, Optional

_DEFAULT_CACHE = os.getenv("CACHE_EVENTS_DEFAULT_CACHE", "interactive-labs")
_DEFAULT_TTL   = int(os.getenv("CACHE_EVENTS_DEFAULT_TTL", "900"))

def get_momento_backend():
    from momento import (
        CacheClientAsync,
        Configurations,
        CredentialProvider,
        TopicClientAsync,
        TopicConfigurations,
    )
    from momento.responses import (
        CacheGet,
        CacheSet,
        CreateCache,
        TopicPublish,
        TopicSubscribe,
        TopicSubscriptionItem,
    )
    from momento.errors import InvalidArgumentException

    class MomentoCacheEvents:
        _known: set[str] = set()
        _lock = asyncio.Lock()
        _log  = logging.getLogger("cache_events_service.momento")

        _cache: Optional[CacheClientAsync] = None
        _topic: Optional[TopicClientAsync] = None

        async def init(self) -> None:
            if self._cache:
                return
            token = os.getenv("MOMENTO_API_KEY")
            if not token:
                raise RuntimeError("MOMENTO_API_KEY env var not set")

            try:
                creds = CredentialProvider.from_string(token)
            except InvalidArgumentException as e:
                raise RuntimeError(f"Invalid MOMENTO_API_KEY: {e}") from e

            self._cache = await CacheClientAsync.create(
                Configurations.Laptop.v1(), creds, timedelta(seconds=_DEFAULT_TTL)
            )
            self._topic = TopicClientAsync(TopicConfigurations.Default.v1(), creds)
            await self._ensure_cache(_DEFAULT_CACHE)
            self._log.info("Momento backend ready (cache=%s)", _DEFAULT_CACHE)

        async def close(self) -> None:
            if self._cache and hasattr(self._cache, "close"):
                await self._cache.close()
            if self._topic and hasattr(self._topic, "close"):
                await self._topic.close()

        async def _ensure_cache(self, name: str) -> None:
            if name in self._known:
                return
            async with self._lock:
                if name in self._known:
                    return
                resp = await self._cache.create_cache(name)
                if isinstance(resp, CreateCache.Error):
                    raise RuntimeError(resp.message)
                self._known.add(name)

        async def set(self, cache, key, value, ttl=None):
            await self._ensure_cache(cache)
            resp = await self._cache.set(
                cache, key, value, timedelta(seconds=ttl) if ttl else None
            )
            if isinstance(resp, CacheSet.Error):
                raise RuntimeError(resp.message)

        async def get(self, cache, key):
            await self._ensure_cache(cache)
            resp = await self._cache.get(cache, key)
            match resp:
                case CacheGet.Hit():
                    return resp.value_string if resp.value_string is not None else resp.value_bytes
                case CacheGet.Miss():
                    return None
                case CacheGet.Error():
                    raise RuntimeError(resp.message)

        async def publish(self, topic, payload, cache=_DEFAULT_CACHE):
            await self._ensure_cache(cache)
            resp = await self._topic.publish(cache, topic, payload)
            if isinstance(resp, TopicPublish.Error):
                raise RuntimeError(resp.message)

        async def subscribe(self, topic, cache=_DEFAULT_CACHE):
            await self._ensure_cache(cache)
            resp = await self._topic.subscribe(cache, topic)
            if isinstance(resp, TopicSubscribe.Error):
                raise RuntimeError(resp.message)

            async for item in resp:
                match item:
                    case TopicSubscriptionItem.Text():
                        yield item.value
                    case TopicSubscriptionItem.Binary():
                        yield item.value
                    case TopicSubscriptionItem.Error():
                        self._log.error("Stream closed: %s", item.inner_exception)
                        return

    return MomentoCacheEvents()
