terraform {
  backend "s3" {
    bucket = "rosettacloud-shared-terraform-backend"
    key    = "terraform.tfstate"
    region = "us-east-1"
  }
}
