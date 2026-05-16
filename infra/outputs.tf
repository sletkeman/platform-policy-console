output "aws_region" {
  description = "AWS region used for the deployment."
  value       = var.aws_region
}

output "service_url" {
  description = "Public ALB service URL."
  value       = "${local.service_scheme}://${local.service_host}"
}

output "github_webhook_url" {
  description = "GitHub webhook delivery URL."
  value       = "${local.service_scheme}://${local.service_host}/webhooks/github"
}

output "swagger_docs_url" {
  description = "Swagger UI URL."
  value       = "${local.service_scheme}://${local.service_host}/docs"
}

output "alb_dns_name" {
  description = "Application Load Balancer DNS name."
  value       = aws_lb.webhook_api.dns_name
}

output "ecr_repository_url" {
  description = "ECR repository URL for the webhook API image."
  value       = aws_ecr_repository.webhook_api.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.webhook_api.name
}
