import Fastify from "fastify";
import { ZodError } from "zod";

import { WebhookVerificationError } from "@platform-policy-console/github-webhooks";

import type { AppConfig } from "./config.js";
import type { ParsedGitHubWebhookBody } from "./handlers/github.js";
import { registerGitHubWebhookRoutes } from "./handlers/github.js";

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL
    }
  });

  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    try {
      const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
      done(null, { rawBody, payload } satisfies ParsedGitHubWebhookBody);
    } catch (error) {
      done(error as Error);
    }
  });

  app.get("/health", () => ({
    ok: true,
    service: "webhook-api"
  }));

  registerGitHubWebhookRoutes(app, config);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof WebhookVerificationError) {
      request.log.warn({ error }, "rejected GitHub webhook");
      return reply.code(401).send({ error: "invalid_webhook_signature" });
    }

    if (error instanceof ZodError) {
      request.log.error({ error }, "invalid application configuration");
      return reply.code(500).send({ error: "invalid_application_configuration" });
    }

    request.log.error({ error }, "unhandled request error");
    return reply.code(500).send({ error: "internal_server_error" });
  });

  return app;
}
