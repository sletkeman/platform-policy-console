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

Terraform for the development deployment lives in `infra/terraform/environments/dev`.
It creates an ECR repository, ECS cluster, one EC2 container host, IAM roles, CloudWatch
logs, and an SSM parameter for `GITHUB_WEBHOOK_SECRET`.

See `infra/terraform/environments/dev/README.md` for the bootstrap and deploy flow.

## Local Container

```bash
docker compose up --build
```

The containerized API listens on `http://localhost:3000`.

Swagger UI is available at `http://localhost:3000/docs` in the container too.

## GitHub Webhook Setup

Create a repository or organization webhook that points to:

```text
https://your-domain.example/webhooks/github
```

Use `application/json` as the content type and set the secret to the same value as
`GITHUB_WEBHOOK_SECRET`.
