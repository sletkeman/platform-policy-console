import { afterEach, describe, expect, it, vi } from "vitest";

import { signPayload } from "@platform-policy-console/github-webhooks";

import { buildApp } from "../src/app.js";

const config = {
  NODE_ENV: "test",
  PORT: 3000,
  LOG_LEVEL: "silent",
  GITHUB_WEBHOOK_SECRET: "secret",
  AWS_REGION: "us-east-1"
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GitHub webhook API", () => {
  it("serves OpenAPI documentation", async () => {
    const app = await buildApp(config);

    const response = await app.inject({
      method: "GET",
      url: "/docs/json"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      openapi: "3.0.3",
      info: {
        title: "Platform Policy Console Webhook API"
      },
      paths: {
        "/health": {},
        "/webhooks/github": {}
      }
    });

    await app.close();
  });

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

  it("does not comment from the API when a pull request title passes policy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const app = await buildApp(config);
    const payload = JSON.stringify(
      createPullRequestPayload({ title: "ABCD-123 Add policy check" })
    );

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
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("does not comment from the API when a pull request title fails policy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const app = await buildApp(config);
    const payload = JSON.stringify(createPullRequestPayload({ title: "Add policy check" }));

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
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });
});

function createPullRequestPayload({ title }: { title: string }) {
  return {
    action: "opened",
    repository: {
      name: "platform-policy-console",
      owner: {
        login: "sletkeman"
      }
    },
    pull_request: {
      number: 42,
      title
    }
  };
}
