import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  BARE_REPO_PATTERN,
  INSTALL_LABEL_MODES,
  IssueDetailSchema,
  PASEO_LABEL_SCOPES,
  activeForgeForDirectory,
  forgeContextContract,
  openIssuesContract,
  searchIssuesContract,
  issueDetailContract,
  setLabelContract,
  addCommentContract,
  createIssueContract,
  prListContract,
  prViewContract,
  prCreateContract,
  prDiffContract,
  prMergeContract,
  ciLogsContract,
  liveScopesFromIssues,
  liveScopesFromLabels,
  normalizeIssueNumber,
  parseAgentEnvelope,
  parseForgeRemote,
  planLabelSetInstall,
  rankIssues,
  resolveForgeTarget,
  scopeOfLabel,
  validateCreateIssueInput,
  type AddCommentInput,
  type AddCommentOutput,
  type CreateIssueInput,
  type CreateIssueOutput,
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
  type PrListInput,
  type PrListOutput,
  type PrViewOutput,
  type PrCreateInput,
  type PrCreateOutput,
  type PrDiffInput,
  type PrDiffOutput,
  type PrMergeInput,
  type PrMergeOutput,
  type CiLogsInput,
  type CiLogsOutput,
  type CiStep,
  type CiStepStatus,
  type Pr,
  type PrReviewComment,
  type CiRun,
} from "../shared/index.js";
import {
  ForgeClient,
  type ForgejoIssueDetail,
  type ForgejoPullRequest,
  type ForgejoReviewComment,
  type ForgejoCiRun,
  type ForgejoCiStep,
  resolveForgeToken,
  resolveDefaultForgeHost,
} from "./client.js";
import { ForgeGuard, type GuardLogLevel } from "./forge-guard.js";
import { gitOriginForDirectory } from "./git-origin.js";

export interface TicketLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

const defaultLogger: TicketLogger = {
  info: () => {},
  warn: (msg, ctx) => console.warn(`[tickets:warn] ${msg}`, ctx ?? ""),
  debug: () => {},
};

export async function storedForgeSelection(
  directory: string | undefined,
  storagePluginId?: string,
  readSettings?: (pluginId: string, filename: string) => Promise<any>,
): Promise<string | undefined> {
  if (!directory || !storagePluginId) return undefined;
  try {
    let settings: any = null;
    if (readSettings) {
      settings = await readSettings(storagePluginId, "settings.json");
    } else {
      const paseoHome = process.env.PASEO_HOME || join(homedir(), ".paseo");
      const settingsPath = join(paseoHome, "plugin-data", "xpufx", storagePluginId, "settings.json");
      const raw = await readFile(settingsPath, "utf8");
      settings = JSON.parse(raw);
    }
    return activeForgeForDirectory(settings, directory) ?? undefined;
  } catch {
    return undefined;
  }
}

type ResolvedRepo =
  | { ok: true; host: string; repo: string; derivedRemote: string | null; remoteSource: "explicit" | "derived" }
  | { ok: false; derivedRemote: string | null; error: string };

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

// ---------------------------------------------------------------------------
// Pull Request & CI transformation helpers
// ---------------------------------------------------------------------------

function labelNamesFromForge(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object") {
      const name = (entry as Record<string, unknown>).name;
      if (typeof name === "string" && name) names.push(name);
    } else if (typeof entry === "string" && entry) {
      names.push(entry);
    }
  }
  return names;
}

function asStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asLogin(value: unknown): string {
  if (value && typeof value === "object") {
    const login = (value as Record<string, unknown>).login;
    if (typeof login === "string" && login) return login;
  }
  return "unknown";
}

function toPr(raw: ForgejoPullRequest): Pr {
  return {
    number: raw.number,
    title: asStr(raw.title),
    state: (raw.state === "merged" || raw.state === "closed") ? raw.state : "open",
    labels: labelNamesFromForge(raw.labels),
    labelDetails: [],
    headBranch: raw.head?.ref ?? "",
    baseBranch: raw.base?.ref ?? "",
    headRepo: raw.head?.repo,
    baseRepo: raw.base?.repo,
    author: asLogin(raw.user),
    createdAt: asStr(raw.created_at),
    updatedAt: asStr(raw.updated_at),
    mergedAt: raw.merged_at ?? null,
    closedAt: raw.closed_at ?? null,
    mergeable: raw.mergeable ?? null,
    mergeCommitSha: raw.merge_commit_sha ?? null,
    comments: raw.comments_count ?? 0,
    reviewComments: raw.review_comments_count ?? 0,
    commits: raw.commits_count ?? 0,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changed_files ?? 0,
    url: raw.html_url,
    body: raw.body,
  };
}

