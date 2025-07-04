################################################################################
# Security Group Module
################################################################################
output "all_sg_ids" {
  value = module.sg.security_group_ids
}
# output "all_sg_arns" {
#   value = module.sg.security_group_arns
# }

# output "all_sg_names" {
#   value = module.sg.security_group_names
# }



output "all_instance_ids" {
  value = module.ec2.instance_ids
}
output "all_public_ips" {
  value = module.ec2.public_ips
}

output "github_oidc_role_arns" {
  value       = module.iam.role_arns
  description = "Map of role names to their ARNs created by the IAM module"
}
