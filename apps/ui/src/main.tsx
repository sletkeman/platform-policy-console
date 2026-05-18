import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

type Rule = {
  scope: string;
  ruleKey?: string;
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
  updatedAt?: string;
};

type PolicyRun = {
  repo: string;
  runKey: string;
  pullNumber: number;
  title: string;
  delivery: string;
  status: "passed" | "failed";
  commentUrl?: string;
  updatedAt?: string;
  createdAt?: string;
};

const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? "");
const defaultRepo = "sletkeman/platform-policy-console";
const defaultScope = `repo#${defaultRepo}`;
const fallbackRule: Rule = {
  scope: defaultScope,
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
};

function App() {
  const [repo, setRepo] = useState(defaultRepo);
  const [scope, setScope] = useState(defaultScope);
  const [runs, setRuns] = useState<PolicyRun[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [status, setStatus] = useState("Loading policy data");

  const passedCount = useMemo(() => runs.filter((run) => run.status === "passed").length, [runs]);
  const failedCount = runs.length - passedCount;

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setStatus("Refreshing");
    try {
      const [runsResponse, rulesResponse] = await Promise.all([
        api<{ runs: PolicyRun[] }>(`/api/policy-runs?repo=${encodeURIComponent(repo)}&limit=20`),
        api<{ rules: Rule[]; defaultRule: Rule }>(
          `/api/policy-rules?scope=${encodeURIComponent(scope)}`
        )
      ]);

      setRuns(runsResponse.runs);
      setRules(rulesResponse.rules);
      setDraft(rulesResponse.rules[0] ?? rulesResponse.defaultRule);
      setStatus("Ready");
    } catch (error) {
      setDraft((current) => current ?? { ...fallbackRule, scope });
      setStatus(error instanceof Error ? `API unavailable: ${error.message}` : "API unavailable");
    }
  }

  async function saveRule() {
    if (!draft) return;
    setStatus("Saving rule");
    const response = await api<{ rule: Rule }>("/api/policy-rules", {
      method: "PUT",
      body: JSON.stringify({ ...draft, scope })
    });
    setDraft(response.rule);
    await refresh();
  }

  async function deleteRule(rule: Rule) {
    if (!rule.ruleKey) return;
    setStatus("Deleting rule");
    await api(
      `/api/policy-rules?scope=${encodeURIComponent(rule.scope)}&ruleKey=${encodeURIComponent(rule.ruleKey)}`,
      { method: "DELETE" }
    );
    await refresh();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Platform Policy Console</h1>
          <p>{status}</p>
        </div>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      <section className="toolbar">
        <label>
          Repository
          <input value={repo} onChange={(event) => setRepo(event.target.value)} />
        </label>
        <label>
          Rule Scope
          <input value={scope} onChange={(event) => setScope(event.target.value)} />
        </label>
      </section>

      <section className="metrics">
        <div>
          <span>{runs.length}</span>
          <small>Runs</small>
        </div>
        <div>
          <span>{passedCount}</span>
          <small>Passed</small>
        </div>
        <div>
          <span>{failedCount}</span>
          <small>Failed</small>
        </div>
      </section>

      <section className="layout">
        <div className="panel">
          <div className="panelHeader">
            <h2>Recent PR Outcomes</h2>
          </div>
          <div className="table">
            <div className="row header">
              <span>PR</span>
              <span>Title</span>
              <span>Status</span>
              <span>Updated</span>
            </div>
            {runs.map((run) => (
              <a
                className="row"
                href={run.commentUrl}
                key={run.runKey}
                target="_blank"
                rel="noreferrer"
              >
                <span>#{run.pullNumber}</span>
                <span>{run.title}</span>
                <span className={run.status}>{run.status}</span>
                <span>{formatDate(run.updatedAt ?? run.createdAt)}</span>
              </a>
            ))}
            {runs.length === 0 ? (
              <p className="empty">No policy runs for this repository yet.</p>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <h2>Rule Editor</h2>
            <button type="button" onClick={() => void saveRule()} disabled={!draft}>
              Save
            </button>
          </div>
          {draft ? (
            <form className="ruleForm">
              <label>
                Rule ID
                <input
                  value={draft.id}
                  onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                />
              </label>
              <label>
                Pattern
                <input
                  value={draft.assertion.pattern}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      assertion: { ...draft.assertion, pattern: event.target.value }
                    })
                  }
                />
              </label>
              <label>
                Fail Message
                <textarea
                  value={draft.messages.fail}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      messages: { ...draft.messages, fail: event.target.value }
                    })
                  }
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                />
                Enabled
              </label>
            </form>
          ) : null}

          <div className="rulesList">
            {rules.map((rule) => (
              <div className="ruleItem" key={rule.ruleKey ?? rule.id}>
                <button type="button" onClick={() => setDraft(rule)}>
                  {rule.id}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteRule(rule)}
                  disabled={!rule.ruleKey}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function formatDate(value: string | undefined) {
  return value ? new Date(value).toLocaleString() : "";
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
