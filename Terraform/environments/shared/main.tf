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
# IAM Module
################################################################################
module "iam" {
  source     = "../../modules/iam"
  oidc_roles = var.github_oidc_roles
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
          from_port   = "30444"
          to_port     = "30444"
          protocol    = "tcp"
          description = "Kubernetes Dashboard"
          cidr_blocks = "0.0.0.0/0"
        },
        {
          from_port   = "30443"
          to_port     = "30443"
          protocol    = "tcp"
          description = "Nginx"
          cidr_blocks = "0.0.0.0/0"
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
      create = true

      name                        = "rosettacloud-ec2"
      ami                         = "ami-09c1ab2520ee9181a" # Ubuntu 24.04
      instance_type               = "t3.large"
      subnet_id                   = module.vpc.public_subnets[0]
      associate_public_ip_address = true
      vpc_security_group_ids      = [data.aws_security_group.rosettacloud_ec2_sg.id]
      key_name                    = "RosettaCloud"
      iam_instance_profile        = "EBEC2InstanceProfile"
      root_volume_size            = 30

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
        sudo microk8s ctr images ls -q | xargs -r sudo microk8s ctr images rm

        # Install Kubectl
        curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
        sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

        # Alias
        echo 'export PATH=$PATH:~/.local/bin' >> /home/ubuntu/.bashrc
        echo 'alias k="kubectl"' >> /home/ubuntu/.bashrc
         _TUTOR_COMPLETE=bash_source tutor >> /home/ubuntu/.bashrc
        
        # Install Tutor
        sudo curl -L "https://github.com/overhangio/tutor/releases/download/v19.0.2/tutor-$(uname -s)_$(uname -m)" -o /usr/local/bin/tutor
        sudo chmod 0755 /usr/local/bin/tutor
        
        # Make kubectl use micro k8s
        sudo mkdir -p /home/ubuntu/.kube
        sudo microk8s config | sudo tee /home/ubuntu/.kube/config > /dev/null
        sudo chown -R ubuntu:ubuntu /home/ubuntu/.kube

        # Dashboard
        kubectl patch svc kubernetes-dashboard -n kube-system -p '{"spec": {"type": "NodePort", "ports": [{"port": 443, "targetPort": 8443, "nodePort": 30443}]}}'
        kubectl create token default --duration=24h

        # Tutor
        tutor config save --set ENABLE_WEB_PROXY=false
        tutor config save --set ENABLE_HTTPS=false
        # tutor k8s do createuser --staff --superuser admin admin@rosettacloud.app
        tutor k8s do importdemocourse
        sudo pip install tutor-indigo --break-system-packages
        tutor plugins enable fourms
      # tutor k8s launch
      # active ssl/tls cert: No

        # Caddy
      # kubectl patch svc caddy -n openedx -p '{"spec": {"type": "NodePort", "ports": [{"port": 80, "targetPort": 80, "nodePort": 30080}]}}'
      # caddy logs: kubectl logs -f caddy-0 -n openedx
       #tutor config printroot
       #cat $(tutor config printroot)/env/apps/caddy/Caddyfile

      EOF

      tags = merge(local.tags, {
        Name = "rosettacloud-ec2"
      })
    }
  }
}

################################################################################
# Route53 Module
################################################################################

module "zones" {
  source  = "terraform-aws-modules/route53/aws//modules/zones"
  version = "5.0.0"

  zones = {
    "rosettacloud.app" = {
      tags = local.tags
    }

  }

  tags = local.tags
}

module "records" {
  source  = "terraform-aws-modules/route53/aws//modules/records"
  version = "5.0.0"

  zone_name = keys(module.zones.route53_zone_zone_id)[0]

  records = [
    {
      name    = ""
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "www"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "dev"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "stg"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "uat"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "learn.dev"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "preview.learn.dev"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "apps.learn.dev"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "meilisearch.learn.dev"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "learn.stg"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "preview.learn.stg"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "apps.learn.stg"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "meilisearch.learn.stg"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "learn.uat"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "preview.learn.uat"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "apps.learn.uat"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "meilisearch.learn.uat"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "studio.dev"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "studio.stg"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    },
    {
      name    = "studio.uat"
      type    = "A"
      ttl     = 5
      records = [module.ec2.public_ips["RosettaCloud"]]
    }
  ]

