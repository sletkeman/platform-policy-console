import { createHmac, timingSafeEqual } from "node:crypto";

export type GitHubWebhookHeaders = {
  event: string;
  delivery: string;
  signature256: string;
};

export type GitHubWebhookEnvelope<TPayload = unknown> = {
  event: string;
  delivery: string;
  payload: TPayload;
  receivedAt: Date;
};

export class WebhookVerificationError extends Error {
  constructor(message = "GitHub webhook signature verification failed") {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export function parseGitHubHeaders(headers: Record<string, string | string[] | undefined>) {
  const event = firstHeader(headers["x-github-event"]);
  const delivery = firstHeader(headers["x-github-delivery"]);
  const signature256 = firstHeader(headers["x-hub-signature-256"]);

  if (!event || !delivery || !signature256) {
    throw new WebhookVerificationError("GitHub webhook is missing required headers");
  }

  return { event, delivery, signature256 } satisfies GitHubWebhookHeaders;
}

export function signPayload(payload: string | Buffer, secret: string) {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

export function verifySignature({
  payload,
  secret,
  signature256
}: {
  payload: string | Buffer;
  secret: string;
  signature256: string;
}) {
  const expected = Buffer.from(signPayload(payload, secret));
  const actual = Buffer.from(signature256);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createWebhookEnvelope<TPayload>({
  payload,
  headers
}: {
  payload: TPayload;
  headers: GitHubWebhookHeaders;
}) {
  return {
    event: headers.event,
    delivery: headers.delivery,
    payload,
    receivedAt: new Date()
  } satisfies GitHubWebhookEnvelope<TPayload>;
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
