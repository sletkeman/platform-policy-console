FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/webhook-api/package.json apps/webhook-api/package.json
COPY packages/github-webhooks/package.json packages/github-webhooks/package.json

RUN corepack pnpm install --frozen-lockfile

FROM deps AS build

COPY . .

RUN corepack pnpm build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/webhook-api/package.json apps/webhook-api/package.json
COPY packages/github-webhooks/package.json packages/github-webhooks/package.json
COPY --from=build /app/apps/webhook-api/dist apps/webhook-api/dist
COPY --from=build /app/packages/github-webhooks/dist packages/github-webhooks/dist

RUN corepack pnpm install --prod --frozen-lockfile

EXPOSE 3000

CMD ["node", "apps/webhook-api/dist/server.js"]
