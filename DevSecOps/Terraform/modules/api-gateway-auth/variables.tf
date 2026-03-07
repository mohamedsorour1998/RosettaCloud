variable "project_name" {
  type        = string
  description = "Project name used as a prefix for all resources"
}

variable "aws_region" {
  type        = string
  description = "AWS region for Cognito and API Gateway"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID where the VPC Link will be provisioned"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR block — used for VPC Link security group egress"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the API Gateway VPC Link"
}

variable "eks_node_private_ip" {
  type        = string
  description = "Private IP of the EKS node running the Istio ingress NodePort"
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
