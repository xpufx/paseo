import { createPluginLogger } from "./vendor/paseo-plugin-helper/index";
import {
  INSTALL_LABEL_MODES,
  IssueDetailSchema,
  PASEO_LABEL_SCOPES,
  liveScopesFromIssues,
  liveScopesFromLabels,
  normalizeIssueNumber,
  parseAgentEnvelope,
  parseForgeRemote,
  planLabelSetInstall,
  rankIssues,
  resolveForgeTarget,
  scopeOfLabel,
  type AddCommentInput,
  type AddCommentOutput,
  type ForgeContextInput,
  type ForgeContextOutput,
  type InstallLabelsInput,
  type InstallLabelsOutput,
  type IssueDetail,
  type IssueDetailInput,
  type IssueDetailOutput,
  type OpenIssuesInput,
  type OpenIssuesOutput,
  type SearchIssuesInput,
  type SearchIssuesOutput,
  type SetLabelInput,
  type SetLabelOutput,
} from "../shared/issues.js";
import type { RpcOutput } from "../shared/vendor/paseo-plugin-helper/index";
import { ForgeClient, type ForgejoIssueDetail } from "./forge-client.js";
import { ForgeGuard, type GuardLogLevel } from "./forge-guard.js";
import { gitOriginForDirectory } from "./git-origin.js";

const log = createPluginLogger("forges");

type OpenIssuesResult = RpcOutput<typeof openIssuesContract>;
import { openIssuesContract } from "../shared/issues.js";

const guard = new ForgeGuard();

/** Emit at the level the poll guard chose, so repeat noise stays at debug. */
function logAt(level: GuardLogLevel, message: string, context: Record<string, unknown>): void {
  if (level === "warn") log.warn(message, context);
  else if (level === "info") log.info(message, context);
  else log.debug(message, context);
}

/**
 * Confirm the resolved host answers as Forgejo/Gitea before any issue call,
 * with the configured token, and cache the verdict (issue #114). Non-forge
 * remotes resolve to a quiet not-a-forge state instead of a per-poll WARN.
 */
async function probeForgeHost(client: ForgeClient): Promise<boolean> {
  const cached = guard.cachedProbe(client.host);
  if (cached !== null) return cached;
  const speaks = await client.isForgeHost();
  guard.recordProbe(client.host, speaks);
  return speaks;
}

import { storedForgeSelection, tokenForHost } from "./settings.js";

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

async function clientFor(host: string): Promise<ForgeClient> {
  return new ForgeClient({ host, token: await tokenForHost(host) });
}

/**
 * Git-origin forge coordinates for a workspace, exposed independently of the
 * issues query so the settings form can resolve a host-keyed token even while
 * issues are loading or unavailable (regression #152). Never throws: an
 * unreadable directory yields empty coordinates.
 */
export async function handleForgeContext(
  input: ForgeContextInput,
): Promise<ForgeContextOutput> {
  const directory =
    typeof input?.directory === "string" && input.directory.trim()
      ? input.directory.trim()
      : null;
  if (!directory) {
    return { directory: null, derivedRemote: null, derivedHost: null, derivedRepo: null };
  }
  const derivedRemote = await gitOriginForDirectory(directory);
  const parsed = parseForgeRemote(derivedRemote);
  return {
    directory,
    derivedRemote,
    derivedHost: parsed?.host ?? null,
    derivedRepo: parsed ? `${parsed.owner}/${parsed.repo}` : null,
  };
}

