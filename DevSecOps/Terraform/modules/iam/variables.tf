variable "oidc_roles" {
  type = list(object({
    name             = string
    subjects         = list(string)
    policies         = map(string)
    tags             = optional(map(string), {})
  }))
  description = "GitHub OIDC roles to provision"
}
