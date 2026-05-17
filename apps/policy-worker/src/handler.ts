import type { SQSHandler, SQSRecord } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { upsertPullRequestComment } from "@platform-policy-console/github-api";
import {
  defaultPullRequestRules,
  evaluatePullRequestTitleRules,
  formatPullRequestRuleComment
} from "@platform-policy-console/policy-core";

import type {
  PullRequestRuleDefinition,
  PullRequestRuleResult
} from "@platform-policy-console/policy-core";

const envSchema = z.object({
  AWS_REGION: z.string().min(1).default("us-east-1"),
  GITHUB_TOKEN: z.string().min(1),
  POLICY_RULES_TABLE_NAME: z.string().min(1),
  POLICY_RUNS_TABLE_NAME: z.string().min(1)
});

const policyRequestedEventSchema = z.object({
  type: z.literal("pull_request_policy_requested"),
  delivery: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.number().int().positive(),
  action: z.string().min(1),
  title: z.string(),
  occurredAt: z.string().min(1)
});

type PolicyRequestedEvent = z.infer<typeof policyRequestedEventSchema>;

const env = envSchema.parse(process.env);
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION }));

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    await processRecord(record);
  }
};

async function processRecord(record: SQSRecord) {
  const parsed = policyRequestedEventSchema.safeParse(JSON.parse(record.body));

  if (!parsed.success) {
    console.warn("Ignoring unsupported policy event", {
      messageId: record.messageId,
      issues: parsed.error.issues
    });
    return;
  }

  const policyEvent = parsed.data;
  const rules = await loadPullRequestRules(policyEvent);
  const results = evaluatePullRequestTitleRules({
    action: policyEvent.action,
    title: policyEvent.title,
    rules
  });

  if (results.length === 0) {
    console.info("No policy rules matched event", {
      delivery: policyEvent.delivery,
      repo: `${policyEvent.owner}/${policyEvent.repo}`,
      pullNumber: policyEvent.pullNumber,
      action: policyEvent.action
    });
    return;
  }

  const passed = results.every((result) => result.passed);
  const comment = await upsertPullRequestComment({
    owner: policyEvent.owner,
    repo: policyEvent.repo,
    pullNumber: policyEvent.pullNumber,
    token: env.GITHUB_TOKEN,
    body: formatPullRequestRuleComment(results)
  });

  await savePolicyRun({
    policyEvent,
    results,
    passed,
    commentAction: comment.action,
    commentUrl: comment.commentUrl
  });
}

async function loadPullRequestRules(policyEvent: PolicyRequestedEvent) {
  const repoScope = `repo#${policyEvent.owner}/${policyEvent.repo}`;
  const orgScope = `org#${policyEvent.owner}`;
  const rules = [
    ...(await queryRules(repoScope)),
    ...(await queryRules(orgScope)),
    ...(await queryRules("global"))
  ];

  return rules.length > 0 ? rules : defaultPullRequestRules;
}

async function queryRules(scope: string) {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: env.POLICY_RULES_TABLE_NAME,
      KeyConditionExpression: "#scope = :scope and begins_with(#ruleKey, :prefix)",
      ExpressionAttributeNames: {
        "#scope": "scope",
        "#ruleKey": "ruleKey"
      },
      ExpressionAttributeValues: {
        ":scope": scope,
        ":prefix": "rule#pull_request#"
      }
    })
  );

  return (response.Items ?? []).filter(isPullRequestRuleDefinition);
}

async function savePolicyRun({
  policyEvent,
  results,
  passed,
  commentAction,
  commentUrl
}: {
  policyEvent: PolicyRequestedEvent;
  results: PullRequestRuleResult[];
  passed: boolean;
  commentAction: "created" | "updated";
  commentUrl: string;
}) {
  const now = new Date().toISOString();

  await dynamo.send(
    new PutCommand({
      TableName: env.POLICY_RUNS_TABLE_NAME,
      Item: {
        repo: `${policyEvent.owner}/${policyEvent.repo}`,
        runKey: `pr#${policyEvent.pullNumber}#delivery#${policyEvent.delivery}`,
        pullNumber: policyEvent.pullNumber,
        title: policyEvent.title,
        delivery: policyEvent.delivery,
        status: passed ? "passed" : "failed",
        results,
        commentAction,
        commentUrl,
        eventOccurredAt: policyEvent.occurredAt,
        createdAt: now,
        updatedAt: now
      }
    })
  );
}

function isPullRequestRuleDefinition(value: unknown): value is PullRequestRuleDefinition {
  const rule = value as Partial<PullRequestRuleDefinition>;

  return (
    typeof rule.id === "string" &&
    typeof rule.version === "number" &&
    typeof rule.enabled === "boolean" &&
    rule.event === "pull_request" &&
    Array.isArray(rule.actions) &&
    rule.subject === "pull_request.title" &&
    rule.assertion?.operator === "matches" &&
    typeof rule.assertion.pattern === "string" &&
    typeof rule.messages?.pass === "string" &&
    typeof rule.messages.fail === "string"
  );
}
