variable "eks_clusters" {
  description = <<EOT
Map of EKS cluster definitions. Key = a unique identifier (e.g. "rosettacloud"),
Value = object describing cluster config.
EOT

  type = map(
    object({
      name               = string
      kubernetes_version = string
      vpc_id             = string
      subnet_ids         = list(string)

      endpoint_public_access  = optional(bool, true)
      endpoint_private_access = optional(bool, true)

      compute_config = optional(object({
        enabled    = bool
        node_pools = list(string)
      }), { enabled = true, node_pools = ["general-purpose"] })

      enable_cluster_creator_admin_permissions = optional(bool, true)

      tags = optional(map(string), {})
    })
  )

  default = {}
}
