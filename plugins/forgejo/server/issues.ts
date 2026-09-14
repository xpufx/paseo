import { safeSpawn, createPluginLogger } from "./vendor/paseo-plugin-helper/index.ts";
import {
  ForgejoIssueSchema,
  IssueDetailSchema,
  normalizeIssueNumber,
  openIssuesContract,
  parseAgentEnvelope,
  resolveForgejoRepo,
  type AddCommentInput,
  type AddCommentOutput,
  type IssueDetail,
  type IssueDetailInput,
  type IssueDetailOutput,
  type OpenIssuesInput,
  type OpenIssuesOutput,
  type SetLabelInput,
  type SetLabelOutput,
} from "../shared/issues.js";
import type { RpcOutput } from "../shared/vendor/paseo-plugin-helper/index.ts";

const log = createPluginLogger("paseo-forgejo");

type OpenIssuesResult = RpcOutput<typeof openIssuesContract>;

async function spawnText(command: string, args: string[]): Promise<string | null> {
  try {
    const result = await safeSpawn(command, args, { timeoutMs: 15000 });
    if (result.code !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

import { storedRemoteForDirectory } from "./settings.js";

async function resolveRepo(
  directory?: string,
  explicitRemote?: string,
): Promise<{ host: string; repo: string } | null> {
  const stored = await storedRemoteForDirectory(directory);
  const explicit = explicitRemote?.trim() ? explicitRemote : stored;
  if (!directory && !explicit) return null;
  const remoteUrl = directory
    ? await spawnText("git", ["-C", directory, "remote", "get-url", "origin"])
    : null;
  return resolveForgejoRepo(explicit, remoteUrl);
}

async function listIssuesJson(
  runner: string,
  repo: string,
  host: string,
): Promise<unknown[] | null> {
  const raw = await spawnText(runner, ["issue", "list", "-R", repo, "--hostname", host, "--json"]);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toIssueRefs(rows: unknown[]): OpenIssuesResult["issues"] {
  const issues: OpenIssuesResult["issues"] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const labels = Array.isArray(record.labels)
      ? (record.labels as unknown[])
          .map((entry) =>
            entry && typeof entry === "object"
              ? (entry as Record<string, unknown>).name
              : entry,
          )
          .filter((name): name is string => typeof name === "string")
      : [];
    const candidate = {
      number: record.number,
      title: record.title,
      state: record.state,
      labels,
      updatedAt: typeof record.updated_at === "string" ? record.updated_at : undefined,
    };
    const parsed = ForgejoIssueSchema.safeParse(candidate);
    if (parsed.success) issues.push(parsed.data);
  }
  return issues;
}

/**
 * List open Forgejo issues for the repo backing a workspace directory.
 * Resolves owner/repo from the directory's git origin remote, shells out to
 * fgjx (falling back to fgj), and never throws: failures surface as an
 * error field so the pill renders a placeholder instead of breaking.
 */
export async function handleOpenIssues(input: OpenIssuesInput): Promise<OpenIssuesOutput> {
  const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
  if (!resolved) {
    return {
      repo: null,
      issues: [],
      error: "No Forgejo repo found for this workspace",
    };
  }
  const { host, repo } = resolved;
  let rows = await listIssuesJson("fgjx", repo, host);
  if (!rows) rows = await listIssuesJson("fgj", repo, host);
  if (!rows) {
    log.warn("issue list failed", { repo, host });
    return { repo, issues: [], error: "Issue list unavailable" };
  }
  const issues = toIssueRefs(rows).filter((issue) => issue.state === "open");
  return { repo, issues };
}

// ---------------------------------------------------------------------------
// Issue detail / label / comment handlers.
// Auth is zero-config: fgjx/fgj read ~/.config/fgj/config.yaml themselves,
// so the token never enters plugin memory or logs.
// ---------------------------------------------------------------------------

function asLabelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[])
    .map((entry) =>
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).name
        : entry,
    )
    .filter((name): name is string => typeof name === "string");
}

function asLogin(value: unknown): string {
  if (value && typeof value === "object") {
    const login = (value as Record<string, unknown>).login;
    if (typeof login === "string" && login) return login;
  }
  return "unknown";
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

async function runFgjxFirst(args: string[]): Promise<{ code: number | null; stdout: string } | null> {
  for (const runner of ["fgjx", "fgj"]) {
    try {
      const result = await safeSpawn(runner, args, { timeoutMs: 15000 });
      if (result.code === 0) return { code: result.code, stdout: result.stdout };
    } catch {
      // Missing binary or timeout: try the fallback runner.
    }
  }
  return null;
}

function toIssueDetail(
  repo: string,
  host: string,
  payload: unknown,
): IssueDetail | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  // `fgjx issue view --json` wraps as { issue, comments }; accept a bare
  // issue object too so `fgj api` shapes keep working.
  const rawIssue = (root.issue ?? root) as Record<string, unknown>;
  if (!rawIssue || typeof rawIssue !== "object" || typeof rawIssue.number !== "number") {
    return null;
  }
  const rawComments = Array.isArray(root.comments) ? root.comments : [];
  const comments: IssueDetail["comments"] = [];
  for (const entry of rawComments) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "number") continue;
    const body = asText(record.body);
    comments.push({
      id: record.id,
      author: asLogin(record.user),
      createdAt: asText(record.created_at),
      updatedAt: asText(record.updated_at, asText(record.created_at)),
      body,
      envelope: parseAgentEnvelope(record.id, body),
    });
  }
  const candidate = {
    number: rawIssue.number,
    title: asText(rawIssue.title, `Issue #${rawIssue.number}`),
    state: asText(rawIssue.state, "open"),
    labels: asLabelNames(rawIssue.labels),
    body: asText(rawIssue.body),
    author: asLogin(rawIssue.user),
    createdAt: asText(rawIssue.created_at),
    updatedAt: asText(rawIssue.updated_at),
    webUrl:
      asText(rawIssue.html_url) ||
      `https://${host}/${repo}/issues/${rawIssue.number}`,
    comments,
    envelopes: comments
      .map((comment) => comment.envelope)
      .filter((envelope): envelope is NonNullable<typeof envelope> => envelope !== null),
  };
  const parsed = IssueDetailSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

