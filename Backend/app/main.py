from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from typing import Annotated, Any, Optional, Dict, Union, List, Literal
from fastapi import FastAPI, HTTPException, status, Path, Depends
from pydantic import BaseModel, EmailStr, Field

import time
import json
import logging
import asyncio
import secrets
import os
import boto3

from app.services import labs_service as lab
from app.services import users_service as users

from app.services.questions_service import QuestionService
from app.backends.questions_backends import QuestionBackend
from app.dependencies.auth import get_current_user

question_backend = QuestionBackend()
questions_service = QuestionService(question_backend)

# Startup / shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    await lab.init()
    await users.init()
    yield
    await users.close()
    await lab.close()

app = FastAPI(
    title="RosettaCloud API",
    version="1.0.0",
    description="User management, interactive labs, and questions API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://dev.rosettacloud.app", "http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)

# ── AgentCore chat ──
_AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN", "")
_AGENT_REGION = os.environ.get("AWS_REGION", "us-east-1")
COGNITO_ISSUER_URL = os.environ.get("COGNITO_ISSUER_URL", "")

_agentcore_client = None

def _get_agentcore_client():
    global _agentcore_client
    if _agentcore_client is None:
        _agentcore_client = boto3.client("bedrock-agentcore", region_name=_AGENT_REGION)
    return _agentcore_client

# In-process chat history — same pattern as questions_backends.py _cache dict.
# Single-replica pod → fully reliable for session continuity.
_chat_histories: dict = {}
_CHAT_HISTORY_TTL = 14400   # 4 hours
_CHAT_MAX_MESSAGES = 40     # 20 turns
_CHAT_MAX_SESSIONS = 500    # evict oldest when dict exceeds this limit

def _chat_history_get(session_id: str) -> list:
    entry = _chat_histories.get(session_id)
    if entry and time.time() - entry[0] < _CHAT_HISTORY_TTL:
        return entry[1]
    _chat_histories.pop(session_id, None)
    return []

def _chat_history_set(session_id: str, history: list) -> None:
    _chat_histories[session_id] = (time.time(), history)

# User Management
class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: str = "user"
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class UserResponse(BaseModel):
    user_id: str
    email: str
    name: str
    role: str
    created_at: Optional[int] = None
    updated_at: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None

class UserList(BaseModel):
    users: List[UserResponse]
    count: int
    last_key: Optional[str] = None

class UserProgressUpdate(BaseModel):
    completed: bool

class ErrorResponse(BaseModel):
    error: str


async def _require_user(user_id: str) -> Dict[str, Any]:
    """Fetch user profile from DynamoDB; raise 404 if not found."""
    user = await users.get_user(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )
    return user


@app.post("/users", response_model=UserResponse, status_code=201, tags=["Users"])
async def create_user(user: UserCreate):
    existing = await users.get_user_by_email(user.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User with email {user.email} already exists",
        )
    user_data = user.dict()
    created_user = await users.create_user(user_data)
    return UserResponse(**created_user)


@app.get("/users/{user_id}", response_model=UserResponse, tags=["Users"])
async def get_user(user_id: str, claims: dict = Depends(get_current_user)):
    resolved_id = claims["resolved_user_id"]
    user = await _require_user(resolved_id)
    return UserResponse(**user)


@app.get("/users", response_model=UserList, tags=["Users"])
async def list_users(limit: int = 100, last_key: Optional[str] = None):
    result = await users.list_users(limit, last_key)
    return UserList(**result)


@app.put("/users/{user_id}", response_model=UserResponse, tags=["Users"])
async def update_user(
    user_id: str,
    update: UserUpdate,
    claims: dict = Depends(get_current_user),
):
    resolved_id = claims["resolved_user_id"]
    await _require_user(resolved_id)
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    updated_user = await users.update_user(resolved_id, update_data)
    if not updated_user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user",
        )
    return UserResponse(**updated_user)


@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Users"])
async def delete_user(user_id: str, claims: dict = Depends(get_current_user)):
    resolved_id = claims["resolved_user_id"]
    await _require_user(resolved_id)
    success = await users.delete_user(resolved_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete user",
        )


