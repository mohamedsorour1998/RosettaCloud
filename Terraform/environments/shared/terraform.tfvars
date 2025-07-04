github_oidc_roles = [
  {
    name     = "github-actions-role"
    subjects = ["repo:RosettaCloud/DevSecOps:*","repo:RosettaCloud/RosettaCloud-Backend:*","repo:RosettaCloud/RosettaCloud-Frontend:*"]
    policies = {
      AmazonEC2ContainerRegistryFullAccess = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess"
      AWSLambda_FullAccess = "arn:aws:iam::aws:policy/AWSLambda_FullAccess"
      AmazonS3FullAccess = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
    }
    tags = { Environment = "dev" }
  }
]
