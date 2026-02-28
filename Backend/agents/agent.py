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


CLASSIFIER_PROMPT = """\
Classify the student's intent into exactly one category. Reply with ONLY the category name.

Categories:
- tutor: concept questions, "what is...", "how do I...", help with Linux/Docker/Kubernetes
- grader: grading, feedback, "how am I doing?", auto-grade messages
- planner: "what should I learn next?", progress, learning path advice

Reply with one word: tutor, grader, or planner."""


# Agent configurations: (system_prompt, tools)
AGENT_CONFIGS = {
    "tutor": (TUTOR_PROMPT, [search_knowledge_base]),
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


def _create_agent(agent_name: str, user_id: str = "", session_id: str = "") -> Agent:
    """Create a fresh Agent instance for this request."""
    prompt, tools = AGENT_CONFIGS[agent_name]
    kwargs = {
        "model": _model,
        "system_prompt": prompt,
        "tools": tools,
        "callback_handler": None,
    }
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

    if msg_type == "grade":
        module = payload.get("module_uuid", "")
        lesson = payload.get("lesson_uuid", "")
        q_num = payload.get("question_number", 0)
        result_text = payload.get("result", "")
        message = (
            f"Auto-grade: Student answered question {q_num} "
            f"in {module}/{lesson}. Result: {result_text}. "
            f"Please provide detailed feedback."
        )

    agent_name = _classify(message, msg_type)
    agent = _create_agent(agent_name, user_id=user_id, session_id=session_id)

    logger.info("Routing to %s: user=%s", agent_name, user_id)

    try:
        result = agent(f"Student (user_id: {user_id}): {message}")
        response_text = _extract_text(result)
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
