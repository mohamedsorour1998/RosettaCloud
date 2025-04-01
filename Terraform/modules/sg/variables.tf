variable "security_groups" {
  type = map(
    object({
      name        = string
      description = optional(string)
      vpc_id      = string



      # Custom ingress using the official module’s style:
      # a list of MAPs with string keys/values
      ingress_with_cidr_blocks = optional(
        list(
          map(string)
        )
      )

      # If you do want SG-based rules, also define as list(map(string)):
      ingress_with_source_security_group_id = optional(
        list(
          map(string)
        )
      )

      # Named egress
      egress_rules       = optional(list(string))
      egress_cidr_blocks = optional(list(string))

      # Custom egress
      egress_with_cidr_blocks              = optional(list(map(string)))
      egress_with_source_security_group_id = optional(list(map(string)))

      tags = optional(map(string))
    })
  )

  default = {}
}
