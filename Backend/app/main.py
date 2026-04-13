from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from typing import Annotated, Any, Optional, Dict, Union, List, Literal
from fastapi import FastAPI, HTTPException, status, Path, Depends
from pydantic import BaseModel, EmailStr, Field
from collections import defaultdict

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
    # Register the auto-terminate callback AFTER users.init so users_service
    # is ready when the janitor fires. The callback records the auto-killed
    # session against the user's weekly quota and releases per-user lab state
    # — without it, free-tier users who let their labs expire never have any
    # minutes deducted and can launch unlimited labs.
    lab.set_auto_terminate_callback(_on_lab_auto_terminated)
    await _load_stats_from_dynamodb()
    flush_task = asyncio.create_task(_stats_flush_loop())
    yield
    flush_task.cancel()
    await _flush_stats_to_dynamodb()
    await users.close()
    await lab.close()


async def _on_lab_auto_terminated(lab_id: str, owner_id: str) -> None:
    """Janitor callback: record session duration + release lab state for a
    lab that the background janitor auto-terminated (TTL expiry or quota cap).

    Mirrors the bookkeeping performed in the DELETE /labs/{lab_id} handler so
    that labs killed by the janitor are indistinguishable from labs killed by
    an explicit user action, from the quota's point of view.
    """
    if not owner_id:
        logger.warning("Auto-terminated lab %s has no owner — session unrecorded", lab_id)
        return
    try:
        minutes = await users.close_lab_session(owner_id)
        await users.unlink_lab_from_user(owner_id, lab_id)
        _track_event(owner_id, "lab_terminated")
        logger.info(
            "Auto-terminated lab %s: recorded %d min for user %s",
            lab_id, minutes, owner_id,
        )
    except Exception as exc:
        logger.error("Auto-terminate bookkeeping failed for lab %s user %s: %s",
                     lab_id, owner_id, exc)

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
# e.g. https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxx → us-east-1_xxx
_COGNITO_USER_POOL_ID = COGNITO_ISSUER_URL.rstrip("/").split("/")[-1] if COGNITO_ISSUER_URL else ""

_cognito_idp_client = None

def _get_cognito_client():
    global _cognito_idp_client
    if _cognito_idp_client is None:
        _cognito_idp_client = boto3.client("cognito-idp", region_name=_AGENT_REGION)
    return _cognito_idp_client

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


# ── Rate Limiting ──
# In-memory sliding window per user. Single-replica pod → fully reliable.
_rate_limits: dict[str, list[float]] = defaultdict(list)

# Limits: endpoint → (max_requests, window_seconds)
_RATE_LIMIT_CONFIG = {
    "chat": (30, 3600),       # 30 chat messages per hour
    "lab_create": (5, 3600),  # 5 lab creations per hour
    "lab_terminate": (10, 3600),  # 10 lab terminations per hour
}


# ── Analytics / Metrics ──
# In-memory per-user event counters. Single-replica pod → fully reliable.
# Structure: _metrics[user_id] = {"lab_started": N, "lab_terminated": N,
#   "question_attempted": N, "question_correct": N, "chat_message": N,
#   "first_seen": epoch, "last_seen": epoch}
_metrics: dict[str, dict[str, Any]] = {}
_metrics_global: dict[str, int] = defaultdict(int)  # aggregate counters

# DynamoDB config for persisting global counters across pod restarts
_STATS_TABLE = os.getenv("USERS_TABLE_NAME", "rosettacloud-users")
_STATS_PK = "STATS#global"
_stats_dirty = False  # tracks whether we need to flush to DynamoDB


async def _load_stats_from_dynamodb() -> None:
    """Seed in-memory global counters from DynamoDB on startup."""
    try:
        ddb = boto3.client("dynamodb", region_name=os.getenv("AWS_REGION", "us-east-1"))
        resp = await asyncio.to_thread(
            ddb.get_item,
            TableName=_STATS_TABLE,
            Key={"user_id": {"S": _STATS_PK}},
        )
        item = resp.get("Item", {})
        for key in ("lab_started", "question_attempted", "chat_message"):
            if key in item:
                _metrics_global[key] = int(item[key].get("N", 0))
        logger.info("Loaded global stats from DynamoDB: %s", dict(_metrics_global))
    except Exception as exc:
        logger.warning("Could not load stats from DynamoDB (will start from 0): %s", exc)


