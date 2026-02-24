# AgentCore Runtime Deployment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy the RosettaCloud multi-agent education platform to AWS via CDK and wire it end-to-end from Angular frontend through WebSocket API Gateway to AgentCore Runtime.

**Architecture:** CDK stack creates an IAM role + S3 code bundle + AgentCore Runtime (PUBLIC network mode). A new Lambda (`ws_agent_handler`) bridges the existing WebSocket API Gateway to the Runtime. The frontend already has agent card UI support.

**Tech Stack:** AWS CDK (Python), Amazon Bedrock AgentCore Runtime, Strands Agents SDK, AWS Lambda (Python 3.12), API Gateway WebSocket, DynamoDB, S3, LanceDB, Amazon Nova Lite, Titan Embeddings.

---

### Task 1: Install CDK CLI and Bootstrap

**Files:** None (system setup)

**Step 1: Install AWS CDK CLI**

```bash
npm install -g aws-cdk
```

**Step 2: Verify installation**

Run: `cdk --version`
Expected: `2.x.x` (any 2.x version)

**Step 3: Bootstrap CDK in us-east-1**

```bash
cdk bootstrap aws://339712964409/us-east-1
```

Expected: `CDKToolkit` stack created successfully.

**Step 4: Verify bootstrap**

Run: `aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-1 --query "Stacks[0].StackStatus"`
Expected: `"CREATE_COMPLETE"`

**Step 5: Commit** — N/A (no file changes)

---

### Task 2: Create CDK Project Structure

**Files:**
- Create: `Backend/agents/cdk/app.py`
- Create: `Backend/agents/cdk/stack.py`
- Create: `Backend/agents/cdk/cdk.json`
- Create: `Backend/agents/cdk/requirements.txt`
- Create: `Backend/agents/cdk/scripts/create_zip.py`
- Create: `Backend/agents/cdk/invoke_agent.py`

**Step 1: Create `cdk/requirements.txt`**

```
aws-cdk-lib>=2.180.0
constructs>=10.0.0,<11.0.0
```

**Step 2: Create `cdk/cdk.json`**

```json
{
  "app": "python3 app.py",
  "watch": {
    "include": ["**"],
    "exclude": [
      "README.md",
      "cdk*.json",
      "requirements*.txt",
      "**/__pycache__",
      "**/*.pyc"
    ]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:stackRelativeExports": true
  }
}
```

**Step 3: Create `cdk/scripts/create_zip.py`**

This zips the agent bundle during CDK Docker bundling (same pattern as logistics demo).

```python
"""Zip the agent bundle for AgentCore Runtime deployment."""
import os
import zipfile
import sys

def create_zip(source_dir, output_path):
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(source_dir):
            # Skip unnecessary directories
            dirs[:] = [d for d in dirs if d not in (
                "__pycache__", ".git", ".venv", "node_modules",
                "tests", "cdk", "cdk.out",
            )]
            for f in files:
                if f.endswith(".pyc"):
                    continue
                full_path = os.path.join(root, f)
                arcname = os.path.relpath(full_path, source_dir)
                zf.write(full_path, arcname)

if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/agent-bundle"
    out = sys.argv[2] if len(sys.argv) > 2 else "/asset-output/agent-code.zip"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    create_zip(src, out)
    print(f"Created {out}")
```

**Step 4: Create `cdk/stack.py`**

