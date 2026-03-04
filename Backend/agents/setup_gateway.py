"""One-time setup: create the AgentCore Gateway that wraps the agent_tools Lambda.

Run ONCE after the agent_tools Lambda is deployed:
    cd Backend/agents
    python setup_gateway.py

Prints the Gateway URL to add to agent-deploy.yml and GitHub repo variables.
Auth: NONE (Gateway accepts all connections; network-level security via known URL).
"""

import time
import boto3

# ─── Configuration ────────────────────────────────────────────────────────────

REGION           = "us-east-1"
GATEWAY_NAME     = "rosettacloud-education-tools"
LAMBDA_ARN       = "arn:aws:lambda:us-east-1:339712964409:function:agent_tools"
GATEWAY_ROLE_ARN = "arn:aws:iam::339712964409:role/rosettacloud-agentcore-gateway-role"

# ─── Tool Schemas (inlinePayload format) ──────────────────────────────────────
# Each entry: name, description, inputSchema (type/properties/required — no wrappers)

TOOL_SCHEMA = [
    {
        "name": "search_knowledge_base",
        "description": (
            "Search the DevOps knowledge base for relevant content about Linux, Docker, "
            "and Kubernetes. Use when you need to look up technical information to answer "
            "a student's question."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_user_progress",
        "description": "Get a student's learning progress across all modules and lessons.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "user_id": {"type": "string"},
            },
            "required": ["user_id"],
        },
    },
    {
        "name": "get_attempt_result",
        "description": "Check if a student completed a specific question.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "user_id":         {"type": "string"},
                "module_uuid":     {"type": "string"},
                "lesson_uuid":     {"type": "string"},
                "question_number": {"type": "integer"},
            },
            "required": ["user_id", "module_uuid", "lesson_uuid", "question_number"],
        },
    },
    {
        "name": "get_question_details",
        "description": "Get details about a specific question: text, type, difficulty, correct answer.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "module_uuid":     {"type": "string"},
                "lesson_uuid":     {"type": "string"},
                "question_number": {"type": "integer"},
            },
            "required": ["module_uuid", "lesson_uuid", "question_number"],
        },
    },
    {
        "name": "list_available_modules",
        "description": "List all available course modules and their lessons.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_question_metadata",
        "description": "Get metadata for ALL questions in a lesson (difficulty, topics, types).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "module_uuid": {"type": "string"},
                "lesson_uuid": {"type": "string"},
            },
            "required": ["module_uuid", "lesson_uuid"],
        },
    },
]

# ─── Main ─────────────────────────────────────────────────────────────────────


def main():
    client = boto3.client("bedrock-agentcore-control", region_name=REGION)

    # ── Step 1: Create the Gateway ─────────────────────────────────────────────
    print(f"Creating AgentCore Gateway '{GATEWAY_NAME}'...")
    gw_resp = client.create_gateway(
        name=GATEWAY_NAME,
        description="MCP server exposing education tools for the RosettaCloud agents",
        roleArn=GATEWAY_ROLE_ARN,
        protocolType="MCP",
        authorizerType="NONE",
    )

    gateway_id  = gw_resp["gatewayId"]
    gateway_url = gw_resp.get("gatewayUrl", "")
    print(f"   Gateway ID : {gateway_id}")

    # Poll until ACTIVE
    print("⏳ Waiting for Gateway to reach ACTIVE state...")
    while True:
        status_resp = client.get_gateway(gatewayIdentifier=gateway_id)
        status = status_resp.get("status", "UNKNOWN")
        print(f"   Status: {status}")
        if status == "ACTIVE":
            gateway_url = status_resp.get("gatewayUrl", gateway_url)
            break
        if status in ("FAILED", "DELETING", "DELETE_FAILED"):
            reasons = status_resp.get("statusReasons", [])
            print(f"❌ Gateway creation failed: {reasons}")
            return
        time.sleep(10)

    print(f"✅ Gateway ACTIVE: {gateway_url}")

    # ── Step 2: Register the Lambda target ────────────────────────────────────
    print(f"\nRegistering Lambda target 'education_tools'...")
    target_resp = client.create_gateway_target(
        gatewayIdentifier=gateway_id,
        name="education_tools",
        description="agent_tools Lambda — DynamoDB, S3, LanceDB tools",
        targetConfiguration={
            "mcp": {
                "lambda": {
                    "lambdaArn": LAMBDA_ARN,
                    "toolSchema": {
                        "inlinePayload": TOOL_SCHEMA,
                    },
                }
            }
        },
        credentialProviderConfigurations=[],
    )

    target_id = target_resp.get("targetId", target_resp.get("name", "education_tools"))
    print(f"✅ Target registered: {target_id}")

    # ── Step 3: Print output ───────────────────────────────────────────────────
    print(f"""
╔══════════════════════════════════════════════════════╗
  Gateway setup complete!
  Gateway ID  : {gateway_id}
  Gateway URL : {gateway_url}
╚══════════════════════════════════════════════════════╝

📋 Run these commands to store the Gateway URL:

  gh variable set GATEWAY_URL --body "{gateway_url}"

Then re-run agent-deploy.yml to bake GATEWAY_URL into the agent container.
Auth is NONE — no Cognito credentials needed.
""")


if __name__ == "__main__":
    main()
