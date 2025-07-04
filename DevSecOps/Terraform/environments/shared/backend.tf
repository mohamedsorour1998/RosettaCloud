terraform {
  backend "s3" {
    bucket = "rosettacloud-shared-terraform-backend"
    key    = "terraform.tfstate"
    region = "me-central-1"
  }
}
