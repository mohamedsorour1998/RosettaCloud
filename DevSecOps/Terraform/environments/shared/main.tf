data "aws_availability_zones" "available" {}
data "aws_caller_identity" "current" {}

locals {
  name       = "rosettacloud-shared"
  region     = "us-east-1"
  account_id = data.aws_caller_identity.current.account_id

  vpc_cidr = "10.16.0.0/16"

  azs = slice(data.aws_availability_zones.available.names, 0, 3)

  eks_oidc_provider_arn = module.eks.oidc_provider_arns["rosettacloud"]
  eks_oidc_issuer       = replace(local.eks_oidc_provider_arn, "/^arn:aws[^:]*:iam::\\d+:oidc-provider\\//", "")

  tags = {
    Terraform   = "true"
    Environment = "shared"
    Project     = "RosettaCloud"
  }
}

################################################################################
# VPC Module
################################################################################
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.19.0"

  name = "${local.name}-vpc"
  cidr = local.vpc_cidr

  azs                          = local.azs
  private_subnets              = [for k, v in local.azs : cidrsubnet(local.vpc_cidr, 8, k)]
  public_subnets               = [for k, v in local.azs : cidrsubnet(local.vpc_cidr, 8, k + 4)]
  database_subnets             = [for k, v in local.azs : cidrsubnet(local.vpc_cidr, 8, k + 8)]
  create_database_subnet_group = true

  private_subnet_names  = ["${local.name}-private-subnet-a", "${local.name}-private-subnet-b", "${local.name}-private-subnet-c"]
  public_subnet_names   = ["${local.name}-public-subnet-a", "${local.name}-public-subnet-b", "${local.name}-public-subnet-c"]
  database_subnet_names = ["${local.name}-database-subnet-a", "${local.name}-database-subnet-b", "${local.name}-database-subnet-c"]

  enable_dns_hostnames = true
  enable_dns_support   = true

  enable_nat_gateway      = false
  map_public_ip_on_launch = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }

  tags = local.tags
}

################################################################################
# IAM Module
################################################################################
module "iam" {
  source     = "../../modules/iam"
  oidc_roles = var.github_oidc_roles
}

################################################################################
# EKS Module
################################################################################
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

      tags = local.tags
    }
  }
}

################################################################################
# Route53 Module
################################################################################
module "route53" {
  source  = "terraform-aws-modules/route53/aws"
  version = "6.4.0"

  name = "rosettacloud.app"

  records = {
    dev = {
      type = "A"
      alias = {
        name                   = module.cloudfront.cloudfront_distribution_domain_name
        zone_id                = module.cloudfront.cloudfront_distribution_hosted_zone_id
        evaluate_target_health = false
      }
    }
    wildcard_labs_dev = {
      name = "*.labs.dev"
      type = "A"
      alias = {
        name                   = module.cloudfront.cloudfront_distribution_domain_name
        zone_id                = module.cloudfront.cloudfront_distribution_hosted_zone_id
        evaluate_target_health = false
      }
    }
  }

  tags = local.tags
}

################################################################################
# ACM Module
################################################################################
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

  tags = local.tags
}

################################################################################
# CloudFront Module
################################################################################
module "cloudfront" {
  source  = "terraform-aws-modules/cloudfront/aws"
  version = "4.1.0"

  aliases = [
    "dev.rosettacloud.app",
    "api.dev.rosettacloud.app",
    "*.labs.dev.rosettacloud.app"
  ]

  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"
  comment         = "RosettaCloud Istio ingress"

  viewer_certificate = {
    acm_certificate_arn      = module.acm.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  origin = {
    istio = {
      domain_name = var.node_public_dns
      custom_origin_config = {
        http_port              = var.istio_http_nodeport
        https_port             = 443
        origin_protocol_policy = "http-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  default_cache_behavior = {
    target_origin_id       = "istio"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    use_forwarded_values   = false

    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer
  }

  tags = local.tags
}

################################################################################
# ECR Module
################################################################################
module "ecr" {
  source  = "terraform-aws-modules/ecr/aws"
  version = "2.4.0"

  repository_name                 = "interactive-labs"
  repository_image_tag_mutability = "MUTABLE"
  repository_read_write_access_arns = [
    "arn:aws:iam::339712964409:root"
  ]

  repository_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire images, keep last 5"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = { type = "expire" }
      }
    ]
  })

  tags = local.tags
}

module "ecr_1" {
  source  = "terraform-aws-modules/ecr/aws"
  version = "2.4.0"

  repository_name                 = "rosettacloud-backend"
  repository_image_tag_mutability = "MUTABLE"
  repository_read_write_access_arns = [
    "arn:aws:iam::339712964409:root"
  ]

