################################################################################
# IAM
################################################################################
output "github_oidc_role_arns" {
  value       = module.iam.role_arns
  description = "Map of role names to their ARNs created by the IAM module"
}

################################################################################
# EKS
################################################################################
output "eks_cluster_endpoint" {
  value       = module.eks.cluster_endpoints["rosettacloud"]
  description = "EKS cluster API endpoint"
}

output "eks_cluster_name" {
  value       = module.eks.cluster_names["rosettacloud"]
  description = "EKS cluster name"
}

output "eks_cluster_arn" {
  value       = module.eks.cluster_arns["rosettacloud"]
  description = "EKS cluster ARN"
}

################################################################################
# Route53
################################################################################
output "route53_zone_id" {
  value       = module.route53.id
  description = "Route53 hosted zone ID for rosettacloud.app"
}

################################################################################
# ACM
################################################################################
output "acm_certificate_arn" {
  value       = module.acm.acm_certificate_arn
  description = "ACM certificate ARN"
}

################################################################################
# CloudFront
################################################################################
output "cloudfront_distribution_domain" {
  value       = module.cloudfront.cloudfront_distribution_domain_name
  description = "CloudFront distribution domain name"
}

output "cloudfront_distribution_id" {
  value       = module.cloudfront.cloudfront_distribution_id
  description = "CloudFront distribution ID"
}

################################################################################
# S3
################################################################################
output "interactive_labs_bucket_name" {
  value       = aws_s3_bucket.interactive_labs.bucket
  description = "S3 bucket for interactive labs shell scripts"
}

output "interactive_labs_vector_bucket_name" {
  value       = aws_s3_bucket.interactive_labs_vector.bucket
  description = "S3 bucket for LanceDB vector store (document_indexer output)"
}

################################################################################
# SQS
################################################################################
output "feedback_requested_queue_url" {
  value       = module.sqs_feedback.queue_url
  description = "SQS queue URL for feedback requests"
}

################################################################################
# IRSA
################################################################################
output "backend_irsa_role_arn" {
  value       = aws_iam_role.backend_irsa.arn
  description = "IAM role ARN for backend service account (IRSA)"
}

output "feedback_lambda_sqs_policy_arn" {
  value       = aws_iam_policy.feedback_lambda_sqs.arn
  description = "IAM policy ARN to attach to feedback_request Lambda role for SQS access"
}

################################################################################
# Lambda
################################################################################
output "feedback_request_lambda_arn" {
  value       = module.lambda_feedback_request.lambda_function_arn
  description = "ARN of the feedback_request Lambda function"
}

output "feedback_request_lambda_invoke_arn" {
  value       = module.lambda_feedback_request.lambda_function_invoke_arn
  description = "Invoke ARN of the feedback_request Lambda function"
}

################################################################################
# DynamoDB
################################################################################
output "session_table_name" {
  value       = aws_dynamodb_table.session_table.name
  description = "DynamoDB table name for ai_chatbot session history"
}

################################################################################
# API Gateway – WebSocket (ai_chatbot)
################################################################################
output "chatbot_ws_api_endpoint" {
  value       = "${aws_apigatewayv2_api.chatbot_ws.api_endpoint}/production"
  description = "WebSocket API Gateway default endpoint (wss://...)"
}

output "chatbot_ws_custom_domain" {
  value       = "wss://wss.dev.rosettacloud.app"
  description = "Custom WebSocket domain for ai_chatbot"
}

################################################################################
# API Gateway – HTTP (feedback_request)
################################################################################
output "feedback_api_endpoint" {
  value       = aws_apigatewayv2_api.feedback.api_endpoint
  description = "Feedback HTTP API Gateway endpoint"
}

output "feedback_custom_domain" {
  value       = "https://feedback.dev.rosettacloud.app"
  description = "Custom domain for feedback_request Lambda"
}
