github_oidc_roles = [
  {
    name     = "github-actions-role"
    subjects = ["repo:RosettaCloud/DevSecOps:*"]
    policies = {
      AmazonEC2ContainerRegistryFullAccess = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess"
    }
    tags = { Environment = "dev" }
  }
]
