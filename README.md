# Platform Policy Console

Monorepo scaffold for a GitHub webhook powered platform policy console.

## Layout

- `apps/webhook-api`: HTTP entrypoint for GitHub webhooks.
- `packages/github-webhooks`: Shared verification and event helpers.
- `tooling/eslint`: Reserved for shared lint rules as the repo grows.

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The webhook API listens on `http://localhost:3000` by default.

Swagger UI is available at `http://localhost:3000/docs` after the API starts.
The raw OpenAPI document is served from `http://localhost:3000/docs/json`.

## Scripts

- `pnpm dev`: Run the webhook API in watch mode.
- `pnpm build`: Build all workspaces.
- `pnpm test`: Run all tests.
- `pnpm lint`: Run ESLint.
- `pnpm typecheck`: Run TypeScript checks.

## Infrastructure

Terraform for the development deployment lives in `infra`. It creates an ECR repository,
ECS cluster, one EC2 container host, IAM roles, CloudWatch logs, and an SSM SecureString
parameter for `GITHUB_WEBHOOK_SECRET`.

See `infra/README.md` for the bootstrap, build, push, and deploy flow.

## Local Container

```bash
docker compose up --build
```

The containerized API listens on `http://localhost:3000`.

Swagger UI is available at `http://localhost:3000/docs` in the container too.

## Build and Push to AWS

Bootstrap the ECR repository once before the first image push:

```bash
cd infra
terraform init
terraform apply \
  -target=aws_ecr_repository.webhook_api \
  -target=aws_ecr_lifecycle_policy.webhook_api
```

Build and push from the repository root:

```bash
AWS_REGION="$(terraform -chdir=infra output -raw aws_region 2>/dev/null || echo us-east-1)"
ECR_REPOSITORY_URL="$(terraform -chdir=infra output -raw ecr_repository_url)"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REPOSITORY_URL"

docker buildx build \
  --platform linux/amd64 \
  --tag "$ECR_REPOSITORY_URL:latest" \
  --push \
  .
```

If the Docker login fails, confirm the AWS CLI is authenticated and targeting the same
account and region as Terraform:

```bash
aws sts get-caller-identity
aws ecr describe-repositories --region "$AWS_REGION"
```

After pushing a new `latest` image, force ECS to pull it:

```bash
aws ecs update-service \
  --cluster "$(terraform -chdir=infra output -raw ecs_cluster_name)" \
  --service "$(terraform -chdir=infra output -raw ecs_service_name)" \
  --force-new-deployment
```

## CI/CD

CI runs in GitHub Actions on pull requests. It runs linting, typechecks, and tests.

CD is configured in `.github/workflows/deploy.yml` and is designed for GitHub Actions
with AWS OIDC. It runs when a PR is merged into `main`, assuming branch protection blocks
direct commits to `main`, and it can also be run manually from the Actions tab.

Configure these variables in GitHub under **Settings > Secrets and variables > Actions >
Variables**:

- `AWS_REGION`: AWS region, for example `us-east-1`.
- `ECR_REPOSITORY_URL`: Terraform output `ecr_repository_url`.
- `ECS_CLUSTER_NAME`: Terraform output `ecs_cluster_name`.
- `ECS_SERVICE_NAME`: Terraform output `ecs_service_name`.

Configure this secret under **Settings > Secrets and variables > Actions > Secrets**:

- `AWS_ROLE_ARN`: IAM role GitHub Actions can assume to push to ECR and update ECS.

If you use the `production` GitHub environment, set the same variables and secret under
**Settings > Environments > production** instead. The workflow job is attached to that
environment.

The deploy workflow builds the Docker image, pushes both `latest` and the commit SHA tag,
and forces a new ECS deployment. Both workflows set
`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` and run project commands with Node.js 24.

## GitHub Webhook Setup

Create a repository or organization webhook that points to:

```text
https://api.letkeman.trade/webhooks/github
```

Use `application/json` as the content type and set the secret to the same value as
`GITHUB_WEBHOOK_SECRET`.
