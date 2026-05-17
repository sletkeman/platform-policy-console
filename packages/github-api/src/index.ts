const githubApiVersion = "2022-11-28";
const policyCommentMarker = "<!-- platform-policy-console:pull-request-policy -->";

export type PullRequestCommentTarget = {
  owner: string;
  repo: string;
  pullNumber: number;
};

export type UpsertPullRequestCommentInput = PullRequestCommentTarget & {
  token: string;
  body: string;
};

export type UpsertPullRequestCommentResult = {
  action: "created" | "updated";
  commentUrl: string;
};

type GitHubIssueComment = {
  id: number;
  body?: string;
  html_url: string;
};

export function buildPolicyCommentBody(body: string) {
  return `${policyCommentMarker}\n${body}`;
}

export async function upsertPullRequestComment({
  owner,
  repo,
  pullNumber,
  token,
  body
}: UpsertPullRequestCommentInput): Promise<UpsertPullRequestCommentResult> {
  const comments = await githubRequest<GitHubIssueComment[]>({
    token,
    path: `/repos/${owner}/${repo}/issues/${pullNumber}/comments`
  });
  const existing = comments.find((comment) => comment.body?.includes(policyCommentMarker));
  const markedBody = buildPolicyCommentBody(body);

  if (existing) {
    const updated = await githubRequest<GitHubIssueComment>({
      token,
      method: "PATCH",
      path: `/repos/${owner}/${repo}/issues/comments/${existing.id}`,
      body: { body: markedBody }
    });

    return {
      action: "updated",
      commentUrl: updated.html_url
    };
  }

  const created = await githubRequest<GitHubIssueComment>({
    token,
    method: "POST",
    path: `/repos/${owner}/${repo}/issues/${pullNumber}/comments`,
    body: { body: markedBody }
  });

  return {
    action: "created",
    commentUrl: created.html_url
  };
}

async function githubRequest<T>({
  token,
  method = "GET",
  path,
  body
}: {
  token: string;
  method?: "GET" | "PATCH" | "POST";
  path: string;
  body?: unknown;
}) {
  const requestInit: RequestInit = {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "platform-policy-console",
      "X-GitHub-Api-Version": githubApiVersion
    }
  };

  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetch(`https://api.github.com${path}`, requestInit);

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${method} ${path} returned ${response.status}`);
  }

  return (await response.json()) as T;
}
