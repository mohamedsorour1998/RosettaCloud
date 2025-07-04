terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.93.0"
    }
  }
}

provider "aws" {
  region  = "me-central-1"
  profile = "ROSETTACLOUD-SHARED"

}

provider "aws" {
  alias   = "useast1"
  region  = "us-east-1"
  profile = "ROSETTACLOUD-SHARED"
}
