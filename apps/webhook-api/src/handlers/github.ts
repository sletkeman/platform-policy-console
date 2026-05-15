import type { FastifyInstance } from "fastify";

import {
  createWebhookEnvelope,
  parseGitHubHeaders,
  verifySignature,
  WebhookVerificationError
} from "@platform-policy-console/github-webhooks";

import type { AppConfig } from "../config.js";

type GitHubWebhookBody = Record<string, unknown>;

export type ParsedGitHubWebhookBody = {
  rawBody: Buffer;
  payload: GitHubWebhookBody;
};

export function registerGitHubWebhookRoutes(app: FastifyInstance, config: AppConfig) {
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

      return reply.code(202).send({
        accepted: true,
        delivery: envelope.delivery,
        event: envelope.event
      });
    }
  );
}
