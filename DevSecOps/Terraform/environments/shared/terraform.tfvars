github_oidc_roles = [
  {
    name     = "github-actions-role"
    subjects = ["repo:mohamedsorour1998/RosettaCloud:*"]
    policies = {
      AmazonEC2ContainerRegistryFullAccess = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess"
      AWSLambda_FullAccess = "arn:aws:iam::aws:policy/AWSLambda_FullAccess"
      AmazonS3FullAccess = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
    }
    tags = { Environment = "dev" }
  }
]

node_public_dns     = "ec2-54-91-153-130.compute-1.amazonaws.com"
istio_http_nodeport = 30578
