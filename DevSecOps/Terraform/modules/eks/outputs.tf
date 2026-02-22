output "cluster_endpoints" {
  description = "Map of cluster endpoints keyed by eks_clusters map keys"
  value       = { for k, m in module.eks_clusters : k => m.cluster_endpoint }
}

output "cluster_names" {
  description = "Map of cluster names"
  value       = { for k, m in module.eks_clusters : k => m.cluster_name }
}

output "cluster_arns" {
  description = "Map of cluster ARNs"
  value       = { for k, m in module.eks_clusters : k => m.cluster_arn }
}

output "cluster_certificate_authority_data" {
  description = "Map of cluster certificate authority data"
  value       = { for k, m in module.eks_clusters : k => m.cluster_certificate_authority_data }
}

output "oidc_provider_arns" {
  description = "Map of OIDC provider ARNs"
  value       = { for k, m in module.eks_clusters : k => m.oidc_provider_arn }
}

output "node_iam_role_arns" {
  description = "Map of node IAM role ARNs (EKS Auto Mode managed)"
  value       = { for k, m in module.eks_clusters : k => try(m.node_iam_role_arn, null) }
}
