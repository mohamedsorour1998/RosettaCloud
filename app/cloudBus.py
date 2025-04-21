"""
cloudBus – unified async interface for cache + pub/sub.

Back‑end selection
------------------
    export CLOUD_BUS_BACKEND=momento   # default (fully working)
"""

from __future__ import annotations

import importlib
import logging
import os
from typing import AsyncGenerator, Protocol

# ────────────────────────── public defaults ────────────────────────────────
DEFAULT_CACHE = os.getenv("CLOUD_BUS_DEFAULT_CACHE", "interactive-labs")
DEFAULT_TTL   = int(os.getenv("CLOUD_BUS_DEFAULT_TTL", "900"))

# ────────────────────────── abstract interface ─────────────────────────────
class _Backend(Protocol):
    async def init(self) -> None: ...
    async def close(self) -> None: ...
    async def set(self, cache: str, key: str, value: str | bytes, ttl: int | None = None) -> None: ...
    async def get(self, cache: str, key: str) -> str | bytes | None: ...
    async def publish(self, topic: str, payload: str | bytes, cache: str = DEFAULT_CACHE) -> None: ...
    async def subscribe(self, topic: str, cache: str = DEFAULT_CACHE) -> AsyncGenerator[str | bytes, None]: ...

# ────────────────────────── load concrete back‑end ─────────────────────────
_backend_name = os.getenv("CLOUD_BUS_BACKEND", "momento").lower()

_module = importlib.import_module(".backends.cloud_backends", package=__package__)

try:
    _IMPL: _Backend = getattr(_module, f"get_{_backend_name}_backend")()
except AttributeError as exc:
    raise RuntimeError(
        f"Unsupported CLOUD_BUS_BACKEND '{_backend_name}'. "
        "Choose 'momento'."
    ) from exc

logging.getLogger(__name__).info("cloudBus backend: %s", _backend_name)

# ────────────────────────── facade re‑exports ──────────────────────────────
init      = _IMPL.init
close     = _IMPL.close
set       = _IMPL.set
get       = _IMPL.get
publish   = _IMPL.publish
subscribe = _IMPL.subscribe
