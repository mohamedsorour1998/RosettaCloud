"""
labs_service – unified async interface to interactive labs.

Select the concrete backend with:
    export LAB_BACKEND=eks   # default
"""
from __future__ import annotations

import importlib
import logging
import os
from typing import Any, Awaitable, Callable, Dict, Optional, Protocol


class _Backend(Protocol):
    async def init(self) -> None: ...
    async def close(self) -> None: ...
    async def launch(
        self,
        *,
        tag: str | None = None,
        ttl_secs: Optional[int] = None,
        owner_id: str = "",
    ) -> str: ...
    async def stop(self, lab_id: str) -> bool: ...
    async def get_lab_info(self, lab_id: str) -> Optional[Dict[str, Any]]: ...
    async def get_ip(self, lab_id: str) -> Optional[str]: ...
    async def get_time_remaining(self, lab_id: str) -> Optional[Dict[str, int]]: ...
    def set_auto_terminate_callback(
        self, cb: Callable[[str, str], Awaitable[None]]
    ) -> None: ...


_backend_name = os.getenv("LAB_BACKEND", "eks").lower()
_impl_mod = importlib.import_module("app.backends.labs_backends")
_IMPL: _Backend = getattr(_impl_mod, f"get_{_backend_name}_backend")()

logging.getLogger(__name__).info("labs_service backend: %s", _backend_name)

init = _IMPL.init
close = _IMPL.close
launch = _IMPL.launch
stop = _IMPL.stop
get_lab_info = _IMPL.get_lab_info
get_ip = _IMPL.get_ip
get_time_remaining = _IMPL.get_time_remaining
set_auto_terminate_callback = _IMPL.set_auto_terminate_callback