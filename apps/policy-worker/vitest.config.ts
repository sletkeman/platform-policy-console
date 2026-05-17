import { defineConfig } from "vitest/config";

const githubApiPath = new URL("../../packages/github-api/src/index.ts", import.meta.url).pathname;
const policyCorePath = new URL("../../packages/policy-core/src/index.ts", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "@platform-policy-console/github-api": githubApiPath,
      "@platform-policy-console/policy-core": policyCorePath
    }
  },
  test: {
    environment: "node"
  }
});
