"""CDK stack for RosettaCloud AgentCore Runtime."""
import os
import shutil
import subprocess
import zipfile
from aws_cdk import (
    Stack,
    CfnResource,
    CfnOutput,
    aws_iam as iam,
    aws_s3_assets as s3_assets,
    BundlingOptions,
    DockerImage,
    ILocalBundling,
)
from constructs import Construct
import jsii


@jsii.implements(ILocalBundling)
class LocalBundler:
    """Bundles the agent code locally when Docker is unavailable."""

    def __init__(self, agent_dir: str):
        self._agent_dir = agent_dir

    def try_bundle(self, output_dir: str, options) -> bool:
        """Bundle agent code + pip dependencies into a zip file locally.

        Args:
            output_dir: CDK-provided output directory for bundled assets.
            options: BundlingOptions passed by CDK (unused for local bundling).
        """
        try:
            bundle_dir = os.path.join(output_dir, "_bundle")
            os.makedirs(bundle_dir, exist_ok=True)

            # Copy agent source files
            for src_file in ("agent.py", "tools.py", "prompts.py"):
                src = os.path.join(self._agent_dir, src_file)
                if os.path.exists(src):
                    shutil.copy2(src, bundle_dir)

            # Install dependencies for arm64 target
            req_file = os.path.join(self._agent_dir, "requirements.txt")
            if os.path.exists(req_file):
                subprocess.check_call(
                    [
                        "pip", "install",
                        "--target", bundle_dir,
                        "--platform", "manylinux2014_aarch64",
                        "--only-binary=:all:",
                        "--python-version", "312",
                        "--implementation", "cp",
                        "-r", req_file,
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )

            # Create zip
            zip_path = os.path.join(output_dir, "agent-code.zip")
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for root, dirs, files in os.walk(bundle_dir):
                    dirs[:] = [d for d in dirs if d != "__pycache__"]
                    for f in files:
                        if f.endswith(".pyc"):
                            continue
                        full = os.path.join(root, f)
                        arcname = os.path.relpath(full, bundle_dir)
                        zf.write(full, arcname)

            # Clean up temp bundle dir
            shutil.rmtree(bundle_dir, ignore_errors=True)
            print(f"Local bundler: created {zip_path}")
            return True

        except Exception as exc:
            print(f"Local bundler failed: {exc}")
            return False


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
                local=LocalBundler(os.path.abspath(agent_dir)),
            ),
        )

        # ── AgentCore Runtime (L1 CfnResource) ──
        runtime = CfnResource(
            self, "AgentCoreRuntime",
            type="AWS::BedrockAgentCore::Runtime",
            properties={
                "AgentRuntimeName": "rosettacloud_education_agent",
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
