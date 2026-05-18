locals {
  name                 = "${var.project_name}-${var.environment}"
  webhook_api_alb_name = "${substr(local.name, 0, 19)}-webhook-api"
  service_scheme       = var.acm_certificate_arn == null ? "http" : "https"
  service_host         = var.service_hostname == null ? aws_lb.webhook_api.dns_name : var.service_hostname
  ui_origin_id         = "${local.name}-ui-s3"

  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ssm_parameter" "ecs_optimized_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id"
}

data "aws_caller_identity" "current" {}

resource "aws_ecr_repository" "webhook_api" {
  name                 = "${local.name}-webhook-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "webhook_api" {
  repository = aws_ecr_repository.webhook_api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the most recent 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "webhook_api" {
  name              = "/ecs/${local.name}-webhook-api"
  retention_in_days = var.log_retention_days
}

resource "aws_ssm_parameter" "github_webhook_secret" {
  name        = "/${local.name}/github-webhook-secret"
  description = "GitHub webhook shared secret for ${local.name}."
  type        = "SecureString"
  value       = var.github_webhook_secret
}

resource "aws_ssm_parameter" "github_token" {
  count = var.github_token == null ? 0 : 1

  name        = "/${local.name}/github-token"
  description = "GitHub API token for ${local.name} pull request comments."
  type        = "SecureString"
  value       = var.github_token
}

resource "aws_sns_topic" "policy_events" {
  name = "${local.name}-policy-events"
}

resource "aws_sqs_queue" "policy_events_dlq" {
  name                      = "${local.name}-policy-events-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "policy_events" {
  name                       = "${local.name}-policy-events"
  visibility_timeout_seconds = var.policy_events_visibility_timeout_seconds
  message_retention_seconds  = var.policy_events_retention_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.policy_events_dlq.arn
    maxReceiveCount     = var.policy_events_max_receive_count
  })
}

resource "aws_sqs_queue_policy" "policy_events" {
  queue_url = aws_sqs_queue.policy_events.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "sns.amazonaws.com"
        }
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.policy_events.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_sns_topic.policy_events.arn
          }
        }
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "policy_events_queue" {
  topic_arn            = aws_sns_topic.policy_events.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.policy_events.arn
  raw_message_delivery = true
}

resource "aws_dynamodb_table" "policy_rules" {
  name         = "${local.name}-policy-rules"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "scope"
  range_key    = "ruleKey"

  attribute {
    name = "scope"
    type = "S"
  }

  attribute {
    name = "ruleKey"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_dynamodb_table" "policy_runs" {
  name         = "${local.name}-policy-runs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "repo"
  range_key    = "runKey"

  attribute {
    name = "repo"
    type = "S"
  }

  attribute {
    name = "runKey"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_s3_bucket" "ui" {
  bucket = "${local.name}-${data.aws_caller_identity.current.account_id}-ui"
}

resource "aws_s3_bucket_public_access_block" "ui" {
  bucket = aws_s3_bucket.ui.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "ui" {
  name                              = "${local.name}-ui"
  description                       = "CloudFront access to ${local.name} UI bucket."
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "ui" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = var.ui_hostname == null ? [] : [var.ui_hostname]

  origin {
    domain_name              = aws_s3_bucket.ui.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.ui.id
    origin_id                = local.ui_origin_id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = local.ui_origin_id

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn            = var.ui_hostname == null ? null : var.acm_certificate_arn
    cloudfront_default_certificate = var.ui_hostname == null
    minimum_protocol_version       = var.ui_hostname == null ? null : "TLSv1.2_2021"
    ssl_support_method             = var.ui_hostname == null ? null : "sni-only"
  }
}

resource "aws_s3_bucket_policy" "ui" {
  bucket = aws_s3_bucket.ui.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.ui.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.ui.arn
          }
        }
      }
    ]
  })
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public HTTP and HTTPS access for ${local.name}."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.http_ingress_cidrs
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.http_ingress_cidrs
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs_instance" {
  name        = "${local.name}-ecs-instance"
  description = "ALB access for ${local.name} ECS host."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Webhook API from ALB"
    from_port       = var.host_port
    to_port         = var.host_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_cluster" "main" {
  name = local.name
}

