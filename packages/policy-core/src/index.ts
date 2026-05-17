export type PullRequestRuleDefinition = {
  id: string;
  version: number;
  enabled: boolean;
  event: "pull_request";
  actions: string[];
  subject: "pull_request.title";
  assertion: {
    operator: "matches";
    pattern: string;
    flags?: string;
  };
  messages: {
    pass: string;
    fail: string;
  };
};

export type PullRequestRuleResult = {
  ruleId: string;
  passed: boolean;
  message: string;
};

export const defaultPullRequestRules = [
  {
    id: "pull-request-title-starts-with-jira-story",
    version: 1,
    enabled: true,
    event: "pull_request",
    actions: ["opened", "edited", "reopened", "synchronize", "ready_for_review"],
    subject: "pull_request.title",
    assertion: {
      operator: "matches",
      pattern: "^\\w{4}-\\d+",
      flags: "i"
    },
    messages: {
      pass: "PR title starts with a Jira-style story reference.",
      fail: "PR title must start with a Jira-style story reference like `ABCD-123`."
    }
  }
] satisfies PullRequestRuleDefinition[];

export function evaluatePullRequestTitleRules({
  action,
  title,
  rules = defaultPullRequestRules
}: {
  action: string;
  title: string;
  rules?: readonly PullRequestRuleDefinition[];
}) {
  return rules
    .filter((rule) => rule.enabled && rule.actions.includes(action))
    .map((rule) => {
      const pattern = new RegExp(rule.assertion.pattern, rule.assertion.flags);
      const passed = pattern.test(title);

      return {
        ruleId: rule.id,
        passed,
        message: passed ? rule.messages.pass : rule.messages.fail
      } satisfies PullRequestRuleResult;
    });
}

export function formatPullRequestRuleComment(results: PullRequestRuleResult[]) {
  const passed = results.every((result) => result.passed);
  const status = passed ? "passed" : "failed";
  const summary = passed
    ? "Platform policy checks passed for this pull request."
    : "Platform policy checks failed for this pull request.";
  const details = results
    .map((result) => {
      const icon = result.passed ? "PASS" : "FAIL";
      return `- ${icon} \`${result.ruleId}\`: ${result.message}`;
    })
    .join("\n");

  return [`## Platform Policy: ${status}`, summary, details].join("\n\n");
}
