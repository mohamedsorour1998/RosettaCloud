# RosettaCloud DevSecOps

Infrastructure as Code (IaC), Kubernetes manifests, and container configurations for the RosettaCloud learning platform. Implements cloud-native architecture with AWS EKS, Istio service mesh, and automated CI/CD pipelines.

## 🏗️ Architecture Overview

**Infrastructure Stack:**
- **Terraform** — Infrastructure as Code for AWS resources
- **Kubernetes (EKS Auto Mode)** — Container orchestration
- **Istio** — Service mesh for traffic management
- **Docker** — Container runtime and image builds
- **GitHub Actions** — CI/CD automation with OIDC

**Key Components:**
- EKS cluster with custom Karpenter NodePool
- CloudFront CDN with ACM SSL certificates
- Route 53 DNS management
- ECR container registries
- S3 buckets for questions and vector store
- DynamoDB for user data
- EventBridge for S3 event triggers
- IAM roles with IRSA (IAM Roles for Service Accounts)

```
DevSecOps/
├── Terraform/
│   ├── environments/
│   │   └── shared/
│   │       ├── main.tf              # Main infrastructure definition
│   │       ├── variables.tf         # Input variables
│   │       ├── outputs.tf           # Output values
│   │       ├── providers.tf         # AWS provider configuration
│   │       ├── backend.tf           # S3 backend for state
│   │       └── terraform.tfvars     # Variable values
│   └── modules/
│       ├── eks/                     # EKS cluster module
│       ├── iam/                     # IAM roles module
│       ├── ec2/                     # EC2 instances (if needed)
│       ├── sg/                      # Security groups
│       └── [ecr, s3]/              # Other modules
├── K8S/
│   ├── be-deployment.yaml           # Backend deployment + service
│   ├── fe-deployment.yaml           # Frontend deployment + service
│   ├── backend-serviceaccount.yaml  # IRSA service account
│   ├── istio-gateway.yaml           # Istio Gateway
│   ├── istio-virtualservices.yaml   # Istio VirtualServices
│   └── nginx-nodeport.yaml          # Istio ingress NodePort
└── interactive-labs/
    └── Dockerfile                   # Lab container image
```

## 🚀 Quick Start

### Prerequisites

**Local Tools:**
- Terraform 1.5+
- kubectl 1.25+
- AWS CLI v2
- Docker
- Helm 3

**AWS Access:**
- AWS account with admin permissions
- AWS CLI configured: `aws configure`
- Region: `us-east-1`

### Terraform Deployment

**1. Initialize Terraform:**
```bash
cd Terraform/environments/shared
terraform init
```

**2. Review Plan:**
```bash
terraform plan -var-file="terraform.tfvars"
```

**3. Apply Infrastructure:**
```bash
terraform apply -var-file="terraform.tfvars"
```

**4. Get Outputs:**
```bash
terraform output
```

### Kubernetes Deployment

**1. Configure kubectl:**
```bash
aws eks update-kubeconfig --name rosettacloud-eks --region us-east-1
```

**2. Verify Connection:**
```bash
kubectl get nodes
kubectl get namespaces
```

**3. Create Namespace:**
```bash
kubectl create namespace dev
kubectl label namespace dev istio-injection=enabled
```

**4. Deploy Istio:**
```bash
# Install Istio (if not already installed)
istioctl install --set profile=default -y

# Verify Istio
kubectl get pods -n istio-system
```

**5. Deploy Applications:**
```bash
cd K8S
kubectl apply -f backend-serviceaccount.yaml
kubectl apply -f be-deployment.yaml
kubectl apply -f fe-deployment.yaml
kubectl apply -f istio-gateway.yaml
kubectl apply -f istio-virtualservices.yaml
kubectl apply -f nginx-nodeport.yaml
```

**6. Verify Deployments:**
```bash
kubectl get pods -n dev
kubectl get services -n dev
kubectl get gateway -n dev
kubectl get virtualservices -n dev
```

## 📊 Infrastructure Components

### 1. Terraform Infrastructure (`Terraform/environments/shared/main.tf`)

**VPC Configuration:**
```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.19.0"

  name = "rosettacloud-shared-vpc"
  cidr = "10.16.0.0/16"

  azs             = ["us-east-1a", "us-east-1b", "us-east-1c"]
  private_subnets = ["10.16.0.0/24", "10.16.1.0/24", "10.16.2.0/24"]
  public_subnets  = ["10.16.4.0/24", "10.16.5.0/24", "10.16.6.0/24"]

  enable_nat_gateway      = false
  map_public_ip_on_launch = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }
}
```

**EKS Cluster:**
```hcl
module "eks" {
  source = "../../modules/eks"

  eks_clusters = {
    rosettacloud = {
      name               = "rosettacloud-eks"
      kubernetes_version = "1.33"
      vpc_id             = module.vpc.vpc_id
      subnet_ids         = module.vpc.public_subnets

      endpoint_public_access  = true
      endpoint_private_access = true

      compute_config = {
        enabled    = true
        node_pools = ["general-purpose"]
      }

      enable_cluster_creator_admin_permissions = true
    }
  }
}
```