function toReviewComment(raw: ForgejoReviewComment): PrReviewComment {
  return {
    id: raw.id,
    author: asLogin(raw.user),
    createdAt: asStr(raw.created_at),
    updatedAt: asStr(raw.updated_at, asStr(raw.created_at)),
    body: asStr(raw.body),
    url: asStr(raw.html_url),
  };
}

function toCiStep(raw: ForgejoCiStep): CiStep {
  return {
    name: raw.name,
    status: (raw.status as CiStepStatus) ?? "completed",
    startedAt: raw.started_at ?? null,
    completedAt: raw.completed_at ?? null,
    logUrl: raw.log_url ?? null,
  };
}

function toCiRun(raw: ForgejoCiRun): CiRun {
  return {
    id: raw.id,
    runId: raw.run_id,
    name: asStr(raw.name),
    status: asStr(raw.status),
    conclusion: raw.conclusion ?? null,
    createdAt: asStr(raw.created_at),
    updatedAt: asStr(raw.updated_at),
    triggeredBy: asStr(raw.triggered_by ?? raw.created_at),
    ref: asStr(raw.ref),
    workflowName: raw.workflow_name ?? "",
    steps: (raw.steps ?? []).map(toCiStep),
    url: asStr(raw.html_url),
  };
}

export interface TicketHandlerOptions {
  storagePluginId?: string;
  resolveToken?: (host: string) => Promise<string | undefined | null>;
  readSettings?: (pluginId: string, filename: string) => Promise<any>;
  guard?: ForgeGuard;
  logger?: TicketLogger;
}

export interface TicketHandlers {
  handleOpenIssues(input: OpenIssuesInput): Promise<OpenIssuesOutput>;
  handleSearchIssues(input: SearchIssuesInput): Promise<SearchIssuesOutput>;
  handleForgeContext(input: ForgeContextInput): Promise<ForgeContextOutput>;
  handleIssueDetail(input: IssueDetailInput): Promise<IssueDetailOutput>;
  handleSetLabel(input: SetLabelInput): Promise<SetLabelOutput>;
  handleAddComment(input: AddCommentInput): Promise<AddCommentOutput>;
  handleCreateIssue(input: CreateIssueInput): Promise<CreateIssueOutput>;
  handleInstallLabels(input: InstallLabelsInput): Promise<InstallLabelsOutput>;
  handlePrList(input: PrListInput): Promise<PrListOutput>;
  handlePrView(input: { pullRequestNumber: number; directory?: string; remoteUrl?: string }): Promise<PrViewOutput>;
  handlePrCreate(input: PrCreateInput): Promise<PrCreateOutput>;
  handlePrDiff(input: PrDiffInput): Promise<PrDiffOutput>;
  handlePrMerge(input: PrMergeInput): Promise<PrMergeOutput>;
  handleCiLogs(input: CiLogsInput): Promise<CiLogsOutput>;
}