@app.get("/users/{user_id}/labs", tags=["Users"])
async def get_user_labs(user_id: str, claims: dict = Depends(get_current_user)):
    resolved_id = claims["resolved_user_id"]
    await _require_user(resolved_id)
    labs = await users.get_user_labs(resolved_id)
    return {"labs": labs}


@app.get("/users/{user_id}/progress", tags=["Users"])
async def get_user_progress(
    user_id: str,
    claims: dict = Depends(get_current_user),
    module_uuid: Optional[str] = None,
    lesson_uuid: Optional[str] = None,
):
    resolved_id = claims["resolved_user_id"]
    await _require_user(resolved_id)
    progress = await users.get_user_progress(resolved_id, module_uuid, lesson_uuid)
    return {"progress": progress}


@app.post(
    "/users/{user_id}/progress/{module_uuid}/{lesson_uuid}/{question_number}",
    tags=["Users"],
)
async def update_user_progress(
    user_id: str,
    module_uuid: str,
    lesson_uuid: str,
    question_number: int,
    progress: UserProgressUpdate,
    claims: dict = Depends(get_current_user),
):
    resolved_id = claims["resolved_user_id"]
    await _require_user(resolved_id)
    success = await users.track_user_progress(
        resolved_id, module_uuid, lesson_uuid, question_number, progress.completed
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update progress",
        )
    return {"updated": True}


# Pydantic models for request/response
class LaunchLabRequest(BaseModel):
    user_id: Optional[str] = None  # Kept for backward compat; user identity comes from JWT

class LabCreationResponse(BaseModel):
    lab_id: str

class LabInfoResponse(BaseModel):
    lab_id: str
    pod_ip: Optional[str]
    hostname: Optional[str] = None
    url: Optional[str] = None
    time_remaining: Optional[Dict[str, int]]
    status: str
    pod_name: Optional[str] = None


@app.post("/labs", status_code=201, response_model=LabCreationResponse, tags=["Labs"])
async def new_lab(
    request: LaunchLabRequest,
    claims: dict = Depends(get_current_user),
):
    user_id = claims["resolved_user_id"]

    await _require_user(user_id)

    active_lab = await users.get_active_lab(user_id)
    if active_lab:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active lab. Please terminate the existing lab first.",
        )

    lab_id = await lab.launch()
    await users.set_active_lab(user_id, lab_id)
    await users.link_lab_to_user(user_id, lab_id)
    return LabCreationResponse(lab_id=lab_id)


@app.get("/labs/{lab_id}", response_model=Union[LabInfoResponse, ErrorResponse], tags=["Labs"])
async def lab_info(lab_id: str, user_id: Optional[str] = None):
    info = await lab.get_lab_info(lab_id)
    if not info:
        if user_id:
            await users.clear_active_lab(user_id)
        return ErrorResponse(error="lab not found")
    return LabInfoResponse(
        lab_id=info["lab_id"],
        pod_ip=info.get("pod_ip"),
        hostname=info.get("hostname"),
        url=info.get("url"),
        time_remaining=info.get("time_remaining"),
        status=info["status"],
        pod_name=info.get("pod_name"),
    )


@app.delete("/labs/{lab_id}", status_code=200, tags=["Labs"])
async def terminate_lab(
    lab_id: str,
    claims: dict = Depends(get_current_user),
):
    user_id = claims["resolved_user_id"]
    await _require_user(user_id)

    deleted = await lab.stop(lab_id)
    if deleted:
        await users.clear_active_lab(user_id)
        await users.unlink_lab_from_user(user_id, lab_id)
        return {"deleted": True}
    else:
        raise HTTPException(status_code=404, detail="Lab not found.")


# Chat
class ChatRequest(BaseModel):
    message: str = ""
    user_id: str = ""
    session_id: str = ""
    module_uuid: str = ""
    lesson_uuid: str = ""
    type: str = "chat"
    question_number: int = 0
    result: str = ""
    image: str = Field(default="", max_length=2_000_000)  # base64 JPEG for multimodal terminal analysis (~1.5MB cap)

class ChatResponse(BaseModel):
    response: str
    agent: str
    session_id: str

