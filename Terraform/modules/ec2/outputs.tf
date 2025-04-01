output "instance_ids" {
  description = "Map of instance IDs keyed by ec2_instances map keys"
  value       = { for k, m in module.ec2_submodules : k => m.id }
}

output "instance_arns" {
  description = "Map of instance ARNs"
  value       = { for k, m in module.ec2_submodules : k => m.arn }
}

output "private_ips" {
  description = "Map of instance private IPs"
  value       = { for k, m in module.ec2_submodules : k => m.private_ip }
}

output "public_ips" {
  description = "Map of instance public IPs"
  value       = { for k, m in module.ec2_submodules : k => m.public_ip }
}

output "instance_states" {
  description = "Map of instance states"
  value       = { for k, m in module.ec2_submodules : k => m.instance_state }
}

output "all_tags" {
  description = "Map of all final tags assigned"
  value       = { for k, m in module.ec2_submodules : k => m.tags_all }
}
