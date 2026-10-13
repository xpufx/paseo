import { describe, it, expect } from "vitest";
import {
  normalizeForgejoEvent,
  normalizeGitHubEvent,
  normalizeGitLabEvent,
} from "../shared/normalizers.js";

const FAKE_ID = "evt-001";

// ── Forgejo fixtures ─────────────────────────────────────────────────

const forgejoPushPayload: Record<string, unknown> = {
  hook_type: "push_hook",
  ref: "refs/heads/main",
  repository: { full_name: "org/forgejo-app" },
  commits: [
    { id: "abc123" },
    { id: "def456" },
  ],
  sender: { login: "alice" },
  created_at: "2025-01-15T10:30:00Z",
};

const forgejoIssuesPayload: Record<string, unknown> = {
  hook_type: "issues_hook",
  action: "opened",
  issue: { number: 42 },
  repository: { full_name: "org/forgejo-app" },
  sender: { login: "bob" },
  created_at: "2025-01-15T11:00:00Z",
};

const forgejoPRPayload: Record<string, unknown> = {
  hook_type: "pulls_hook",
  action: "opened",
  number: 7,
  pull_request: {
    number: 7,
    head: { ref: "feature-x" },
  },
  repository: { full_name: "org/forgejo-app" },
  sender: { login: "charlie" },
  created_at: "2025-01-15T12:00:00Z",
};

const forgejoCommentPayload: Record<string, unknown> = {
  hook_type: "issue_comment_hook",
  action: "created",
  issue: { number: 42 },
  comment: { body: "LGTM!" },
  repository: { full_name: "org/forgejo-app" },
  sender: { login: "dave" },
  created_at: "2025-01-15T13:00:00Z",
};

// ── GitHub fixtures ──────────────────────────────────────────────────

const githubPushPayload: Record<string, unknown> = {
  ref: "refs/heads/develop",
  repository: { full_name: "org/github-repo" },
  commits: [{ id: "gha111" }, { id: "ghb222" }],
  sender: { login: "github-user" },
};

const githubIssuesPayload: Record<string, unknown> = {
  action: "labeled",
  issue: { number: 10 },
  repository: { full_name: "org/github-repo" },
  sender: { login: "triage-bot" },
};

const githubPRPayload: Record<string, unknown> = {
  action: "review_requested",
  pull_request: {
    number: 55,
    head: { ref: "pr-fix" },
  },
  repository: { full_name: "org/github-repo" },
  sender: { login: "reviewer" },
};

const githubCommentPayload: Record<string, unknown> = {
  action: "created",
  issue: { number: 10 },
  issue_comment: { body: "Looks good" },
  repository: { full_name: "org/github-repo" },
  sender: { login: "commenter" },
};

// ── GitLab fixtures ──────────────────────────────────────────────────

const gitlabPushPayload: Record<string, unknown> = {
  event_name: "push",
  object_kind: "push",
  ref: "refs/tags/v1.0.0",
  project: { path_with_namespace: "group/gitlab-proj" },
  commits: [{ id: "glc333" }],
  user_username: "gitlab-pusher",
  date: "2025-02-01T08:00:00Z",
};

const gitlabMRPayload: Record<string, unknown> = {
  event_name: "merge_request",
  object_kind: "merge_request",
  object_attributes: {
    action: "open",
    iid: 12,
    source_branch: "mr-branch",
  },
  project: { path_with_namespace: "group/gitlab-proj" },
  gl_username: "mr-author",
  date: "2025-02-01T09:00:00Z",
};

const gitlabIssuePayload: Record<string, unknown> = {
  event_name: "issue",
  object_attributes: { type: "issue", id: 99 },
  action: "open",
  issue: { iid: 99 },
  project: { path_with_namespace: "group/gitlab-proj" },
  gl_username: "issue-opener",
  date: "2025-02-01T10:00:00Z",
};

