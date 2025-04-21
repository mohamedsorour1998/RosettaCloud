"""
lab_service – facade + Web‑Socket proxy for interactive labs.
"""
from __future__ import annotations

import asyncio, base64, json, struct, uuid, logging, importlib, os
from typing import Any, Protocol

import websockets
from fastapi import WebSocket, WebSocketDisconnect

# ────────── load back‑end selected via LAB_BACKEND ───────────────────────
class _Backend(Protocol):
    async def init(self): ...
    async def close(self): ...
    async def launch(self, *, tag: str | None = None) -> str: ...
    async def exec_stream(self, lab_id: str) -> dict[str, Any]: ...
    async def stop(self, lab_id: str): ...

_backend = os.getenv("LAB_BACKEND", "ecs").lower()
_impl    = importlib.import_module("app.backends.lab_backends", package=__package__)
_IMPL: _Backend = getattr(_impl, f"get_{_backend}_backend")()

logging.getLogger(__name__).info("lab_service backend: %s", _backend)

init, close   = _IMPL.init, _IMPL.close
launch, stop  = _IMPL.launch, _IMPL.stop
_exec_stream  = _IMPL.exec_stream

# ────────── SSM frame helpers (binary) ───────────────────────────────────
# ‑‑‑ wrap stdin ----------------------------------------------------------
def _wrap(text: str) -> bytes:
    msg = {
        "MessageSchemaVersion": "1.0",
        "RequestId": str(uuid.uuid4()),
        "Channel": "stdin",
        "Payload": base64.b64encode(text.encode()).decode(),
    }
    raw = json.dumps(msg).encode()
    return struct.pack("<I", len(raw)) + raw + b"\0"

# ‑‑‑ unwrap stdout/stderr ------------------------------------------------
def _unwrap(data: bytes) -> str:
    raw = data[4:-1]          # strip length prefix & trailing 0x00
    doc = json.loads(raw)
    return base64.b64decode(doc["Payload"]).decode(errors="replace")

# ────────── proxy – attaches to FastAPI route /labs/{lab_id} ─────────────
async def proxy(ws: WebSocket, lab_id: str) -> None:
    cfg = await _exec_stream(lab_id)          # uri + kwargs
    uri = cfg.pop("uri")

    async with websockets.connect(uri, **cfg) as backend:

        async def browser_to_lab():
            try:
                async for text in ws.iter_text():
                    await backend.send(_wrap(text))
            except WebSocketDisconnect:
                await backend.close()

        async def lab_to_browser():
            async for data in backend:        # bytes frames → str
                await ws.send_text(_unwrap(data))

        await asyncio.gather(browser_to_lab(), lab_to_browser())