async function fetchIssueDetail(
  repo: string,
  host: string,
  issueNumber: number,
): Promise<IssueDetail | null> {
  const result = await runFgjxFirst([
    "issue",
    "view",
    String(issueNumber),
    "-R",
    repo,
    "--hostname",
    host,
    "--json",
  ]);
  if (!result || !result.stdout) return null;
  try {
    return toIssueDetail(repo, host, JSON.parse(result.stdout) as unknown);
  } catch {
    return null;
  }
}

/** Scopes the plugin may apply via set-label (spec §4.1 + live board scopes). */
const SET_LABEL_SCOPES = new Set([
  "state",
  "priority",
  "attention",
  "spec",
  "kind",
  "target",
  "format",
  "size",
  "dep",
  "flag",
]);

function validateSetLabel(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return "Label must not be empty";
  if (trimmed.length > 100) return "Label is too long";
  if (/[\s,;]/.test(trimmed)) return `Unsupported label: ${trimmed}`;
  const slash = trimmed.indexOf("/");
  if (slash > 0 && !SET_LABEL_SCOPES.has(trimmed.slice(0, slash))) {
    return `Unknown label scope: ${trimmed}`;
  }
  return null;
}

export async function handleIssueDetail(
  input: IssueDetailInput,
): Promise<IssueDetailOutput> {
  const fetchedAt = new Date().toISOString();
  try {
    const issueNumber = normalizeIssueNumber(input ?? {});
    if (issueNumber == null) {
      return { repo: null, issue: null, fetchedAt, error: "issueNumber is required" };
    }
    const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
    if (!resolved) {
      return {
        repo: null,
        issue: null,
        fetchedAt,
        error: "No Forgejo repo found for this workspace",
      };
    }
    const { host, repo } = resolved;
    const issue = await fetchIssueDetail(repo, host, issueNumber);
    if (!issue) {
      return {
        repo,
        issue: null,
        fetchedAt,
        error: `Issue #${issueNumber} not found in ${repo}`,
      };
    }
    return { repo, issue, fetchedAt };
  } catch (error) {
    log.warn("issue detail failed", { error: String(error) });
    return { repo: null, issue: null, fetchedAt, error: "Issue detail unavailable" };
  }
}

export async function handleSetLabel(input: SetLabelInput): Promise<SetLabelOutput> {
  try {
    const issueNumber = normalizeIssueNumber(input ?? {});
    if (issueNumber == null) {
      return { number: 0, labels: [], error: "issueNumber is required" };
    }
    const labelError = validateSetLabel(asText((input as { label?: unknown }).label));
    if (labelError) {
      return { number: issueNumber, labels: [], error: labelError };
    }
    const label = ((input as { label: string }).label as string).trim();
    const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
    if (!resolved) {
      return {
        number: issueNumber,
        labels: [],
        error: "No Forgejo repo found for this workspace",
      };
    }
    const { host, repo } = resolved;
    // Exclusive scoped labels evict the previous scope mate server-side,
    // so only --add-label is ever sent (spec §5.3).
    const result = await runFgjxFirst([
      "issue",
      "edit",
      String(issueNumber),
      "-R",
      repo,
      "--hostname",
      host,
      "--add-label",
      label,
    ]);
    if (!result) {
      log.warn("set-label failed", { repo, issueNumber, label });
      return { number: issueNumber, labels: [], error: "Could not update labels" };
    }
    const fresh = await fetchIssueDetail(repo, host, issueNumber);
    return { number: issueNumber, labels: fresh ? fresh.labels : [label] };
  } catch (error) {
    log.warn("set-label failed", { error: String(error) });
    return { number: 0, labels: [], error: "Could not update labels" };
  }
}

export async function handleAddComment(
  input: AddCommentInput,
): Promise<AddCommentOutput> {
  try {
    const issueNumber = normalizeIssueNumber(input ?? {});
    if (issueNumber == null) {
      return { number: 0, commentId: null, error: "issueNumber is required" };
    }
    const body = asText((input as { body?: unknown }).body).trim();
    if (!body) {
      return { number: issueNumber, commentId: null, error: "Comment body must not be empty" };
    }
    if (body.length > 10000) {
      return { number: issueNumber, commentId: null, error: "Comment body is too long" };
    }
    const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
    if (!resolved) {
      return {
        number: issueNumber,
        commentId: null,
        error: "No Forgejo repo found for this workspace",
      };
    }
    const { host, repo } = resolved;
    // Operator steering only: no agent envelope is appended (spec §5.4).
    const result = await runFgjxFirst([
      "issue",
      "comment",
      String(issueNumber),
      "-R",
      repo,
      "--hostname",
      host,
      "-b",
      body,
    ]);
    if (!result) {
      log.warn("add-comment failed", { repo, issueNumber });
      return { number: issueNumber, commentId: null, error: "Could not post comment" };
    }
    return { number: issueNumber, commentId: null };
  } catch (error) {
    log.warn("add-comment failed", { error: String(error) });
    return { number: 0, commentId: null, error: "Could not post comment" };
  }
}
