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
