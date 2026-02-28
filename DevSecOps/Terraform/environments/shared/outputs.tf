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
# IRSA
################################################################################
output "backend_irsa_role_arn" {
  value       = aws_iam_role.backend_irsa.arn
  description = "IAM role ARN for backend service account (IRSA)"
}

################################################################################
# DynamoDB
################################################################################
output "session_table_name" {
  value       = aws_dynamodb_table.session_table.name
  description = "DynamoDB SessionTable (legacy, kept for data)"
}

