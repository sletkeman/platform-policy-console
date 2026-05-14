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

## Scripts

- `pnpm dev`: Run the webhook API in watch mode.
- `pnpm build`: Build all workspaces.
- `pnpm test`: Run all tests.
- `pnpm lint`: Run ESLint.
- `pnpm typecheck`: Run TypeScript checks.

## GitHub Webhook Setup

Create a repository or organization webhook that points to:

```text
https://your-domain.example/webhooks/github
```

Use `application/json` as the content type and set the secret to the same value as
`GITHUB_WEBHOOK_SECRET`.
