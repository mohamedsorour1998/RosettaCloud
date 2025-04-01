module "sg_submodules" {
  for_each = var.security_groups

  source  = "terraform-aws-modules/security-group/aws"
  version = "5.3.0"

  name            = each.value.name
  description     = lookup(each.value, "description", null)
  vpc_id          = each.value.vpc_id
  use_name_prefix = false

  # Ingress
  ingress_with_cidr_blocks              = local.final_ingress_with_cidr[each.key]
  ingress_with_source_security_group_id = local.final_ingress_with_sg[each.key]

  # Egress
  egress_rules       = local.final_egress_rules[each.key]
  egress_cidr_blocks = local.final_egress_cidrs[each.key]

  tags = lookup(each.value, "tags", {})
}


locals {
  final_egress_rules = {
    for k, v in var.security_groups :
    k => lookup(v, "egress_rules", ["all-all"])
  }

  final_egress_cidrs = {
    for k, v in var.security_groups :
    k => lookup(v, "egress_cidr_blocks", ["0.0.0.0/0"])
  }

  final_ingress_with_cidr = {
    for k, v in var.security_groups :
    k => lookup(v, "ingress_with_cidr_blocks", [])
  }

  final_ingress_with_sg = {
    for k, v in var.security_groups :
    k => lookup(v, "ingress_with_source_security_group_id", [])
  }
}


################
# DOCS
################

#   1) Additional custom ingress? 
# ingress_with_cidr_blocks = []
#   ingress_with_cidr_blocks = [
#     {
#       from_port   = 8080
#       to_port     = 8090
#       protocol    = "tcp"
#       description = "User-service ports"
#       cidr_blocks = "10.10.0.0/16"
#     },
#     {
#       from_port   = 8081
#       to_port     = 8091
#       protocol    = "tcp"
#       description = "User-service ports1"
#       cidr_blocks = "10.10.0.0/16"
#     }
#   ]

#   ingress_with_source_security_group_id = []
#   # or define something like:
#   # [
#   #   {
#   #     from_port                = 22
#   #     to_port                  = 22
#   #     protocol                 = "tcp"
#   #     description             = "SSH from other SG"
#   #     source_security_group_id = "sg-22222222"
#   #   }
#   # ]
#   
#  Egress
#   egress_rules       = ["https-443-tcp"]  # Named rule
#   egress_cidr_blocks = ["10.20.0.0/16"]   # restricting egress to 10.20