  repository_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire images, keep last 5"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = { type = "expire" }
      }
    ]
  })

  tags = local.tags
}

module "ecr_2" {
  source  = "terraform-aws-modules/ecr/aws"
  version = "2.4.0"

  repository_name                 = "rosettacloud-frontend"
  repository_image_tag_mutability = "MUTABLE"
  repository_read_write_access_arns = [
    "arn:aws:iam::339712964409:root"
  ]

  repository_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire images, keep last 5"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = { type = "expire" }
      }
    ]
  })

  tags = local.tags
}

module "ecr_3" {
  source  = "terraform-aws-modules/ecr/aws"
  version = "2.4.0"

  repository_name                 = "rosettacloud-document_indexer-lambda"
  repository_image_tag_mutability = "MUTABLE"
  repository_read_write_access_arns = [
    "arn:aws:iam::339712964409:root"
  ]

  repository_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire images, keep last 5"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = { type = "expire" }
      }
    ]
  })

  tags = local.tags
}

resource "aws_ecr_repository" "agent_tools_lambda" {
  name                 = "rosettacloud-agent_tools-lambda"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "agent_tools_lambda" {
  repository = aws_ecr_repository.agent_tools_lambda.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire images, keep last 5"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = { type = "expire" }
      }
    ]
  })
}

################################################################################
# S3 – Interactive Labs Shell Scripts
################################################################################
resource "aws_s3_bucket" "interactive_labs" {
  bucket = "rosettacloud-shared-interactive-labs"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "interactive_labs" {
  bucket = aws_s3_bucket.interactive_labs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "interactive_labs" {
  bucket = aws_s3_bucket.interactive_labs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Enable EventBridge notifications so the document_indexer Lambda is triggered on upload
resource "aws_s3_bucket_notification" "interactive_labs_eventbridge" {
  bucket      = aws_s3_bucket.interactive_labs.id
  eventbridge = true
}

################################################################################
# S3 – Interactive Labs Vector Store (LanceDB)
################################################################################
resource "aws_s3_bucket" "interactive_labs_vector" {
  bucket = "rosettacloud-shared-interactive-labs-vector"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "interactive_labs_vector" {
  bucket = aws_s3_bucket.interactive_labs_vector.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "interactive_labs_vector" {
  bucket = aws_s3_bucket.interactive_labs_vector.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

################################################################################
# IRSA – Backend Service Account IAM Role
################################################################################
data "aws_iam_policy_document" "backend_irsa_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.eks_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.eks_oidc_issuer}:sub"
      values   = ["system:serviceaccount:dev:rosettacloud-backend"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.eks_oidc_issuer}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backend_irsa" {
  name               = "rosettacloud-backend-irsa"
  assume_role_policy = data.aws_iam_policy_document.backend_irsa_trust.json
  tags               = local.tags
}

resource "aws_iam_role_policy" "backend_irsa_permissions" {
  name = "backend-permissions"
  role = aws_iam_role.backend_irsa.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DynamoDBTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:CreateTable", "dynamodb:DescribeTable"]
        Resource = ["arn:aws:dynamodb:us-east-1:${local.account_id}:table/rosettacloud-*"]
      },
      {
        Sid      = "DynamoDBListTables"
        Effect   = "Allow"
        Action   = ["dynamodb:ListTables"]
        Resource = ["*"]
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
        Sid      = "Bedrock"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = ["arn:aws:bedrock:us-east-1::foundation-model/*"]
      },
      {
        Sid      = "AgentCoreInvoke"
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:InvokeAgentRuntime"]
        Resource = ["arn:aws:bedrock-agentcore:us-east-1:${local.account_id}:runtime/*"]
      },
      {
        Sid      = "CognitoBackfill"
        Effect   = "Allow"
        Action   = ["cognito-idp:AdminUpdateUserAttributes"]
        Resource = ["arn:aws:cognito-idp:us-east-1:${local.account_id}:userpool/*"]
      }
    ]
  })
}

################################################################################
# DynamoDB – SessionTable (legacy ai_chatbot chat history, kept for data)
################################################################################
resource "aws_dynamodb_table" "session_table" {
  name         = "SessionTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "SessionId"

  attribute {
    name = "SessionId"
    type = "S"
  }

  tags = local.tags
}

################################################################################
# IAM – document_indexer Lambda execution role
################################################################################
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "document_indexer" {
  name               = "rosettacloud-document-indexer-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "document_indexer_basic" {
  role       = aws_iam_role.document_indexer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "document_indexer_permissions" {
  name = "document-indexer-permissions"
  role = aws_iam_role.document_indexer.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Read"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::rosettacloud-shared-interactive-labs",
          "arn:aws:s3:::rosettacloud-shared-interactive-labs/*",
        ]
      },
      {
        Sid    = "S3VectorWrite"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::rosettacloud-shared-interactive-labs-vector",
          "arn:aws:s3:::rosettacloud-shared-interactive-labs-vector/*",
        ]
      },
      {
        Sid      = "Bedrock"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = ["arn:aws:bedrock:us-east-1::foundation-model/*"]
      },
    ]
  })
}

