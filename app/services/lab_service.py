"""
lab_service – unified async interface to interactive labs.

Back‑end selector
------------------
    export LAB_BACKEND=eks   # default
"""
from __future__ import annotations

import logging, importlib, os
from typing import Any, Protocol, Dict, Optional

class _Backend(Protocol):
    async def init(self) -> None: ...
    async def close(self) -> None: ...
    async def launch(self, *, tag: str | None = None) -> str: ...
    async def stop(self, lab_id: str) -> bool: ...
    async def get_lab_info(self, lab_id: str) -> Optional[Dict[str,Any]]: ...
    async def get_ip(self, lab_id: str) -> Optional[str]: ...
    async def get_time_remaining(self, lab_id: str) -> Optional[Dict[str,int]]: ...
    
_backend = os.getenv("LAB_BACKEND", "eks").lower()
_impl_mod = importlib.import_module("app.backends.lab_backends")
_IMPL: _Backend = getattr(_impl_mod, f"get_{_backend}_backend")()
logging.getLogger(__name__).info("lab_service backend: %s", _backend)

init   = _IMPL.init
close  = _IMPL.close
launch = _IMPL.launch
stop   = _IMPL.stop

async def get_lab_info(lab_id: str) -> Optional[Dict[str,Any]]:
    return await _IMPL.get_lab_info(lab_id)

async def get_ip(lab_id: str) -> Optional[str]:
    return await _IMPL.get_ip(lab_id)

async def get_time_remaining(lab_id: str) -> Optional[Dict[str,int]]:
    return await _IMPL.get_time_remaining(lab_id)