```python
"""CDK stack for RosettaCloud AgentCore Runtime."""
import os
from aws_cdk import (
    Stack,
    CfnResource,
    CfnOutput,
    aws_iam as iam,
    aws_s3_assets as s3_assets,
    BundlingOptions,
    DockerImage,
)
from constructs import Construct

ACCOUNT_ID = "339712964409"
REGION = "us-east-1"


class RosettaCloudAgentRuntimeStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs):
        super().__init__(scope, construct_id, **kwargs)

        # ── IAM Role ──
        runtime_role = iam.Role(
            self, "AgentCoreRuntimeRole",
            role_name="rosettacloud-agentcore-runtime-role",
            assumed_by=iam.ServicePrincipal(
                "bedrock-agentcore.amazonaws.com"
            ).with_conditions({
                "StringEquals": {"aws:SourceAccount": self.account},
                "ArnLike": {
                    "aws:SourceArn": f"arn:aws:bedrock-agentcore:{self.region}:{self.account}:*"
                },
            }),
        )

        # Bedrock InvokeModel
        runtime_role.add_to_policy(iam.PolicyStatement(
            sid="BedrockInvokeModel",
            actions=["bedrock:InvokeModel"],
            resources=[
                f"arn:aws:bedrock:{self.region}::foundation-model/amazon.nova-lite-v1:0",
                f"arn:aws:bedrock:{self.region}::foundation-model/amazon.titan-embed-text-v2:0",
            ],
        ))

        # DynamoDB read
        runtime_role.add_to_policy(iam.PolicyStatement(
            sid="DynamoDBRead",
            actions=["dynamodb:GetItem"],
            resources=[
                f"arn:aws:dynamodb:{self.region}:{self.account}:table/rosettacloud-users",
            ],
        ))

        # S3 read (questions + vector store)
        runtime_role.add_to_policy(iam.PolicyStatement(
            sid="S3Read",
            actions=["s3:GetObject", "s3:ListBucket"],
            resources=[
                "arn:aws:s3:::rosettacloud-shared-interactive-labs",
                "arn:aws:s3:::rosettacloud-shared-interactive-labs/*",
                "arn:aws:s3:::rosettacloud-shared-interactive-labs-vector",
                "arn:aws:s3:::rosettacloud-shared-interactive-labs-vector/*",
            ],
        ))

        # CloudWatch Logs
        runtime_role.add_to_policy(iam.PolicyStatement(
            sid="CloudWatchLogs",
            actions=[
                "logs:CreateLogGroup",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
            ],
            resources=[
                f"arn:aws:logs:{self.region}:{self.account}:log-group:/aws/bedrock-agentcore/*",
            ],
        ))

        # X-Ray
        runtime_role.add_to_policy(iam.PolicyStatement(
            sid="XRay",
            actions=[
                "xray:PutTraceSegments",
                "xray:PutTelemetryRecords",
                "xray:GetSamplingRules",
                "xray:GetSamplingTargets",
            ],
            resources=["*"],
        ))

        # CloudWatch Metrics
        runtime_role.add_to_policy(iam.PolicyStatement(
            sid="CloudWatchMetrics",
            actions=["cloudwatch:PutMetricData"],
            resources=["*"],
            conditions={
                "StringEquals": {"cloudwatch:namespace": "bedrock-agentcore"},
            },
        ))

        # ── S3 Asset (agent code bundle) ──
        agent_dir = os.path.join(os.path.dirname(__file__), "..")

        agent_asset = s3_assets.Asset(
            self, "AgentCodeAsset",
            path=agent_dir,
            exclude=[
                "cdk", "cdk.out", "__pycache__", "*.pyc", ".git",
                ".venv", "node_modules",
            ],
            bundling=BundlingOptions(
                image=DockerImage.from_registry("python:3.12-slim"),
                platform="linux/arm64",
                command=[
                    "bash", "-c",
                    "mkdir -p /tmp/agent-bundle && "
                    "cp -r /asset-input/agent.py /asset-input/tools.py /asset-input/prompts.py /tmp/agent-bundle/ && "
                    "pip install --target /tmp/agent-bundle "
                    "--platform manylinux2014_aarch64 "
                    "--only-binary=:all: "
                    "--python-version 312 "
                    "--implementation cp "
                    "-r /asset-input/requirements.txt && "
                    "cd /tmp/agent-bundle && "
                    "python3 -c \""
                    "import zipfile, os; "
                    "zf = zipfile.ZipFile('/asset-output/agent-code.zip', 'w', zipfile.ZIP_DEFLATED); "
                    "[zf.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f), '/tmp/agent-bundle')) "
                    "for r,ds,fs in os.walk('.') "
                    "for f in fs if not f.endswith('.pyc') and '__pycache__' not in r]; "
                    "zf.close(); "
                    "print('Zipped agent bundle')\""
                ],
            ),
        )

        # ── AgentCore Runtime (L1 CfnResource) ──
        # The asset produces a zip file. CDK uploads it to the asset bucket.
        # We reference the bucket and key from the asset.
        runtime = CfnResource(
            self, "AgentCoreRuntime",
            type="AWS::BedrockAgentCore::Runtime",
            properties={
                "AgentRuntimeName": "rosettacloud-education-agent",
                "Description": "Multi-agent education platform — Tutor, Grader, Planner",
                "RoleArn": runtime_role.role_arn,
                "NetworkConfiguration": {
                    "NetworkMode": "PUBLIC",
                },
                "AgentRuntimeArtifact": {
                    "CodeConfiguration": {
                        "Code": {
                            "S3": {
                                "Bucket": agent_asset.s3_bucket_name,
                                "Prefix": agent_asset.s3_object_key,
                            }
                        },
                        "EntryPoint": ["agent.py"],
                        "Runtime": "PYTHON_3_12",
                    }
                },
            },
        )

        # ── Outputs ──
        CfnOutput(self, "RuntimeArn",
            value=runtime.get_att("AgentRuntimeArn").to_string(),
            description="AgentCore Runtime ARN",
            export_name="RosettaCloudAgentRuntimeArn",
        )
        CfnOutput(self, "RuntimeRoleArn",
            value=runtime_role.role_arn,
            description="AgentCore Runtime IAM Role ARN",
        )
```

