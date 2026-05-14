# Dev Infrastructure

This Terraform environment hosts the webhook API on ECS using a single EC2 container
instance. It is intentionally small and avoids an Application Load Balancer, NAT gateway,
and Secrets Manager so the baseline is friendlier to AWS Free Tier usage.

## Cost Shape

ECS on the EC2 launch type has no separate ECS control-plane charge. You still pay for
the underlying AWS resources if they are not covered by your account's Free Tier:

- One EC2 instance, defaulting to `t3.micro`.
- One EBS root volume, defaulting to 30 GB.
- ECR image storage.
- CloudWatch log ingestion/storage.
- Public internet data transfer.

Verify that the selected `instance_type` is marked free-tier eligible in your AWS account
and region before applying.

## Deploy

Create a local variables file:

```bash
cp infra/terraform/environments/dev/terraform.tfvars.example infra/terraform/environments/dev/terraform.tfvars
```

Update `github_webhook_secret`, then initialize Terraform:

```bash
cd infra/terraform/environments/dev
terraform init
```

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
ECR_REPOSITORY_URL=$(terraform -chdir=infra/terraform/environments/dev output -raw ecr_repository_url)
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REPOSITORY_URL"
docker build -t "$ECR_REPOSITORY_URL:latest" .
docker push "$ECR_REPOSITORY_URL:latest"
```

Then create or update ECS:

```bash
cd infra/terraform/environments/dev
terraform apply
```

Use the `github_webhook_url` output as the GitHub webhook target.

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
