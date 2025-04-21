from contextlib import asynccontextmanager
from typing import Annotated, Optional

from fastapi import FastAPI, WebSocket, Path, Body, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app import cloudBus as cloud
from app import AIBus   as ai
from app import labBus  as lab

# ───────────── lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(_: FastAPI):
    await cloud.init(); await ai.init(); await lab.init()
    yield
    await lab.close(); await ai.close(); await cloud.close()

app = FastAPI(
    title="RosettaCloud API",
    version="1.0.0",
    description="Caching, events, AI, and interactive labs",
    lifespan=lifespan,
)

# ───────────── Cache endpoints ────────────────────────────────
class CacheItem(BaseModel):
    value: str
    ttl: Optional[int] = Query(None, ge=1)

@app.post("/cache/{cache}/{key}", tags=["Cache"])
async def cache_put(
    cache: Annotated[str, Path()], key: Annotated[str, Path()], item: CacheItem
):
    await cloud.set(cache, key, item.value, item.ttl)
    return {"stored": key, "cache": cache, "ttl": item.ttl or cloud.DEFAULT_TTL}

@app.get("/cache/{cache}/{key}", tags=["Cache"])
async def cache_get(cache: Annotated[str, Path()], key: Annotated[str, Path()]):
    val = await cloud.get(cache, key)
    return {"value": val, "hit": val is not None}

# ───────────── Topic endpoints (unchanged) ────────────────────────────────
@app.post("/events/{topic}", tags=["Events"])
async def publish_event(topic: Annotated[str, Path()], payload: Annotated[str, Body(embed=True)]):
    await cloud.publish(topic, payload)
    return {"published": topic}

@app.websocket("/ws/events/{topic}")
async def event_stream(ws: WebSocket, topic: str):
    await ws.accept()
    async for msg in cloud.subscribe(topic):
        await ws.send_text(msg)

# ───────────── AI streaming endpoint ──────────────────────────
class Prompt(BaseModel):
    prompt: str
    model_id: Optional[str]      = None
    system_role: Optional[str]   = None
    max_tokens: Optional[int]    = 512
    temperature: Optional[float] = 0.5
    top_p: Optional[float]       = 0.9

@app.post("/ai/chat", tags=["AI"])
async def chat_endpoint(body: Prompt):
    async def _gen():
        async for chunk in (
            await ai.chat(
                body.prompt,
                stream=True,
                model_id=body.model_id,
                system_role=body.system_role,
                max_tokens=body.max_tokens,
                temperature=body.temperature,
                top_p=body.top_p,
            )
        ):
            yield chunk
    return StreamingResponse(_gen(), media_type="text/plain")

# ───────────── Labs endpoints ─────────────────────────────────────────────
@app.post("/labs", tags=["Labs"], status_code=201)
async def new_lab(): return {"lab_id": await lab.launch()}

@app.websocket("/labs/{lab_id}")
async def labs_ws(ws: WebSocket, lab_id: str):
    await ws.accept()
    try:
        await lab.proxy(ws, lab_id)
    except RuntimeError as exc:
        await ws.send_json({"error": str(exc)})
        await ws.close(code=4404)