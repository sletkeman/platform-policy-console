import { defineConfig } from "vitest/config";

const githubWebhooksPath = new URL("../../packages/github-webhooks/src/index.ts", import.meta.url)
  .pathname;
const policyCorePath = new URL("../../packages/policy-core/src/index.ts", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "@platform-policy-console/github-webhooks": githubWebhooksPath,
      "@platform-policy-console/policy-core": policyCorePath
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
