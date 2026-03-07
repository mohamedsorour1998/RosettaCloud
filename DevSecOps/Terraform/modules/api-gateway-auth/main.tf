################################################################################
# Random suffix for Cognito domain (must be globally unique)
################################################################################
resource "random_id" "cognito_domain" {
  byte_length = 4
}

################################################################################
# Cognito User Pool
################################################################################
resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  schema {
    name                = "user_id"
    attribute_data_type = "String"
    required            = false
    mutable             = true
    string_attribute_constraints {
      min_length = 0
      max_length = 256
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "RosettaCloud — verify your email"
    email_message        = "Your verification code is {####}"
  }

  user_pool_add_ons {
    advanced_security_mode = "OFF"
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = var.tags
}

################################################################################
# Cognito User Pool Client (SPA — no secret)
################################################################################
resource "aws_cognito_user_pool_client" "frontend" {
  name         = "${var.project_name}-frontend"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  allowed_oauth_flows                  = ["implicit", "code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  supported_identity_providers = ["COGNITO"]

  read_attributes  = ["email", "name", "custom:user_id"]
  write_attributes = ["email", "name", "custom:user_id"]
}

################################################################################
# Cognito User Pool Domain (hosted UI)
################################################################################
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project_name}-${random_id.cognito_domain.hex}"
  user_pool_id = aws_cognito_user_pool.main.id
}

################################################################################
# API Gateway HTTP API — via terraform-aws-modules/apigateway-v2
################################################################################
module "api_gateway" {
  source  = "terraform-aws-modules/apigateway-v2/aws"
  version = "6.1.0"

  name          = "${var.project_name}-api"
  description   = "RosettaCloud HTTP API with Cognito JWT authorizer"
  protocol_type = "HTTP"

  cors_configuration = {
    allow_origins = var.cors_allow_origins
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
    allow_headers = ["Content-Type", "Authorization", "X-Amz-Date", "X-Api-Key", "X-Amz-Security-Token"]
    max_age       = 300
  }

  # Custom domain — use existing ACM cert; Route53 record is managed in environments/shared/main.tf
  domain_name                 = var.domain_name
  domain_name_certificate_arn = var.acm_certificate_arn
  create_certificate          = false
  create_domain_records       = false

  # JWT authorizer backed by Cognito
  authorizers = {
    cognito = {
      authorizer_type  = "JWT"
      identity_sources = ["$request.header.Authorization"]
      name             = "cognito-jwt"
      jwt_configuration = {
        audience = [aws_cognito_user_pool_client.frontend.id]
        issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
      }
    }
  }

  # Routes — HTTP_PROXY to the public Istio ingress (same origin as CloudFront)
  routes = {
    # Health check — no auth so uptime monitors can reach it
    "GET /health-check" = {
      integration = {
        type   = "HTTP_PROXY"
        uri    = "http://${var.istio_public_dns}:${var.eks_nodeport}/health-check"
        method = "GET"
        # Istio routes by Host header; set it to the API domain so VirtualService matches
        request_parameters = {
          "overwrite:header.Host" = "${var.domain_name}"
        }
      }
    }

    # CORS preflight — no auth; forward to FastAPI which has CORSMiddleware
    "OPTIONS /{proxy+}" = {
      integration = {
        type   = "HTTP_PROXY"
        uri    = "http://${var.istio_public_dns}:${var.eks_nodeport}/"
        method = "ANY"
        request_parameters = {
          "overwrite:path"        = "$request.path"
          "overwrite:header.Host" = "${var.domain_name}"
        }
      }
    }

    # Catch-all — JWT required; forwards full request path to Istio
    "$default" = {
      authorizer_key     = "cognito"
      authorization_type = "JWT"
      integration = {
        type   = "HTTP_PROXY"
        uri    = "http://${var.istio_public_dns}:${var.eks_nodeport}/"
        method = "ANY"
        request_parameters = {
          "overwrite:path"        = "$request.path"
          "overwrite:header.Host" = "${var.domain_name}"
        }
      }
    }
  }

  tags = var.tags
}
