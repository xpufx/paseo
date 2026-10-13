import type { NormalizedEvent, ForgeId } from "./types.js";

// ── Forgejo / Gitea normalizer ───────────────────────────────────────

/**
 * Normalize a Forgejo (or Gitea) webhook payload into a `NormalizedEvent`.
 *
 * Supports push, issues, pull_request, and issue_comment events.
 */
export function normalizeForgejoEvent(
  raw: Record<string, unknown>,
  eventId: string,
): NormalizedEvent {
  const forge = "forgejo" as ForgeId;
  const action = extractAction(raw);
  const sender = extractSender(raw);
  const timestamp = extractTimestamp(raw);

  // Push event
  if (raw["hook_type"] === "push_hook" || isPushEvent(raw)) {
    return {
      id: eventId,
      forge,
      action: "push",
      repository: extractRepoSlug(raw),
      ref: getString(raw, "ref"),
      commits: extractCommits(raw),
      sender,
      timestamp,
      raw,
    };
  }

  // Issues event
  if (raw["hook_type"] === "issues_hook" || isIssuesEvent(raw)) {
    return {
      id: eventId,
      forge,
      action: getString(raw, "action") ?? "opened",
      repository: extractRepoSlug(raw),
      issueNumber: getNumber(raw, "issue", "number"),
      sender,
      timestamp,
      raw,
    };
  }

  // Pull request event
  if (raw["hook_type"] === "pulls_hook" || isPullRequestEvent(raw)) {
    return {
      id: eventId,
      forge,
      action: getString(raw, "action") ?? "opened",
      repository: extractRepoSlug(raw),
      ref: getString(raw, "pull_request", "head", "ref") ?? getString(raw, "ref"),
      pullRequestNumber: getNumber(raw, "pull_request", "number") ?? getNumber(raw, "number"),
      sender,
      timestamp,
      raw,
    };
  }

  // Issue comment event
  if (raw["hook_type"] === "issue_comment_hook" || isIssueCommentEvent(raw)) {
    return {
      id: eventId,
      forge,
      action: getString(raw, "action") ?? "created",
      repository: extractRepoSlug(raw),
      issueNumber: getNumber(raw, "issue", "number"),
      sender,
      timestamp,
      raw,
    };
  }

  // Fallback: treat as generic
  return {
    id: eventId,
    forge,
    action: action ?? "unknown",
    repository: extractRepoSlug(raw),
    sender,
    timestamp,
    raw,
  };
}

// ── GitHub normalizer ────────────────────────────────────────────────

/**
 * Normalize a GitHub webhook payload into a `NormalizedEvent`.
 */
export function normalizeGitHubEvent(
  raw: Record<string, unknown>,
  eventId: string,
): NormalizedEvent {
  const forge = "github" as ForgeId;
  const action = extractAction(raw);
  const sender = extractSender(raw);
  const timestamp = new Date().toISOString();

  // Push event
  if (raw["ref"]) {
    return {
      id: eventId,
      forge,
      action: "push",
      repository: extractRepoSlug(raw),
      ref: getString(raw, "ref"),
      commits: extractGitHubCommits(raw),
      sender,
      timestamp,
      raw,
    };
  }

  // Issues event
  if (raw["issue"]) {
    return {
      id: eventId,
      forge,
      action: getString(raw, "action") ?? "opened",
      repository: extractRepoSlug(raw),
      issueNumber: getNumber(raw, "issue", "number"),
      sender,
      timestamp,
      raw,
    };
  }

  // Pull request event
  if (raw["pull_request"]) {
    return {
      id: eventId,
      forge,
      action: getString(raw, "action") ?? "opened",
      repository: extractRepoSlug(raw),
      ref: getString(raw, "pull_request", "head", "ref"),
      pullRequestNumber: getNumber(raw, "pull_request", "number"),
      sender,
      timestamp,
      raw,
    };
  }

  // Issue comment event
  if (raw["issue_comment"]) {
    return {
      id: eventId,
      forge,
      action: getString(raw, "action") ?? "created",
      repository: extractRepoSlug(raw),
      issueNumber: getNumber(raw, "issue", "number"),
      sender,
      timestamp,
      raw,
    };
  }

  return {
    id: eventId,
    forge,
    action: action ?? "unknown",
    repository: extractRepoSlug(raw),
    sender,
    timestamp,
    raw,
  };
}

// ── GitLab normalizer ────────────────────────────────────────────────

/**
 * Normalize a GitLab webhook payload into a `NormalizedEvent`.
 *
 * GitLab uses `event_name` instead of `hook_type` and nests data differently.
 */