async def _flush_stats_to_dynamodb() -> None:
    """Write current global counters to DynamoDB."""
    global _stats_dirty
    if not _stats_dirty:
        return
    try:
        ddb = boto3.client("dynamodb", region_name=os.getenv("AWS_REGION", "us-east-1"))
        await asyncio.to_thread(
            ddb.put_item,
            TableName=_STATS_TABLE,
            Item={
                "user_id": {"S": _STATS_PK},
                "lab_started": {"N": str(_metrics_global.get("lab_started", 0))},
                "question_attempted": {"N": str(_metrics_global.get("question_attempted", 0))},
                "chat_message": {"N": str(_metrics_global.get("chat_message", 0))},
                "updated_at": {"N": str(int(time.time()))},
            },
        )
        _stats_dirty = False
    except Exception as exc:
        logger.warning("Could not flush stats to DynamoDB: %s", exc)


async def _stats_flush_loop() -> None:
    """Background task: flush stats to DynamoDB every 2 minutes."""
    while True:
        await asyncio.sleep(120)
        await _flush_stats_to_dynamodb()


def _track_event(user_id: str, event: str) -> None:
    """Record a user event for analytics."""
    global _stats_dirty
    now = time.time()
    if user_id not in _metrics:
        _metrics[user_id] = {
            "lab_started": 0, "lab_terminated": 0,
            "question_attempted": 0, "question_correct": 0,
            "chat_message": 0,
            "first_seen": now, "last_seen": now,
        }
    _metrics[user_id][event] = _metrics[user_id].get(event, 0) + 1
    _metrics[user_id]["last_seen"] = now
    _metrics_global[event] += 1
    _stats_dirty = True


def _check_rate_limit(user_id: str, action: str) -> None:
    """Raise 429 if user exceeds rate limit for the given action."""
    config = _RATE_LIMIT_CONFIG.get(action)
    if not config:
        return
    max_requests, window = config
    key = f"{user_id}:{action}"
    now = time.time()
    cutoff = now - window

    # Prune expired timestamps
    timestamps = _rate_limits[key]
    _rate_limits[key] = [t for t in timestamps if t > cutoff]

    if len(_rate_limits[key]) >= max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: max {max_requests} {action} requests per {window // 60} minutes. Please try again later.",
        )
    _rate_limits[key].append(now)


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


async def _require_user(user_id: str, email: str = "") -> Dict[str, Any]:
    """Fetch user profile from DynamoDB; raise 404 if not found.

    Falls back to email-based lookup for new users whose Cognito token
    only contains `sub` (not `custom:user_id`) on their first login.
    """
    user = await users.get_user(user_id)
    if not user and email:
        user = await users.get_user_by_email(email)
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

    # Backfill custom:user_id in Cognito so the ID token resolves on next login
    if _COGNITO_USER_POOL_ID:
        try:
            _get_cognito_client().admin_update_user_attributes(
                UserPoolId=_COGNITO_USER_POOL_ID,
                Username=user.email,
                UserAttributes=[{"Name": "custom:user_id", "Value": created_user["user_id"]}],
            )
        except Exception as _e:
            logger.warning("Could not set custom:user_id in Cognito for %s: %s", user.email, _e)

    return UserResponse(**created_user)


@app.get("/users/{user_id}", response_model=UserResponse, tags=["Users"])
async def get_user(user_id: str, claims: dict = Depends(get_current_user)):
    resolved_id = claims["resolved_user_id"]
    user = await _require_user(resolved_id, email=claims.get("email", ""))
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
    _check_rate_limit(user_id, "lab_create")

    await _require_user(user_id)

    active_lab = await users.get_active_lab(user_id)
    if active_lab:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active lab. Please terminate the existing lab first.",
        )

    # ── Weekly free-tier quota enforcement ────────────────────────────────
    # Read quota *before* launching. If the user has 0 minutes remaining,
    # refuse outright. Otherwise, cap the lab's TTL to the user's remaining
    # minutes so the janitor will auto-terminate the pod when quota runs out.
    quota = await users.get_lab_quota(user_id)
    minutes_remaining = int(quota.get("minutes_remaining", 0) or 0)
    if minutes_remaining <= 0:
        reset_at = int(quota.get("week_resets_at", 0) or 0)
        from datetime import datetime as _dt, timezone as _tz
        reset_str = (
            _dt.fromtimestamp(reset_at, tz=_tz.utc).strftime("%a %d %b %H:%M UTC")
            if reset_at else "next Monday"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Weekly free-tier lab quota exhausted "
                f"({quota.get('minutes_used', 0)}/{quota.get('minutes_limit', 120)} minutes used). "
                f"Quota resets on {reset_str}."
            ),
        )
    ttl_secs = minutes_remaining * 60

    lab_id = await lab.launch(ttl_secs=ttl_secs, owner_id=user_id)
    await users.set_active_lab(user_id, lab_id)
    await users.link_lab_to_user(user_id, lab_id)
    _track_event(user_id, "lab_started")
    return LabCreationResponse(lab_id=lab_id)


