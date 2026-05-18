import type { FastifyInstance } from "fastify";
import { DeleteCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { defaultPullRequestRules } from "@platform-policy-console/policy-core";

import type { AppConfig } from "../config.js";
import type { createDynamoDocumentClient } from "../data/dynamo.js";

type DynamoDocumentClient = ReturnType<typeof createDynamoDocumentClient>;

const ruleSchema = z.object({
  scope: z.string().min(1),
  ruleKey: z.string().min(1).optional(),
  id: z.string().min(1),
  version: z.coerce.number().int().positive(),
  enabled: z.boolean(),
  event: z.literal("pull_request"),
  actions: z.array(z.string().min(1)).min(1),
  subject: z.literal("pull_request.title"),
  assertion: z.object({
    operator: z.literal("matches"),
    pattern: z.string().min(1),
    flags: z.string().optional()
  }),
  messages: z.object({
    pass: z.string().min(1),
    fail: z.string().min(1)
  })
});

const defaultRule = {
  scope: "repo#sletkeman/platform-policy-console",
  ...defaultPullRequestRules[0]
};

export function registerPolicyAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  dynamo: DynamoDocumentClient
) {
  app.get(
    "/api/policy-rules",
    {
      schema: {
        tags: ["policy"],
        summary: "List policy rules",
        querystring: {
          type: "object",
          properties: {
            scope: { type: "string" }
          }
        }
      }
    },
    async (request) => {
      ensurePolicyTablesConfigured(config);
      const query = z
        .object({ scope: z.string().min(1).default(defaultRule.scope) })
        .parse(request.query);
      const response = await dynamo.send(
        new QueryCommand({
          TableName: config.POLICY_RULES_TABLE_NAME,
          KeyConditionExpression: "#scope = :scope",
          ExpressionAttributeNames: {
            "#scope": "scope"
          },
          ExpressionAttributeValues: {
            ":scope": query.scope
          }
        })
      );

      return {
        rules: response.Items ?? [],
        defaultRule
      };
    }
  );

  app.put(
    "/api/policy-rules",
    {
      schema: {
        tags: ["policy"],
        summary: "Create or update a policy rule"
      }
    },
    async (request) => {
      ensurePolicyTablesConfigured(config);
      const rule = ruleSchema.parse(unwrapJsonBody(request.body));
      const item = {
        ...rule,
        ruleKey: rule.ruleKey ?? buildRuleKey(rule),
        updatedAt: new Date().toISOString()
      };

      await dynamo.send(
        new PutCommand({
          TableName: config.POLICY_RULES_TABLE_NAME,
          Item: item
        })
      );

      return { rule: item };
    }
  );

  app.delete(
    "/api/policy-rules",
    {
      schema: {
        tags: ["policy"],
        summary: "Delete a policy rule",
        querystring: {
          type: "object",
          required: ["scope", "ruleKey"],
          properties: {
            scope: { type: "string" },
            ruleKey: { type: "string" }
          }
        }
      }
    },
    async (request) => {
      ensurePolicyTablesConfigured(config);
      const query = z
        .object({ scope: z.string().min(1), ruleKey: z.string().min(1) })
        .parse(request.query);

      await dynamo.send(
        new DeleteCommand({
          TableName: config.POLICY_RULES_TABLE_NAME,
          Key: query
        })
      );

      return { deleted: true };
    }
  );

  app.get(
    "/api/policy-runs",
    {
      schema: {
        tags: ["policy"],
        summary: "List recent policy runs",
        querystring: {
          type: "object",
          properties: {
            repo: { type: "string" },
            limit: { type: "number" }
          }
        }
      }
    },
    async (request) => {
      ensurePolicyTablesConfigured(config);
      const query = z
        .object({
          repo: z.string().min(1).optional(),
          limit: z.coerce.number().int().positive().max(50).default(20)
        })
        .parse(request.query);

      const response = query.repo
        ? await dynamo.send(
            new QueryCommand({
              TableName: config.POLICY_RUNS_TABLE_NAME,
              KeyConditionExpression: "#repo = :repo",
              ExpressionAttributeNames: {
                "#repo": "repo"
              },
              ExpressionAttributeValues: {
                ":repo": query.repo
              },
              Limit: query.limit,
              ScanIndexForward: false
            })
          )
        : await dynamo.send(
            new ScanCommand({
              TableName: config.POLICY_RUNS_TABLE_NAME,
              Limit: query.limit
            })
          );

      const runs = [...(response.Items ?? [])].sort((a, b) =>
        String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))
      );

      return { runs };
    }
  );
}

function ensurePolicyTablesConfigured(config: AppConfig) {
  if (!config.POLICY_RULES_TABLE_NAME || !config.POLICY_RUNS_TABLE_NAME) {
    throw new Error("Policy DynamoDB table names are not configured");
  }
}

function buildRuleKey(rule: z.infer<typeof ruleSchema>) {
  return `rule#${rule.event}#${rule.id}#v${rule.version}`;
}

function unwrapJsonBody(body: unknown) {
  if (typeof body === "object" && body !== null && "payload" in body) {
    return body.payload;
  }

  return body;
}
