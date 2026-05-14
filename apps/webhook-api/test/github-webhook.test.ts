import { describe, expect, it } from "vitest";

import { signPayload } from "@platform-policy-console/github-webhooks";

import { buildApp } from "../src/app.js";

const config = {
  NODE_ENV: "test",
  PORT: 3000,
  LOG_LEVEL: "silent",
  GITHUB_WEBHOOK_SECRET: "secret"
} as const;

describe("GitHub webhook API", () => {
  it("accepts verified GitHub webhooks", async () => {
    const app = await buildApp(config);
    const payload = JSON.stringify({ action: "opened" });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-id",
        "x-hub-signature-256": signPayload(payload, config.GITHUB_WEBHOOK_SECRET)
      },
      payload
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      accepted: true,
      delivery: "delivery-id",
      event: "pull_request"
    });

    await app.close();
  });

  it("rejects webhooks with invalid signatures", async () => {
    const app = await buildApp(config);
    const payload = JSON.stringify({ action: "opened" });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-id",
        "x-hub-signature-256": "sha256=bad"
      },
      payload
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