**Key Features:**
- **EKS Auto Mode** — Managed node groups with auto-scaling
- **Custom Karpenter NodePool** — `rosettacloud-spot` (t3.xlarge, spot instances, max 1 node)
- **Public Endpoints** — Accessible from internet
- **OIDC Provider** — For IRSA (IAM Roles for Service Accounts)

**Route 53 DNS:**
```hcl
module "route53" {
  source  = "terraform-aws-modules/route53/aws"
  version = "6.4.0"

  name = "rosettacloud.app"

  records = {
    dev = {
      type = "A"
      alias = {
        name    = module.cloudfront.cloudfront_distribution_domain_name
        zone_id = module.cloudfront.cloudfront_distribution_hosted_zone_id
      }
    }
    api_dev = {
      name = "api.dev"
      type = "A"
      alias = {
        name    = module.cloudfront.cloudfront_distribution_domain_name
        zone_id = module.cloudfront.cloudfront_distribution_hosted_zone_id
      }
    }
    wildcard_labs_dev = {
      name = "*.labs.dev"
      type = "A"
      alias = {
        name    = module.cloudfront.cloudfront_distribution_domain_name
        zone_id = module.cloudfront.cloudfront_distribution_hosted_zone_id
      }
    }
  }
}
```

**Domains:**
- `dev.rosettacloud.app` → Frontend
- `api.dev.rosettacloud.app` → Backend API
- `*.labs.dev.rosettacloud.app` → Lab pods (wildcard)

**ACM SSL Certificates:**
```hcl
module "acm" {
  source  = "terraform-aws-modules/acm/aws"
  version = "6.3.0"

  domain_name = "rosettacloud.app"
  zone_id     = module.route53.id

  validation_method = "DNS"

  subject_alternative_names = [
    "*.rosettacloud.app",
    "*.dev.rosettacloud.app",
    "*.labs.dev.rosettacloud.app"
  ]

  wait_for_validation = true
}
```

**CloudFront CDN:**
```hcl
module "cloudfront" {
  source  = "terraform-aws-modules/cloudfront/aws"
  version = "4.1.0"

  aliases = [
    "dev.rosettacloud.app",
    "api.dev.rosettacloud.app",
    "*.labs.dev.rosettacloud.app"
  ]

  viewer_certificate = {
    acm_certificate_arn      = module.acm.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  origin = {
    istio = {
      domain_name = var.node_public_dns  # EKS node public DNS
      custom_origin_config = {
        http_port              = var.istio_http_nodeport  # 30578
        https_port             = 443
        origin_protocol_policy = "http-only"
      }
    }
  }

  default_cache_behavior = {
    target_origin_id       = "istio"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer
  }
}
```

**Traffic Flow:**
```
User → CloudFront (HTTPS) → EKS Node (HTTP:30578) → Istio Ingress → Services
```

**ECR Repositories:**
```hcl
# 4 repositories created
module "ecr" {
  source = "terraform-aws-modules/ecr/aws"
  
  repository_name = "interactive-labs"
  repository_image_tag_mutability = "MUTABLE"
  
  repository_lifecycle_policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire images, keep last 5"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

# Also: rosettacloud-backend, rosettacloud-frontend, 
#       rosettacloud-document_indexer-lambda, rosettacloud-agent_tools-lambda
```


**S3 Buckets:**
```hcl
# 1. Questions bucket (shell scripts)
resource "aws_s3_bucket" "interactive_labs" {
  bucket = "rosettacloud-shared-interactive-labs"
}

resource "aws_s3_bucket_notification" "interactive_labs_eventbridge" {
  bucket      = aws_s3_bucket.interactive_labs.id
  eventbridge = true  # Enable EventBridge notifications
}

# 2. Vector store bucket (LanceDB)
resource "aws_s3_bucket" "interactive_labs_vector" {
  bucket = "rosettacloud-shared-interactive-labs-vector"
}
```

**EventBridge Rule:**
```hcl
resource "aws_cloudwatch_event_rule" "s3_sh_upload" {
  name        = "rosettacloud-s3-sh-upload"
  description = "Fires when a .sh file is uploaded to the interactive-labs bucket"

  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = { name = ["rosettacloud-shared-interactive-labs"] }
      object = { key = [{ suffix = ".sh" }] }
    }
  })
}

resource "aws_cloudwatch_event_target" "document_indexer" {
  rule      = aws_cloudwatch_event_rule.s3_sh_upload.name
  target_id = "document_indexer"
  arn       = "arn:aws:lambda:us-east-1:ACCOUNT_ID:function:document_indexer"
}
```

**Pipeline:**
```
.sh file uploaded to S3 → EventBridge → document_indexer Lambda → LanceDB indexing
```

