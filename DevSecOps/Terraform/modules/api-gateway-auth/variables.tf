variable "project_name" {
  type        = string
  description = "Project name used as a prefix for all resources"
}

variable "aws_region" {
  type        = string
  description = "AWS region for Cognito and API Gateway"
}

variable "istio_public_dns" {
  type        = string
  description = "Public DNS of the EKS node running the Istio ingress (same origin used by CloudFront)"
}

variable "eks_nodeport" {
  type        = number
  description = "NodePort for Istio ingress gateway HTTP"
  default     = 30578
}

variable "domain_name" {
  type        = string
  description = "Custom domain for the API Gateway (e.g. api.dev.rosettacloud.app)"
}

variable "acm_certificate_arn" {
  type        = string
  description = "ARN of the existing ACM certificate for the custom domain"
}

variable "callback_urls" {
  type        = list(string)
  description = "Cognito allowed OAuth callback URLs for the app client"
}

variable "logout_urls" {
  type        = list(string)
  description = "Cognito allowed logout URLs for the app client"
}

variable "cors_allow_origins" {
  type        = list(string)
  description = "Origins allowed by API Gateway CORS configuration"
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to all resources"
  default     = {}
}
