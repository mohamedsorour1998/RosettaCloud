module "eks_clusters" {
  for_each = var.eks_clusters

  source  = "terraform-aws-modules/eks/aws"
  version = "21.15.1"

  name               = each.value.name
  kubernetes_version  = each.value.kubernetes_version
  vpc_id             = each.value.vpc_id
  subnet_ids         = each.value.subnet_ids

  endpoint_public_access  = each.value.endpoint_public_access
  endpoint_private_access = each.value.endpoint_private_access

  compute_config = each.value.compute_config

  eks_managed_node_groups = each.value.eks_managed_node_groups

  enable_cluster_creator_admin_permissions = each.value.enable_cluster_creator_admin_permissions

  tags = each.value.tags
}
