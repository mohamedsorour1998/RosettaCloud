"""WebSocket handler — bridges API Gateway WebSocket to AgentCore Runtime."""

import os
import json
import uuid
import boto3
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AGENT_RUNTIME_ARN = os.environ["AGENT_RUNTIME_ARN"]
agentcore = boto3.client("bedrock-agentcore", region_name="us-east-1")


def handler(event, context):
    route = event["requestContext"]["routeKey"]
    conn_id = event["requestContext"]["connectionId"]
    api_id = event["requestContext"]["apiId"]
    stage = event["requestContext"]["stage"]
    apigw = boto3.client(
        "apigatewaymanagementapi",
        endpoint_url=f"https://{api_id}.execute-api.us-east-1.amazonaws.com/{stage}",
    )

    if route == "$connect":
        return {"statusCode": 200}
    if route == "$disconnect":
        return {"statusCode": 200}

    # $default — handle message
    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        _send(apigw, conn_id, {"type": "error", "content": "Invalid JSON"})
        return {"statusCode": 400}

    message = body.get("prompt", body.get("message", ""))
    user_id = body.get("user_id", "")
    session_id = body.get("session_id", str(uuid.uuid4()) + "-auto-generated")
    msg_type = body.get("type", "chat")

    if not message and msg_type != "grade":
        _send(apigw, conn_id, {"type": "error", "content": "Missing prompt"})
        return {"statusCode": 400}

    _send(apigw, conn_id, {"type": "status", "content": "Processing your question..."})

    # Build AgentCore payload
    payload = {
        "message": message,
        "user_id": user_id,
        "session_id": session_id,
        "type": msg_type,
    }
    if msg_type == "grade":
        payload.update({
            "module_uuid": body.get("module_uuid", ""),
            "lesson_uuid": body.get("lesson_uuid", ""),
            "question_number": body.get("question_number", 0),
            "result": body.get("result", ""),
        })

    # Ensure session_id is 33+ chars (AgentCore requirement)
    runtime_session_id = session_id
    if len(runtime_session_id) < 33:
        runtime_session_id = session_id + "-" + uuid.uuid4().hex

    # Invoke AgentCore Runtime
    try:
        response = agentcore.invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            runtimeSessionId=runtime_session_id,
            payload=json.dumps(payload),
            qualifier="DEFAULT",
        )
        result = json.loads(response["response"].read())
        agent_name = result.get("agent", "tutor")
        agent_response = result.get("response", "")

        _send(apigw, conn_id, {
            "type": "chunk",
            "content": agent_response,
            "agent": agent_name,
        })
        _send(apigw, conn_id, {"type": "complete", "agent": agent_name})
    except Exception as e:
        logger.error("AgentCore invocation error: %s", e)
        _send(apigw, conn_id, {
            "type": "error",
            "content": f"Agent error: {str(e)}",
        })

    return {"statusCode": 200}


def _send(apigw, conn_id, data):
    try:
        apigw.post_to_connection(
            ConnectionId=conn_id,
            Data=json.dumps(data).encode(),
        )
    except apigw.exceptions.GoneException:
        logger.warning("Connection %s gone", conn_id)