  depends_on = [module.zones]
}


################################################################################
# ACM Module
################################################################################

module "acm_useast1" {
  source  = "terraform-aws-modules/acm/aws"
  version = "5.1.1"

  providers = {
    aws = aws.useast1
  }

  domain_name = "rosettacloud.app"
  zone_id     = "Z079218314YQ78VCH6R35"

  validation_method = "DNS"

  subject_alternative_names = [
    "*.rosettacloud.app",
    "*.dev.rosettacloud.app",
    "*.learn.dev.rosettacloud.app",
    "*.stg.rosettacloud.app",
    "*.learn.stg.rosettacloud.app",
    "*.uat.rosettacloud.app",
    "*.learn.uat.rosettacloud.app",
  ]

  wait_for_validation = true

  tags = local.tags
}

module "acm" {
  source  = "terraform-aws-modules/acm/aws"
  version = "5.1.1"

  domain_name = "rosettacloud.app"
  zone_id     = "Z079218314YQ78VCH6R35"

  validation_method = "DNS"

  subject_alternative_names = [
    "*.rosettacloud.app",
    "*.dev.rosettacloud.app",
    "*.learn.dev.rosettacloud.app",
    "*.stg.rosettacloud.app",
    "*.learn.stg.rosettacloud.app",
    "*.uat.rosettacloud.app",
    "*.learn.uat.rosettacloud.app",
  ]

  wait_for_validation = true

  tags = local.tags
}

################################################################################
# ECR Module
################################################################################

module "ecr" {
  source  = "terraform-aws-modules/ecr/aws"
  version = "2.4.0"

  repository_name                 = "interactive-labs"
  repository_image_tag_mutability = "MUTABLE"

  # repository_read_write_access_arns for root via caller identity
  repository_read_write_access_arns = [
    "arn:aws:iam::339712964409:root"
  ]
  repository_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1,
        description  = "Keep last 5 images",
        selection = {
          tagStatus     = "tagged",
          tagPrefixList = ["v"],
          countType     = "imageCountMoreThan",
          countNumber   = 5
        },
        action = {
          type = "expire"
        }
      }
    ]
  })

  tags = local.tags
}

################################################################################
# ECS Module
################################################################################
module "ecs_cluster" {
  source  = "terraform-aws-modules/ecs/aws//modules/cluster"
  version = "5.12.1"

  cluster_name = "interactive-labs-cluster"

  cluster_configuration = {
    execute_command_configuration = {
      logging = "OVERRIDE"
      log_configuration = {
        cloud_watch_log_group_name = "/aws/ecs/aws-ec2"
      }
    }
  }

  fargate_capacity_providers = {
    FARGATE_SPOT = {
      default_capacity_provider_strategy = {
        weight = 100
      }
    }
  }

  tags = local.tags
}

module "ecs_task_definition" {
  source  = "terraform-aws-modules/ecs/aws//modules/service"
  version = "5.12.1"

  # Service
  name                   = "interactive-labs"
  cluster_arn            = module.ecs_cluster.arn
  create_service         = false
  enable_execute_command = true

  # Task Definition
  volume = {
    # ex-vol = {}
  }

  runtime_platform = {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  # Container definition(s)
  container_definitions = {
    lab = {
      image                    = "339712964409.dkr.ecr.me-central-1.amazonaws.com/interactive-labs:latest"
      cpu                      = 512
      memory                   = 2048
      essential                = true
      memory_reservation       = 50
      readonly_root_filesystem = false
      port_mappings = [
        {
          name          = "ecs"
          containerPort = 80
          protocol      = "tcp"
        }
      ]
      # mount_points = [
      #   {
      #     sourceVolume  = "ex-vol",
      #     containerPath = "/var/www/ex-vol"
      #   }
      # ]

      entrypoint = ["/bin/sh", "-c"]
      command    = ["tail -f /dev/null"]
    }
  }

  subnet_ids = module.vpc.public_subnets

  security_group_rules = {
    egress_all = {
      type        = "egress"
      from_port   = 0
      to_port     = 0
      protocol    = "-1"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
  security_group_use_name_prefix = false

  tags = local.tags
}
