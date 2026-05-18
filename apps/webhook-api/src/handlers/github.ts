import type { FastifyInstance } from "fastify";

import {
  createWebhookEnvelope,
  parseGitHubHeaders,
  verifySignature,
  WebhookVerificationError
} from "@platform-policy-console/github-webhooks";

import type { AppConfig } from "../config.js";
import { NoopPolicyEventPublisher } from "../events/policyEvents.js";
import type { PolicyEventPublisher } from "../events/policyEvents.js";

type GitHubWebhookBody = Record<string, unknown>;

export type ParsedGitHubWebhookBody = {
  rawBody: Buffer;
  payload: GitHubWebhookBody;
};

type PullRequestWebhookPayload = {
  action: string;
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
  pull_request: {
    number: number;
    title: string;
  };
};

export function registerGitHubWebhookRoutes(
  app: FastifyInstance,
  config: AppConfig,
  policyEventPublisher: PolicyEventPublisher = new NoopPolicyEventPublisher()
) {
  app.post<{ Body: ParsedGitHubWebhookBody }>(
    "/webhooks/github",
    {
      schema: {
        tags: ["webhooks"],
        summary: "Receive a GitHub webhook",
        description:
          "Validates the GitHub SHA-256 webhook signature and accepts the event for platform policy processing.",
        headers: {
          type: "object",
          required: ["x-github-delivery", "x-github-event", "x-hub-signature-256"],
          properties: {
            "x-github-delivery": {
              type: "string",
              description: "GitHub delivery identifier for this webhook request."
            },
            "x-github-event": {
              type: "string",
              description: "GitHub event name, for example pull_request or push."
            },
            "x-hub-signature-256": {
              type: "string",
              description: "HMAC SHA-256 signature in the form sha256=<hex digest>."
            }
          }
        },
        body: {
          type: "object",
          description: "Raw GitHub webhook JSON payload.",
          additionalProperties: true
        },
        response: {
          202: {
            type: "object",
            required: ["accepted", "delivery", "event"],
            properties: {
              accepted: { type: "boolean" },
              delivery: { type: "string" },
              event: { type: "string" }
            }
          },
          401: {
            type: "object",
            required: ["error"],
            properties: {
              error: { type: "string", const: "invalid_webhook_signature" }
            }
          },
          500: {
            type: "object",
            required: ["error"],
            properties: {
              error: {
                type: "string",
                enum: ["invalid_application_configuration", "internal_server_error"]
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const headers = parseGitHubHeaders(request.headers);
      const verified = verifySignature({
        payload: request.body.rawBody,
        secret: config.GITHUB_WEBHOOK_SECRET,
        signature256: headers.signature256
      });

      if (!verified) {
        throw new WebhookVerificationError();
      }

      const envelope = createWebhookEnvelope({
        headers,
        payload: request.body.payload
      });

      request.log.info(
        {
          delivery: envelope.delivery,
          event: envelope.event
        },
        "accepted GitHub webhook"
      );

      if (envelope.event === "pull_request") {
        await handlePullRequestWebhook({
          payload: envelope.payload,
          delivery: envelope.delivery,
          policyEventPublisher,
          log: request.log
        });
      }

      return reply.code(202).send({
        accepted: true,
        delivery: envelope.delivery,
        event: envelope.event
      });
    }
  );
}

async function handlePullRequestWebhook({
  payload,
  delivery,
  policyEventPublisher,
  log
}: {
  payload: GitHubWebhookBody;
  delivery: string;
  policyEventPublisher: PolicyEventPublisher;
  log: FastifyInstance["log"];
}) {
  const pullRequestPayload = parsePullRequestPayload(payload);

  if (!pullRequestPayload) {
    log.warn({ payload }, "ignored malformed pull_request webhook payload");
    return;
  }

  await publishPolicyEvent(
    policyEventPublisher,
    {
      type: "pull_request_policy_requested",
      delivery,
      owner: pullRequestPayload.repository.owner.login,
      repo: pullRequestPayload.repository.name,
      pullNumber: pullRequestPayload.pull_request.number,
      action: pullRequestPayload.action,
      title: pullRequestPayload.pull_request.title,
      occurredAt: new Date().toISOString()
    },
    log
  );
}

async function publishPolicyEvent(
  policyEventPublisher: PolicyEventPublisher,
  event: Parameters<PolicyEventPublisher["publish"]>[0],
  log: FastifyInstance["log"]
) {
  try {
    await policyEventPublisher.publish(event);
  } catch (error) {
    log.error({ error, eventType: event.type }, "failed to publish policy event");
  }
}

function parsePullRequestPayload(payload: GitHubWebhookBody): PullRequestWebhookPayload | null {
  const action = payload.action;
  const repository = payload.repository;
  const pullRequest = payload.pull_request;

  if (typeof action !== "string" || !isRecord(repository) || !isRecord(pullRequest)) {
    return null;
  }

  const repoName = repository.name;
  const owner = repository.owner;
  const pullNumber = pullRequest.number;
  const title = pullRequest.title;

  if (
    typeof repoName !== "string" ||
    !isRecord(owner) ||
    typeof owner.login !== "string" ||
    typeof pullNumber !== "number" ||
    typeof title !== "string"
  ) {
    return null;
  }

  return {
    action,
    repository: {
      name: repoName,
      owner: {
        login: owner.login
      }
    },
    pull_request: {
      number: pullNumber,
      title
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
