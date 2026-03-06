# RosettaCloud: API Gateway + Cognito Migration Plan

## Part 3: Terraform Changes

### 3.1 New Terraform Module Structure

```
DevSecOps/Terraform/
├── environments/
│   └── shared/
│       ├── main.tf                    # MODIFIED
│       ├── terraform.tfvars           # MODIFIED
│       ├── outputs.tf                 # MODIFIED
│       └── variables.tf               # MODIFIED
└── modules/
    └── api-gateway-auth/              # NEW MODULE
        ├── main.tf                    # Cognito + API Gateway
        ├── variables.tf               # Module variables
        ├── outputs.tf                 # Module outputs
        └── README.md                  # Module documentation
```

### 3.2 New Terraform Module: api-gateway-auth

**File: DevSecOps/Terraform/modules/api-gateway-auth/main.tf**

```hcl
# ============================================================================
# Cognito User Pool
# ============================================================================

resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-users"

  # Password policy
  password_policy {
    minimum_length                   = 8
    require_uppercase                = true
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # Email configuration
  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]
  
  # MFA configuration
  mfa_configuration = "OFF"

  # Email schema
  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
  }

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # User pool add-ons
  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }

  tags = var.tags
}

# ============================================================================
# Cognito User Pool Client
# ============================================================================

resource "aws_cognito_user_pool_client" "frontend" {
  name         = "${var.project_name}-frontend"
  user_pool_id = aws_cognito_user_pool.main.id

  # OAuth configuration
  generate_secret                      = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  allowed_oauth_flows_user_pool_client = true
  supported_identity_providers         = ["COGNITO"]

  # Callback URLs
  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  # Token validity
  access_token_validity  = 1  # 1 hour
  id_token_validity      = 1  # 1 hour
  refresh_token_validity = 30 # 30 days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Auth flows
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH"
  ]

  # Prevent user existence errors
  prevent_user_existence_errors = "ENABLED"

  # Read/write attributes
  read_attributes  = ["email", "email_verified", "name"]
  write_attributes = ["email", "name"]
}

# ============================================================================
# Cognito Domain
# ============================================================================

resource "random_id" "domain_suffix" {
  byte_length = 4
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project_name}-auth-${random_id.domain_suffix.hex}"
  user_pool_id = aws_cognito_user_pool.main.id
}

# ============================================================================
# API Gateway HTTP API
# ============================================================================

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"
  description   = "API Gateway for ${var.project_name}"

  # CORS configuration
  cors_configuration {
    allow_origins     = var.cors_allow_origins
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
    allow_headers     = ["Authorization", "Content-Type", "X-Amz-Date", "X-Api-Key", "X-Amz-Security-Token"]
    expose_headers    = ["Content-Length", "Content-Type"]
    max_age           = 300
    allow_credentials = true
  }

  tags = var.tags
}

# ============================================================================
# JWT Authorizer
# ============================================================================

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-authorizer"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.frontend.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

# ============================================================================
# VPC Link
# ============================================================================

resource "aws_security_group" "vpclink" {
  name        = "${var.project_name}-vpclink-sg"
  description = "Security group for API Gateway VPC Link"
  vpc_id      = var.vpc_id

  # Allow egress to EKS nodes on NodePort
  egress {
    description = "Allow traffic to EKS nodes"
    from_port   = var.eks_nodeport
    to_port     = var.eks_nodeport
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = merge(
    var.tags,
    {
      Name = "${var.project_name}-vpclink-sg"
    }
  )
}

resource "aws_apigatewayv2_vpc_link" "main" {
  name               = "${var.project_name}-vpclink"
  security_group_ids = [aws_security_group.vpclink.id]
  subnet_ids         = var.private_subnet_ids

  tags = var.tags
}

# ============================================================================
# Integration to EKS
# ============================================================================

resource "aws_apigatewayv2_integration" "eks" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "HTTP_PROXY"
  integration_method = "ANY"
  integration_uri  = "http://${var.eks_node_ip}:${var.eks_nodeport}/{proxy}"
  
  connection_type = "VPC_LINK"
  connection_id   = aws_apigatewayv2_vpc_link.main.id
  
  payload_format_version = "1.0"
  timeout_milliseconds   = 30000

  # Pass through request parameters
  request_parameters = {
    "overwrite:path" = "$request.path"
  }
}

# ============================================================================
# Routes
# ============================================================================

# Catch-all route with JWT authorizer
resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.eks.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Health check route (no auth)
resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /health-check"
  target    = "integrations/${aws_apigatewayv2_integration.eks.id}"

  authorization_type = "NONE"
}

# ============================================================================
# Stage
# ============================================================================

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  # Access logging
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
      errorMessage   = "$context.error.message"
      authorizerError = "$context.authorizer.error"
    })
  }

  # Default route settings
  default_route_settings {
    throttling_burst_limit = 5000
    throttling_rate_limit  = 10000
  }

  tags = var.tags
}

# ============================================================================
# CloudWatch Log Group
# ============================================================================

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${var.project_name}"
  retention_in_days = 7

  tags = var.tags
}

# ============================================================================
# Outputs
# ============================================================================

output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_client_id" {
  description = "Cognito User Pool Client ID"
  value       = aws_cognito_user_pool_client.frontend.id
  sensitive   = true
}

output "user_pool_client_secret" {
  description = "Cognito User Pool Client Secret"
  value       = aws_cognito_user_pool_client.frontend.client_secret
  sensitive   = true
}

output "cognito_domain" {
  description = "Cognito Hosted UI Domain"
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "api_gateway_id" {
  description = "API Gateway ID"
  value       = aws_apigatewayv2_api.main.id
}

output "api_gateway_endpoint" {
  description = "API Gateway Endpoint"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "api_gateway_arn" {
  description = "API Gateway ARN"
  value       = aws_apigatewayv2_api.main.arn
}

output "vpc_link_id" {
  description = "VPC Link ID"
  value       = aws_apigatewayv2_vpc_link.main.id
}
```