**Step 5: Create `cdk/app.py`**

```python
"""CDK app entry point for RosettaCloud AgentCore Runtime."""
import aws_cdk as cdk
from stack import RosettaCloudAgentRuntimeStack

app = cdk.App()
RosettaCloudAgentRuntimeStack(
    app,
    "RosettaCloudAgentRuntime",
    env=cdk.Environment(account="339712964409", region="us-east-1"),
)
app.synth()
```

**Step 6: Create `cdk/invoke_agent.py`**

```python
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
```

**Step 7: Commit**

```bash
cd /home/sorour/RosettaCloud
git add Backend/agents/cdk/
git commit -m "feat: add CDK stack for AgentCore Runtime deployment"
```

---

### Task 3: Deploy AgentCore Runtime via CDK

**Files:** None (infrastructure deployment)

**Step 1: Install CDK Python dependencies**

```bash
cd /home/sorour/RosettaCloud/Backend/agents/cdk
pip install -r requirements.txt --break-system-packages
```

**Step 2: Synthesize the CDK stack**

```bash
cd /home/sorour/RosettaCloud/Backend/agents/cdk
cdk synth
```

Expected: CloudFormation template printed to stdout, `cdk.out/` created. No errors.

**Step 3: Deploy the CDK stack**

```bash
cd /home/sorour/RosettaCloud/Backend/agents/cdk
cdk deploy --require-approval never
```

Expected: Stack deploys in ~5-10 minutes. Outputs include `RuntimeArn`.

**Step 4: Save the Runtime ARN**

```bash
RUNTIME_ARN=$(aws cloudformation describe-stacks \
  --stack-name RosettaCloudAgentRuntime \
  --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='RuntimeArn'].OutputValue" \
  --output text)
echo "Runtime ARN: $RUNTIME_ARN"
```

**Step 5: Wait for Runtime to become READY**

```bash
# Poll until status is READY (may take 2-5 minutes after stack creation)
aws bedrock-agentcore get-agent-runtime \
  --agent-runtime-arn "$RUNTIME_ARN" \
  --region us-east-1 \
  --query "status"
```

Expected: `"READY"`. If `"CREATING"`, wait and retry.

**Step 6: Test with invoke script**

```bash
cd /home/sorour/RosettaCloud/Backend/agents/cdk
python invoke_agent.py "$RUNTIME_ARN" "What is Docker?"
```

Expected: Response with `agent: tutor` and a helpful explanation of Docker.

**Step 7: Test grader route**

```bash
python invoke_agent.py "$RUNTIME_ARN" "How am I doing in my studies?"
```

Expected: Response with `agent: grader` or `agent: planner`.

---

### Task 4: Deploy ws_agent_handler Lambda

**Files:** None (infrastructure deployment)

**Step 1: Create IAM role for the Lambda**

```bash
# Create trust policy
cat > /tmp/lambda-trust.json << 'TRUST'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
TRUST

aws iam create-role \
  --role-name rosettacloud-ws-agent-handler-role \
  --assume-role-policy-document file:///tmp/lambda-trust.json \
  --region us-east-1

# Attach basic Lambda execution policy
aws iam attach-role-policy \
  --role-name rosettacloud-ws-agent-handler-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Create inline policy for AgentCore + API Gateway
cat > /tmp/lambda-policy.json << 'POLICY'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeAgentCore",
      "Effect": "Allow",
      "Action": "bedrock-agentcore:InvokeAgentRuntime",
      "Resource": "*"
    },
    {
      "Sid": "ApiGatewayManageConnections",
      "Effect": "Allow",
      "Action": "execute-api:ManageConnections",
      "Resource": "arn:aws:execute-api:us-east-1:339712964409:ogehhw2t45/*/*"
    }
  ]
}
POLICY

aws iam put-role-policy \
  --role-name rosettacloud-ws-agent-handler-role \
  --policy-name ws-agent-permissions \
  --policy-document file:///tmp/lambda-policy.json
```

**Step 2: Package the Lambda code**

```bash
cd /home/sorour/RosettaCloud/Backend/serverless/Lambda/ws_agent_handler
zip -r /tmp/ws_agent_handler.zip handler.py
```

**Step 3: Create the Lambda function**

