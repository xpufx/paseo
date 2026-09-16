import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createPluginLogger } from "./vendor/paseo-plugin-helper/index.ts";
import {
  IssueDetailSchema,
  liveScopesFromIssues,
  liveScopesFromLabels,
  normalizeIssueNumber,
  parseAgentEnvelope,
  rankIssues,
  resolveForgeTarget,
  scopeOfLabel,
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
import { ForgejoClient, type ForgejoIssueDetail } from "./forge-client.js";

const log = createPluginLogger("forges");

type OpenIssuesResult = RpcOutput<typeof openIssuesContract>;
import { openIssuesContract } from "../shared/issues.js";

const listFailureCounts = new Map<string, number>();
const forgejoHostCache = new Map<string, boolean>();
const quietHostLogged = new Set<string>();

function listKey(host: string, repo: string): string {
  return `${host}/${repo}`;
}

async function probeForgejoHost(host: string): Promise<boolean> {
  const cached = forgejoHostCache.get(host);
  if (cached !== undefined) return cached;
  let speaks = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`https://${host}/api/v1/version`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const payload = (await res.json()) as unknown;
        speaks =
          !!payload &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>).version === "string";
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    speaks = false;
  }
  forgejoHostCache.set(host, speaks);
  return speaks;
}

function noteListFailure(host: string, repo: string): boolean {
  const key = listKey(host, repo);
  const count = (listFailureCounts.get(key) ?? 0) + 1;
  listFailureCounts.set(key, count);
  return count <= 1;
}

function noteListSuccess(host: string, repo: string): void {
  listFailureCounts.delete(listKey(host, repo));
}

import { storedForgeSelection, tokenForHost } from "./settings.js";