**IAM Roles:**

1. **Backend IRSA Role:**
```hcl
resource "aws_iam_role" "backend_irsa" {
  name = "rosettacloud-backend-irsa"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.eks_oidc_provider_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.eks_oidc_issuer}:sub" = "system:serviceaccount:dev:rosettacloud-backend"
          "${local.eks_oidc_issuer}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "backend_irsa_permissions" {
  role = aws_iam_role.backend_irsa.id
  
  policy = jsonencode({
    Statement = [
      {
        Sid    = "DynamoDBTable"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", 
                  "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan"]
        Resource = ["arn:aws:dynamodb:us-east-1:ACCOUNT_ID:table/rosettacloud-*"]
      },
      {
        Sid    = "S3"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::rosettacloud-shared-interactive-labs",
          "arn:aws:s3:::rosettacloud-shared-interactive-labs/*"
        ]
      },
      {
        Sid    = "Bedrock"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = ["arn:aws:bedrock:us-east-1::foundation-model/*"]
      },
      {
        Sid    = "AgentCoreInvoke"
        Effect = "Allow"
        Action = ["bedrock-agentcore:InvokeAgentRuntime"]
        Resource = ["arn:aws:bedrock-agentcore:us-east-1:ACCOUNT_ID:runtime/*"]
      }
    ]
  })
}
```

2. **document_indexer Lambda Role:**
```hcl
resource "aws_iam_role" "document_indexer" {
  name = "rosettacloud-document-indexer-role"
  
  assume_role_policy = jsonencode({
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "document_indexer_permissions" {
  role = aws_iam_role.document_indexer.id
  
  policy = jsonencode({
    Statement = [
      {
        Sid    = "S3Read"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::rosettacloud-shared-interactive-labs",
          "arn:aws:s3:::rosettacloud-shared-interactive-labs/*"
        ]
      },
      {
        Sid    = "S3VectorWrite"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::rosettacloud-shared-interactive-labs-vector",
          "arn:aws:s3:::rosettacloud-shared-interactive-labs-vector/*"
        ]
      },
      {
        Sid    = "Bedrock"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = ["arn:aws:bedrock:us-east-1::foundation-model/*"]
      }
    ]
  })
}
```

3. **GitHub Actions OIDC Role:**
```hcl
module "iam" {
  source = "../../modules/iam"
  
  oidc_roles = [{
    name     = "github-actions-role"
    subjects = ["repo:mohamedsorour1998/RosettaCloud:*"]
    policies = {
      AmazonEC2ContainerRegistryFullAccess = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess"
      AWSLambda_FullAccess                 = "arn:aws:iam::aws:policy/AWSLambda_FullAccess"
      AmazonS3FullAccess                   = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
    }
  }]
}

# EKS access for kubectl rollout restart
resource "aws_eks_access_entry" "github_actions" {
  cluster_name  = module.eks.cluster_names["rosettacloud"]
  principal_arn = module.iam.role_arns["github-actions-role"]
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "github_actions_admin" {
  cluster_name  = module.eks.cluster_names["rosettacloud"]
  principal_arn = module.iam.role_arns["github-actions-role"]
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  
  access_scope {
    type = "cluster"
  }
}
```

**No Static Credentials:**
- GitHub Actions uses OIDC to assume IAM role
- Backend pods use IRSA (service account annotations)
- Lambda functions use execution roles

### 2. Kubernetes Manifests (`K8S/`)

**Backend Deployment (`be-deployment.yaml`):**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: rosettacloud-backend-config
  namespace: dev
data:
  LAB_IMAGE_PULL_SECRET: "ecr-creds"
  LAB_K8S_NAMESPACE: "dev"
  LAB_POD_IMAGE: "339712964409.dkr.ecr.us-east-1.amazonaws.com/interactive-labs:latest"
  AWS_REGION: "us-east-1"
  REDIS_HOST: "redis-service"
  REDIS_PORT: "6379"
  AGENT_RUNTIME_ARN: "arn:aws:bedrock-agentcore:us-east-1:ACCOUNT_ID:runtime/rosettacloud_education_agent-yebWcC9Yqy"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rosettacloud-backend
  namespace: dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: rosettacloud-backend
  template:
    metadata:
      labels:
        app: rosettacloud-backend
    spec:
      serviceAccountName: rosettacloud-backend  # IRSA
      containers:
        - name: rosettacloud-backend
          image: 339712964409.dkr.ecr.us-east-1.amazonaws.com/rosettacloud-backend:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 80
          envFrom:
            - configMapRef:
                name: rosettacloud-backend-config

---
apiVersion: v1
kind: Service
metadata:
  name: rosettacloud-backend-service
  namespace: dev
spec:
  selector:
    app: rosettacloud-backend
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80
  type: ClusterIP