resource "aws_iam_role" "ecs_instance" {
  name = "${local.name}-ecs-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_instance" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_role_policy_attachment" "ecs_instance_ssm" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ecs_instance" {
  name = "${local.name}-ecs-instance"
  role = aws_iam_role.ecs_instance.name
}

resource "aws_iam_role" "task_execution" {
  name = "${local.name}-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_read_ssm" {
  name = "${local.name}-read-ssm-parameters"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "ssm:GetParameters"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role" "task" {
  name = "${local.name}-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_publish_policy_events" {
  name = "${local.name}-publish-policy-events"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = aws_sns_topic.policy_events.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_manage_policy_data" {
  name = "${local.name}-manage-policy-data"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:PutItem",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.policy_rules.arn,
          aws_dynamodb_table.policy_runs.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role" "policy_worker" {
  name = "${local.name}-policy-worker"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "policy_worker_basic" {
  role       = aws_iam_role.policy_worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "policy_worker" {
  name = "${local.name}-policy-worker"
  role = aws_iam_role.policy_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = aws_sqs_queue.policy_events.arn
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:PutItem",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.policy_rules.arn,
          aws_dynamodb_table.policy_runs.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "ssm:GetParameters"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "policy_worker" {
  function_name    = "${local.name}-policy-worker"
  role             = aws_iam_role.policy_worker.arn
  runtime          = "nodejs22.x"
  handler          = "apps/policy-worker/dist/handler.handler"
  filename         = var.policy_worker_package_path
  source_code_hash = filebase64sha256(var.policy_worker_package_path)
  timeout          = var.policy_worker_timeout_seconds

  environment {
    variables = {
      GITHUB_TOKEN            = var.github_token == null ? "" : var.github_token
      POLICY_RULES_TABLE_NAME = aws_dynamodb_table.policy_rules.name
      POLICY_RUNS_TABLE_NAME  = aws_dynamodb_table.policy_runs.name
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.policy_worker_basic,
    aws_iam_role_policy.policy_worker
  ]
}

resource "aws_lambda_event_source_mapping" "policy_worker" {
  event_source_arn = aws_sqs_queue.policy_events.arn
  function_name    = aws_lambda_function.policy_worker.arn
  batch_size       = 1
  enabled          = var.github_token != null
}

resource "aws_instance" "ecs" {
  ami                         = data.aws_ssm_parameter.ecs_optimized_ami.value
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.ecs_instance.id]
  iam_instance_profile        = aws_iam_instance_profile.ecs_instance.name
  associate_public_ip_address = true

  user_data = <<-USER_DATA
    #!/bin/bash
    echo "ECS_CLUSTER=${aws_ecs_cluster.main.name}" >> /etc/ecs/ecs.config
  USER_DATA

  root_block_device {
    volume_size = var.root_volume_size_gb
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${local.name}-ecs"
  }
}

resource "aws_lb" "webhook_api" {
  name               = local.webhook_api_alb_name
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids
}

resource "aws_lb_target_group" "webhook_api" {
  name        = local.webhook_api_alb_name
  port        = var.host_port
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = data.aws_vpc.default.id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 2
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.webhook_api.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = var.acm_certificate_arn == null ? [1] : []

    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.webhook_api.arn
    }
  }

  dynamic "default_action" {
    for_each = var.acm_certificate_arn == null ? [] : [1]

    content {
      type = "redirect"

      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count = var.acm_certificate_arn == null ? 0 : 1

  load_balancer_arn = aws_lb.webhook_api.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.acm_certificate_arn
  ssl_policy        = var.alb_ssl_policy

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.webhook_api.arn
  }
}

resource "aws_ecs_task_definition" "webhook_api" {
  family                   = "${local.name}-webhook-api"
  requires_compatibilities = ["EC2"]
  network_mode             = "bridge"
  cpu                      = "128"
  memory                   = "384"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "webhook-api"
      image     = "${aws_ecr_repository.webhook_api.repository_url}:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 3000
          hostPort      = var.host_port
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "PORT"
          value = "3000"
        },
        {
          name  = "LOG_LEVEL"
          value = var.log_level
        },
        {
          name  = "AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "POLICY_EVENTS_TOPIC_ARN"
          value = aws_sns_topic.policy_events.arn
        },
        {
          name  = "POLICY_RULES_TABLE_NAME"
          value = aws_dynamodb_table.policy_rules.name
        },
        {
          name  = "POLICY_RUNS_TABLE_NAME"
          value = aws_dynamodb_table.policy_runs.name
        },
        {
          name  = "UI_CORS_ORIGIN"
          value = var.ui_hostname == null ? "https://${aws_cloudfront_distribution.ui.domain_name}" : "https://${var.ui_hostname}"
        }
      ]

      secrets = concat(
        [
          {
            name      = "GITHUB_WEBHOOK_SECRET"
            valueFrom = aws_ssm_parameter.github_webhook_secret.arn
          }
        ],
        var.github_token == null ? [] : [
          {
            name      = "GITHUB_TOKEN"
            valueFrom = aws_ssm_parameter.github_token[0].arn
          }
        ]
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.webhook_api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "webhook_api" {
  name            = "${local.name}-webhook-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.webhook_api.arn
  desired_count   = 1
  launch_type     = "EC2"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  load_balancer {
    target_group_arn = aws_lb_target_group.webhook_api.arn
    container_name   = "webhook-api"
    container_port   = 3000
  }

  depends_on = [
    aws_instance.ecs,
    aws_iam_role_policy.task_execution_read_ssm,
    aws_iam_role_policy.task_manage_policy_data,
    aws_iam_role_policy.task_publish_policy_events,
    aws_iam_role_policy_attachment.ecs_instance,
    aws_iam_role_policy_attachment.task_execution,
    aws_lb_listener.http,
    aws_lb_listener.https
  ]
}