# Questions
class QuestionRequest(BaseModel):
    pod_name: str

class QuestionCheckRequest(QuestionRequest):
    pass


@app.get("/questions/{module_uuid}/{lesson_uuid}", tags=["Questions"])
async def get_questions(
    module_uuid: str,
    lesson_uuid: str,
    claims: dict = Depends(get_current_user),
):
    user_id = claims["resolved_user_id"]
    await _require_user(user_id)
    result = await questions_service.get_questions(module_uuid, lesson_uuid, user_id)
    return result


@app.post("/questions/{module_uuid}/{lesson_uuid}/{question_number}/setup", tags=["Questions"])
async def setup_question(
    module_uuid: str,
    lesson_uuid: str,
    question_number: int,
    request: QuestionRequest,
    claims: dict = Depends(get_current_user),
):
    user_id = claims["resolved_user_id"]
    await _require_user(user_id)
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
    request: QuestionCheckRequest,
    claims: dict = Depends(get_current_user),
):
    user_id = claims["resolved_user_id"]
    await _require_user(user_id)
    result = await questions_service.execute_question_check(
        request.pod_name, module_uuid, lesson_uuid, question_number
    )
    if result["status"] == "success" and result["completed"]:
        await users.track_user_progress(
            user_id, module_uuid, lesson_uuid, question_number, True
        )
    return result


@app.post("/chat", response_model=ChatResponse, tags=["Chat"])
async def chat(request: ChatRequest):
    if not _AGENT_RUNTIME_ARN:
        raise HTTPException(status_code=503, detail="AGENT_RUNTIME_ARN not configured")

    session_id = request.session_id
    # session_start and explain must not read or write session history:
    # session_start response is assistant-only (no preceding user turn) which
    # would cause Bedrock ValidationException on the next real user message.
    _skip_history = request.type in ("explain", "session_start")
    history = [] if _skip_history else (
        _chat_history_get(session_id) if session_id else []
    )

    runtime_session_id = session_id
    if len(runtime_session_id) < 33:
        runtime_session_id = session_id + "-" + secrets.token_hex(8)

    payload = {
        "message": request.message,
        "user_id": request.user_id,
        "session_id": session_id,
        "type": request.type,
        "module_uuid": request.module_uuid,
        "lesson_uuid": request.lesson_uuid,
        "conversation_history": history,
    }
    if request.type == "grade":
        payload["question_number"] = request.question_number
        payload["result"] = request.result
    if request.image:
        try:
            import base64 as _b64
            raw = request.image.split(",")[-1] if "," in request.image else request.image
            decoded = _b64.b64decode(raw, validate=True)
            if not decoded[:3] == b'\xff\xd8\xff':
                raise HTTPException(status_code=400, detail="image must be a JPEG")
        except Exception:
            raise HTTPException(status_code=400, detail="image must be valid base64 JPEG")
        payload["image"] = request.image

    def _invoke():
        import boto3
        client = boto3.client("bedrock-agentcore", region_name=_AGENT_REGION)
        resp = client.invoke_agent_runtime(
            agentRuntimeArn=_AGENT_RUNTIME_ARN,
            runtimeSessionId=runtime_session_id,
            payload=json.dumps(payload),
            qualifier="DEFAULT",
        )
        return json.loads(resp["response"].read())

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _invoke)
    except Exception as e:
        logger.error("AgentCore invocation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Agent error: {e}")

    agent_response = result.get("response", "")
    agent_name = result.get("agent", "tutor")

    if session_id and not _skip_history:
        updated = history + [
            {"role": "user", "text": request.message},
            {"role": "assistant", "text": agent_response},
        ]
        if len(updated) > _CHAT_MAX_MESSAGES:
            updated = updated[-_CHAT_MAX_MESSAGES:]
        _chat_history_set(session_id, updated)

    return ChatResponse(response=agent_response, agent=agent_name, session_id=session_id)


# Health check endpoint — no auth required (API GW routes it without JWT)
@app.get("/health-check", tags=["System"])
async def health_check():
    return {"status": "healthy", "timestamp": time.time()}
