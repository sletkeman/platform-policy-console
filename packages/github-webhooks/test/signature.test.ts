import { describe, expect, it } from "vitest";

import { parseGitHubHeaders, signPayload, verifySignature, WebhookVerificationError } from "../src/index.js";

describe("GitHub webhook signatures", () => {
  it("signs and verifies payloads with the shared secret", () => {
    const payload = JSON.stringify({ action: "opened" });
    const signature256 = signPayload(payload, "secret");

    expect(verifySignature({ payload, secret: "secret", signature256 })).toBe(true);
    expect(verifySignature({ payload, secret: "wrong", signature256 })).toBe(false);
  });

  it("parses required GitHub headers", () => {
    expect(
      parseGitHubHeaders({
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-id",
        "x-hub-signature-256": "sha256=abc123"
      })
    ).toEqual({
      event: "pull_request",
      delivery: "delivery-id",
      signature256: "sha256=abc123"
    });
  });

  it("rejects missing required headers", () => {
    expect(() => parseGitHubHeaders({})).toThrow(WebhookVerificationError);
  });
});