const gitlabCommentPayload: Record<string, unknown> = {
  event_type: "note",
  object_attributes: { type: "IssueNote", id: 200 },
  issue: { iid: 99 },
  project: { path_with_namespace: "group/gitlab-proj" },
  gl_username: "note-writer",
  date: "2025-02-01T11:00:00Z",
};

// ── Tests ────────────────────────────────────────────────────────────

describe("Forgejo normalizer", () => {
  it("normalizes push events", () => {
    const result = normalizeForgejoEvent(forgejoPushPayload, FAKE_ID);
    expect(result.forge).toBe("forgejo");
    expect(result.action).toBe("push");
    expect(result.repository).toBe("org/forgejo-app");
    expect(result.ref).toBe("refs/heads/main");
    expect(result.commits).toEqual(["abc123", "def456"]);
    expect(result.sender).toBe("alice");
  });

  it("normalizes issues events", () => {
    const result = normalizeForgejoEvent(forgejoIssuesPayload, FAKE_ID);
    expect(result.forge).toBe("forgejo");
    expect(result.action).toBe("opened");
    expect(result.issueNumber).toBe(42);
    expect(result.sender).toBe("bob");
  });

  it("normalizes pull_request events", () => {
    const result = normalizeForgejoEvent(forgejoPRPayload, FAKE_ID);
    expect(result.forge).toBe("forgejo");
    expect(result.action).toBe("opened");
    expect(result.pullRequestNumber).toBe(7);
    expect(result.ref).toBe("feature-x");
  });

  it("normalizes issue_comment events", () => {
    const result = normalizeForgejoEvent(forgejoCommentPayload, FAKE_ID);
    expect(result.forge).toBe("forgejo");
    expect(result.action).toBe("created");
    expect(result.issueNumber).toBe(42);
  });
});

describe("GitHub normalizer", () => {
  it("normalizes push events", () => {
    const result = normalizeGitHubEvent(githubPushPayload, FAKE_ID);
    expect(result.forge).toBe("github");
    expect(result.action).toBe("push");
    expect(result.repository).toBe("org/github-repo");
    expect(result.commits).toEqual(["gha111", "ghb222"]);
  });

  it("normalizes issues events", () => {
    const result = normalizeGitHubEvent(githubIssuesPayload, FAKE_ID);
    expect(result.forge).toBe("github");
    expect(result.action).toBe("labeled");
    expect(result.issueNumber).toBe(10);
  });

  it("normalizes pull_request events", () => {
    const result = normalizeGitHubEvent(githubPRPayload, FAKE_ID);
    expect(result.forge).toBe("github");
    expect(result.action).toBe("review_requested");
    expect(result.pullRequestNumber).toBe(55);
  });

  it("normalizes issue_comment events", () => {
    const result = normalizeGitHubEvent(githubCommentPayload, FAKE_ID);
    expect(result.forge).toBe("github");
    expect(result.action).toBe("created");
    expect(result.issueNumber).toBe(10);
  });
});

describe("GitLab normalizer", () => {
  it("normalizes push events", () => {
    const result = normalizeGitLabEvent(gitlabPushPayload, FAKE_ID);
    expect(result.forge).toBe("gitlab");
    expect(result.action).toBe("push");
    expect(result.repository).toBe("group/gitlab-proj");
    expect(result.commits).toEqual(["glc333"]);
  });

  it("normalizes merge_request events", () => {
    const result = normalizeGitLabEvent(gitlabMRPayload, FAKE_ID);
    expect(result.forge).toBe("gitlab");
    expect(result.action).toBe("open");
    expect(result.pullRequestNumber).toBe(12);
    expect(result.ref).toBe("mr-branch");
  });

  it("normalizes issue events", () => {
    const result = normalizeGitLabEvent(gitlabIssuePayload, FAKE_ID);
    expect(result.forge).toBe("gitlab");
    expect(result.issueNumber).toBe(99);
  });

  it("normalizes issue_comment events", () => {
    const result = normalizeGitLabEvent(gitlabCommentPayload, FAKE_ID);
    expect(result.forge).toBe("gitlab");
    expect(result.issueNumber).toBe(99);
  });
});
