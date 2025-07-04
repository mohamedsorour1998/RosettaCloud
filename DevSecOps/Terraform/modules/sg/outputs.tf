output "security_group_ids" {
  description = "Map of SG IDs"
  value       = { for k, m in module.sg_submodules : k => m.security_group_id }
}

output "security_group_names" {
  description = "Map of SG Names"
  value       = { for k, m in module.sg_submodules : k => m.security_group_name }
}

output "security_group_arns" {
  description = "Map of SG ARNs"
  value       = { for k, m in module.sg_submodules : k => m.security_group_arn }
}
