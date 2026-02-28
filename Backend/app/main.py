from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from typing import Annotated, Any, Optional, Dict, Union, List
from fastapi import FastAPI, HTTPException, status, Path, Depends
from pydantic import BaseModel, EmailStr, Field

import time
import json
import logging
import asyncio
import secrets
import os

from app.services import labs_service as lab
from app.services import users_service as users

from app.services.questions_service import QuestionService
from app.backends.questions_backends import QuestionBackend

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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)

# ── AgentCore chat ──
_AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN", "")
_AGENT_REGION = os.environ.get("AWS_REGION", "us-east-1")

# In-process chat history — same pattern as questions_backends.py _cache dict.
# Single-replica pod → fully reliable for session continuity.
_chat_histories: dict = {}
_CHAT_HISTORY_TTL = 14400   # 4 hours
_CHAT_MAX_MESSAGES = 40     # 20 turns

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

# Dependency to verify user exists
async def verify_user(user_id: str) -> Dict[str, Any]:
    user = await users.get_user(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {user_id} not found"
        )
    return user

@app.post("/users", response_model=UserResponse, status_code=201, tags=["Users"])
async def create_user(user: UserCreate):
    # Check if email already exists
    existing = await users.get_user_by_email(user.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User with email {user.email} already exists"
        )
    
    # Create user
    user_data = user.dict()
    created_user = await users.create_user(user_data)
    
    return UserResponse(**created_user)

@app.get("/users/{user_id}", response_model=UserResponse, tags=["Users"])
async def get_user(user: Dict[str, Any] = Depends(verify_user)):
    return UserResponse(**user)

@app.get("/users", response_model=UserList, tags=["Users"])
async def list_users(limit: int = 100, last_key: Optional[str] = None):
    result = await users.list_users(limit, last_key)
    return UserList(**result)

@app.put("/users/{user_id}", response_model=UserResponse, tags=["Users"])
async def update_user(user_id: str, update: UserUpdate):
    # Verify user exists
    await verify_user(user_id)
    
    # Update user
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    updated_user = await users.update_user(user_id, update_data)
    
    if not updated_user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user"
        )
    
    return UserResponse(**updated_user)

@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Users"])
async def delete_user(user_id: str):
    # Verify user exists
    await verify_user(user_id)
    
    # Delete user
    success = await users.delete_user(user_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete user"
        )

@app.get("/users/{user_id}/labs", tags=["Users"])
async def get_user_labs(user_id: str):
    # Verify user exists
    await verify_user(user_id)
    
    # Get user labs
    labs = await users.get_user_labs(user_id)
    
    return {"labs": labs}

@app.get("/users/{user_id}/progress", tags=["Users"])
async def get_user_progress(
    user_id: str,
    module_uuid: Optional[str] = None,
    lesson_uuid: Optional[str] = None
):
    # Verify user exists
    await verify_user(user_id)
    
    # Get user progress
    progress = await users.get_user_progress(user_id, module_uuid, lesson_uuid)
    
    return {"progress": progress}

@app.post("/users/{user_id}/progress/{module_uuid}/{lesson_uuid}/{question_number}", tags=["Users"])
async def update_user_progress(
    user_id: str,
    module_uuid: str,
    lesson_uuid: str,
    question_number: int,
    progress: UserProgressUpdate
):
    # Verify user exists
    await verify_user(user_id)
    
    # Update progress
    success = await users.track_user_progress(
        user_id, module_uuid, lesson_uuid, question_number, progress.completed
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update progress"
        )
    
    return {"updated": True}

# Pydantic models for request/response
class LaunchLabRequest(BaseModel):
    user_id: str
    
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

# FastAPI routes
@app.post("/labs", status_code=201, response_model=LabCreationResponse, tags=["Labs"])
async def new_lab(request: LaunchLabRequest):
    user_id = request.user_id

    # Verify user exists
    await verify_user(user_id)

    # Check if the user already has an active lab
    active_lab = await users.get_active_lab(user_id)
    if active_lab:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active lab. Please terminate the existing lab first."
        )

    # Launch lab
    lab_id = await lab.launch()

    # Store active lab in DynamoDB
    await users.set_active_lab(user_id, lab_id)

    # Link lab to user
    await users.link_lab_to_user(user_id, lab_id)

    return LabCreationResponse(lab_id=lab_id)

@app.get("/labs/{lab_id}", response_model=Union[LabInfoResponse, ErrorResponse], tags=["Labs"])
async def lab_info(lab_id: str, user_id: Optional[str] = None):
    info = await lab.get_lab_info(lab_id)
    if not info:
        # Pod is gone — clear active lab so the user can create a new one
        if user_id:
            await users.clear_active_lab(user_id)
        return ErrorResponse(error="lab not found")
    
    # Convert to the response model
    response_data = {
        "lab_id": info["lab_id"],
        "pod_ip": info.get("pod_ip"),
        "hostname": info.get("hostname"),
        "url": info.get("url"),
        "time_remaining": info.get("time_remaining"),
        "status": info["status"],
        "pod_name": info.get("pod_name")
    }
    
    return LabInfoResponse(**response_data)

@app.delete("/labs/{lab_id}", status_code=200, tags=["Labs"])
async def terminate_lab(lab_id: str, user_id: str):
    # Verify user exists
    await verify_user(user_id)
    
    # Stop lab
    deleted = await lab.stop(lab_id)
    
    if deleted:
        # Clear active lab
        await users.clear_active_lab(user_id)

        # Unlink lab from user
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
async def get_questions(module_uuid: str, lesson_uuid: str, user_id: str):
    # Verify user exists
    await verify_user(user_id)
    
    # Get questions
    result = await questions_service.get_questions(module_uuid, lesson_uuid, user_id)
    
    return result

@app.post("/questions/{module_uuid}/{lesson_uuid}/{question_number}/setup", tags=["Questions"])
async def setup_question(
    module_uuid: str, 
    lesson_uuid: str, 
    question_number: int, 
    request: QuestionRequest,
    user_id: str
):
    # Verify user exists
    await verify_user(user_id)
    
    # Setup question
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
    user_id: str
):
    # Verify user exists
    await verify_user(user_id)
    
    # Check question
    result = await questions_service.execute_question_check(
        request.pod_name, module_uuid, lesson_uuid, question_number
    )
    
    # If successful, update user progress
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
    history = _chat_history_get(session_id) if session_id else []

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

    if session_id:
        updated = history + [
            {"role": "user", "text": request.message},
            {"role": "assistant", "text": agent_response},
        ]
        if len(updated) > _CHAT_MAX_MESSAGES:
            updated = updated[-_CHAT_MAX_MESSAGES:]
        _chat_history_set(session_id, updated)

    return ChatResponse(response=agent_response, agent=agent_name, session_id=session_id)

# Health check endpoint
@app.get("/health-check", tags=["System"])
async def health_check():
    return {"status": "healthy", "timestamp": time.time()}