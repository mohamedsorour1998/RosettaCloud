# AgentCore Runtime Deployment Design

## Goal

Deploy the RosettaCloud multi-agent education platform to AWS using Amazon Bedrock AgentCore Runtime via CDK, with PUBLIC network mode, and wire it end-to-end from the Angular frontend through WebSocket API Gateway.

## Architecture

```
User -> Frontend (Angular)
  -> WebSocket (wss://wss.dev.rosettacloud.app)
    -> API Gateway WebSocket
      -> ws_agent_handler Lambda
        -> AgentCore Runtime (PUBLIC mode)
          -> Orchestrator Agent (Nova Lite)
            |-- Tutor Agent -> search_knowledge_base (LanceDB/S3 + Bedrock Titan embeddings)
            |-- Grader Agent -> get_question_details (S3), get_user_progress (DynamoDB), get_attempt_result (DynamoDB)
            +-- Planner Agent -> get_user_progress (DynamoDB), list_available_modules (S3), get_question_metadata (S3)
```

## Key Decisions

- **PUBLIC NetworkMode** (not VPC) — our tools only access DynamoDB, S3, Bedrock, LanceDB-on-S3. No VPC-only resources. Saves ~$50/day on VPC endpoints.
- **CDK deployment** — reproducible IaC, follows the logistics demo pattern.
- **S3 zip code deployment** (not container image) — CDK bundles agent code + ARM64 pip wheels into a zip, uploads to S3 asset bucket. Same pattern as the logistics demo.
- **Python 3.12 / ARM64** — AgentCore Runtime runs on ARM64.
- **Amazon Nova Lite** (`amazon.nova-lite-v1:0`) — required for hackathon.

## CDK Stack Components

### 1. IAM Role

Trust: `bedrock-agentcore.amazonaws.com` with source account/ARN conditions.

Permissions (least-privilege):

| Permission | Resource |
|-----------|----------|
| `bedrock:InvokeModel` | `amazon.nova-lite-v1:0`, `amazon.titan-embed-text-v2:0` |
| `dynamodb:GetItem` | `rosettacloud-users` table |
| `s3:GetObject`, `s3:ListBucket` | `rosettacloud-shared-interactive-labs`, `rosettacloud-shared-interactive-labs-vector` |
| `logs:CreateLogGroup`, `CreateLogStream`, `PutLogEvents` | `/aws/bedrock-agentcore/runtimes/*` |
| `xray:PutTraceSegments`, `PutTelemetryRecords`, `GetSamplingRules`, `GetSamplingTargets` | `*` |
| `cloudwatch:PutMetricData` | `*` (namespace: `bedrock-agentcore`) |

### 2. S3 Asset (Agent Code Bundle)

Docker bundling (same as logistics demo):
- Base: `python:3.12-slim`, platform `linux/arm64`
- Copies `agent.py`, `tools.py`, `prompts.py` into bundle
- `pip install` with `--platform manylinux2014_aarch64 --only-binary=:all:`
- Zips to `agent-code.zip`, uploaded to CDK asset bucket

### 3. AgentCore Runtime (L1 CfnResource)

```
Type: AWS::BedrockAgentCore::Runtime
Properties:
  AgentRuntimeName: rosettacloud-education-agent
  NetworkConfiguration:
    NetworkMode: PUBLIC
  AgentRuntimeArtifact:
    CodeConfiguration:
      Code: S3 (CDK asset)
      EntryPoint: ["agent.py"]
      Runtime: PYTHON_3_12
```

## Directory Structure

```
Backend/agents/
  agent.py, tools.py, prompts.py, requirements.txt  (exist)
  cdk/
    app.py              — CDK entry point
    cdk.json            — CDK config
    requirements.txt    — CDK deps
    stack.py            — CDK stack (IAM + S3 asset + Runtime)
    invoke_agent.py     — Test script
    scripts/
      create_zip.py     — Zip bundler
```

## Lambda & API Gateway Wiring

**ws_agent_handler Lambda:**
- Runtime: Python 3.12 (zip)
- Handler: `handler.handler`
- Env: `AGENT_RUNTIME_ARN` from CDK output
- IAM: `bedrock-agentcore:InvokeAgentRuntime` on Runtime ARN
- Timeout: 60s, Memory: 256MB

**WebSocket API Gateway:**
- Exists at `wss.dev.rosettacloud.app`
- Re-point `$connect`, `$disconnect`, `$default` routes to new Lambda

## Pre-requisites (already exist)

- DynamoDB table `rosettacloud-users`
- S3 bucket `rosettacloud-shared-interactive-labs` (questions)
- S3 bucket `rosettacloud-shared-interactive-labs-vector` (LanceDB)
- Bedrock model access enabled: Nova Lite + Titan Embed v2
- WebSocket API Gateway at `wss.dev.rosettacloud.app`
- AWS account 339712964409, region us-east-1

## Test Plan

1. `cdk deploy` -> get Runtime ARN
2. `python invoke_agent.py` -> verify agent responds
3. Deploy Lambda with Runtime ARN
4. Update API Gateway integration
5. `ng serve` -> chatbot -> "What is Docker?" -> Tutor Agent blue card
