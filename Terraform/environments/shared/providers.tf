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
