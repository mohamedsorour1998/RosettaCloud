data "aws_availability_zones" "available" {}

locals {
  name   = "rosstacloud-shared"
  region = "me-central-1"

  vpc_cidr = "10.16.0.0/16"

  azs = slice(data.aws_availability_zones.available.names, 0, 3)

  tags = {
    Terraform   = "true"
    Environment = "shared"
    Project     = "RosettaCloud"
  }
}

################################################################################
# VPC Module
################################################################################

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.19.0"

  name = "${local.name}-vpc"
  cidr = local.vpc_cidr

  azs                          = local.azs
  private_subnets              = [for k, v in local.azs : cidrsubnet(local.vpc_cidr, 8, k)]
  public_subnets               = [for k, v in local.azs : cidrsubnet(local.vpc_cidr, 8, k + 4)]
  database_subnets             = [for k, v in local.azs : cidrsubnet(local.vpc_cidr, 8, k + 8)]
  create_database_subnet_group = true

  private_subnet_names  = ["${local.name}-private-subnet-a", "${local.name}-private-subnet-b", "${local.name}-private-subnet-c"]
  public_subnet_names   = ["${local.name}-public-subnet-a", "${local.name}-public-subnet-b", "${local.name}-public-subnet-c"]
  database_subnet_names = ["${local.name}-database-subnet-a", "${local.name}-database-subnet-b", "${local.name}-database-subnet-c"]

  enable_dns_hostnames = true
  enable_dns_support   = true

  enable_nat_gateway = false

  tags = local.tags
}
################################################################################
# Security Group Module
################################################################################

data "aws_security_group" "rosettacloud_ec2_sg" {
  name = "rosettacloud-ec2-sg"
}

module "sg" {
  source = "../../modules/sg"

  security_groups = {
    rosettacloud_ec2_sg = {
      name        = "rosettacloud-ec2-sg"
      description = "Security group for RosettaCloud EC2 instances"
      vpc_id      = module.vpc.vpc_id

      # https://github.com/terraform-aws-modules/terraform-aws-security-group/blob/master/rules.tf
      ingress_with_cidr_blocks = [
        {
          from_port   = "8080"
          to_port     = "8090"
          protocol    = "tcp"
          description = "User-service ports"
          cidr_blocks = "10.10.0.0/16"
        },
        {
          rule        = "ssh-tcp"
          cidr_blocks = "0.0.0.0/0"
        },
        {
          rule        = "http-80-tcp"
          cidr_blocks = "0.0.0.0/0"
        },
        {
          rule        = "https-443-tcp"
          cidr_blocks = "0.0.0.0/0"
        }
      ]

      ingress_with_source_security_group_id = []
      egress_rules                          = ["all-all"]
      egress_cidr_blocks                    = ["0.0.0.0/0"]

    }
  }
}

################################################################################
# EC2 Module
################################################################################

module "ec2" {
  source = "../../modules/ec2"

  ec2_instances = {
    RosettaCloud = {
      create = false

      name                        = "rosettacloud-ec2"
      ami                         = "ami-09c1ab2520ee9181a" # Ubuntu 24.04
      instance_type               = "t3.medium"
      subnet_id                   = module.vpc.public_subnets[0]
      associate_public_ip_address = true
      vpc_security_group_ids      = [data.aws_security_group.rosettacloud_ec2_sg.id]
      key_name                    = "RosettaCloud"

      user_data = <<-EOF
        #!/usr/bin/env bash
        set -ex

        # Install dependencies
        sudo apt-get update -y
        sudo apt-get install -y unzip

        # Install AWS CLI v2
        curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
        unzip -q /tmp/awscliv2.zip -d /tmp
        sudo /tmp/aws/install
        rm -rf /tmp/awscliv2.zip /tmp/aws

        # Install MicroK8s
        sudo snap install microk8s --classic
 
        sudo microk8s enable dns
        sudo microk8s enable dashboard
        sudo microk8s enable storage
        
        # Install Kubectl
        curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
        sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
        
        # Alias
        echo 'export PATH=$PATH:~/.local/bin' >> /home/ubuntu/.bashrc
        echo 'alias k="kubectl"' >> /home/ubuntu/.bashrc
        
        # Install Tutor

        # Make kubectl use micro k8s
        sudo mkdir -p /home/ubuntu/.kube
        sudo microk8s config | sudo tee /home/ubuntu/.kube/config > /dev/null
        sudo chown -R ubuntu:ubuntu /home/ubuntu/.kube


      EOF

      tags = merge(local.tags, {
        Name = "rosettacloud-ec2"
      })
    }
  }
}