@app.get("/labs/{lab_id}", response_model=Union[LabInfoResponse, ErrorResponse], tags=["Labs"])
async def lab_info(lab_id: str, user_id: Optional[str] = None):
    info = await lab.get_lab_info(lab_id)
    if not info:
        if user_id:
            # Phantom-lab recovery: pod is gone (janitor killed it or pod crashed).
            # Record the session duration against the user's weekly quota before
            # clearing active_lab — otherwise users whose pod dies outside the
            # explicit DELETE path never pay for the time they actually used.
            await users.close_lab_session(user_id)
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
    _check_rate_limit(user_id, "lab_terminate")
    await _require_user(user_id)

    deleted = await lab.stop(lab_id)
    if deleted:
        # close_lab_session does the full bookkeeping atomically: computes
        # duration from lab_started_at, adds it to the weekly quota, and
        # clears active_lab/lab_started_at in a single DynamoDB update.
        await users.close_lab_session(user_id)
        await users.unlink_lab_from_user(user_id, lab_id)
        _track_event(user_id, "lab_terminated")
        return {"deleted": True}
    else:
        raise HTTPException(status_code=404, detail="Lab not found.")


@app.get("/users/{user_id}/lab-quota", tags=["Labs"])
async def get_lab_quota(
    user_id: str,
    claims: dict = Depends(get_current_user),
):
    resolved_id = claims["resolved_user_id"]
    await _require_user(resolved_id)
    return await users.get_lab_quota(resolved_id)


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
    _track_event(user_id, "question_attempted")
    if result["status"] == "success" and result["completed"]:
        _track_event(user_id, "question_correct")
        await users.track_user_progress(
            user_id, module_uuid, lesson_uuid, question_number, True
        )
    return result


@app.get("/users/{user_id}/ai-quota", tags=["Chat"])
async def get_ai_quota(
    user_id: str,
    claims: dict = Depends(get_current_user),
):
    resolved_id = claims["resolved_user_id"]
    await _require_user(resolved_id)
    return await users.get_ai_quota(resolved_id)


@app.post("/chat", response_model=ChatResponse, tags=["Chat"])
async def chat(request: ChatRequest, claims: dict = Depends(get_current_user)):
    if not _AGENT_RUNTIME_ARN:
        raise HTTPException(status_code=503, detail="AGENT_RUNTIME_ARN not configured")

    _check_rate_limit(claims["resolved_user_id"], "chat")
    _track_event(claims["resolved_user_id"], "chat_message")

    # Enforce weekly AI message quota for user-initiated chat messages
    if request.type == "chat":
        quota = await users.get_ai_quota(claims["resolved_user_id"])
        if quota["messages_remaining"] <= 0:
            raise HTTPException(
                status_code=403,
                detail={"code": "AI_QUOTA_EXHAUSTED", "quota": quota},
            )

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

    # Increment persisted AI message counter for user-initiated messages
    if request.type == "chat":
        try:
            await users.increment_ai_messages(claims["resolved_user_id"])
        except Exception as exc:
            logger.warning("Failed to increment AI message count: %s", exc)

    return ChatResponse(response=agent_response, agent=agent_name, session_id=session_id)


# ── Admin Metrics ──
@app.get("/admin/metrics", tags=["System"])
async def admin_metrics():
    """Aggregate platform metrics for pilot data collection.
    No auth — intended for internal/admin use only."""
    total_users = len(_metrics)
    aggregate = dict(_metrics_global)

    # Per-user breakdown
    per_user = {}
    for uid, m in _metrics.items():
        per_user[uid] = {
            k: v for k, v in m.items()
            if k not in ("first_seen", "last_seen")
        }
        per_user[uid]["active_minutes"] = round(
            (m["last_seen"] - m["first_seen"]) / 60, 1
        )

    # Derived stats
    attempted = aggregate.get("question_attempted", 0)
    correct = aggregate.get("question_correct", 0)
    accuracy = round(correct / attempted * 100, 1) if attempted else 0

    return {
        "total_users": total_users,
        "aggregate": aggregate,
        "accuracy_pct": accuracy,
        "per_user": per_user,
        "collected_since": min(
            (m["first_seen"] for m in _metrics.values()), default=None
        ),
    }


# Health check endpoint — no auth required (API GW routes it without JWT)
@app.get("/health-check", tags=["System"])
async def health_check():
    return {"status": "healthy", "timestamp": time.time()}


@app.get("/public/stats", tags=["Public"])
async def public_stats():
    """Public-safe platform counters — no auth, no per-user data."""
    return {
        "labs_launched": _metrics_global.get("lab_started", 0),
        "questions_answered": _metrics_global.get("question_attempted", 0),
        "ai_messages": _metrics_global.get("chat_message", 0),
        "total_users_seen": len(_metrics),
    }
