variable "github_oidc_roles" {
  type        = list(any)
  description = "List of GitHub-OIDC role definitions to pass to the iam module"
}
