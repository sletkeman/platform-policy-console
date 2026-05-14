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
  app.post<{ Body: ParsedGitHubWebhookBody }>("/webhooks/github", async (request, reply) => {
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
  });
}
