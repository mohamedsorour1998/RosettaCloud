# RosettaCloud — Restore Guide

Everything needed to bring RosettaCloud back from zero. Run steps in order.

---

## Prerequisites

- AWS CLI configured (`aws sts get-caller-identity` works)
- `kubectl` installed and pointing to the right context after EKS is restored
- `terraform` installed
- `agentcore` CLI at `~/.local/bin/agentcore`
- GitHub Actions secrets still set (OIDC role, ECR, etc.)

---

## Step 1 — Restore Infrastructure (Terraform)

```bash
cd DevSecOps/Terraform/environments/shared
terraform init
terraform apply -var-file="terraform.tfvars"
```

This recreates: VPC, EKS cluster, Cognito, API Gateway, CloudFront, Route 53, DynamoDB,
S3 buckets, ECR repos, IAM roles, ACM certs, EventBridge, Lambda permissions.

> Takes ~15–20 minutes. EKS alone is ~10 minutes.

---

## Step 2 — Update kubeconfig

```bash
aws eks update-kubeconfig --region us-east-1 --name rosettacloud-eks
kubectl get nodes  # confirm cluster is up
```

---

## Step 3 — Deploy Kubernetes Workloads

```bash
# Install Istio first (if not already in cluster)
istioctl install --set profile=default -y
kubectl label namespace dev istio-injection=enabled

# Apply all manifests
kubectl apply -f DevSecOps/K8S/

# Verify
kubectl get pods -n dev
```

---

## Step 4 — Build and Push Docker Images (trigger CI/CD)

Push a dummy commit to main touching each service, or run workflows manually:

```bash
# From GitHub Actions UI → run each workflow manually:
# - backend-build.yml
# - frontend-build.yml
# - interactive-labs-build.yml
```

Or trigger via CLI:
```bash
gh workflow run backend-build.yml
gh workflow run frontend-build.yml
gh workflow run interactive-labs-build.yml
```

---

## Step 5 — Sync Questions to S3

```bash
gh workflow run questions-sync.yml
```

This pushes `Backend/questions/` to S3 and triggers the document indexer Lambda
to re-index vectors into LanceDB.

---

## Step 6 — Redeploy AgentCore

```bash
cd Backend/agents
export GATEWAY_URL=<gateway-url-from-github-repo-variable>

~/.local/bin/agentcore configure -e agent.py -n rosettacloud_education_agent \
  -er arn:aws:iam::339712964409:role/rosettacloud-agentcore-runtime-role \
  -rf requirements.txt -r us-east-1 -ni

~/.local/bin/agentcore launch --auto-update-on-conflict \
  --env BEDROCK_AGENTCORE_MEMORY_ID=rosettacloud_education_memory_v2-vvC3mbAmra \
  --env GATEWAY_URL=$GATEWAY_URL

~/.local/bin/agentcore status
```

After launch, update the backend K8s ConfigMap with the new Runtime ARN:

```bash
# Get new ARN
~/.local/bin/agentcore status

# Update ConfigMap
kubectl edit configmap rosettacloud-config -n dev
# Set AGENT_RUNTIME_ARN to the new ARN

# Restart backend to pick it up
kubectl rollout restart deployment/rosettacloud-backend -n dev
```

---

## Step 7 — Restore DynamoDB Data (Optional)

If you want to restore previous user accounts and progress:

```bash
# The backup is at: backup-dynamodb-users-20260501.json
# Restore individual items with aws dynamodb put-item, or use a bulk restore script
python3 - <<'EOF'
import json, boto3

client = boto3.client('dynamodb', region_name='us-east-1')
with open('backup-dynamodb-users-20260501.json') as f:
    data = json.load(f)

for item in data['Items']:
    client.put_item(TableName='rosettacloud-users', Item=item)
    print(f"Restored: {item.get('user_id', {}).get('S', '?')}")
EOF
```

---

## Step 8 — Verify Everything

```bash
# DNS resolves
curl https://dev.rosettacloud.app
curl https://api.dev.rosettacloud.app/health-check

# Pods running
kubectl get pods -n dev

# Nodes scaled up (Karpenter provisions on first lab)
kubectl get nodes
```

---

## What Survives Destroy Automatically

| Resource | Where |
|---|---|
| All Terraform code | `DevSecOps/Terraform/` in git |
| K8s manifests | `DevSecOps/K8S/` in git |
| Backend code | `Backend/` in git |
| Frontend code | `Frontend/` in git |
| Shell script questions | `Backend/questions/` in git |
| Agent code + prompts | `Backend/agents/` in git |
| DynamoDB backup | `backup-dynamodb-users-20260501.json` in git |
| Terraform state | S3 bucket `rosettacloud-shared-terraform-backend` (not destroyed by Terraform) |

---

## Estimated Restore Time

| Step | Time |
|---|---|
| Terraform apply | ~20 min |
| Docker image builds (CI/CD) | ~10 min each |
| AgentCore launch (CodeBuild) | ~15 min |
| Questions sync + indexing | ~5 min |
| **Total** | **~60–90 min** |