```

**Backend Service Account (`backend-serviceaccount.yaml`):**
```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: rosettacloud-backend
  namespace: dev
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT_ID:role/rosettacloud-backend-irsa
```

**IRSA Flow:**
```
Pod → ServiceAccount → OIDC Provider → IAM Role → AWS API
```

**Frontend Deployment (`fe-deployment.yaml`):**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rosettacloud-frontend
  namespace: dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: rosettacloud-frontend
  template:
    metadata:
      labels:
        app: rosettacloud-frontend
    spec:
      containers:
        - name: rosettacloud-frontend
          image: 339712964409.dkr.ecr.us-east-1.amazonaws.com/rosettacloud-frontend:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 80

---
apiVersion: v1
kind: Service
metadata:
  name: rosettacloud-frontend-service
  namespace: dev
spec:
  selector:
    app: rosettacloud-frontend
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80
  type: ClusterIP
```

**Istio Gateway (`istio-gateway.yaml`):**
```yaml
apiVersion: networking.istio.io/v1
kind: Gateway
metadata:
  name: rosettacloud-gateway
  namespace: dev
spec:
  selector:
    istio: ingress
  servers:
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - "dev.rosettacloud.app"
        - "api.dev.rosettacloud.app"
        - "*.labs.dev.rosettacloud.app"
```

**Istio VirtualServices (`istio-virtualservices.yaml`):**
```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: rosettacloud-frontend
  namespace: dev
spec:
  hosts:
    - "dev.rosettacloud.app"
  gateways:
    - rosettacloud-gateway
  http:
    - route:
        - destination:
            host: rosettacloud-frontend-service.dev.svc.cluster.local
            port:
              number: 80

---
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: rosettacloud-backend
  namespace: dev
spec:
  hosts:
    - "api.dev.rosettacloud.app"
  gateways:
    - rosettacloud-gateway
  http:
    - route:
        - destination:
            host: rosettacloud-backend-service.dev.svc.cluster.local
            port:
              number: 80
```

**Istio Ingress NodePort (`nginx-nodeport.yaml`):**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: istio-ingress-nodeport
  namespace: istio-system
spec:
  type: NodePort
  selector:
    istio: ingress
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30578
      protocol: TCP
      name: http
```

**Traffic Flow:**
```
CloudFront → EKS Node:30578 → Istio Ingress → Gateway → VirtualService → Service → Pod
```


### 3. Interactive Labs Container (`interactive-labs/Dockerfile`)

**Multi-Tool Development Environment:**

**Base Image:**
- `codercom/code-server:noble` — VS Code in browser
- `docker:28-dind` — Docker-in-Docker

**Installed Tools:**
- **Code Editor:** code-server (VS Code)
- **Container Runtime:** Docker + dockerd
- **Kubernetes:** kubectl, Kind, Helm
- **Cloud:** AWS CLI
- **Languages:** Python 3, Node.js 22 (via nvm)
- **Web Server:** Caddy (reverse proxy)
- **Editors:** vim, nano
- **Utilities:** curl, jq, zip, unzip

**VS Code Extensions (Pre-installed):**
```dockerfile
RUN code-server \
  --install-extension ms-python.python \
  --install-extension ms-kubernetes-tools.vscode-kubernetes-tools \
  --install-extension ms-azuretools.vscode-docker \
  --install-extension hashicorp.terraform \
  --install-extension github.copilot \
  --install-extension github.copilot-chat \
  --install-extension redhat.vscode-yaml \
  # ... 20+ more extensions
```

**Startup Script (`/usr/local/bin/start.sh`):**
```bash
#!/usr/bin/env bash
set -e

# 1) Start code-server (port 8080)
sudo -u coder /usr/bin/code-server \
  --host 127.0.0.1 \
  --port 8080 \
  --auth none \
  --user-data-dir /data \
  --extensions-dir /data/extensions \
  /home/coder/lab &

# 2) Start Caddy (port 80, reverse proxy to code-server)
caddy run --config /etc/caddy/Caddyfile &

# 3) Start Docker daemon
nohup dockerd-entrypoint.sh dockerd > /var/log/dockerd.log 2>&1 &
while ! docker info > /dev/null 2>&1; do sleep 1; done

# 4) Load Kind image and create cluster
docker load -i /kind-node.tar
sudo -u coder bash -lc "kind create cluster --image=kindest/node:v1.33.0 --name rosettacloud"

