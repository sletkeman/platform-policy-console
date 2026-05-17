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

  it("comments when a pull request title passes policy", async () => {
    const fetchMock = mockGitHubComments([]);
    const app = await buildApp({ ...config, GITHUB_TOKEN: "github-token" });
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
    const commentRequest = getFetchCall(fetchMock, 1);
    expect(commentRequest.url).toBe(
      "https://api.github.com/repos/sletkeman/platform-policy-console/issues/42/comments"
    );
    expect(commentRequest.init.method).toBe("POST");
    expect(commentRequest.body).toContain("Platform policy checks passed");

    await app.close();
  });

  it("comments when a pull request title fails policy", async () => {
    const fetchMock = mockGitHubComments([
      {
        id: 101,
        body: "<!-- platform-policy-console:pull-request-policy -->\nold body",
        html_url: "https://github.com/sletkeman/platform-policy-console/pull/42#issuecomment-101"
      }
    ]);
    const app = await buildApp({ ...config, GITHUB_TOKEN: "github-token" });
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
    const commentRequest = getFetchCall(fetchMock, 1);
    expect(commentRequest.url).toBe(
      "https://api.github.com/repos/sletkeman/platform-policy-console/issues/comments/101"
    );
    expect(commentRequest.init.method).toBe("PATCH");
    expect(commentRequest.body).toContain("Platform policy checks failed");
    expect(commentRequest.body).toContain("PR title must start with a Jira-style story reference");

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

function mockGitHubComments(comments: Array<{ id: number; body: string; html_url: string }>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
    const method = init?.method ?? "GET";

    if (method === "GET") {
      return Promise.resolve(Response.json(comments));
    }

    return Promise.resolve(
      Response.json({
        id: comments[0]?.id ?? 102,
        html_url: "https://github.com/sletkeman/platform-policy-console/pull/42#issuecomment-102"
      })
    );
  });
}

function getFetchCall(fetchMock: ReturnType<typeof mockGitHubComments>, index: number) {
  const call = fetchMock.mock.calls[index];

  if (!call) {
    throw new Error(`Expected fetch call ${index} to exist`);
  }

  const [url, init] = call;

  if (typeof url !== "string" || !init || typeof init.body !== "string") {
    throw new Error(`Expected fetch call ${index} to include a URL and JSON body`);
  }

  return {
    url,
    init,
    body: init.body
  };
}