```bash
RUNTIME_ARN=$(aws cloudformation describe-stacks \
  --stack-name RosettaCloudAgentRuntime \
  --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='RuntimeArn'].OutputValue" \
  --output text)

# Wait for IAM role propagation
sleep 10

aws lambda create-function \
  --function-name ws_agent_handler \
  --runtime python3.12 \
  --handler handler.handler \
  --role arn:aws:iam::339712964409:role/rosettacloud-ws-agent-handler-role \
  --zip-file fileb:///tmp/ws_agent_handler.zip \
  --timeout 60 \
  --memory-size 256 \
  --environment "Variables={AGENT_RUNTIME_ARN=$RUNTIME_ARN}" \
  --region us-east-1
```

**Step 4: Verify Lambda created**

Run: `aws lambda get-function --function-name ws_agent_handler --region us-east-1 --query "Configuration.{State:State,Runtime:Runtime,Timeout:Timeout}"`
Expected: `{"State": "Active", "Runtime": "python3.12", "Timeout": 60}`

---

### Task 5: Wire API Gateway to New Lambda

**Files:** None (infrastructure update)

The WebSocket API Gateway `rosettacloud-chatbot-ws` (ID: `ogehhw2t45`) currently points to the deleted `ai_chatbot` Lambda. We update it to point to `ws_agent_handler`.

**Step 1: Grant API Gateway permission to invoke the Lambda**

```bash
aws lambda add-permission \
  --function-name ws_agent_handler \
  --statement-id AllowAPIGatewayInvoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:339712964409:ogehhw2t45/*/*" \
  --region us-east-1
```

**Step 2: Update the API Gateway integration**

```bash
aws apigatewayv2 update-integration \
  --api-id ogehhw2t45 \
  --integration-id bvtl953 \
  --integration-uri arn:aws:lambda:us-east-1:339712964409:function:ws_agent_handler \
  --region us-east-1
```

**Step 3: Verify integration updated**

Run: `aws apigatewayv2 get-integration --api-id ogehhw2t45 --integration-id bvtl953 --region us-east-1 --query "IntegrationUri"`
Expected: `"arn:aws:lambda:us-east-1:339712964409:function:ws_agent_handler"`

**Step 4: Verify auto-deploy**

The stage has `auto_deploy = true`, so the change takes effect immediately. Verify:

```bash
aws apigatewayv2 get-stage --api-id ogehhw2t45 --stage-name production --region us-east-1 --query "LastDeploymentStatusMessage"
```

Expected: `"Successfully deployed stage with deployment ID '...'"`

---

### Task 6: End-to-End Test

**Files:** None (validation)

**Step 1: Test via WebSocket CLI (wscat)**

```bash
npm install -g wscat
wscat -c "wss://wss.dev.rosettacloud.app"
```

Then send:
```json
{"prompt": "What is Docker?", "session_id": "test-session-1234567890-abcdef", "type": "chat"}
```

Expected: Receive messages:
1. `{"type": "status", "content": "Processing your question..."}`
2. `{"type": "chunk", "content": "...", "agent": "tutor"}`
3. `{"type": "complete", "agent": "tutor"}`

**Step 2: Test via Frontend**

```bash
cd /home/sorour/RosettaCloud/Frontend
ng serve
```

Open `http://localhost:4200`, navigate to a lab, open the chatbot, send "What is Docker?".

Expected: Tutor Agent responds with blue card header and mortarboard icon.

**Step 3: Test auto-grading**

In the lab, answer a question correctly. The chatbot should automatically receive a grading message and the Grader Agent should respond with green card header.

---

### Task 7: Update Terraform to Match (Optional Cleanup)

**Files:**
- Modify: `DevSecOps/Terraform/environments/shared/main.tf`

This is optional but keeps Terraform in sync. Update the integration URI from `ai_chatbot` to `ws_agent_handler`:

**Step 1: Update Terraform integration resource**

In `main.tf` line ~782, change:
```hcl
integration_uri = "arn:aws:lambda:us-east-1:${local.account_id}:function:ai_chatbot"
```
to:
```hcl
integration_uri = "arn:aws:lambda:us-east-1:${local.account_id}:function:ws_agent_handler"
```

**Step 2: Update Lambda permission resource**

In `main.tf` line ~814, change:
```hcl
function_name = "ai_chatbot"
```
to:
```hcl
function_name = "ws_agent_handler"
```

**Step 3: Commit**

```bash
git add DevSecOps/Terraform/environments/shared/main.tf
git commit -m "chore: update Terraform to point WebSocket API to ws_agent_handler"
```

Note: Do NOT run `terraform apply` yet — we already updated the integration imperatively in Task 5. This just keeps the IaC in sync for future runs.