export function normalizeGitLabEvent(
  raw: Record<string, unknown>,
  eventId: string,
): NormalizedEvent {
  const forge = "gitlab" as ForgeId;
  const action = extractAction(raw);
  const sender = extractSender(raw);
  const timestamp = extractTimestamp(raw);

  // Push event
  if (raw["event_name"] === "push" || raw["object_kind"] === "push") {
    return {
      id: eventId,
      forge,
      action: "push",
      repository: extractRepoSlug(raw, "project"),
      ref: getString(raw, "ref"),
      commits: extractGitLabCommits(raw),
      sender,
      timestamp,
      raw,
    };
  }

  // Issues event
  if (raw["event_name"] === "issue" || raw["object_kind"] === "note" && !raw["object_attributes"]) {
    return {
      id: eventId,
      forge,
      action: getString(raw, "object_attributes", "type") ?? getString(raw, "action") ?? "opened",
      repository: extractRepoSlug(raw, "project"),
      issueNumber: getNumber(raw, "object_attributes", "id") ?? getNumber(raw, "issue", "iid"),
      sender,
      timestamp,
      raw,
    };
  }

  // Pull request (Merge Request) event
  if (raw["event_name"] === "merge_request" || raw["object_kind"] === "merge_request") {
    return {
      id: eventId,
      forge,
      action: getString(raw, "object_attributes", "action") ?? getString(raw, "event_type") ?? getString(raw, "object_attributes", "action") ?? "unknown",
      repository: extractRepoSlug(raw, "project"),
      ref: getString(raw, "object_attributes", "source_branch") ?? undefined,
      pullRequestNumber: getNumber(raw, "object_attributes", "iid") ?? getNumber(raw, "merge_request", "iid"),
      sender,
      timestamp,
      raw,
    };
  }

  // Issue comment event
  if (raw["event_type"] === "note" && raw["object_attributes"]) {
    return {
      id: eventId,
      forge,
      action: getString(raw, "object_attributes", "type") ?? "created",
      repository: extractRepoSlug(raw, "project"),
      issueNumber: getNumber(raw, "issue", "iid"),
      sender,
      timestamp,
      raw,
    };
  }

  return {
    id: eventId,
    forge,
    action: action ?? "unknown",
    repository: extractRepoSlug(raw, "project"),
    sender,
    timestamp,
    raw,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function extractAction(raw: Record<string, unknown>): string | undefined {
  return (
    getString(raw, "action") ??
    getString(raw, "event_name") ??
    getString(raw, "hook_type")
  );
}

function extractSender(raw: Record<string, unknown>): string {
  return (
    getString(raw, "sender", "login") ??
    getString(raw, "sender", "username") ??
    getString(raw, "user_login") ??
    getString(raw, "user_name") ??
    getString(raw, "gl_username") ??
    getString(raw, "actor") ??
    "unknown"
  );
}

function extractTimestamp(raw: Record<string, unknown>): string {
  return (
    getString(raw, "created_at") ??
    getString(raw, "date") ??
    new Date().toISOString()
  );
}

function extractRepoSlug(
  raw: Record<string, unknown>,
  nestedKey?: string,
): string {
  if (nestedKey && raw[nestedKey]) {
    const project = raw[nestedKey] as Record<string, unknown>;
    const fullPath = getString(project, "path_with_namespace");
    if (fullPath) return fullPath;
  }
  return (
    getString(raw, "repository", "full_name") ??
    getString(raw, "repo", "full_name") ??
    getString(raw, "project", "path_with_namespace") ??
    getString(raw, "repository", "name") ??
    "unknown/unknown"
  );
}

function extractCommits(raw: Record<string, unknown>): string[] {
  const list = raw["commits"] ?? raw["commits_array"];
  if (!Array.isArray(list)) return [];
  return list.map((c: unknown) =>
    typeof c === "object" && c !== null ? getString(c as Record<string, unknown>, "id") : String(c),
  ).filter(Boolean) as string[];
}

function extractGitHubCommits(raw: Record<string, unknown>): string[] {
  const list = raw["commits"] as unknown[] | undefined;
  if (!Array.isArray(list)) return [];
  return list.map((c: unknown) =>
    typeof c === "object" && c !== null ? getString(c as Record<string, unknown>, "id") : String(c),
  ).filter(Boolean) as string[];
}

function extractGitLabCommits(raw: Record<string, unknown>): string[] {
  const objAttrs = raw["object_attributes"] as Record<string, unknown> | undefined;
  const list = raw["commits"] ?? objAttrs?.commits;
  if (!Array.isArray(list)) return [];
  return list.map((c: unknown) =>
    typeof c === "object" && c !== null ? getString(c as Record<string, unknown>, "id") : String(c),
  ).filter(Boolean) as string[];
}

function getString(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

function getNumber(
  obj: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" ? current : undefined;
}

function isPushEvent(raw: Record<string, unknown>): boolean {
  return Boolean(raw["ref"]) && !raw["issue"] && !raw["pull_request"];
}

function isIssuesEvent(raw: Record<string, unknown>): boolean {
  return Boolean(raw["issue"]);
}

function isPullRequestEvent(raw: Record<string, unknown>): boolean {
  return Boolean(raw["pull_request"]);
}

function isIssueCommentEvent(raw: Record<string, unknown>): boolean {
  return Boolean(raw["comment"]) || Boolean(raw["issue_comment"]);
}