/**
 * List open forge issues for the repo backing a workspace directory.
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
      repoWritePermission: null,
      page: 1,
      hasMore: false,
      error: resolved.error,
    };
  }
  const { host, repo, derivedRemote, remoteSource } = resolved;
  const client = await clientFor(host);
  if (!(await probeForgeHost(client))) {
    logAt(guard.skipLogLevel(host), "skipping non-forge remote", { repo, host });
    const message = remoteSource === "explicit"
      ? `Selected forge ${host}/${repo} is unreachable or not a forge API host`
      : "Not a forge repo for this workspace";
    return { repo, host, issues: [], openIssueCount: null, page: 1, hasMore: false, derivedRemote, remoteSource, repoPublic: null, tokenPresent: false, tokenValid: null, repoWritePermission: null, error: message };
  }
  const anonClient = new ForgeClient({ host });
  const tokenPresent = client.hasToken();
  const page = input?.page ?? 1;
  const [paged, openIssueCount, repoPublic, tokenValid, repoWritePermission] = await Promise.all([
    client.listIssues(repo, page),
    client.openIssueCount(repo),
    anonClient.repoIsPublic(repo),
    client.tokenIsValid(),
    client.repoWritePermission(repo),
  ]);
  if (!paged) {
    logAt(guard.failureLogLevel(host, repo), "issue list failed", { repo, host });
    const message = remoteSource === "explicit"
      ? `Issue list unavailable for ${host}/${repo}`
      : "Issue list unavailable";
    return { repo, host, issues: [], openIssueCount, page, hasMore: false, derivedRemote, remoteSource, repoPublic, tokenPresent, tokenValid, repoWritePermission, error: message };
  }
  guard.noteSuccess(host, repo);
  const issues: OpenIssuesResult["issues"] = rankIssues(paged.issues);
  void liveScopesFromIssues(issues);
  return { repo, host, issues, openIssueCount, page, hasMore: paged.hasMore, derivedRemote, remoteSource, repoPublic, tokenPresent, tokenValid, repoWritePermission };
}

// ---------------------------------------------------------------------------
// Live remote issue search (issue #139). Same remote resolution and auth as
// `handleOpenIssues` — the token is attached daemon-side — but the query goes
// to the issues API's `q` parameter with `state=all`, so closed issues match.
// Never throws: failures come back as an `error` field for the client to show
// while it keeps rendering its instant client-side filter.
// ---------------------------------------------------------------------------

export async function handleSearchIssues(input: SearchIssuesInput): Promise<SearchIssuesOutput> {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (!query) {
    return { repo: null, host: null, issues: [], page: 1, hasMore: false, error: "Enter a search query" };
  }
  const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
  if (!resolved.ok) {
    return { repo: null, host: null, issues: [], page: 1, hasMore: false, error: resolved.error };
  }
  const { host, repo } = resolved;
  const client = await clientFor(host);
  if (!(await probeForgeHost(client))) {
    logAt(guard.skipLogLevel(host), "skipping non-forge remote", { repo, host });
    return {
      repo,
      host,
      issues: [],
      page: 1,
      hasMore: false,
      error: `Selected forge ${host}/${repo} is unreachable or not a forge API host`,
    };
  }
  const page = input?.page ?? 1;
  const result = await client.searchIssues(repo, query, page);
  if (!result) {
    logAt(guard.failureLogLevel(host, repo), "issue search failed", { repo, host });
    return { repo, host, issues: [], page, hasMore: false, error: `Search unavailable for ${host}/${repo}` };
  }
  guard.noteSuccess(host, repo);
  return { repo, host, issues: result.issues, page, hasMore: result.hasMore };
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
    const fallback = new Set<string>(PASEO_LABEL_SCOPES);
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
      return { repo: null, issue: null, fetchedAt, repoPublic: null, tokenPresent: false, tokenValid: null, repoWritePermission: null, error: "issueNumber is required" };
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
        repoWritePermission: null,
        error: resolved.error,
      };
    }
    const { host, repo } = resolved;
    const client = await clientFor(host);
    const tokenPresent = client.hasToken();
    const [issue, repoPublic, tokenValid, repoWritePermission] = await Promise.all([
      fetchIssueDetail(repo, host, issueNumber),
      new ForgeClient({ host }).repoIsPublic(repo),
      client.tokenIsValid(),
      client.repoWritePermission(repo),
    ]);
    if (!issue) {
      return {
        repo,
        issue: null,
        fetchedAt,
        repoPublic,
        tokenPresent,
        tokenValid,
        repoWritePermission,
        error: `Issue #${issueNumber} not found in ${repo}`,
      };
    }
    return { repo, issue, fetchedAt, repoPublic, tokenPresent, tokenValid, repoWritePermission };
  } catch (error) {
    log.warn("issue detail failed", { error: String(error) });
    return { repo: null, issue: null, fetchedAt, repoPublic: null, tokenPresent: false, tokenValid: null, repoWritePermission: null, error: "Issue detail unavailable" };
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

// ---------------------------------------------------------------------------
// Optional label-set install (decision #121.3). A user-invoked action, never
// automatic: the client sends an explicit `mode`, the server resolves the
// configured forge and only ever writes repo labels for that target. `merge`
// adds our missing labels; `replace` additionally removes the target's labels
// that share a scope with our taxonomy. Unrelated boards are never touched
// silently, and a missing token fails closed.
// ---------------------------------------------------------------------------

export async function handleInstallLabels(
  input: InstallLabelsInput,
): Promise<InstallLabelsOutput> {
  const rawMode = (input as { mode?: unknown }).mode;
  const mode = INSTALL_LABEL_MODES.find((candidate) => candidate === rawMode);
  if (!mode) {
    return {
      host: null,
      repo: null,
      mode: null,
      created: [],
      skipped: [],
      removed: [],
      error: "An explicit install mode (merge or replace) is required",
    };
  }
  try {
    const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
    if (!resolved.ok) {
      return { host: null, repo: null, mode, created: [], skipped: [], removed: [], error: resolved.error };
    }
    const { host, repo } = resolved;
    const result: InstallLabelsOutput = {
      host,
      repo,
      mode,
      created: [],
      skipped: [],
      removed: [],
    };
    const client = await clientFor(host);
    if (!client.hasToken()) {
      result.error = "A valid API token is required to install labels";
      return result;
    }
    const existing = await client.listLabels(repo);
    if (!existing) {
      result.error = `Could not read labels for ${host}/${repo}`;
      return result;
    }
    const plan = planLabelSetInstall(existing, mode);
    result.skipped = [...plan.skip];
    for (const label of plan.remove) {
      if (typeof label.id !== "number") continue;
      if (!(await client.deleteLabel(repo, label.id))) {
        result.error = `Could not remove label ${label.name}`;
        return result;
      }
      result.removed.push(label.name);
    }
    for (const definition of plan.create) {
      if (await client.createLabel(repo, definition)) {
        result.created.push(definition.name);
        continue;
      }
      // A concurrent install (or a page-window miss) returns 409 for a label
      // that now exists; treat that as skipped rather than a hard failure.
      const refreshed = await client.listLabels(repo);
      if (refreshed?.some((label) => label.name === definition.name)) {
        result.skipped.push(definition.name);
        continue;
      }
      result.error = `Could not create label ${definition.name}`;
      return result;
    }
    return result;
  } catch (error) {
    log.warn("install-labels failed", { error: String(error) });
    return { host: null, repo: null, mode, created: [], skipped: [], removed: [], error: "Could not install labels" };
  }
}
