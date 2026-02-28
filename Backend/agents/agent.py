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

from tools import (
    search_knowledge_base,
    get_user_progress,
    get_attempt_result,
    get_question_details,
    list_available_modules,
    get_question_metadata,
)
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


# Agent configurations: (system_prompt, tools)
AGENT_CONFIGS = {
    "tutor": (TUTOR_PROMPT, [search_knowledge_base, get_question_details, get_question_metadata]),
    "grader": (GRADER_PROMPT, [get_question_details, get_user_progress, get_attempt_result]),
    "planner": (PLANNER_PROMPT, [get_user_progress, list_available_modules, get_question_metadata]),
}


def _init():
    global _model, _bedrock, _init_error
    if _model is not None:
        return

    try:
        _bedrock = boto3.client("bedrock-runtime", region_name=REGION)
        _model = BedrockModel(
            model_id="amazon.nova-lite-v1:0",
            region_name=REGION,
        )
        logger.info("Model initialized. Memory SDK available: %s, MEMORY_ID: %s",
                     AgentCoreMemorySessionManager is not None, MEMORY_ID)
    except Exception as e:
        _init_error = f"{e}\n{traceback.format_exc()}"
        logger.error("Init failed: %s", _init_error)


def _create_agent(agent_name: str, user_id: str = "", session_id: str = "", messages: list = None) -> Agent:
    """Create a fresh Agent instance for this request."""
    prompt, tools = AGENT_CONFIGS[agent_name]
    kwargs = {
        "model": _model,
        "system_prompt": prompt,
        "tools": tools,
        "callback_handler": None,
    }
    if messages:
        kwargs["messages"] = messages
    if MEMORY_ID and AgentCoreMemorySessionManager and session_id:
        try:
            config = AgentCoreMemoryConfig(
                memory_id=MEMORY_ID,
                region_name=REGION,
                session_id=session_id,
                actor_id=user_id or "anonymous",
            )
            kwargs["session_manager"] = AgentCoreMemorySessionManager(config, region=REGION)
            kwargs["session_id"] = session_id
            # Verified: passing both `messages` and `session_manager` to Agent() is safe.
            # Agent.__init__ sets self.messages = messages directly (line: `self.messages = messages if messages is not None else []`),
            # then adds session_manager as a hook — the two are independent. messages provides
            # the initial in-process history; session_manager handles long-term persistence.
        except Exception as e:
            logger.warning("Memory session setup failed, continuing without memory: %s", e)
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

    lower = message.lower()
    if any(k in lower for k in ["what should i learn", "what next", "learning path", "recommend"]):
        return "planner"
    if any(k in lower for k in ["how am i doing", "my progress", "my grade", "my score"]):
        return "grader"

    try:
        result = _bedrock.converse(
            modelId="amazon.nova-lite-v1:0",
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

    if msg_type == "grade":
        q_num = payload.get("question_number", 0)
        result_text = payload.get("result", "")
        message = (
            f"Auto-grade: Student answered question {q_num} "
            f"in {module_uuid}/{lesson_uuid}. Result: {result_text}. "
            f"Please provide detailed feedback."
        )

    agent_name = _classify(message, msg_type)

    # Load in-process history for this session
    history = _session_histories.get(session_id, []) if session_id else []

    agent = _create_agent(agent_name, user_id=user_id, session_id=session_id, messages=history)

    logger.info("Routing to %s: user=%s session=...%s history_turns=%d",
                agent_name, user_id, session_id[-12:] if session_id else "none", len(history) // 2)

    try:
        context_parts = [f"user_id: {user_id}"]
        if module_uuid:
            context_parts.append(f"module_uuid: {module_uuid}")
        if lesson_uuid:
            context_parts.append(f"lesson_uuid: {lesson_uuid}")
        context_str = ", ".join(context_parts)
        result = agent(f"Student ({context_str}): {message}")
        response_text = _extract_text(result)

        # Save updated conversation history back to in-process cache
        if session_id:
            try:
                updated_messages = getattr(agent, 'messages', None)
                if updated_messages:
                    # Trim to avoid unbounded growth
                    if len(updated_messages) > MAX_HISTORY_TURNS * 2:
                        updated_messages = updated_messages[-(MAX_HISTORY_TURNS * 2):]
                    # Evict oldest session if dict grows too large
                    if len(_session_histories) >= MAX_SESSIONS:
                        oldest_key = next(iter(_session_histories))
                        del _session_histories[oldest_key]
                    _session_histories[session_id] = updated_messages
                # If updated_messages is empty/None, don't overwrite existing history
            except Exception as hist_err:
                logger.warning("Failed to save session history", exc_info=True)
    except Exception as e:
        logger.error("Agent error: %s", e)
        response_text = f"Agent error: {e}"

    return {
        "agent": agent_name,
        "response": response_text,
        "session_id": session_id,
    }


if __name__ == "__main__":
    app.run()
