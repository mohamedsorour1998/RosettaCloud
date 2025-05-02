from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from typing import Annotated, Any, Optional, Dict, Union, List
from fastapi import FastAPI, HTTPException, status, WebSocket, Path, Body, Query, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

import time

from app.services import cache_events_service as cache_events
from app.services import ai_service as ai
from app.services import labs_service as lab
from app.services import users_service as users
# Import the feedback service, but don't initialize it separately
# as it will hook into the AI service initialization
from app.services import feedback_service

from app.services.questions_service import QuestionService
from app.backends.questions_backends import QuestionBackend

question_backend = QuestionBackend()
questions_service = QuestionService(ai, question_backend)

# Startup / shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize services
    await cache_events.init()
    await ai.init()  # This will also initialize the feedback service
    await lab.init()
    await users.init()
    
    # Log that the app is ready
    print("Application fully initialized and ready")
    
    yield
    
    # Cleanup
    await users.close()
    await lab.close()
    await ai.close()  # This will also clean up the feedback service
    await cache_events.close()

app = FastAPI(
    title="RosettaCloud API",
    version="1.0.0",
    description="User management, caching, events, AI, and interactive labs",
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
    ttl: Optional[int] = Query(None, ge=1)

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
    prompt: str
    model_id: Optional[str] = None
    system_role: Optional[str] = None
    max_tokens: Optional[int] = 512
    temperature: Optional[float] = 0.5
    top_p: Optional[float] = 0.9

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
    index: Optional[int]

@app.post("/labs", status_code=201, response_model=LabCreationResponse, tags=["Labs"])
async def new_lab(request: LaunchLabRequest):
    user_id = request.user_id
    
    # Verify user exists
    await verify_user(user_id)
    
    # Check if the user already has an active lab in the cache
    active_lab = await cache_events.get("active_labs", user_id)
    if active_lab and active_lab != "null":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active lab. Please terminate the existing lab first."
        )

    # Launch lab
    lab_id = await lab.launch()
    
    # Store active lab in cache
    await cache_events.set("active_labs", user_id, lab_id)
    
    # Link lab to user
    await users.link_lab_to_user(user_id, lab_id)
    
    return LabCreationResponse(lab_id=lab_id)

@app.get("/labs/{lab_id}", response_model=Union[LabInfoResponse,ErrorResponse], tags=["Labs"])
async def lab_info(lab_id: str):
    info = await lab.get_lab_info(lab_id)
    if not info:
        return ErrorResponse(error="lab not found")
    return LabInfoResponse(**info)

@app.delete("/labs/{lab_id}", status_code=200, tags=["Labs"])
async def terminate_lab(lab_id: str, user_id: str):
    # Verify user exists
    await verify_user(user_id)
    
    # Stop lab
    deleted = await lab.stop(lab_id)
    
    if deleted:
        # Update cache
        await cache_events.set("active_labs", user_id, "null")
        
        # Unlink lab from user
        await users.unlink_lab_from_user(user_id, lab_id)
        
        return {"deleted": True}
    else:
        raise HTTPException(status_code=404, detail="Lab not found.")

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

# Health check endpoint
@app.get("/health-check", tags=["System"])
async def health_check():
    return {"status": "healthy", "timestamp": time.time()}