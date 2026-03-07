output "user_pool_id" {
  value       = aws_cognito_user_pool.main.id
  description = "Cognito User Pool ID"
}

output "user_pool_arn" {
  value       = aws_cognito_user_pool.main.arn
  description = "Cognito User Pool ARN"
}

output "user_pool_client_id" {
  value       = aws_cognito_user_pool_client.frontend.id
  description = "Cognito User Pool Client ID (used by Angular SDK)"
}

output "cognito_issuer_url" {
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  description = "Cognito JWT issuer URL (used by API GW JWT authorizer and backend)"
}

output "cognito_domain" {
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
  description = "Cognito hosted UI base URL"
}

output "api_gateway_id" {
  value       = module.api_gateway.api_id
  description = "API Gateway HTTP API ID"
}

output "api_gateway_endpoint" {
  value       = module.api_gateway.api_endpoint
  description = "Default API Gateway invoke URL"
}

output "domain_name_target_domain_name" {
  value       = module.api_gateway.domain_name_target_domain_name
  description = "API GW custom domain target (alias for Route53 record)"
}

output "domain_name_hosted_zone_id" {
  value       = module.api_gateway.domain_name_hosted_zone_id
  description = "Hosted Zone ID of the API GW regional endpoint (for Route53 alias)"
}

output "vpc_link_id" {
  value       = module.api_gateway.vpc_links["istio"].id
  description = "VPC Link ID"
}
