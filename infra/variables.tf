variable "aws_region" {
  description = "AWS region for the webhook API."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for AWS resource names."
  type        = string
  default     = "platform-policy-console"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "dev"
}

variable "image_tag" {
  description = "Container image tag ECS should deploy."
  type        = string
  default     = "latest"
}

variable "instance_type" {
  description = "EC2 instance type for the single ECS container host. Verify free-tier eligibility in your account and region."
  type        = string
  default     = "t3.micro"
}

variable "root_volume_size_gb" {
  description = "Root EBS volume size for the ECS host."
  type        = number
  default     = 30
}

variable "host_port" {
  description = "Public host port mapped to the webhook API container."
  type        = number
  default     = 80
}

variable "http_ingress_cidrs" {
  description = "CIDR ranges allowed to call the public ALB HTTP and HTTPS endpoints."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener. Leave null to run the ALB over HTTP only."
  type        = string
  default     = null
}

variable "service_hostname" {
  description = "Optional custom hostname that points to the ALB and matches the ACM certificate."
  type        = string
  default     = null
}

variable "ui_hostname" {
  description = "Optional custom hostname for the static UI CloudFront distribution."
  type        = string
  default     = null
}

variable "alb_ssl_policy" {
  description = "TLS security policy for the HTTPS listener."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "log_retention_days" {
  description = "CloudWatch log retention period for container logs."
  type        = number
  default     = 7
}

variable "log_level" {
  description = "Webhook API log level."
  type        = string
  default     = "info"
}

variable "github_webhook_secret" {
  description = "Shared secret configured on the GitHub webhook."
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "Optional GitHub token used by the webhook API to comment on pull requests."
  type        = string
  sensitive   = true
  default     = null
}

variable "policy_events_visibility_timeout_seconds" {
  description = "Visibility timeout for queued policy events."
  type        = number
  default     = 60
}

variable "policy_events_retention_seconds" {
  description = "Retention period for queued policy events."
  type        = number
  default     = 345600
}

variable "policy_events_max_receive_count" {
  description = "Number of failed receives before a policy event moves to the dead-letter queue."
  type        = number
  default     = 5
}

variable "policy_worker_package_path" {
  description = "Path to the built policy worker Lambda zip package."
  type        = string
  default     = "../dist/policy-worker.zip"
}

variable "policy_worker_timeout_seconds" {
  description = "Policy worker Lambda timeout."
  type        = number
  default     = 30
}
