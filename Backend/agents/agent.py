"""RosettaCloud Multi-Agent Education Platform — AgentCore Runtime entrypoint.

Version: 3.0 — CLI deployment, AgentCoreMemorySessionManager.
"""

import json
import logging
import os
import re
import boto3
import traceback

from bedrock_agentcore import BedrockAgentCoreApp

try:
    from bedrock_agentcore.memory.integrations.strands.session_manager import (
        AgentCoreMemoryConfig,
        AgentCoreMemorySessionManager,
    )
except ImportError:
    AgentCoreMemorySessionManager = None
    AgentCoreMemoryConfig = None

from strands import Agent
from strands.models.bedrock import BedrockModel

import time
import urllib.request
import urllib.parse

from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from prompts import (
    TUTOR_PROMPT,
    GRADER_PROMPT,
    PLANNER_PROMPT,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()

REGION = os.environ.get("AWS_REGION", "us-east-1")
MEMORY_ID = os.environ.get("BEDROCK_AGENTCORE_MEMORY_ID")

GATEWAY_URL           = os.environ.get("GATEWAY_URL", "")
COGNITO_TOKEN_URL     = os.environ.get("COGNITO_TOKEN_URL", "")
COGNITO_CLIENT_ID     = os.environ.get("COGNITO_CLIENT_ID", "")
COGNITO_CLIENT_SECRET = os.environ.get("COGNITO_CLIENT_SECRET", "")

# Token cache: (access_token, expiry_timestamp)
_token_cache: tuple = ("", 0.0)


def _get_bearer_token() -> str:
    """Fetch a Cognito client-credentials token, cached until 60s before expiry."""
    global _token_cache
    if not COGNITO_TOKEN_URL or not COGNITO_CLIENT_ID or not COGNITO_CLIENT_SECRET:
        raise RuntimeError(
            "Gateway auth not configured: COGNITO_TOKEN_URL, COGNITO_CLIENT_ID, "
            "and COGNITO_CLIENT_SECRET must all be set"
        )
    token, expiry = _token_cache
    if token and time.time() < expiry - 60:
        return token

    data = urllib.parse.urlencode({
        "grant_type":    "client_credentials",
        "client_id":     COGNITO_CLIENT_ID,
        "client_secret": COGNITO_CLIENT_SECRET,
        "scope":         "rosettacloud-agents/invoke",
    }).encode()
    req = urllib.request.Request(COGNITO_TOKEN_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = json.loads(resp.read())
    token  = body["access_token"]
    expiry = time.time() + body.get("expires_in", 3600)
    _token_cache = (token, expiry)
    logger.info("Cognito token refreshed, expires in %ds", int(expiry - time.time()))
    return token


# ── Lazy-initialized globals ──
_model = None
_bedrock = None
_init_error = None

# ── In-process session history (survives across requests within same container) ──
# Note: concurrent requests for the same session_id can race on the save step.
# This is low probability (frontend is sequential) and acceptable — AgentCore Memory
# is the durable store; in-process dict is a best-effort short-term cache.
_session_histories: dict = {}  # session_id -> list of Strands message dicts
MAX_HISTORY_TURNS = 20  # keep last 20 message pairs to avoid unbounded context growth
MAX_SESSIONS = 500  # evict oldest when dict exceeds this limit


CLASSIFIER_PROMPT = """\
Classify the student's intent into exactly one category. Reply with ONLY the category name.

Categories:
- tutor: concept questions, "what is...", "how do I...", help with Linux/Docker/Kubernetes
- grader: grading, feedback, "how am I doing?", auto-grade messages
- planner: "what should I learn next?", progress, learning path advice

Reply with one word: tutor, grader, or planner."""


# Tool names each agent is allowed to use via the Gateway MCP server.
# Use simple underscore names (no prefix) — these are the normalized display names
# presented to the Bedrock model. MCP tools are renamed on-the-fly in invoke().
_AGENT_TOOL_NAMES = {
    "tutor":   {"search_knowledge_base", "get_question_details", "get_question_metadata"},
    "grader":  {"get_question_details", "get_user_progress", "get_attempt_result"},
    "planner": {"get_user_progress", "list_available_modules", "get_question_metadata"},
}


def _normalize_tool_name(mcp_name: str) -> str:
    """Convert MCP gateway tool name to a Bedrock-compatible identifier.

    'education-tools___search-knowledge-base' → 'search_knowledge_base'
    """
    # Strip target prefix (everything up to and including '___')
    bare = mcp_name.split("___", 1)[-1] if "___" in mcp_name else mcp_name
    return bare.replace("-", "_")

AGENT_CONFIGS = {
    "tutor":   (TUTOR_PROMPT,   None),   # tools injected at runtime via MCPClient
    "grader":  (GRADER_PROMPT,  None),
    "planner": (PLANNER_PROMPT, None),
}


def _init():
    global _model, _bedrock, _init_error
    if _model is not None:
        return

    try:
        _bedrock = boto3.client("bedrock-runtime", region_name=REGION)
        _model = BedrockModel(
            model_id=os.environ.get("NOVA_MODEL_ID", "us.amazon.nova-2-lite-v1:0"),
            region_name=REGION,
        )
        logger.info("Model initialized. Memory SDK available: %s, MEMORY_ID: %s",
                     AgentCoreMemorySessionManager is not None, MEMORY_ID)
    except Exception as e:
        _init_error = f"{e}\n{traceback.format_exc()}"
        logger.error("Init failed: %s", _init_error)


try:
    from bedrock_agentcore.memory.integrations.strands.config import RetrievalConfig
except ImportError:
    RetrievalConfig = None


def _create_session_manager(user_id: str, session_id: str):
    """Create an AgentCoreMemorySessionManager if memory is configured."""
    if not (MEMORY_ID and AgentCoreMemorySessionManager and session_id):
        return None
    try:
        retrieval = {}
        if RetrievalConfig:
            retrieval = {
                "/preferences/{actorId}": RetrievalConfig(top_k=5, relevance_score=0.5),
                "/facts/{actorId}": RetrievalConfig(top_k=10, relevance_score=0.3),
                "/summaries/{actorId}/{sessionId}": RetrievalConfig(top_k=3, relevance_score=0.5),
            }
        config = AgentCoreMemoryConfig(
            memory_id=MEMORY_ID,
            session_id=session_id,
            actor_id=user_id or "anonymous",
            retrieval_config=retrieval,
        )
        return AgentCoreMemorySessionManager(
            agentcore_memory_config=config,
            region_name=REGION,
        )
    except Exception as e:
        logger.warning("Memory session setup failed: %s", e)
        return None


def _create_agent(agent_name: str, user_id: str = "", session_id: str = "",
                  messages: list = None, tools: list = None,
                  session_manager=None) -> Agent:
    """Create a fresh Agent instance for this request."""
    prompt, _ = AGENT_CONFIGS[agent_name]
    kwargs = {
        "model": _model,
        "system_prompt": prompt,
        "tools": tools or [],
        "callback_handler": None,
    }
    if messages:
        kwargs["messages"] = messages
    if session_manager:
        kwargs["session_manager"] = session_manager
    return Agent(**kwargs)


def _extract_text(result) -> str:
    """Extract text from agent result, stripping any <thinking> tags."""
    try:
        text = result.message["content"][0]["text"]
    except (KeyError, IndexError, TypeError):
        text = str(result)
    text = re.sub(r"<thinking>.*?</thinking>", "", text, flags=re.DOTALL).strip()
    return text


def _classify(message: str, msg_type: str) -> str:
    if msg_type == "grade":
        return "grader"
    if msg_type == "hint":
        return "tutor"
    if msg_type == "session_start":
        return "planner"
    if msg_type == "explain":
        return "tutor"

    lower = message.lower()
    if any(k in lower for k in ["what should i learn", "what next", "learning path", "recommend"]):
        return "planner"
    if any(k in lower for k in ["how am i doing", "my progress", "my grade", "my score"]):
        return "grader"

    try:
        result = _bedrock.converse(
            modelId=os.environ.get("NOVA_MODEL_ID", "us.amazon.nova-2-lite-v1:0"),
            messages=[{"role": "user", "content": [{"text": message}]}],
            system=[{"text": CLASSIFIER_PROMPT}],
            inferenceConfig={"maxTokens": 10, "temperature": 0},
        )
        classification = result["output"]["message"]["content"][0]["text"].strip().lower()
        if classification in ("tutor", "grader", "planner"):
            return classification
    except Exception as e:
        logger.warning("Classification fallback to tutor: %s", e)

    return "tutor"


@app.entrypoint
def invoke(payload, context=None):
    """Handle incoming requests from API Gateway / AgentCore Runtime."""
    _init()

    if _init_error:
        return {"agent": "error", "response": f"Init error: {_init_error}", "session_id": ""}

    message = payload.get("message", payload.get("prompt", ""))
    user_id = payload.get("user_id", "")
    session_id = payload.get("session_id", "")
    msg_type = payload.get("type", "chat")
    module_uuid = payload.get("module_uuid", "")
    lesson_uuid = payload.get("lesson_uuid", "")
    image_b64 = payload.get("image", "")

    if msg_type == "grade" and not message:
        q_num = payload.get("question_number", 0)
        result_text = payload.get("result", "")
        message = (
            f"Auto-grade: Student answered question {q_num} "
            f"in {module_uuid}/{lesson_uuid}. Result: {result_text}. "
            f"Please provide detailed feedback."
        )

    if msg_type == "session_start":
        message = (
            f"Generate a warm, personalised 2–3 sentence welcome card for the student "
            f"starting a lab session in module '{module_uuid}', lesson '{lesson_uuid}'. "
            f"Call get_user_progress to see what they have completed. "
            f"Check AgentCore Memory for any past session context. "
            f"Be specific: mention what they did before (if anything) and suggest one concrete focus for today. "
            f"Be encouraging. Start with 'Welcome back!' or 'Great to see you!' Keep it short."
        )

    if msg_type == "explain":
        message = (
            f"In exactly one sentence (15 words max), plain English, no markdown formatting: "
            f"what does `{message}` do in a Linux/Kubernetes environment?"
        )

    agent_name = _classify(message, msg_type)

    # Build Strands message history from payload (sent by ws_agent_handler, reliable).
    # Falls back to in-process dict for direct invocations (agentcore invoke CLI, tests).
    raw_history = payload.get("conversation_history", [])
    if raw_history:
        history = [
            {"role": m["role"], "content": [{"text": m["text"]}]}
            for m in raw_history
            if m.get("text")
        ]
    else:
        history = _session_histories.get(session_id, []) if session_id else []

    allowed_tools = _AGENT_TOOL_NAMES.get(agent_name, set())

    # Create session manager (context manager ensures messages are flushed on exit)
    sm = _create_session_manager(user_id, session_id)

    def _run_agent(agent_tools: list) -> str:
        """Run the agent with tools, using context manager for memory flush."""
        try:
            agent = _create_agent(agent_name, user_id=user_id, session_id=session_id,
                                  messages=history, tools=agent_tools, session_manager=sm)
        except Exception as e:
            logger.error("Agent creation failed: %s\n%s", e, traceback.format_exc())
            return f"Agent creation error: {e}"
        try:
            context_parts = [f"user_id: {user_id}"]
            if module_uuid:
                context_parts.append(f"module_uuid: {module_uuid}")
            if lesson_uuid:
                context_parts.append(f"lesson_uuid: {lesson_uuid}")
            context_str = ", ".join(context_parts)
            if image_b64:
                import base64 as _base64
                raw = image_b64.split(",")[-1] if "," in image_b64 else image_b64
                image_bytes = _base64.b64decode(raw)
                user_msg = [{"role": "user", "content": [
                    {"text": f"Student ({context_str}): {message}"},
                    {"image": {"format": "jpeg", "source": {"bytes": image_bytes}}},
                ]}]
                result = agent(user_msg)
            else:
                result = agent(f"Student ({context_str}): {message}")
            text = _extract_text(result)
        except Exception as e:
            logger.error("Agent error: %s\n%s", e, traceback.format_exc())
            text = f"Agent error: {e}"

        # Save in-process history
        if session_id:
            try:
                updated_messages = getattr(agent, 'messages', None)
                if updated_messages:
                    if len(updated_messages) > MAX_HISTORY_TURNS * 2:
                        updated_messages = updated_messages[-(MAX_HISTORY_TURNS * 2):]
                    if len(_session_histories) >= MAX_SESSIONS:
                        oldest_key = next(iter(_session_histories))
                        del _session_histories[oldest_key]
                    _session_histories[session_id] = updated_messages
            except Exception:
                logger.warning("Failed to save session history", exc_info=True)
        return text

    response_text = ""
    try:
        if GATEWAY_URL:
            try:
                headers = {}
                if COGNITO_CLIENT_ID:
                    headers["Authorization"] = f"Bearer {_get_bearer_token()}"
                mcp_client = MCPClient(
                    lambda: streamablehttp_client(GATEWAY_URL, headers=headers or None)
                )
            except Exception as e:
                logger.error("Failed to create MCPClient: %s", e)
                return {"agent": "error", "response": f"Gateway connection error: {e}", "session_id": session_id}

            with mcp_client:
                all_mcp_tools = mcp_client.list_tools_sync()
                for t in all_mcp_tools:
                    t._agent_tool_name = _normalize_tool_name(t.tool_name)
                agent_tools = [t for t in all_mcp_tools if t.tool_name in allowed_tools]
                logger.info("Routing to %s via Gateway: user=%s session=...%s tools=%s history_turns=%d",
                            agent_name, user_id, session_id[-12:] if session_id else "none",
                            [t.tool_name for t in agent_tools], len(raw_history) // 2)
                response_text = _run_agent(agent_tools)
        else:
            logger.warning("GATEWAY_URL not set — running without tools")
            response_text = _run_agent([])
    except Exception as e:
        logger.error("Invoke error: %s\n%s", e, traceback.format_exc())
        response_text = f"Error: {e}"
    finally:
        # Flush buffered memory messages — critical for cross-session persistence
        if sm:
            try:
                sm.close()
                logger.info("Memory session flushed for session=...%s", session_id[-12:] if session_id else "none")
            except Exception as e:
                logger.warning("Memory flush failed: %s", e)

    return {
        "agent": agent_name,
        "response": response_text,
        "session_id": session_id,
    }


if __name__ == "__main__":
    app.run()
