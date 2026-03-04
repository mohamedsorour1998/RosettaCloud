"""One-time setup: create the AgentCore Gateway that wraps the agent_tools Lambda.

Run ONCE after the agent_tools Lambda is deployed:
    python setup_gateway.py

Prints the Gateway endpoint URL and Cognito credentials to add to agent-deploy.yml.
"""

import boto3

# ─── Configuration ────────────────────────────────────────────────────────────

REGION = "us-east-1"
GATEWAY_NAME = "rosettacloud-education-tools"
LAMBDA_ARN = "arn:aws:lambda:us-east-1:339712964409:function:agent_tools"
GATEWAY_ROLE_ARN = "arn:aws:iam::339712964409:role/rosettacloud-agentcore-gateway-role"

# ─── Tool Schemas ─────────────────────────────────────────────────────────────

TOOL_SCHEMA = [
    {
        "toolSpec": {
            "name": "search_knowledge_base",
            "description": (
                "Search the DevOps knowledge base for relevant content about Linux, Docker, "
                "and Kubernetes. Use when you need to look up technical information to answer "
                "a student's question."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query describing what information to find.",
                        }
                    },
                    "required": ["query"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_user_progress",
            "description": "Get a student's learning progress across all modules and lessons.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "user_id": {
                            "type": "string",
                            "description": "The student's user ID.",
                        }
                    },
                    "required": ["user_id"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_attempt_result",
            "description": "Check if a student completed a specific question.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "user_id": {"type": "string"},
                        "module_uuid": {"type": "string"},
                        "lesson_uuid": {"type": "string"},
                        "question_number": {"type": "integer"},
                    },
                    "required": ["user_id", "module_uuid", "lesson_uuid", "question_number"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_question_details",
            "description": "Get details about a specific question: text, type, difficulty, correct answer.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "module_uuid": {"type": "string"},
                        "lesson_uuid": {"type": "string"},
                        "question_number": {"type": "integer"},
                    },
                    "required": ["module_uuid", "lesson_uuid", "question_number"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "list_available_modules",
            "description": "List all available course modules and their lessons.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_question_metadata",
            "description": "Get metadata for ALL questions in a lesson (difficulty, topics, types).",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "module_uuid": {"type": "string"},
                        "lesson_uuid": {"type": "string"},
                    },
                    "required": ["module_uuid", "lesson_uuid"],
                }
            },
        }
    },
]

# ─── Main ─────────────────────────────────────────────────────────────────────


def main():
    client = boto3.client("bedrock-agentcore-control", region_name=REGION)

    print(f"Creating AgentCore Gateway '{GATEWAY_NAME}'...")

    resp = client.create_agent_runtime_endpoint(
        name=GATEWAY_NAME,
        description=(
            "MCP server exposing education tools for the RosettaCloud tutor/grader/planner agents"
        ),
        executionRoleArn=GATEWAY_ROLE_ARN,
        authorizerConfiguration={
            "customJWTAuthorizer": {
                "allowedAudience": ["rosettacloud-agents"],
                "allowedClients": ["rosettacloud-agent-client"],
            }
        },
        targets=[
            {
                "name": "education_tools",
                "targetConfiguration": {
                    "lambda": {
                        "lambdaArn": LAMBDA_ARN,
                        "toolSchema": {"tools": TOOL_SCHEMA},
                        "lambdaInputPayloadEncoding": "json",
                    }
                },
                "credentialProviderConfigurations": [
                    {"credentialProviderType": "GATEWAY_IAM_ROLE"}
                ],
            }
        ],
    )

    gateway_id = resp["agentRuntimeEndpointId"]
    print(f"\n⏳ Waiting for gateway to reach READY state (this may take 30-60 seconds)...")

    import time
    while True:
        status_resp = client.get_agent_runtime_endpoint(
            agentRuntimeEndpointId=gateway_id
        )
        status = status_resp.get("status", "UNKNOWN")
        print(f"   Status: {status}")
        if status == "READY":
            gateway_url = status_resp["liveVersion"]["endpointUrl"]
            break
        elif status in ("FAILED", "DELETING"):
            print(f"❌ Gateway creation failed with status: {status}")
            return
        time.sleep(10)

    print(f"\n✅ Gateway created!")
    print(f"   Gateway ID  : {gateway_id}")
    print(f"   Gateway URL : {gateway_url}")

    token_resp = client.get_agent_runtime_endpoint_oauth_credentials(
        agentRuntimeEndpointId=gateway_id
    )

    token_url = token_resp["tokenEndpoint"]
    client_id = token_resp["clientId"]
    client_secret = token_resp["clientSecret"]

    print(f"\n📋 Add these to agent-deploy.yml --env flags:")
    print(f"   GATEWAY_URL={gateway_url}")
    print(f"   COGNITO_TOKEN_URL={token_url}")
    print(f"   COGNITO_CLIENT_ID={client_id}")
    print(f"   COGNITO_CLIENT_SECRET={client_secret}")
    print()
    print("Also add COGNITO_CLIENT_SECRET as a GitHub Actions secret named COGNITO_CLIENT_SECRET.")


if __name__ == "__main__":
    main()