# 5) Keep script alive
wait
```

**Caddy Configuration:**
```
:80 {
  header {
    -X-Frame-Options
    -Content-Security-Policy
    Content-Security-Policy "frame-ancestors *"
  }
  reverse_proxy 127.0.0.1:8080
}
```

**Key Features:**
- **Privileged Container** — Required for Docker-in-Docker
- **No Istio Sidecar** — Annotation: `sidecar.istio.io/inject: "false"`
- **Pre-loaded Kind Image** — `/kind-node.tar` (650MB+)
- **Readiness Probe** — HTTP GET `/` port 80 (Caddy)
- **Background Cluster Creation** — Kind cluster starts while user works

**Startup Timeline:**
1. code-server + Caddy start: ~2-3s
2. Readiness probe passes: ~6-10s (pod Ready)
3. dockerd starts: ~5-15s (background)
4. `docker load` Kind image: ~10-30s (background)
5. `kind create cluster`: ~30-60s (background)

**Image Size:** 1.86 GB

**Build:**
```bash
cd interactive-labs
docker build -t interactive-labs:latest .
docker tag interactive-labs:latest 339712964409.dkr.ecr.us-east-1.amazonaws.com/interactive-labs:latest
docker push 339712964409.dkr.ecr.us-east-1.amazonaws.com/interactive-labs:latest
```

## 🔄 CI/CD Pipelines

### GitHub Actions Workflows

**1. Backend Build (`.github/workflows/backend-build.yml`):**
```yaml
name: Backend Build and Deploy

on:
  push:
    branches: [main]
    paths:
      - 'Backend/app/**'
      - 'Backend/Dockerfile'
      - 'Backend/requirements.txt'

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT_ID:role/github-actions-role
          aws-region: us-east-1
      
      - name: Login to ECR
        run: |
          aws ecr get-login-password --region us-east-1 | \
          docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
      
      - name: Build and Push
        run: |
          cd Backend
          docker build -t rosettacloud-backend:${{ github.sha }} .
          docker tag rosettacloud-backend:${{ github.sha }} \
            ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/rosettacloud-backend:latest
          docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/rosettacloud-backend:latest
      
      - name: Update kubeconfig
        run: aws eks update-kubeconfig --name rosettacloud-eks --region us-east-1
      
      - name: Rollout Restart
        run: kubectl rollout restart deployment/rosettacloud-backend -n dev