# ── agent_tools Lambda execution role ──────────────────────────────────────
resource "aws_iam_role" "agent_tools_lambda_role" {
  name = "rosettacloud-agent-tools-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "agent_tools_lambda_policy" {
  name = "agent-tools-lambda-policy"
  role = aws_iam_role.agent_tools_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DynamoDB"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:us-east-1:339712964409:table/rosettacloud-users"
      },
      {
        Sid    = "S3"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::rosettacloud-shared-interactive-labs",
          "arn:aws:s3:::rosettacloud-shared-interactive-labs/*",
          "arn:aws:s3:::rosettacloud-shared-interactive-labs-vector",
          "arn:aws:s3:::rosettacloud-shared-interactive-labs-vector/*",
        ]
      },
      {
        Sid      = "Bedrock"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        # Scoped to the function name 'agent_tools' — update if function is renamed
        Resource = "arn:aws:logs:us-east-1:339712964409:log-group:/aws/lambda/agent_tools:*"
      }
    ]
  })
}

# ── AgentCore Gateway invocation role ──────────────────────────────────────
resource "aws_iam_role" "agentcore_gateway_role" {
  name = "rosettacloud-agentcore-gateway-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "agentcore_gateway_policy" {
  name = "agentcore-gateway-policy"
  role = aws_iam_role.agentcore_gateway_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "LambdaInvoke"
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = "arn:aws:lambda:us-east-1:339712964409:function:agent_tools"
    }]
  })
}

################################################################################
# EventBridge – trigger document_indexer on S3 .sh uploads
################################################################################
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

  tags = local.tags
}

resource "aws_cloudwatch_event_target" "document_indexer" {
  rule      = aws_cloudwatch_event_rule.s3_sh_upload.name
  target_id = "document_indexer"
  arn       = "arn:aws:lambda:us-east-1:${local.account_id}:function:document_indexer"
}

resource "aws_lambda_permission" "eventbridge_document_indexer" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = "document_indexer"
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.s3_sh_upload.arn
}

################################################################################
# EKS Access Entry – github-actions-role (for kubectl rollout restart in CI)
################################################################################
resource "aws_iam_role_policy" "github_actions_eks" {
  name = "github-actions-eks-access"
  role = "github-actions-role"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["eks:DescribeCluster", "eks:ListClusters"]
      Resource = ["arn:aws:eks:us-east-1:${local.account_id}:cluster/rosettacloud-eks"]
    }]
  })
}

resource "aws_eks_access_entry" "github_actions" {
  cluster_name  = module.eks.cluster_names["rosettacloud"]
  principal_arn = module.iam.role_arns["github-actions-role"]
  type          = "STANDARD"
  tags          = local.tags
}

resource "aws_eks_access_policy_association" "github_actions_admin" {
  cluster_name  = module.eks.cluster_names["rosettacloud"]
  principal_arn = module.iam.role_arns["github-actions-role"]
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}

################################################################################
# API Gateway + Cognito
################################################################################
module "api_gateway_auth" {
  source = "../../modules/api-gateway-auth"

  project_name     = "rosettacloud"
  aws_region       = local.region
  istio_public_dns = var.node_public_dns
  eks_nodeport     = var.istio_http_nodeport

  domain_name         = "api.dev.rosettacloud.app"
  acm_certificate_arn = module.acm.acm_certificate_arn

  callback_urls      = ["https://dev.rosettacloud.app/auth/callback", "http://localhost:4200/auth/callback"]
  logout_urls        = ["https://dev.rosettacloud.app/", "http://localhost:4200/"]
  cors_allow_origins = ["https://dev.rosettacloud.app", "http://localhost:4200"]

  tags = local.tags
}

# Route 53 A record for api.dev.rosettacloud.app → API Gateway custom domain
# (replaces the former CloudFront alias managed inside module.route53)
resource "aws_route53_record" "api_dev" {
  zone_id = module.route53.id
  name    = "api.dev.rosettacloud.app"
  type    = "A"

  alias {
    name                   = module.api_gateway_auth.domain_name_target_domain_name
    zone_id                = module.api_gateway_auth.domain_name_hosted_zone_id
    evaluate_target_health = false
  }
}
