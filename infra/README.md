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

Update `github_webhook_secret`, and set `github_token` if you want the API to comment on
pull requests. Then initialize Terraform:

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
ECR_REPOSITORY_URL="$(terraform -chdir=infra output -raw ecr_repository_url)"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REPOSITORY_URL"

docker buildx build \
  --platform linux/amd64 \
  --tag "$ECR_REPOSITORY_URL:latest" \
  --push \
  .
```

If Docker login fails, first check which AWS identity the CLI is using:

```bash
aws sts get-caller-identity
aws ecr describe-repositories --region "$AWS_REGION"
```

Common causes are an expired SSO/session token, a different AWS profile than the one
used for Terraform, a region mismatch, or using the full image tag instead of the
repository URL when logging in.

To use a named AWS CLI profile:

```bash
AWS_PROFILE=your-profile aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REPOSITORY_URL"
```

Then create or update ECS:

```bash
cd infra
terraform apply
```

Use the `github_webhook_url` output as the GitHub webhook target.
Use the `swagger_docs_url` output to open Swagger UI.

## GitHub Credentials

`github_webhook_secret` verifies that inbound webhook deliveries came from GitHub.
`github_token` authorizes outbound API calls back to GitHub, such as creating or updating
PR comments.

For early testing, use a fine-grained token with access to the target repository and
permission to write pull request or issue comments:

```hcl
github_token = "github_pat_..."
```

Terraform stores the token in SSM Parameter Store as a SecureString and injects it into
the ECS task as `GITHUB_TOKEN`. Longer term, prefer a GitHub App installation token.

## Policy Event Queue

Terraform creates:

- SNS topic: `policy_events_topic_arn`
- SQS queue: `policy_events_queue_url`
- SQS dead-letter queue: `policy_events_dlq_url`

The webhook API publishes pull request policy lifecycle events to SNS:

- `pull_request_policy_requested`
- `pull_request_policy_completed`
- `pull_request_policy_failed`

SNS fans those messages into SQS with raw message delivery enabled. The API still performs
the current PR comment synchronously, but the queue gives us a durable trail for failures
and a natural handoff point for a future background worker.

Build the Lambda package before applying Terraform:

```bash
corepack pnpm build:policy-worker
```

Terraform deploys a Lambda worker subscribed to the SQS queue. The worker consumes
`pull_request_policy_requested` events, loads rules from DynamoDB, falls back to the
default Jira-style PR title rule when no database rules exist, comments on the PR, and
stores the outcome in the policy runs table.

The DynamoDB tables are:

- `policy_rules_table_name`: editable rule definitions for the future UI.
- `policy_runs_table_name`: PR policy outcomes for the list page.

## Static UI

Terraform creates a private S3 bucket and CloudFront distribution for the React UI. Set
`ui_hostname = "ui.letkeman.trade"` and use an ACM certificate ARN that includes that
hostname. If `ui_hostname` is `null`, use the generated CloudFront domain from
`ui_cloudfront_domain_name`.

Build and publish the UI from the repository root:

```bash
VITE_API_BASE_URL="$(terraform output -raw service_url)" corepack pnpm build:ui
corepack pnpm deploy:ui
```

The API receives `UI_CORS_ORIGIN` from Terraform so the static UI can call the policy
CRUD and run-list endpoints.

Inspect queued events:

```bash
aws sqs receive-message \
  --queue-url "$(terraform output -raw policy_events_queue_url)" \
  --max-number-of-messages 10 \
  --visibility-timeout 30
```

Inspect failed events:

```bash
aws sqs receive-message \
  --queue-url "$(terraform output -raw policy_events_dlq_url)" \
  --max-number-of-messages 10 \
  --visibility-timeout 30
```

## GitHub Actions CD

GitHub Actions is the recommended CI/CD runner for this repo because the source,
pull requests, and existing CI workflow are already in GitHub. Use AWS for the runtime
and permissions boundary: GitHub assumes a narrowly scoped AWS IAM role through OIDC,
pushes the image to ECR, then forces ECS to deploy the new `latest` image.

CI runs on pull requests only. The deploy workflow runs on pushes to `main`, which means
it runs after PR merges once direct commits to `main` are blocked by branch protection.
It can also be run manually from the Actions tab.

The deploy workflow expects these GitHub variables:

- `AWS_REGION`: AWS region, for example `us-east-1`.
- `ECR_REPOSITORY_URL`: `terraform output -raw ecr_repository_url`.
- `ECS_CLUSTER_NAME`: `terraform output -raw ecs_cluster_name`.
- `ECS_SERVICE_NAME`: `terraform output -raw ecs_service_name`.

Add them under **Settings > Secrets and variables > Actions > Variables** for repository
variables, or under **Settings > Environments > production** if you prefer to scope them
to the `production` environment used by the deploy job.

It expects this GitHub secret:

- `AWS_ROLE_ARN`: IAM role ARN for GitHub Actions.

Add it under **Settings > Secrets and variables > Actions > Secrets**, or under
**Settings > Environments > production** for an environment-scoped secret.

Both workflows set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` and use Node.js 24 for
project commands.

The IAM role should trust the GitHub OIDC provider and allow:

- `ecr:GetAuthorizationToken`
- `ecr:BatchCheckLayerAvailability`
- `ecr:InitiateLayerUpload`
- `ecr:UploadLayerPart`
- `ecr:CompleteLayerUpload`
- `ecr:PutImage`
- `ecr:BatchGetImage`
- `ecs:UpdateService`

Scope the ECR permissions to this repository where possible and scope `ecs:UpdateService`
to this ECS service. `ecr:GetAuthorizationToken` must remain resource `*`.

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
