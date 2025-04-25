output "role_arns" {
  value       = { for name, mod in module.iam_github_oidc_role : name => mod.arn }
  description = "IAM role ARNs keyed by role name"
}
