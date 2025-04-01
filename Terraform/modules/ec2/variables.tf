variable "ec2_instances" {
  description = <<EOT
Map of EC2 instance definitions. Key = a unique identifier (e.g. "web1", "db2"), 
Value = object describing instance config:
{
  name                      = (string) - Name for the instance
  ami                       = (string, optional)
  instance_type             = (string, optional)
  subnet_id                 = (string, optional)
  vpc_security_group_ids    = (list(string), optional)
  key_name                  = (string, optional)
  user_data                 = (string, optional)
  user_data_base64          = (string, optional)
  ebs_block_device          = (list(map(string)), optional)
  root_block_device         = (list(map(string)), optional)
  create_spot_instance      = (bool, optional)
  spot_price                = (string, optional)
  # ... (you can add more fields as needed)
  tags = (map(string), optional)
}
EOT

  type = map(
    object({
      name                        = string
      ami                         = optional(string)
      create                      = optional(bool, true)
      instance_type               = optional(string)
      subnet_id                   = optional(string)
      vpc_security_group_ids      = optional(list(string))
      key_name                    = optional(string)
      user_data                   = optional(string)
      root_block_device           = optional(list(map(string)), [])
      create_spot_instance        = optional(bool, false)
      spot_price                  = optional(string)
      source_dest_check           = optional(bool, true)
      iam_instance_profile        = optional(string)
      tags                        = optional(map(string))
      associate_public_ip_address = optional(bool, false)
    })
  )

  default = {}
}