/** Read the origin remote without shelling: parse .git/config directly. */
async function gitOriginForDirectory(directory: string): Promise<string | null> {
  try {
    const config = await readFile(join(directory, ".git", "config"), "utf8");
    const section = /\[remote\s+"origin"\][^\[]*?url\s*=\s*(.+)/.exec(config);
    const url = section?.[1]?.trim();
    return url || null;
  } catch {
    return null;
  }
}

type ResolvedRepo =
  | { ok: true; host: string; repo: string; derivedRemote: string | null; remoteSource: "explicit" | "derived" }
  | { ok: false; derivedRemote: string | null; error: string };

/**
 * Single remote resolution for the whole plugin. The explicit forge target
 * (per-request override, else the workspace's active forge selection, else the
 * legacy single remote) wins absolutely: when present it is used as-is and
 * never falls back to git derivation, so an invalid target fails loudly. Git
 * origin is only consulted when no explicit target is set, or to supply the
 * host for a bare owner/repo.
 */
async function resolveRepo(
  directory?: string,
  explicitRemote?: string,
): Promise<ResolvedRepo> {
  const stored = await storedForgeSelection(directory);
  const explicit = explicitRemote?.trim() ? explicitRemote.trim() : stored?.trim();
  const remoteUrl = directory ? await gitOriginForDirectory(directory) : null;
  const resolved = resolveForgeTarget(explicit, remoteUrl);
  if (!resolved.ok) {
    return { ok: false, derivedRemote: remoteUrl, error: resolved.error };
  }
  return {
    ok: true,
    host: resolved.host,
    repo: resolved.repo,
    derivedRemote: remoteUrl,
    remoteSource: resolved.source,
  };
}

async function clientFor(host: string): Promise<ForgejoClient> {
  return new ForgejoClient({ host, token: await tokenForHost(host) });
}

/**
 * List open Forgejo issues for the repo backing a workspace directory.
 * Resolves owner/repo from the directory's git origin remote, fetches via
 * the embedded API client, and never throws: failures surface as an
 * error field so the pill renders a placeholder instead of breaking.
 */
export async function handleOpenIssues(input: OpenIssuesInput): Promise<OpenIssuesOutput> {
  const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
  if (!resolved.ok) {
    return {
      repo: null,
      host: null,
      issues: [],
      openIssueCount: null,
      derivedRemote: resolved.derivedRemote,
      remoteSource: null,
      repoPublic: null,
      tokenPresent: false,
      tokenValid: null,
      page: 1,
      hasMore: false,
      error: resolved.error,
    };
  }
  const { host, repo, derivedRemote, remoteSource } = resolved;
  if (!(await probeForgejoHost(host))) {
    if (!quietHostLogged.has(host)) {
      quietHostLogged.add(host);
      log.info("skipping non-Forgejo remote", { repo, host });
    } else {
      log.debug("skipping non-Forgejo remote", { repo, host });
    }
    const message = remoteSource === "explicit"
      ? `Selected forge ${host}/${repo} is unreachable or not a Forgejo/Gitea API host`
      : "Not a Forgejo repo for this workspace";
    return { repo, host, issues: [], openIssueCount: null, page: 1, hasMore: false, derivedRemote, remoteSource, repoPublic: null, tokenPresent: false, tokenValid: null, error: message };
  }
  const client = await clientFor(host);
  const anonClient = new ForgejoClient({ host });
  const tokenPresent = client.hasToken();
  const page = input?.page ?? 1;
  const [paged, openIssueCount, repoPublic, tokenValid] = await Promise.all([
    client.listIssues(repo, page),
    client.openIssueCount(repo),
    anonClient.repoIsPublic(repo),
    client.tokenIsValid(),
  ]);
  if (!paged) {
    if (noteListFailure(host, repo)) {
      log.warn("issue list failed", { repo, host });
    } else {
      log.debug("issue list failed", { repo, host });
    }
    const message = remoteSource === "explicit"
      ? `Issue list unavailable for ${host}/${repo}`
      : "Issue list unavailable";
    return { repo, host, issues: [], openIssueCount, page, hasMore: false, derivedRemote, remoteSource, repoPublic, tokenPresent, tokenValid, error: message };
  }
  noteListSuccess(host, repo);
  const issues: OpenIssuesResult["issues"] = rankIssues(paged.issues);
  void liveScopesFromIssues(issues);
  return { repo, host, issues, openIssueCount, page, hasMore: paged.hasMore, derivedRemote, remoteSource, repoPublic, tokenPresent, tokenValid };
}

// ---------------------------------------------------------------------------
// Issue detail / label / comment handlers.
// Auth is daemon-side: the token lives in plugin settings and is only ever
// attached to fetch() calls here, never sent to the client.
// ---------------------------------------------------------------------------

function toIssueDetail(detail: ForgejoIssueDetail): IssueDetail | null {
  const comments: IssueDetail["comments"] = detail.comments.map((comment) => ({
    id: comment.id,
    author: comment.author,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    body: comment.body,
    url: comment.url,
    envelope: parseAgentEnvelope(comment.id, comment.body),
  }));
  const candidate = {
    ...detail,
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
  const client = await clientFor(host);
  const detail = await client.getIssue(repo, host, issueNumber);
  return detail ? toIssueDetail(detail) : null;
}

/** Validate a label against the board's live scopes (plus known fallback scopes). */
function validateSetLabel(label: string, boardLabels: string[]): string | null {
  const trimmed = label.trim();
  if (!trimmed) return "Label must not be empty";
  if (trimmed.length > 100) return "Label is too long";
  if (/[\s,;]/.test(trimmed)) return `Unsupported label: ${trimmed}`;
  const scope = scopeOfLabel(trimmed);
  if (scope) {
    const live = new Set(liveScopesFromLabels(boardLabels));
    const fallback = new Set([
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
    if (!live.has(scope) && !fallback.has(scope)) {
      return `Unknown label scope: ${trimmed}`;
    }
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
      return { repo: null, issue: null, fetchedAt, repoPublic: null, tokenPresent: false, tokenValid: null, error: "issueNumber is required" };
    }
    const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
    if (!resolved.ok) {
      return {
        repo: null,
        issue: null,
        fetchedAt,
        repoPublic: null,
        tokenPresent: false,
        tokenValid: null,
        error: resolved.error,
      };
    }
    const { host, repo } = resolved;
    const client = await clientFor(host);
    const tokenPresent = client.hasToken();
    const [issue, repoPublic, tokenValid] = await Promise.all([
      fetchIssueDetail(repo, host, issueNumber),
      new ForgejoClient({ host }).repoIsPublic(repo),
      client.tokenIsValid(),
    ]);
    if (!issue) {
      return {
        repo,
        issue: null,
        fetchedAt,
        repoPublic,
        tokenPresent,
        tokenValid,
        error: `Issue #${issueNumber} not found in ${repo}`,
      };
    }
    return { repo, issue, fetchedAt, repoPublic, tokenPresent, tokenValid };
  } catch (error) {
    log.warn("issue detail failed", { error: String(error) });
    return { repo: null, issue: null, fetchedAt, repoPublic: null, tokenPresent: false, tokenValid: null, error: "Issue detail unavailable" };
  }
}

export async function handleSetLabel(input: SetLabelInput): Promise<SetLabelOutput> {
  try {
    const issueNumber = normalizeIssueNumber(input ?? {});
    if (issueNumber == null) {
      return { number: 0, labels: [], error: "issueNumber is required" };
    }
    const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
    if (!resolved.ok) {
      return {
        number: issueNumber,
        labels: [],
        error: resolved.error,
      };
    }
    const { host, repo } = resolved;
    const client = await clientFor(host);
    const detail = await client.getIssue(repo, host, issueNumber);
    if (!detail) {
      return {
        number: issueNumber,
        labels: [],
        error: `Issue #${issueNumber} not found in ${repo}`,
      };
    }
    const rawLabel = (input as { label?: unknown }).label;
    const labelError = validateSetLabel(
      typeof rawLabel === "string" ? rawLabel : "",
      detail.labels,
    );
    if (labelError) {
      return { number: issueNumber, labels: [], error: labelError };
    }
    const label = (rawLabel as string).trim();
    const scope = scopeOfLabel(label);
    const remove = scope
      ? detail.labels.filter(
          (existing) => scopeOfLabel(existing) === scope && existing !== label,
        )
      : [];
    const labels = await client.setLabels(repo, issueNumber, [label], remove);
    if (!labels) {
      log.warn("set-label failed", { repo, issueNumber, label });
      return { number: issueNumber, labels: [], error: "Could not update labels" };
    }
    return { number: issueNumber, labels };
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
    const body = typeof (input as { body?: unknown }).body === "string"
      ? ((input as { body: string }).body as string).trim()
      : "";
    if (!body) {
      return { number: issueNumber, commentId: null, error: "Comment body must not be empty" };
    }
    if (body.length > 10000) {
      return { number: issueNumber, commentId: null, error: "Comment body is too long" };
    }
    const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
    if (!resolved.ok) {
      return {
        number: issueNumber,
        commentId: null,
        error: resolved.error,
      };
    }
    const { host, repo } = resolved;
    // Operator steering only: no agent envelope is appended (spec §5.4).
    const client = await clientFor(host);
    const commentId = await client.addComment(repo, issueNumber, body);
    if (commentId == null) {
      const detail = await client.getIssue(repo, host, issueNumber);
      if (!detail) {
        log.warn("add-comment failed", { repo, issueNumber });
        return { number: issueNumber, commentId: null, error: "Could not post comment" };
      }
    }
    return { number: issueNumber, commentId };
  } catch (error) {
    log.warn("add-comment failed", { error: String(error) });
    return { number: 0, commentId: null, error: "Could not post comment" };
  }
}
