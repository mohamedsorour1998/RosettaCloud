"""RosettaCloud Multi-Agent Education Platform — AgentCore Runtime entrypoint."""

import json
import logging

from bedrock_agentcore import BedrockAgentCoreApp
from strands import Agent, tool
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
    ORCHESTRATOR_PROMPT,
    TUTOR_PROMPT,
    GRADER_PROMPT,
    PLANNER_PROMPT,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()

# ── Lazy-initialized agents (created on first request) ──
_orchestrator = None


def _extract_text(result) -> str:
    """Extract text from Strands agent result."""
    try:
        return result.message["content"][0]["text"]
    except (KeyError, IndexError, TypeError):
        return str(result)


def _get_orchestrator():
    """Lazy-init all agents on first invocation."""
    global _orchestrator
    if _orchestrator is not None:
        return _orchestrator

    model = BedrockModel(
        model_id="amazon.nova-lite-v1:0",
        region_name="us-east-1",
    )

    tutor_agent = Agent(
        model=model,
        system_prompt=TUTOR_PROMPT,
        tools=[search_knowledge_base],
        callback_handler=None,
    )

    grader_agent = Agent(
        model=model,
        system_prompt=GRADER_PROMPT,
        tools=[get_question_details, get_user_progress, get_attempt_result],
        callback_handler=None,
    )

    planner_agent = Agent(
        model=model,
        system_prompt=PLANNER_PROMPT,
        tools=[get_user_progress, list_available_modules, get_question_metadata],
        callback_handler=None,
    )

    @tool
    def route_to_tutor(message: str, user_id: str) -> str:
        """Route to Tutor Agent for DevOps concept explanations and learning guidance.

        Use when student asks about concepts, needs help, or wants to learn about
        Linux, Docker, or Kubernetes.

        Args:
            message: The student's question.
            user_id: Student's user ID.

        Returns:
            JSON with agent name and response.
        """
        result = tutor_agent(f"Student (user_id: {user_id}): {message}")
        return json.dumps({"agent": "tutor", "response": _extract_text(result)})

    @tool
    def route_to_grader(message: str, user_id: str) -> str:
        """Route to Grader Agent for evaluating student work and providing feedback.

        Use when student just answered a question, asks 'how am I doing?',
        or wants feedback on progress.

        Args:
            message: The grading context or student's question.
            user_id: Student's user ID.

        Returns:
            JSON with agent name and response.
        """
        result = grader_agent(f"Student (user_id: {user_id}): {message}")
        return json.dumps({"agent": "grader", "response": _extract_text(result)})

    @tool
    def route_to_planner(message: str, user_id: str) -> str:
        """Route to Curriculum Planner for learning path recommendations.

        Use when student asks 'what should I learn next?', about overall progress,
        or which topics to focus on.

        Args:
            message: The student's question about learning path.
            user_id: Student's user ID.

        Returns:
            JSON with agent name and response.
        """
        result = planner_agent(f"Student (user_id: {user_id}): {message}")
        return json.dumps({"agent": "planner", "response": _extract_text(result)})

    _orchestrator = Agent(
        model=model,
        system_prompt=ORCHESTRATOR_PROMPT,
        tools=[route_to_tutor, route_to_grader, route_to_planner],
        callback_handler=None,
    )
    logger.info("All agents initialized")
    return _orchestrator


@app.entrypoint
def invoke(payload):
    """Handle incoming requests from API Gateway / AgentCore Runtime."""
    message = payload.get("message", payload.get("prompt", ""))
    user_id = payload.get("user_id", "")
    session_id = payload.get("session_id", "")
    msg_type = payload.get("type", "chat")

    # Auto-grade: build context for grader
    if msg_type == "grade":
        module = payload.get("module_uuid", "")
        lesson = payload.get("lesson_uuid", "")
        q_num = payload.get("question_number", 0)
        result = payload.get("result", "")
        message = (
            f"Auto-grade: Student answered question {q_num} "
            f"in {module}/{lesson}. Result: {result}. "
            f"Please provide detailed feedback."
        )

    logger.info("Invoking orchestrator: user=%s type=%s", user_id, msg_type)
    orchestrator = _get_orchestrator()
    response = orchestrator(
        f"user_id: {user_id}, session_id: {session_id}\n\n{message}"
    )

    # Parse which agent responded
    response_text = _extract_text(response)
    try:
        parsed = json.loads(response_text)
        agent_name = parsed.get("agent", "tutor")
        agent_response = parsed.get("response", response_text)
    except (json.JSONDecodeError, TypeError):
        agent_name = "tutor"
        agent_response = response_text

    return {
        "agent": agent_name,
        "response": agent_response,
        "session_id": session_id,
    }


if __name__ == "__main__":
    app.run()
