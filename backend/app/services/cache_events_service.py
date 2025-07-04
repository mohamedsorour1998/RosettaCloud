"""
cache_events_service – unified async interface for cache + pub/sub.

Back‑end selector
------------------
    export CACHE_EVENTS_BACKEND=momento   # default
"""

from __future__ import annotations

import importlib
import logging
import os
from typing import AsyncGenerator, Protocol

DEFAULT_CACHE = os.getenv("CACHE_EVENTS_DEFAULT_CACHE", "interactive-labs")
DEFAULT_TTL   = int(os.getenv("CACHE_EVENTS_DEFAULT_TTL", "900"))

class _Backend(Protocol):
    async def init(self) -> None: ...
    async def close(self) -> None: ...
    async def set(self, cache: str, key: str, value: str | bytes, ttl: int | None = None) -> None: ...
    async def get(self, cache: str, key: str) -> str | bytes | None: ...
    async def publish(self, topic: str, payload: str | bytes, cache: str = DEFAULT_CACHE) -> None: ...
    async def subscribe(self, topic: str, cache: str = DEFAULT_CACHE) -> AsyncGenerator[str | bytes, None]: ...

_backend_name = os.getenv("CACHE_EVENTS_BACKEND", "momento").lower()

_module = importlib.import_module("app.backends.cache_events_backends", package=__package__)

try:
    _IMPL: _Backend = getattr(_module, f"get_{_backend_name}_backend")()
except AttributeError as exc:
    raise RuntimeError(
        f"Unsupported CACHE_EVENTS_BACKEND '{_backend_name}'. "
        "Choose 'momento'."
    ) from exc

logging.getLogger(__name__).info("cache_events_service backend: %s", _backend_name)

init      = _IMPL.init
close     = _IMPL.close
set       = _IMPL.set
get       = _IMPL.get
publish   = _IMPL.publish
subscribe = _IMPL.subscribe
