###############################################################################
# GitHub OIDC provider
###############################################################################
module "iam_github_oidc_provider" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-github-oidc-provider"
  version = "5.55.0"
}

###############################################################################
# GitHub OIDC roles
###############################################################################
module "iam_github_oidc_role" {
  for_each = { for r in var.oidc_roles : r.name => r }

  source  = "terraform-aws-modules/iam/aws//modules/iam-github-oidc-role"
  version = "5.55.0"

  name     = each.value.name
  subjects = each.value.subjects

  policies = each.value.policies

  tags = merge(
    { ManagedBy = "Terraform" },
    lookup(each.value, "tags", {})
  )
}
