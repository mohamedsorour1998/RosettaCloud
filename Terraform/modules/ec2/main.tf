module "ec2_submodules" {
  for_each = var.ec2_instances

  source  = "terraform-aws-modules/ec2-instance/aws"
  version = "5.8.0"

  name   = each.value.name
  create = each.value.create

  ami           = try(each.value.ami, null)
  instance_type = try(each.value.instance_type, "t3.micro")
  subnet_id     = try(each.value.subnet_id, null)
  key_name      = try(each.value.key_name, null)

  vpc_security_group_ids = try(each.value.vpc_security_group_ids, [])

  user_data                   = try(each.value.user_data, null)
  ebs_block_device            = try(each.value.ebs_block_device, [])
  create_spot_instance        = try(each.value.create_spot_instance, false)
  spot_price                  = try(each.value.spot_price, null)
  source_dest_check           = try(each.value.source_dest_check, null)
  iam_instance_profile        = try(each.value.iam_instance_profile, null)
  associate_public_ip_address = try(each.value.associate_public_ip_address, false)

  tags = try(each.value.tags, {})
}
