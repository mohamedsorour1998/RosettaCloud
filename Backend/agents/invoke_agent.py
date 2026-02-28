"""Test script — invoke the deployed AgentCore Runtime."""
import json
import uuid
import sys
import boto3


def invoke(runtime_arn: str, message: str, user_id: str = "test-user"):
    client = boto3.client("bedrock-agentcore", region_name="us-east-1")
    session_id = f"test-{uuid.uuid4().hex}-rosettacloud"

    payload = json.dumps({
        "message": message,
        "user_id": user_id,
        "session_id": session_id,
        "type": "chat",
    })

    print(f"Invoking Runtime: {runtime_arn}")
    print(f"Session: {session_id}")
    print(f"Message: {message}")
    print("---")

    response = client.invoke_agent_runtime(
        agentRuntimeArn=runtime_arn,
        runtimeSessionId=session_id,
        payload=payload,
        qualifier="DEFAULT",
    )

    result = json.loads(response["response"].read())
    print(f"Agent: {result.get('agent', 'unknown')}")
    print(f"Response: {result.get('response', result)}")
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python invoke_agent.py <RUNTIME_ARN> [message]")
        sys.exit(1)

    arn = sys.argv[1]
    msg = sys.argv[2] if len(sys.argv) > 2 else "What is Docker?"
    invoke(arn, msg)