export function createTicketHandlers(options: TicketHandlerOptions = {}): TicketHandlers {
  const storagePluginId = options.storagePluginId; // no 'forges' fallback
  const log = options.logger ?? defaultLogger;
  const guard = options.guard ?? new ForgeGuard();

  function logAt(level: GuardLogLevel, message: string, context: Record<string, unknown>): void {
    if (level === "warn") log.warn(message, context);
    else if (level === "info") log.info(message, context);
    else log.debug(message, context);
  }

  async function clientFor(host: string): Promise<ForgeClient> {
    return new ForgeClient({ host, token: await resolveForgeToken(host, options) });
  }

  async function probeForgeHost(client: ForgeClient): Promise<boolean> {
    const cached = guard.cachedProbe(client.host);
    if (cached !== null) return cached;
    const speaks = await client.isForgeHost();
    guard.recordProbe(client.host, speaks);
    return speaks;
  }

  async function resolveRepo(
    directory?: string,
    explicitRemote?: string,
  ): Promise<ResolvedRepo> {
    const stored = await storedForgeSelection(directory, storagePluginId, options.readSettings);
    const explicit = explicitRemote?.trim() ? explicitRemote.trim() : stored?.trim();
    const remoteUrl = directory ? await gitOriginForDirectory(directory) : null;
    let resolved = resolveForgeTarget(explicit, remoteUrl);
    if (!resolved.ok && explicit && BARE_REPO_PATTERN.test(explicit)) {
      const defaultHost = await resolveDefaultForgeHost();
      if (defaultHost) {
        const fallbackTarget = `https://${defaultHost}/${explicit}`;
        const fallbackResolved = resolveForgeTarget(fallbackTarget, remoteUrl);
        if (fallbackResolved.ok) {
          resolved = fallbackResolved;
        }
      }
    }
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

  async function fetchIssueDetail(
    repo: string,
    host: string,
    issueNumber: number,
  ): Promise<IssueDetail | null> {
    const client = await clientFor(host);
    const detail = await client.getIssue(repo, host, issueNumber);
    return detail ? toIssueDetail(detail) : null;
  }

  const handlers: TicketHandlers = {
    async handleForgeContext(input: ForgeContextInput): Promise<ForgeContextOutput> {
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
    },

    async handleOpenIssues(input: OpenIssuesInput): Promise<OpenIssuesOutput> {
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
        const message =
          remoteSource === "explicit"
            ? `Selected forge ${host}/${repo} is unreachable or not a forge API host`
            : "Not a forge repo for this workspace";
        return {
          repo,
          host,
          issues: [],
          openIssueCount: null,
          page: 1,
          hasMore: false,
          derivedRemote,
          remoteSource,
          repoPublic: null,
          tokenPresent: false,
          tokenValid: null,
          repoWritePermission: null,
          error: message,
        };
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
        const message =
          remoteSource === "explicit"
            ? `Issue list unavailable for ${host}/${repo}`
            : "Issue list unavailable";
        return {
          repo,
          host,
          issues: [],
          openIssueCount,
          page,
          hasMore: false,
          derivedRemote,
          remoteSource,
          repoPublic,
          tokenPresent,
          tokenValid,
          repoWritePermission,
          error: message,
        };
      }
      guard.noteSuccess(host, repo);
      const issues = rankIssues(paged.issues);
      void liveScopesFromIssues(issues);
      return {
        repo,
        host,
        issues,
        openIssueCount,
        page,
        hasMore: paged.hasMore,
        derivedRemote,
        remoteSource,
        repoPublic,
        tokenPresent,
        tokenValid,
        repoWritePermission,
      };
    },

    async handleSearchIssues(input: SearchIssuesInput): Promise<SearchIssuesOutput> {
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
    },

    async handleIssueDetail(input: IssueDetailInput): Promise<IssueDetailOutput> {
      const fetchedAt = new Date().toISOString();
      try {
        const issueNumber = normalizeIssueNumber(input ?? {});
        if (issueNumber == null) {
          return {
            repo: null,
            issue: null,
            fetchedAt,
            repoPublic: null,
            tokenPresent: false,
            tokenValid: null,
            repoWritePermission: null,
            error: "issueNumber is required",
          };
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
        return {
          repo: null,
          issue: null,
          fetchedAt,
          repoPublic: null,
          tokenPresent: false,
          tokenValid: null,
          repoWritePermission: null,
          error: "Issue detail unavailable",
        };
      }
    },

    async handleSetLabel(input: SetLabelInput): Promise<SetLabelOutput> {
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
    },

    async handleAddComment(input: AddCommentInput): Promise<AddCommentOutput> {
      try {
        const issueNumber = normalizeIssueNumber(input ?? {});
        if (issueNumber == null) {
          return { number: 0, commentId: null, error: "issueNumber is required" };
        }
        const body =
          typeof (input as { body?: unknown }).body === "string"
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
    },

    async handleCreateIssue(input: CreateIssueInput): Promise<CreateIssueOutput> {
      try {
        const validationError = validateCreateIssueInput(input ?? {});
        if (validationError) {
          return { repo: null, host: null, number: null, error: validationError };
        }
        const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
        if (!resolved.ok) {
          return { repo: null, host: null, number: null, error: resolved.error };
        }
        const { host, repo } = resolved;
        const title = (input.title as string).trim();
        const body = typeof input.body === "string" ? input.body.trim() : "";
        const labels = Array.isArray(input.labels)
          ? input.labels.map((label) => String(label).trim()).filter(Boolean)
          : [];
        const client = await clientFor(host);
        const number = await client.createIssue(repo, { title, body, labels });
        if (number == null) {
          log.warn("create-issue failed", { repo });
          return { repo, host, number: null, error: "Could not create issue" };
        }
        return { repo, host, number };
      } catch (error) {
        log.warn("create-issue failed", { error: String(error) });
        return { repo: null, host: null, number: null, error: "Could not create issue" };
      }
    },

    async handleInstallLabels(input: InstallLabelsInput): Promise<InstallLabelsOutput> {
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
    },

    async handlePrList(input: PrListInput): Promise<PrListOutput> {
      try {
        const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
        if (!resolved.ok) {
          return {
            repo: null, host: null, pullRequests: [], page: 1, hasMore: false,
            derivedRemote: null, remoteSource: null, repoPublic: null,
            tokenPresent: false, tokenValid: null, repoWritePermission: null,
            error: resolved.error,
          };
        }
        const { host, repo, derivedRemote, remoteSource } = resolved;
        const client = await clientFor(host);
        if (!(await probeForgeHost(client))) {
          logAt(guard.skipLogLevel(host), "skipping non-forge remote for PR list", { repo, host });
          return {
            repo, host, pullRequests: [], page: 1, hasMore: false,
            derivedRemote, remoteSource, repoPublic: null,
            tokenPresent: false, tokenValid: null, repoWritePermission: null,
            error: `Selected forge ${host}/${repo} is unreachable or not a forge API host`,
          };
        }
        const anonClient = new ForgeClient({ host });
        const tokenPresent = client.hasToken();
        const state = input.state ?? "open";
        const page = input.page ?? 1;
        const [paged, repoPublic, tokenValid, repoWritePermission] = await Promise.all([
          client.listPullRequests(repo, state, page),
          anonClient.repoIsPublic(repo),
          client.tokenIsValid(),
          client.repoWritePermission(repo),
        ]);
        if (!paged) {
          logAt(guard.failureLogLevel(host, repo), "PR list failed", { repo, host, state });
          return {
            repo, host, pullRequests: [], page, hasMore: false,
            derivedRemote, remoteSource, repoPublic, tokenPresent,
            tokenValid, repoWritePermission,
            error: `Pull request list unavailable for ${host}/${repo}`,
          };
        }
        guard.noteSuccess(host, repo);
        return {
          repo, host, pullRequests: paged.pullRequests.map(toPr), page, hasMore: paged.hasMore,
          derivedRemote, remoteSource, repoPublic, tokenPresent,
          tokenValid, repoWritePermission,
        };
      } catch (error) {
        log.warn("pr-list failed", { error: String(error) });
        return {
          repo: null, host: null, pullRequests: [], page: 1, hasMore: false,
          derivedRemote: null, remoteSource: null, repoPublic: null,
          tokenPresent: false, tokenValid: null, repoWritePermission: null,
          error: "Pull request list unavailable",
        };
      }
    },

    async handlePrView(input: PrListInput & { pullRequestNumber: number }): Promise<PrViewOutput> {
      const fetchedAt = new Date().toISOString();
      try {
        const prNumber = typeof input.pullRequestNumber === "number"
          ? input.pullRequestNumber : 0;
        if (prNumber <= 0) {
          return {
            repo: null, host: null, pr: null, reviewComments: [], fetchedAt,
            repoPublic: null, tokenPresent: false, tokenValid: null,
            repoWritePermission: null, error: "pullRequestNumber is required",
          };
        }
        const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
        if (!resolved.ok) {
          return {
            repo: null, host: null, pr: null, reviewComments: [], fetchedAt,
            repoPublic: null, tokenPresent: false, tokenValid: null,
            repoWritePermission: null, error: resolved.error,
          };
        }
        const { host, repo } = resolved;
        const client = await clientFor(host);
        const tokenPresent = client.hasToken();
        const [pr, reviewComments, repoPublic, tokenValid, repoWritePermission] = await Promise.all([
          client.getPullRequest(repo, prNumber),
          client.getSreviewComments(repo, prNumber),
          new ForgeClient({ host }).repoIsPublic(repo),
          client.tokenIsValid(),
          client.repoWritePermission(repo),
        ]);
        if (!pr) {
          return {
            repo, host, pr: null, reviewComments: [], fetchedAt,
            repoPublic, tokenPresent, tokenValid, repoWritePermission,
            error: `Pull request #${prNumber} not found in ${repo}`,
          };
        }
        return {
          repo, host, pr: toPr(pr), reviewComments: (reviewComments ?? []).map(toReviewComment), fetchedAt,
          repoPublic, tokenPresent, tokenValid, repoWritePermission,
        };
      } catch (error) {
        log.warn("pr-view failed", { error: String(error) });
        return {
          repo: null, host: null, pr: null, reviewComments: [], fetchedAt,
          repoPublic: null, tokenPresent: false, tokenValid: null,
          repoWritePermission: null, error: "Pull request detail unavailable",
        };
      }
    },

    async handlePrCreate(input: PrCreateInput): Promise<PrCreateOutput> {
      try {
        const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
        if (!resolved.ok) {
          return { repo: null, host: null, number: null, url: null, error: resolved.error };
        }
        const { host, repo } = resolved;
        const title = (input.title as string).trim();
        if (!title) {
          return { repo, host, number: null, url: null, error: "PR title must not be empty" };
        }
        const body = typeof input.body === "string" ? input.body.trim() : "";
        const headBranch = (input.headBranch as string).trim();
        const baseBranch = (input.baseBranch as string).trim();
        if (!headBranch || !baseBranch) {
          return { repo, host, number: null, url: null, error: "headBranch and baseBranch are required" };
        }
        const client = await clientFor(host);
        const number = await client.createPullRequest(repo, {
          title, head: headBranch, base: baseBranch, body: body || undefined, draft: input.draft,
        });
        if (number == null) {
          log.warn("pr-create failed", { repo });
          return { repo, host, number: null, url: null, error: "Could not create pull request" };
        }
        return { repo, host, number, url: `https://${host}/${repo}/pulls/${number}` };
      } catch (error) {
        log.warn("pr-create failed", { error: String(error) });
        return { repo: null, host: null, number: null, url: null, error: "Could not create pull request" };
      }
    },

    async handlePrDiff(input: PrDiffInput): Promise<PrDiffOutput> {
      try {
        const prNumber = typeof input.pullRequestNumber === "number"
          ? input.pullRequestNumber : 0;
        if (prNumber <= 0) {
          return { repo: null, pullRequestNumber: 0, diff: "", error: "pullRequestNumber is required" };
        }
        const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
        if (!resolved.ok) {
          return { repo: null, pullRequestNumber: prNumber, diff: "", error: resolved.error };
        }
        const { host, repo } = resolved;
        const client = await clientFor(host);
        const [diff, patch] = await Promise.all([
          client.getPullRequestDiff(repo, prNumber),
          client.getPullRequestPatch(repo, prNumber),
        ]);
        if (diff === null) {
          return {
            repo, pullRequestNumber: prNumber, diff: "",
            error: `Could not fetch diff for PR #${prNumber}`,
          };
        }
        return { repo, pullRequestNumber: prNumber, diff, patch: patch ?? undefined };
      } catch (error) {
        log.warn("pr-diff failed", { error: String(error) });
        return { repo: null, pullRequestNumber: 0, diff: "", error: "Could not fetch PR diff" };
      }
    },

    async handlePrMerge(input: PrMergeInput): Promise<PrMergeOutput> {
      try {
        const prNumber = typeof input.pullRequestNumber === "number"
          ? input.pullRequestNumber : 0;
        if (prNumber <= 0) {
          return { repo: null, pullRequestNumber: 0, merged: false, mergeCommitSha: null, error: "pullRequestNumber is required" };
        }
        const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
        if (!resolved.ok) {
          return { repo: null, pullRequestNumber: prNumber, merged: false, mergeCommitSha: null, error: resolved.error };
        }
        const { host, repo } = resolved;
        const client = await clientFor(host);
        const merged = await client.mergePullRequest(repo, prNumber, {
          title: input.title || undefined,
          commit_msg: input.commitMsg || undefined,
          squash: input.squash !== false,
        });
        if (!merged) {
          log.warn("pr-merge failed", { repo, prNumber });
          return {
            repo, pullRequestNumber: prNumber, merged: false,
            mergeCommitSha: null, error: `Could not merge PR #${prNumber}`,
          };
        }
        return { repo, pullRequestNumber: prNumber, merged: true, mergeCommitSha: null };
      } catch (error) {
        log.warn("pr-merge failed", { error: String(error) });
        return { repo: null, pullRequestNumber: 0, merged: false, mergeCommitSha: null, error: "Could not merge pull request" };
      }
    },

    async handleCiLogs(input: CiLogsInput): Promise<CiLogsOutput> {
      try {
        const runId = typeof input.runId === "number" ? input.runId : 0;
        if (runId <= 0) {
          return {
            repo: null, host: null, run: null, stepLog: null, steps: [],
            page: 1, hasMore: false, error: "runId is required",
          };
        }
        const resolved = await resolveRepo(input?.directory, input?.remoteUrl);
        if (!resolved.ok) {
          return {
            repo: null, host: null, run: null, stepLog: null, steps: [],
            page: 1, hasMore: false, error: resolved.error,
          };
        }
        const { host, repo } = resolved;
        const client = await clientFor(host);
        const [run, steps] = await Promise.all([
          client.getCiRun(repo, runId),
          client.listCiRunSteps(repo, runId),
        ]);
        if (!run) {
          return {
            repo, host, run: null, stepLog: null, steps: [],
            page: 1, hasMore: false,
            error: `CI run #${runId} not found in ${repo}`,
          };
        }
        let stepLog: string | null = null;
        if (input.stepId != null && input.stepId > 0) {
          stepLog = await client.getStepLog(repo, runId, input.stepId);
        }
        return {
          repo, host, run: toCiRun(run), stepLog, steps: (steps ?? []).map(toCiStep),
          page: input.page ?? 1, hasMore: false,
        };
      } catch (error) {
        log.warn("ci-logs failed", { error: String(error) });
        return {
          repo: null, host: null, run: null, stepLog: null, steps: [],
          page: 1, hasMore: false, error: "CI logs unavailable",
        };
      }
    },
  };

  return handlers;
}

const defaultTicketHandlers = createTicketHandlers();

export const handleOpenIssues = (input: OpenIssuesInput) => defaultTicketHandlers.handleOpenIssues(input);
export const handleSearchIssues = (input: SearchIssuesInput) => defaultTicketHandlers.handleSearchIssues(input);
export const handleForgeContext = (input: ForgeContextInput) => defaultTicketHandlers.handleForgeContext(input);
export const handleIssueDetail = (input: IssueDetailInput) => defaultTicketHandlers.handleIssueDetail(input);
export const handleSetLabel = (input: SetLabelInput) => defaultTicketHandlers.handleSetLabel(input);
export const handleAddComment = (input: AddCommentInput) => defaultTicketHandlers.handleAddComment(input);
export const handleCreateIssue = (input: CreateIssueInput) => defaultTicketHandlers.handleCreateIssue(input);
export const handleInstallLabels = (input: InstallLabelsInput) => defaultTicketHandlers.handleInstallLabels(input);
export const handlePrList = (input: PrListInput) => defaultTicketHandlers.handlePrList(input);
export const handlePrView = (input: { pullRequestNumber: number; directory?: string; remoteUrl?: string }) => defaultTicketHandlers.handlePrView(input);
export const handlePrCreate = (input: PrCreateInput) => defaultTicketHandlers.handlePrCreate(input);
export const handlePrDiff = (input: PrDiffInput) => defaultTicketHandlers.handlePrDiff(input);
export const handlePrMerge = (input: PrMergeInput) => defaultTicketHandlers.handlePrMerge(input);
export const handleCiLogs = (input: CiLogsInput) => defaultTicketHandlers.handleCiLogs(input);

export interface HandleableServerContext {
  handle(contract: any, handler: (input: any) => Promise<any> | any): void;
}

export function registerTicketHandlers(
  server: HandleableServerContext,
  options?: TicketHandlerOptions,
): TicketHandlers {
  const handlers = options ? createTicketHandlers(options) : defaultTicketHandlers;

  server.handle(openIssuesContract, (input: OpenIssuesInput) => handlers.handleOpenIssues(input));
  server.handle(searchIssuesContract, (input: SearchIssuesInput) => handlers.handleSearchIssues(input));
  server.handle(forgeContextContract, (input: ForgeContextInput) => handlers.handleForgeContext(input));
  server.handle(issueDetailContract, (input: IssueDetailInput) => handlers.handleIssueDetail(input));
  server.handle(setLabelContract, (input: SetLabelInput) => handlers.handleSetLabel(input));
  server.handle(addCommentContract, (input: AddCommentInput) => handlers.handleAddComment(input));
  server.handle(createIssueContract, (input: CreateIssueInput) => handlers.handleCreateIssue(input));
  server.handle(prListContract, (input: PrListInput) => handlers.handlePrList(input));
  server.handle(prViewContract, (input: { pullRequestNumber: number; directory?: string; remoteUrl?: string }) => handlers.handlePrView(input));
  server.handle(prCreateContract, (input: PrCreateInput) => handlers.handlePrCreate(input));
  server.handle(prDiffContract, (input: PrDiffInput) => handlers.handlePrDiff(input));
  server.handle(prMergeContract, (input: PrMergeInput) => handlers.handlePrMerge(input));
  server.handle(ciLogsContract, (input: CiLogsInput) => handlers.handleCiLogs(input));

  return handlers;
}