**File: DevSecOps/Terraform/modules/api-gateway-auth/variables.tf**

```hcl
variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where EKS cluster is deployed"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for VPC Link"
  type        = list(string)
}

variable "eks_node_ip" {
  description = "EKS node private IP address"
  type        = string
}

variable "eks_nodeport" {
  description = "EKS NodePort for Istio ingress"
  type        = number
  default     = 30578
}

variable "callback_urls" {
  description = "Cognito callback URLs"
  type        = list(string)
}

variable "logout_urls" {
  description = "Cognito logout URLs"
  type        = list(string)
}

variable "cors_allow_origins" {
  description = "CORS allowed origins"
  type        = list(string)
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}
```

### 3.3 Modified Main Terraform Configuration

**File: DevSecOps/Terraform/environments/shared/main.tf**

Add this module after existing resources:

```hcl
# ============================================================================
# API Gateway + Cognito Authentication Module
# ============================================================================

# Data source to get EKS node IP
data "aws_instances" "eks_nodes" {
  filter {
    name   = "tag:eks:cluster-name"
    values = [module.eks.cluster_name]
  }

  filter {
    name   = "instance-state-name"
    values = ["running"]
  }
}

module "api_gateway_auth" {
  source = "../../modules/api-gateway-auth"

  project_name       = var.project_name
  aws_region         = var.aws_region
  vpc_id             = module.vpc.vpc_id
  vpc_cidr           = module.vpc.vpc_cidr_block
  private_subnet_ids = module.vpc.private_subnets
  eks_node_ip        = data.aws_instances.eks_nodes.private_ips[0]
  eks_nodeport       = 30578

  callback_urls = [
    "https://${var.domain_name}/auth/callback",
    "http://localhost:4200/auth/callback"  # For local dev
  ]

  logout_urls = [
    "https://${var.domain_name}/logout",
    "http://localhost:4200/logout"
  ]

  cors_allow_origins = [
    "https://${var.domain_name}",
    "http://localhost:4200"
  ]

  tags = local.common_tags
}

# ============================================================================
# Update CloudFront Distribution Origin
# ============================================================================

# Modify existing CloudFront distribution
resource "aws_cloudfront_distribution" "main" {
  # ... existing configuration ...

  origin {
    domain_name = replace(module.api_gateway_auth.api_gateway_endpoint, "https://", "")
    origin_id   = "api-gateway"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # Pass Authorization header to origin
    custom_header {
      name  = "X-Forwarded-Host"
      value = var.domain_name
    }
  }

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD", "OPTIONS"]
    target_origin_id = "api-gateway"

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Accept", "Content-Type"]

      cookies {
        forward = "all"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
    compress               = true
  }

  # ... rest of existing configuration ...
}
```

**File: DevSecOps/Terraform/environments/shared/outputs.tf**

Add these outputs:

```hcl
# ============================================================================
# API Gateway + Cognito Outputs
# ============================================================================

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.api_gateway_auth.user_pool_id
}

output "cognito_user_pool_client_id" {
  description = "Cognito User Pool Client ID"
  value       = module.api_gateway_auth.user_pool_client_id
  sensitive   = true
}

output "cognito_domain" {
  description = "Cognito Hosted UI Domain"
  value       = module.api_gateway_auth.cognito_domain
}

output "api_gateway_endpoint" {
  description = "API Gateway Endpoint"
  value       = module.api_gateway_auth.api_gateway_endpoint
}

output "api_gateway_id" {
  description = "API Gateway ID"
  value       = module.api_gateway_auth.api_gateway_id
}

# Instructions for frontend configuration
output "frontend_config_instructions" {
  description = "Instructions for configuring frontend"
  value = <<-EOT
    Add these values to Frontend/src/environments/environment.ts:
    
    export const environment = {
      production: false,
      apiUrl: 'https://${var.domain_name}',
      cognito: {
        userPoolId: '${module.api_gateway_auth.user_pool_id}',
        userPoolClientId: '${module.api_gateway_auth.user_pool_client_id}',
        domain: '${module.api_gateway_auth.cognito_domain}',
        region: '${var.aws_region}'
      }
    };
  EOT
}
```

### 3.4 Terraform Apply Steps

```bash
# 1. Navigate to Terraform directory
cd DevSecOps/Terraform/environments/shared

# 2. Initialize Terraform (download new providers)
terraform init

# 3. Validate configuration
terraform validate

# 4. Plan changes (review before applying)
terraform plan -out=tfplan

# Expected changes:
# + 15 resources to add (Cognito, API Gateway, VPC Link, etc.)
# ~ 1 resource to modify (CloudFront distribution)
# 0 resources to destroy

# 5. Apply changes
terraform apply tfplan

# 6. Save outputs to file
terraform output -json > /tmp/terraform-outputs.json

# 7. Extract Cognito config for frontend
terraform output frontend_config_instructions
```

### 3.5 Terraform State Management

**Before applying:**
```bash
# Backup current state
terraform state pull > /tmp/terraform-state-backup-$(date +%Y%m%d-%H%M%S).json

# List current resources
terraform state list
```

**After applying:**
```bash
# Verify new resources
terraform state list | grep -E "(cognito|apigateway)"

# Expected output:
# module.api_gateway_auth.aws_cognito_user_pool.main
# module.api_gateway_auth.aws_cognito_user_pool_client.frontend
# module.api_gateway_auth.aws_cognito_user_pool_domain.main
# module.api_gateway_auth.aws_apigatewayv2_api.main
# module.api_gateway_auth.aws_apigatewayv2_authorizer.cognito
# module.api_gateway_auth.aws_apigatewayv2_vpc_link.main
# module.api_gateway_auth.aws_apigatewayv2_integration.eks
# module.api_gateway_auth.aws_apigatewayv2_route.proxy
# module.api_gateway_auth.aws_apigatewayv2_stage.default
# module.api_gateway_auth.aws_security_group.vpclink
# module.api_gateway_auth.aws_cloudwatch_log_group.api_gateway
```

### 3.6 Rollback Plan

If issues occur:

```bash
# 1. Revert CloudFront origin to EKS NodePort
terraform apply -target=aws_cloudfront_distribution.main \
  -var="use_api_gateway=false"

# 2. If needed, destroy API Gateway resources
terraform destroy -target=module.api_gateway_auth

# 3. Restore from state backup
terraform state push /tmp/terraform-state-backup-YYYYMMDD-HHMMSS.json
```

### 3.7 Cost Tracking

Add cost tags to track new resources:

```hcl
locals {
  common_tags = {
    Project     = "RosettaCloud"
    Environment = "dev"
    ManagedBy   = "Terraform"
    CostCenter  = "Engineering"
    Component   = "Authentication"  # NEW
  }
}
```

Query costs:
```bash
# Get API Gateway costs
aws ce get-cost-and-usage \
  --time-period Start=2026-03-01,End=2026-03-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --filter file://filter.json

# filter.json
{
  "Tags": {
    "Key": "Component",
    "Values": ["Authentication"]
  }
}
```

---

## Summary of Terraform Changes

**New Resources (15):**
- 1 Cognito User Pool
- 1 Cognito User Pool Client
- 1 Cognito Domain
- 1 API Gateway HTTP API
- 1 JWT Authorizer
- 1 VPC Link
- 1 Security Group (VPC Link)
- 1 API Gateway Integration
- 2 API Gateway Routes
- 1 API Gateway Stage
- 1 CloudWatch Log Group
- 3 Random IDs

**Modified Resources (1):**
- CloudFront Distribution (origin change)

**Total Changes:** 16 resources

**Next:** Part 4 will detail the backend code changes.
