output "service_url" {
  description = "Public ECS service URL."
  value       = "http://${aws_instance.ecs.public_dns}"
}

output "github_webhook_url" {
  description = "GitHub webhook delivery URL."
  value       = "http://${aws_instance.ecs.public_dns}/webhooks/github"
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
