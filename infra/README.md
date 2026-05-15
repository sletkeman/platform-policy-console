# Dev Infrastructure

This Terraform environment hosts the webhook API on ECS using a single EC2 container
instance behind an internet-facing Application Load Balancer. It intentionally avoids a
NAT gateway and Secrets Manager so the baseline is friendlier to AWS Free Tier usage.

## Cost Shape

ECS on the EC2 launch type has no separate ECS control-plane charge. You still pay for
the underlying AWS resources if they are not covered by your account's Free Tier:

- One EC2 instance, defaulting to `t3.micro`.
- One Application Load Balancer.
- One EBS root volume, defaulting to 30 GB.
- ECR image storage.
- CloudWatch log ingestion/storage.
- Public internet data transfer.

Verify that the selected `instance_type` is marked free-tier eligible in your AWS account
and region before applying.

## Deploy

Create a local variables file:

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

Update `github_webhook_secret`, then initialize Terraform:

```bash
cd infra
terraform init
```

To enable HTTPS, request or import an ACM certificate in the same region as the ALB and
set its ARN in `terraform.tfvars`:

```hcl
acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."
service_hostname    = "api.example.com"
```

When `acm_certificate_arn` is set, the ALB listens on HTTPS and redirects HTTP to HTTPS.
When it is `null`, the ALB serves HTTP only.
For browser-trusted HTTPS, create a DNS alias or CNAME from `service_hostname` to the
`alb_dns_name` output; the raw ALB hostname will not match your ACM certificate.

Bootstrap the ECR repository first:

```bash
terraform apply \
  -target=aws_ecr_repository.webhook_api \
  -target=aws_ecr_lifecycle_policy.webhook_api
```

## Build and Push

From the repository root:

```bash
AWS_REGION=us-east-1
ECR_REPOSITORY_URL=953143184104.dkr.ecr.us-east-1.amazonaws.com/platform-policy-console-dev-webhook-api
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REPOSITORY_URL"
docker buildx build --platform linux/amd64 -t "$ECR_REPOSITORY_URL:latest" --push .
```

Then create or update ECS:

```bash
cd infra
terraform apply
```

Use the `github_webhook_url` output as the GitHub webhook target.
Use the `swagger_docs_url` output to open Swagger UI.

## Redeploy the Same Tag

If you push a new image with the same tag, force ECS to restart the task:

```bash
aws ecs update-service \
  --cluster "$(terraform output -raw ecs_cluster_name)" \
  --service "$(terraform output -raw ecs_service_name)" \
  --force-new-deployment
```

## Local Container

From the repository root:

```bash
docker compose up --build
```

The local container listens on `http://localhost:3000`.
