variable "github_oidc_roles" {
  type        = list(any)
  description = "List of GitHub-OIDC role definitions to pass to the iam module"
}

variable "node_public_dns" {
  type        = string
  description = "Public DNS of the EKS node running Istio ingress"
  default     = "localhost"
}

variable "istio_http_nodeport" {
  type        = number
  description = "NodePort for Istio ingress gateway HTTP"
  default     = 30578
}