```

**2. Frontend Build (`.github/workflows/frontend-build.yml`):**
- Similar to backend
- Triggers on `Frontend/src/**`, `Frontend/Dockerfile`, `Frontend/package.json`, etc.
- Builds multi-stage Docker image (Node.js → nginx)
- Pushes to ECR
- Restarts deployment

**3. Agent Deploy (`.github/workflows/agent-deploy.yml`):**
```yaml
name: Agent Deploy

on:
  push:
    branches: [main]
    paths:
      - 'Backend/agents/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT_ID:role/github-actions-role
          aws-region: us-east-1
      
      - name: Install agentcore CLI
        run: pip install bedrock-agentcore
      
      - name: Deploy Agent
        run: |
          cd Backend/agents
          agentcore launch --auto-update-on-conflict \
            --env BEDROCK_AGENTCORE_MEMORY_ID=${{ secrets.MEMORY_ID }} \
            --env GATEWAY_URL=${{ secrets.GATEWAY_URL }}
      
      - name: Get New Runtime ARN
        id: arn
        run: |
          NEW_ARN=$(agentcore status | grep "Runtime ARN" | awk '{print $3}')
          echo "arn=$NEW_ARN" >> $GITHUB_OUTPUT
      
      - name: Update ConfigMap
        run: |
          kubectl set env deployment/rosettacloud-backend \
            AGENT_RUNTIME_ARN=${{ steps.arn.outputs.arn }} -n dev
```

**4. Lambda Deploy (`.github/workflows/lambda-deploy.yml`):**
- Triggers on `Backend/serverless/Lambda/**`
- Builds container images for `document_indexer` and `agent_tools`
- Pushes to ECR
- Updates Lambda function code

**5. Questions Sync (`.github/workflows/questions-sync.yml`):**
```yaml
name: Questions Sync

on:
  push:
    branches: [main]
    paths:
      - 'Backend/questions/**'

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT_ID:role/github-actions-role
          aws-region: us-east-1
      
      - name: Sync to S3
        run: |
          aws s3 sync Backend/questions/ \
            s3://rosettacloud-shared-interactive-labs/ \
            --delete
```

**6. Interactive Labs Build (`.github/workflows/interactive-labs-build.yml`):**
- Triggers on `DevSecOps/interactive-labs/**`
- Builds lab container image
- Pushes to ECR

**Authentication:**
All workflows use **GitHub OIDC** — no static AWS credentials stored in secrets.

**IAM Trust Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:mohamedsorour1998/RosettaCloud:*"
      }
    }
  }]
}
```

## 🔧 Configuration Management

### Terraform Variables (`terraform.tfvars`)

```hcl
github_oidc_roles = [
  {
    name     = "github-actions-role"
    subjects = ["repo:mohamedsorour1998/RosettaCloud:*"]
    policies = {
      AmazonEC2ContainerRegistryFullAccess = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess"
      AWSLambda_FullAccess                 = "arn:aws:iam::aws:policy/AWSLambda_FullAccess"
      AmazonS3FullAccess                   = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
    }
    tags = { Environment = "dev" }
  }
]

node_public_dns     = "ec2-54-87-145-36.compute-1.amazonaws.com"
istio_http_nodeport = 30578
```

**Update After Node Changes:**
```bash
# Get new node public DNS
kubectl get nodes -o wide

# Update terraform.tfvars
node_public_dns = "ec2-XX-XX-XX-XX.compute-1.amazonaws.com"

# Apply changes
terraform apply -var-file="terraform.tfvars"
```

### Kubernetes ConfigMap Updates

**Update Agent Runtime ARN:**
```bash
# After agentcore launch
NEW_ARN=$(agentcore status | grep "Runtime ARN" | awk '{print $3}')

# Update ConfigMap
kubectl edit configmap rosettacloud-backend-config -n dev
# Or
kubectl set env deployment/rosettacloud-backend AGENT_RUNTIME_ARN=$NEW_ARN -n dev
```

**Update Lab Image:**
```bash
kubectl set env deployment/rosettacloud-backend \
  LAB_POD_IMAGE=339712964409.dkr.ecr.us-east-1.amazonaws.com/interactive-labs:v2.0 \
  -n dev
```

## 🔐 Security Best Practices

### Network Security

**VPC Configuration:**
- Public subnets for EKS nodes (NAT gateway disabled for cost)
- Private subnets for future RDS/ElastiCache
- Security groups restrict traffic

**Istio Service Mesh:**
- mTLS between services (except lab pods)
- Lab pods opt out: `sidecar.istio.io/inject: "false"`
- Traffic policies and rate limiting

**CloudFront:**
- HTTPS only (redirect HTTP to HTTPS)
- TLS 1.2+ minimum
- Origin protocol: HTTP (internal network)

### IAM Security

**Principle of Least Privilege:**
- Backend IRSA: Only DynamoDB, S3, Bedrock, AgentCore
- Lambda roles: Scoped to specific resources
- GitHub Actions: Only ECR, Lambda, S3, EKS

**No Static Credentials:**
- IRSA for pods (service account annotations)
- OIDC for GitHub Actions
- Execution roles for Lambda

**Resource-Based Policies:**
```hcl
# S3 bucket policy (example)
resource "aws_s3_bucket_policy" "interactive_labs" {
  bucket = aws_s3_bucket.interactive_labs.id
  
  policy = jsonencode({
    Statement = [{
      Sid    = "DenyInsecureTransport"
      Effect = "Deny"
      Principal = "*"
      Action = "s3:*"
      Resource = [
        aws_s3_bucket.interactive_labs.arn,
        "${aws_s3_bucket.interactive_labs.arn}/*"
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })
}
```

### Container Security

**ECR Image Scanning:**
```hcl
resource "aws_ecr_repository" "interactive_labs" {
  name = "interactive-labs"
  
  image_scanning_configuration {
    scan_on_push = true
  }
}
```

**Pod Security:**
- Lab pods run privileged (required for Docker-in-Docker)
- Backend/frontend pods run as non-root
- Resource limits enforced

**Secrets Management:**
- No secrets in ConfigMaps
- Use AWS Secrets Manager for sensitive data
- IRSA provides temporary credentials


## 🐛 Troubleshooting

### Common Issues

**1. Terraform State Lock**

**Symptoms:**
- `terraform apply` fails with "Error acquiring the state lock"
- Another process is holding the lock

**Solution:**
```bash
# Force unlock (use with caution)
terraform force-unlock LOCK_ID

# Or wait for lock to expire (usually 15 minutes)
```

**2. EKS Node Not Ready**

**Symptoms:**
- `kubectl get nodes` shows NotReady
- Pods stuck in Pending state

**Diagnosis:**
```bash
kubectl describe node NODE_NAME
kubectl get events --all-namespaces --sort-by='.lastTimestamp'
```

**Common Causes:**
- Karpenter NodePool not created
- Instance type unavailable (spot)
- Insufficient capacity

**Solution:**
```bash
# Check Karpenter logs
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter

# Create NodePool manually
kubectl apply -f - <<EOF
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: rosettacloud-spot
spec:
  template:
    spec:
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot"]
        - key: node.kubernetes.io/instance-type
          operator: In
          values: ["t3.xlarge"]
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
  limits:
    cpu: "4"
  disruption:
    consolidationPolicy: WhenEmpty
    consolidateAfter: 30s
EOF
```

**3. Istio Gateway Not Working**

**Symptoms:**
- 404 errors when accessing domains
- CloudFront returns origin errors

**Diagnosis:**
```bash
# Check Istio ingress
kubectl get pods -n istio-system
kubectl logs -n istio-system -l istio=ingress

# Check Gateway and VirtualServices
kubectl get gateway -n dev
kubectl get virtualservices -n dev

# Test NodePort directly
curl http://NODE_PUBLIC_DNS:30578 -H "Host: dev.rosettacloud.app"
```

**Solution:**
```bash
# Restart Istio ingress
kubectl rollout restart deployment/istio-ingress -n istio-system

# Verify NodePort service
kubectl get svc istio-ingress-nodeport -n istio-system

# Update CloudFront origin if node changed
# Update terraform.tfvars with new node_public_dns
terraform apply -var-file="terraform.tfvars"
```

**4. Lab Pods Not Starting**

**Symptoms:**
- Lab pods stuck in Pending or ImagePullBackOff
- Backend returns "Failed to create lab"

**Diagnosis:**
```bash
# Check pod status
kubectl get pods -n dev -l app=interactive-labs

# Describe pod
kubectl describe pod lab-XXXXX -n dev

# Check events
kubectl get events -n dev --sort-by='.lastTimestamp' | grep lab-
```

**Common Causes:**
- ECR credentials expired
- Image not found
- Insufficient node resources

**Solution:**
```bash
# Recreate ECR credentials secret
kubectl delete secret ecr-creds -n dev
kubectl create secret docker-registry ecr-creds \
  --docker-server=339712964409.dkr.ecr.us-east-1.amazonaws.com \
  --docker-username=AWS \
  --docker-password=$(aws ecr get-login-password --region us-east-1) \
  -n dev

# Check node resources
kubectl top nodes
kubectl describe node NODE_NAME | grep -A 5 "Allocated resources"

# Scale down other pods if needed
kubectl scale deployment/rosettacloud-backend --replicas=0 -n dev
```

**5. CloudFront Cache Issues**

**Symptoms:**
- Old version of frontend/backend served
- Changes not reflected after deployment

**Solution:**
```bash
# Create invalidation
aws cloudfront create-invalidation \
  --distribution-id DISTRIBUTION_ID \
  --paths "/*"

# Or use cache policy with short TTL
# Already configured: CachingDisabled policy
```

**6. IRSA Not Working**

**Symptoms:**
- Backend pod can't access DynamoDB/S3/Bedrock
- Error: "Unable to locate credentials"

**Diagnosis:**
```bash
# Check service account
kubectl get sa rosettacloud-backend -n dev -o yaml

# Verify annotation
kubectl get sa rosettacloud-backend -n dev -o jsonpath='{.metadata.annotations}'

# Check pod environment
kubectl exec -it POD_NAME -n dev -- env | grep AWS
```

**Solution:**
```bash
# Verify IAM role exists
aws iam get-role --role-name rosettacloud-backend-irsa

# Verify trust policy
aws iam get-role --role-name rosettacloud-backend-irsa \
  --query 'Role.AssumeRolePolicyDocument'

# Recreate service account
kubectl delete sa rosettacloud-backend -n dev
kubectl apply -f K8S/backend-serviceaccount.yaml

# Restart deployment
kubectl rollout restart deployment/rosettacloud-backend -n dev
```

## 📊 Monitoring & Observability

### CloudWatch Logs

**Lambda Logs:**
```bash
# document_indexer
aws logs tail /aws/lambda/document_indexer --follow

# agent_tools
aws logs tail /aws/lambda/agent_tools --follow
```

**EKS Control Plane Logs:**
```bash
# Enable control plane logging (if not already enabled)
aws eks update-cluster-config \
  --name rosettacloud-eks \
  --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":true}]}'

# View logs
aws logs tail /aws/eks/rosettacloud-eks/cluster --follow
```

### Kubernetes Monitoring

**Pod Logs:**
```bash
# Backend
kubectl logs -f deployment/rosettacloud-backend -n dev

# Frontend
kubectl logs -f deployment/rosettacloud-frontend -n dev

# Lab pod
kubectl logs -f lab-XXXXX -n dev

# Istio ingress
kubectl logs -f -n istio-system -l istio=ingress
```

**Resource Usage:**
```bash
# Node metrics
kubectl top nodes

# Pod metrics
kubectl top pods -n dev

# Specific pod
kubectl top pod POD_NAME -n dev
```

**Events:**
```bash
# All events
kubectl get events --all-namespaces --sort-by='.lastTimestamp'

# Namespace events
kubectl get events -n dev --sort-by='.lastTimestamp'

# Watch events
kubectl get events -n dev --watch
```

### Cost Monitoring

**AWS Cost Explorer:**
- Monitor EKS cluster costs
- Track ECR storage costs
- Review CloudFront data transfer
- Analyze Lambda invocations

**Key Cost Drivers:**
- EKS cluster: ~$73/month (control plane)
- EC2 instances: ~$25/month (t3.xlarge spot)
- CloudFront: Pay-as-you-go (data transfer)
- S3: Minimal (storage + requests)
- Lambda: Minimal (free tier covers most usage)

**Cost Optimization:**
- Use spot instances for EKS nodes
- Disable NAT gateway (use public subnets)
- ECR lifecycle policies (keep last 5 images)
- CloudFront caching (reduce origin requests)
- Lambda memory optimization

## 🚀 Deployment Checklist

### Initial Setup

- [ ] Configure AWS CLI with admin credentials
- [ ] Install Terraform, kubectl, Helm
- [ ] Clone repository
- [ ] Update `terraform.tfvars` with your values
- [ ] Run `terraform init`
- [ ] Run `terraform plan` and review
- [ ] Run `terraform apply`
- [ ] Configure kubectl: `aws eks update-kubeconfig --name rosettacloud-eks`
- [ ] Install Istio: `istioctl install --set profile=default -y`
- [ ] Create namespace: `kubectl create namespace dev`
- [ ] Enable Istio injection: `kubectl label namespace dev istio-injection=enabled`
- [ ] Deploy Kubernetes manifests: `kubectl apply -f K8S/`
- [ ] Verify deployments: `kubectl get pods -n dev`
- [ ] Test domains: `curl https://dev.rosettacloud.app`

### Application Updates

**Backend:**
- [ ] Make code changes in `Backend/app/`
- [ ] Commit and push to `main` branch
- [ ] GitHub Actions builds and deploys automatically
- [ ] Verify: `kubectl get pods -n dev -l app=rosettacloud-backend`

**Frontend:**
- [ ] Make code changes in `Frontend/src/`
- [ ] Commit and push to `main` branch
- [ ] GitHub Actions builds and deploys automatically
- [ ] Verify: `kubectl get pods -n dev -l app=rosettacloud-frontend`

**Agent:**
- [ ] Make code changes in `Backend/agents/`
- [ ] Commit and push to `main` branch
- [ ] GitHub Actions deploys via `agentcore launch`
- [ ] ConfigMap updated with new ARN
- [ ] Verify: `agentcore status`

**Lambda:**
- [ ] Make code changes in `Backend/serverless/Lambda/`
- [ ] Commit and push to `main` branch
- [ ] GitHub Actions builds and updates Lambda
- [ ] Verify: `aws lambda get-function --function-name document_indexer`

**Questions:**
- [ ] Add/update shell scripts in `Backend/questions/`
- [ ] Commit and push to `main` branch
- [ ] GitHub Actions syncs to S3
- [ ] EventBridge triggers document_indexer
- [ ] Verify: `aws s3 ls s3://rosettacloud-shared-interactive-labs/`

**Interactive Labs:**
- [ ] Make changes to `DevSecOps/interactive-labs/Dockerfile`
- [ ] Commit and push to `main` branch
- [ ] GitHub Actions builds and pushes to ECR
- [ ] Update ConfigMap if image tag changed
- [ ] Restart backend: `kubectl rollout restart deployment/rosettacloud-backend -n dev`

## 📚 Additional Resources

### Documentation
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Istio Documentation](https://istio.io/latest/docs/)
- [EKS Best Practices](https://aws.github.io/aws-eks-best-practices/)
- [Karpenter Documentation](https://karpenter.sh/)

### AWS Services
- [Amazon EKS](https://docs.aws.amazon.com/eks/)
- [Amazon ECR](https://docs.aws.amazon.com/ecr/)
- [AWS CloudFront](https://docs.aws.amazon.com/cloudfront/)
- [Amazon Route 53](https://docs.aws.amazon.com/route53/)
- [AWS Certificate Manager](https://docs.aws.amazon.com/acm/)

### Related Files
- `../Backend/` — FastAPI backend
- `../Frontend/` — Angular frontend
- `../CLAUDE.md` — Technical implementation guide
- `../README.md` — Project overview

## 👨‍💻 Contributing

### Infrastructure Changes

**Terraform:**
1. Make changes in `Terraform/environments/shared/`
2. Run `terraform fmt` to format
3. Run `terraform validate` to validate
4. Run `terraform plan` to preview
5. Commit and push (manual apply required)

**Kubernetes:**
1. Make changes in `K8S/`
2. Test in local cluster first
3. Apply to dev: `kubectl apply -f K8S/`
4. Verify: `kubectl get all -n dev`
5. Commit and push

**Docker:**
1. Make changes to Dockerfile
2. Build locally: `docker build -t test .`
3. Test container: `docker run -p 8080:80 test`
4. Commit and push (CI/CD builds and deploys)

### Best Practices

**Terraform:**
- Use modules for reusable components
- Tag all resources with `Environment`, `Project`, `Terraform`
- Use remote state (S3 backend)
- Enable state locking (DynamoDB)
- Use workspaces for multiple environments

**Kubernetes:**
- Use namespaces for isolation
- Set resource requests and limits
- Use ConfigMaps for configuration
- Use Secrets for sensitive data
- Implement health checks (readiness/liveness probes)

**Docker:**
- Use multi-stage builds
- Minimize image size
- Don't run as root (except lab pods)
- Use specific image tags (not `latest`)
- Scan images for vulnerabilities

---

**Last Updated:** 2026-03-06  
**Maintainer:** Mohamed Sorour (mohamedsorour1998@gmail.com)  
**License:** MIT

