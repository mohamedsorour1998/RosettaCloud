"""
ai_service – unified async interface to LLM chat/stream.

Back‑end selector
-----------------
    export AI_BACKEND=nova      # default (Amazon Nova via Bedrock)
"""

from __future__ import annotations

import importlib
import logging
import os
from typing import AsyncGenerator, Protocol

# ─────────── abstract contract every back‑end must meet ────────────
class _AIBackend(Protocol):
    async def init(self) -> None: ...
    async def close(self) -> None: ...

    async def chat(
        self,
        prompt: str,
        *,
        stream: bool = False,
        **params,
    ) -> str | AsyncGenerator[str, None]: ...

_backend_name = os.getenv("AI_BACKEND", "nova").lower()

_module = importlib.import_module("app.backends.ai_backends")
try:
    _IMPL: _AIBackend = getattr(_module, f"get_{_backend_name}_backend")()
except AttributeError as exc:
    raise RuntimeError(
        f"Unsupported AI_BACKEND '{_backend_name}'. Choose 'nova'."
    ) from exc

logging.getLogger(__name__).info("ai_service backend: %s", _backend_name)

init   = _IMPL.init
close  = _IMPL.close
chat   = _IMPL.chat 
