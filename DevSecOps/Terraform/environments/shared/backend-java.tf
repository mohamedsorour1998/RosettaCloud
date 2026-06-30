################################################################################
# Spring Boot 4 backend — ECR repos, per-service IRSA roles, event backbone.
# (Plan-of-record IaC for the Java microservices migration. `terraform import` the
#  out-of-band e2e role before apply — see bottom.)
################################################################################

locals {
  java_services = ["user-service", "lab-service", "question-service", "chat-service", "analytics-service"]
}

# ── ECR repositories (one per service) ─────────────────────────────────────────
resource "aws_ecr_repository" "java_service" {
  for_each             = toset(local.java_services)
  name                 = "rosettacloud-${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "java_service" {
  for_each   = aws_ecr_repository.java_service
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep last 10"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

# ── Per-service IRSA roles (least privilege) ────────────────────────────────────
data "aws_iam_policy_document" "java_irsa_trust" {
  for_each = toset(local.java_services)
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.eks_oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.eks_oidc_issuer}:sub"
      values   = ["system:serviceaccount:dev:rosettacloud-${each.key}"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.eks_oidc_issuer}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "java_irsa" {
  for_each           = toset(local.java_services)
  name               = "rosettacloud-${each.key}-irsa"
  assume_role_policy = data.aws_iam_policy_document.java_irsa_trust[each.key].json
  tags               = local.tags
}

# user-service + analytics-service: DynamoDB (+ Cognito backfill for user-service)
resource "aws_iam_role_policy" "user_service" {
  name = "perms"
  role = aws_iam_role.java_irsa["user-service"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Dynamo", Effect = "Allow",
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan"],
        Resource = ["arn:aws:dynamodb:us-east-1:${local.account_id}:table/rosettacloud-*", "arn:aws:dynamodb:us-east-1:${local.account_id}:table/rosettacloud-*/index/*"] },
      { Sid = "Cognito", Effect = "Allow", Action = ["cognito-idp:AdminUpdateUserAttributes"], Resource = ["arn:aws:cognito-idp:us-east-1:${local.account_id}:userpool/*"] }
    ]
  })
}

resource "aws_iam_role_policy" "analytics_service" {
  name = "perms"
  role = aws_iam_role.java_irsa["analytics-service"].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Sid = "Dynamo", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:UpdateItem"], Resource = ["arn:aws:dynamodb:us-east-1:${local.account_id}:table/rosettacloud-users"] }]
  })
}

# question-service: S3 read
resource "aws_iam_role_policy" "question_service" {
  name = "perms"
  role = aws_iam_role.java_irsa["question-service"].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Sid = "S3", Effect = "Allow", Action = ["s3:GetObject", "s3:ListBucket"], Resource = ["arn:aws:s3:::rosettacloud-shared-interactive-labs", "arn:aws:s3:::rosettacloud-shared-interactive-labs/*"] }]
  })
}

# chat-service: Bedrock Nova Lite 2 + AgentCore invoke
resource "aws_iam_role_policy" "chat_service" {
  name = "perms"
  role = aws_iam_role.java_irsa["chat-service"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Bedrock", Effect = "Allow", Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream"],
        Resource = ["arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0", "arn:aws:bedrock:us-east-1:${local.account_id}:inference-profile/us.amazon.nova-2-lite-v1:0"] },
      { Sid = "AgentCore", Effect = "Allow", Action = ["bedrock-agentcore:InvokeAgentRuntime"], Resource = ["arn:aws:bedrock-agentcore:us-east-1:${local.account_id}:runtime/*"] }
    ]
  })
}
# lab-service: uses the in-cluster SA token for the K8s API (no AWS perms required).

# ── Event backbone (WP-60): progress/metrics fan-out ───────────────────────────
resource "aws_sns_topic" "events" {
  name = "rosettacloud-events"
  tags = local.tags
}

resource "aws_sqs_queue" "analytics" {
  name = "rosettacloud-analytics"
  tags = local.tags
}

resource "aws_sns_topic_subscription" "analytics" {
  topic_arn = aws_sns_topic.events.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.analytics.arn
}

################################################################################
# The e2e tester role was created out-of-band (CLI). Import before apply:
#   terraform import aws_iam_role.e2e_tester rosettacloud-e2e-tester
################################################################################
resource "aws_iam_role" "e2e_tester" {
  name = "rosettacloud-e2e-tester"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "arn:aws:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:mohamedsorour1998/RosettaCloud:*" }
      }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "e2e_tester" {
  name = "rosettacloud-e2e-tester-policy"
  role = aws_iam_role.e2e_tester.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "BedrockNovaLite2", Effect = "Allow", Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream"],
        Resource = ["arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0", "arn:aws:bedrock:us-east-1:${local.account_id}:inference-profile/us.amazon.nova-2-lite-v1:0"] },
      { Sid = "AgentCoreInvoke", Effect = "Allow", Action = ["bedrock-agentcore:InvokeAgentRuntime"], Resource = "arn:aws:bedrock-agentcore:us-east-1:${local.account_id}:runtime/*" }
    ]
  })
}
