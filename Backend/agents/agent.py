"""RosettaCloud Multi-Agent Education Platform — AgentCore Runtime entrypoint."""

import json
import logging
import boto3

from bedrock_agentcore import BedrockAgentCoreApp
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

# ── Lazy-initialized agents ──
_model = None
_bedrock = None
_tutor = None
_grader = None
_planner = None

CLASSIFIER_PROMPT = """\
Classify the student's intent into exactly one category. Reply with ONLY the category name.

Categories:
- tutor: concept questions, "what is...", "how do I...", help with Linux/Docker/Kubernetes
- grader: grading, feedback, "how am I doing?", auto-grade messages
- planner: "what should I learn next?", progress, learning path advice

Reply with one word: tutor, grader, or planner."""


def _init():
    global _model, _bedrock, _tutor, _grader, _planner
    if _model is not None:
        return

    _bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
    _model = BedrockModel(
        model_id="amazon.nova-lite-v1:0",
        region_name="us-east-1",
    )

    _tutor = Agent(
        model=_model,
        system_prompt=TUTOR_PROMPT,
        tools=[search_knowledge_base],
        callback_handler=None,
    )

    _grader = Agent(
        model=_model,
        system_prompt=GRADER_PROMPT,
        tools=[get_question_details, get_user_progress, get_attempt_result],
        callback_handler=None,
    )

    _planner = Agent(
        model=_model,
        system_prompt=PLANNER_PROMPT,
        tools=[get_user_progress, list_available_modules, get_question_metadata],
        callback_handler=None,
    )
    logger.info("All agents initialized")


def _extract_text(result) -> str:
    """Extract text from Strands agent result."""
    try:
        return result.message["content"][0]["text"]
    except (KeyError, IndexError, TypeError):
        return str(result)


def _classify(message: str, msg_type: str) -> str:
    """Fast intent classification — no LLM call needed for obvious cases."""
    if msg_type == "grade":
        return "grader"

    lower = message.lower()
    if any(k in lower for k in ["what should i learn", "what next", "learning path", "recommend"]):
        return "planner"
    if any(k in lower for k in ["how am i doing", "my progress", "my grade", "my score"]):
        return "grader"

    # Default: use LLM classifier for ambiguous messages
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
        logger.warning("Classification failed, defaulting to tutor: %s", e)

    return "tutor"


@app.entrypoint
def invoke(payload):
    """Handle incoming requests from API Gateway / AgentCore Runtime."""
    _init()

    message = payload.get("message", payload.get("prompt", ""))
    user_id = payload.get("user_id", "")
    session_id = payload.get("session_id", "")
    msg_type = payload.get("type", "chat")

    # Auto-grade: build context for grader
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

    # Classify intent and route directly
    agent_name = _classify(message, msg_type)
    agents = {"tutor": _tutor, "grader": _grader, "planner": _planner}
    agent = agents[agent_name]

    logger.info("Routing to %s: user=%s", agent_name, user_id)

    result = agent(f"Student (user_id: {user_id}): {message}")
    response_text = _extract_text(result)

    return {
        "agent": agent_name,
        "response": response_text,
        "session_id": session_id,
    }


if __name__ == "__main__":
    app.run()
