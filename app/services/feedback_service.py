"""
Feedback service – minimal, direct, and verbose.
Watches FeedbackRequested, calls the AI, and republishes to FeedbackGiven.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from momento.responses import TopicPublish
from app.services import ai_service as ai
from app.services import cache_events_service as cache_events

CACHE_NAME               = "interactive-labs"
FEEDBACK_REQUEST_TOPIC   = "FeedbackRequested"
FEEDBACK_GIVEN_TOPIC     = "FeedbackGiven"
DEFAULT_MAX_TOKENS       = 1_500
DEFAULT_TEMPERATURE      = 0.7

logger = logging.getLogger("feedback_direct")

if not logger.handlers:
    h = logging.StreamHandler()
    h.setFormatter(
        logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    )
    logger.addHandler(h)

async def _publish(topic: str, payload: str) -> Optional[TopicPublish.Error]:
    """Publish to Momento using the correct cache, regardless of signature."""
    try:
        return await cache_events.publish(topic, payload, cache=CACHE_NAME)  # type: ignore[arg-type]
    except TypeError:
        logger.debug("'cache' kw‑arg not supported; publishing to default cache")
        return await cache_events.publish(topic, payload)                     # type: ignore[return-value]

def _build_prompt(data: Dict[str, Any]) -> str:
    mod   = data.get("module_uuid", "unknown")
    les   = data.get("lesson_uuid", "unknown")
    qs    = data.get("questions", [])
    prog  = data.get("progress", {})

    txt = [
        f"A student has completed Module {mod}, Lesson {les}.",
        "Provide detailed educational feedback.\n",
        "Questions:"
    ]
    for q in qs:
        qid   = q.get("id")
        qtext = q.get("question", "<no text>")
        done  = bool((str(qid) in prog and prog[str(qid)]) or q.get("completed"))
        status = "COMPLETED" if done else "NOT COMPLETED"
        txt.append(f"- Q{qid}: {qtext}  [{status}]")
    txt.append(
        "\nInclude: overall assessment, per‑question feedback, "
        "improvement suggestions, and encouraging remarks."
    )
    return "\n".join(txt)

async def _handle(raw_msg: str) -> None:
    logger.debug("Raw message: %s", raw_msg)
    try:
        data        = json.loads(raw_msg)
        feedback_id  = data["feedback_id"]

        prompt      = _build_prompt(data)
        logger.info("Calling AI for request %s", feedback_id)

        system_role = (
            "You are an educational assistant providing feedback on lab exercises. "
            "Do not mention any user IDs or specific identifiers in your feedback. "
            "Address the student generically without any personal references. "
            "Focus on the educational content and performance only."
        )

        ai_response = await ai.chat(
            prompt=prompt,
            stream=False,
            max_tokens=DEFAULT_MAX_TOKENS,
            temperature=DEFAULT_TEMPERATURE,
            system_role=system_role
        )

        logger.debug("AI response (trimmed): %s…", ai_response[:120])

        payload = json.dumps(
            {
                "type":       "feedback",
                "feedback_id": feedback_id,
                "content":    ai_response,
                "timestamp":  datetime.utcnow().isoformat(),
            }
        )

        pub = await _publish(FEEDBACK_GIVEN_TOPIC, payload)
        if isinstance(pub, TopicPublish.Error):
            logger.error("Publish failed: %s", pub.message)
        else:
            logger.info("Feedback %s published to %s", feedback_id, FEEDBACK_GIVEN_TOPIC)

    except Exception as exc:
        logger.exception("Failed to handle message: %s", exc)

async def _subscribe_loop() -> None:
    logger.info("Subscribing to %s (cache=%s)", FEEDBACK_REQUEST_TOPIC, CACHE_NAME)
    while True:
        try:
            async for msg in cache_events.subscribe(                        # type: ignore[arg-type]
                FEEDBACK_REQUEST_TOPIC, cache=CACHE_NAME
            ):
                asyncio.create_task(_handle(msg))
        except Exception as exc:
            logger.warning("Subscription error: %s – retry in 5 s", exc)
            await asyncio.sleep(5)

_original_init = ai.init
_started = False

async def _extended_init() -> None:
    global _started
    await _original_init()
    if not _started:
        asyncio.create_task(_subscribe_loop())
        _started = True
        logger.info("Feedback service started")

ai.init = _extended_init