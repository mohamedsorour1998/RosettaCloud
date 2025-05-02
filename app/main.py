from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware

from typing import Annotated, Optional, Dict, Union

from fastapi import FastAPI, HTTPException, status, WebSocket, Path, Body, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services import cache_events_service as cache_events
from app.services import ai_service           as ai
from app.services import lab_service          as lab

from app.services.questions_service import QuestionService
from app.backends.questions_backends import QuestionBackend

question_backend = QuestionBackend()
questions_service = QuestionService(ai, question_backend)

#startup / shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    await cache_events.init()
    await ai.init()
    await lab.init()
    yield
    await lab.close()
    await ai.close()
    await cache_events.close()

app = FastAPI(
    title="RosettaCloud API",
    version="1.0.0",
    description="Caching, events, AI, and interactive labs",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache / Events
class CacheItem(BaseModel):
    value: str
    ttl:   Optional[int] = Query(None, ge=1)

@app.post("/cache/{cache}/{key}", tags=["Cache"])
async def cache_put(cache: Annotated[str,Path()], key: Annotated[str,Path()], item: CacheItem):
    await cache_events.set(cache, key, item.value, item.ttl)
    return {"stored":key,"cache":cache,"ttl":item.ttl or cache_events.DEFAULT_TTL}

@app.get("/cache/{cache}/{key}", tags=["Cache"])
async def cache_get(cache: Annotated[str,Path()], key: Annotated[str,Path()]):
    val = await cache_events.get(cache, key)
    return {"value":val,"hit":val is not None}

@app.post("/events/{topic}", tags=["Events"])
async def publish_event(topic: Annotated[str,Path()], payload: Annotated[str,Body(embed=True)]):
    await cache_events.publish(topic, payload)
    return {"published":topic}

@app.websocket("/ws/events/{topic}")
async def event_stream(ws: WebSocket, topic: str):
    await ws.accept()
    async for msg in cache_events.subscribe(topic):
        await ws.send_text(msg)

# AI streaming
class Prompt(BaseModel):
    prompt:      str
    model_id:    Optional[str]   = None
    system_role: Optional[str]   = None
    max_tokens:  Optional[int]   = 512
    temperature: Optional[float] = 0.5
    top_p:       Optional[float] = 0.9

@app.post("/ai/chat", tags=["AI"])
async def chat_endpoint(body: Prompt):
    async def gen():
        async for chunk in await ai.chat(
            body.prompt,
            stream=True,
            model_id=body.model_id,
            system_role=body.system_role,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
            top_p=body.top_p,
        ):
            yield chunk
    return StreamingResponse(gen(), media_type="text/plain")

# Labs management
class LaunchLabRequest(BaseModel):
    user_id: str
    
class LabCreationResponse(BaseModel):
    lab_id: str

class LabInfoResponse(BaseModel):
    lab_id: str
    pod_ip: Optional[str]
    time_remaining: Optional[Dict[str,int]]
    status: str
    idx: Optional[int]

class ErrorResponse(BaseModel):
    error: str

@app.post("/labs", status_code=201, response_model=LabCreationResponse, tags=["Labs"])
async def new_lab(request: LaunchLabRequest):
    user_id = request.user_id
    # Check if the user already has an active lab in the cache
    active_lab = await cache_events.get("active_labs", user_id)
    if active_lab and active_lab != "null":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active lab. Please terminate the existing lab first."
        )

    lab_id = await lab.launch()
    
    await cache_events.set("active_labs", user_id, lab_id)
    
    return LabCreationResponse(lab_id=lab_id)


@app.get("/labs/{lab_id}", response_model=Union[LabInfoResponse,ErrorResponse], tags=["Labs"])
async def lab_info(lab_id: str):
    info = await lab.get_lab_info(lab_id)
    if not info:
        return ErrorResponse(error="lab not found")
    return LabInfoResponse(**info)

@app.delete("/labs/{lab_id}", status_code=200, tags=["Labs"])
async def terminate_lab(lab_id: str, user_id: str):
    deleted = await lab.stop(lab_id)
    if deleted:
        await cache_events.set("active_labs", user_id, "null")
        return {"deleted": True}
    else:
        raise HTTPException(status_code=404, detail="Lab not found.")

class QuestionRequest(BaseModel):
    pod_name: str
    
class QuestionCheckRequest(QuestionRequest):
    pass

@app.get("/questions/{module_uuid}/{lesson_uuid}", tags=["Questions"])
async def get_questions(module_uuid: str, lesson_uuid: str, user_id: str):
    result = await questions_service.get_questions(module_uuid, lesson_uuid, user_id)
    return result

@app.post("/questions/{module_uuid}/{lesson_uuid}/{question_number}/setup", tags=["Questions"])
async def setup_question(
    module_uuid: str, 
    lesson_uuid: str, 
    question_number: int, 
    request: QuestionRequest
):
    result = await questions_service.execute_question_setup(
        request.pod_name, module_uuid, lesson_uuid, question_number
    )
    
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.post("/questions/{module_uuid}/{lesson_uuid}/{question_number}/check", tags=["Questions"])
async def check_question(
    module_uuid: str, 
    lesson_uuid: str, 
    question_number: int, 
    request: QuestionCheckRequest
):
    result = await questions_service.execute_question_check(
        request.pod_name, module_uuid, lesson_uuid, question_number
    )
    return result
