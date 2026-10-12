import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { PluginStorage } from "./storage.js";
import { createPluginLogger } from "./logger.js";
import type { HandleableServerContext } from "./settings.js";
import {
  BARE_REPO_PATTERN,
  INSTALL_LABEL_MODES,
  IssueDetailSchema,
  PASEO_LABEL_SCOPES,
  ForgeIssueSchema,
  activeForgeForDirectory,
  forgeCapabilityFromRepo,
  forgeContextContract,
  openIssuesContract,
  searchIssuesContract,
  issueDetailContract,
  setLabelContract,
  addCommentContract,
  createIssueContract,
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
  type ForgeIssue,
  type ForgeLabel,
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
} from "../shared/tickets.js";
import type { RpcOutput } from "../shared/rpc.js";

// ============================================================================
// Git Origin utilities
// ============================================================================

const ORIGIN_SECTION = /\[remote\s+"origin"\][^\[]*?url\s*=\s*(.+)/;
const GITDIR_POINTER = /^\s*gitdir:\s*(.+?)\s*$/m;

/** `[remote "origin"]` URL from git config text, or null when absent. */
export function parseOriginUrl(config: string | null | undefined): string | null {
  if (!config) return null;
  const match = ORIGIN_SECTION.exec(config);
  const url = match?.[1]?.trim();
  return url || null;
}

/** `gitdir:` target from a linked-worktree `.git` file, or null. */
export function parseGitDirPointer(contents: string | null | undefined): string | null {
  if (!contents) return null;
  const match = GITDIR_POINTER.exec(contents);
  return match?.[1]?.trim() || null;
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/** Resolve a gitdir/commondir value relative to the directory that held it. */
function resolveGitPath(value: string, base: string): string {
  return isAbsolute(value) ? value : resolve(base, value);
}

/**
 * Git directory that holds the shared config for a checkout.
 * A normal checkout's `.git` is a directory. A linked worktree's `.git` is a
 * file `gitdir: <path>`; that gitdir carries a `commondir` pointing at the main
 * repo's git dir. Submodule-style gitdirs have no `commondir`, so the gitdir
 * itself is used. Null when there is no usable git pointer.
 */
async function commonGitDir(directory: string): Promise<string | null> {
  const dotGit = join(directory, ".git");
  if (!(await isFile(dotGit))) return dotGit;
  const pointer = parseGitDirPointer(await readText(dotGit));
  if (!pointer) return null;
  const gitDir = resolveGitPath(pointer, directory);
  const commondir = (await readText(join(gitDir, "commondir")))?.trim();
  if (commondir) return resolveGitPath(commondir, gitDir);
  return gitDir;
}

/**
 * Read the workspace's git origin URL without shelling out. Handles both a
 * normal `.git` directory and a linked-worktree `.git` file. Never throws:
 * an unreadable or non-git directory yields null.
 */
export async function gitOriginForDirectory(directory: string): Promise<string | null> {
  const gitDir = await commonGitDir(directory);
  if (!gitDir) return null;
  return parseOriginUrl(await readText(join(gitDir, "config")));
}

// ============================================================================
// Forge Guard
// ============================================================================

export const NEGATIVE_PROBE_TTL_MS = 300_000;

export type GuardLogLevel = "info" | "debug" | "warn";

interface ProbeEntry {
  speaksForgeApi: boolean;
  at: number;
}

export class ForgeGuard {
  private readonly probes = new Map<string, ProbeEntry>();
  private readonly quietLogged = new Set<string>();
  private readonly failures = new Map<string, number>();
  private readonly now: () => number;
  private readonly negativeProbeTtlMs: number;

  constructor(options: { now?: () => number; negativeProbeTtlMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.negativeProbeTtlMs = options.negativeProbeTtlMs ?? NEGATIVE_PROBE_TTL_MS;
  }

  /**
   * Cached verdict: a host that speaks the forge API stays cached, a negative
   * verdict expires. Null means the caller must probe.
   */
  cachedProbe(host: string): boolean | null {
    const entry = this.probes.get(host);
    if (!entry) return null;
    if (entry.speaksForgeApi) return true;
    return this.now() - entry.at < this.negativeProbeTtlMs ? false : null;
  }

  recordProbe(host: string, speaksForgeApi: boolean): void {
    this.probes.set(host, { speaksForgeApi, at: this.now() });
  }

  /** Skip-log level for a non-forge host: info the first time, debug after. */
  skipLogLevel(host: string): GuardLogLevel {
    if (this.quietLogged.has(host)) return "debug";
    this.quietLogged.add(host);
    return "info";
  }

  /** List-failure level: warn the first time per repo, debug on repeats. */
  failureLogLevel(host: string, repo: string): GuardLogLevel {
    const key = `${host}/${repo}`;
    const count = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, count);
    return count <= 1 ? "warn" : "debug";
  }

  /** A successful list clears the backoff so the next failure warns again. */
  noteSuccess(host: string, repo: string): void {
    this.failures.delete(`${host}/${repo}`);
  }
}

// ============================================================================
// Forge Client
// ============================================================================

export interface ForgeClientOptions {
  host: string;
  token?: string;
  timeoutMs?: number;
}

const FORGE_PROBE_TIMEOUT_MS = 5000;

interface ApiLabel {
  name?: unknown;
  color?: unknown;
  description?: unknown;
}

function labelList(value: unknown): ForgeLabel[] {
  if (!Array.isArray(value)) return [];
  const labels: ForgeLabel[] = [];
  for (const entry of value as unknown[]) {
    if (entry && typeof entry === "object") {
      const record = entry as ApiLabel;
      if (typeof record.name !== "string" || !record.name) continue;
      labels.push({
        name: record.name,
        ...(typeof record.color === "string" && record.color ? { color: record.color } : {}),
        ...(typeof record.description === "string" && record.description
          ? { description: record.description }
          : {}),
      });
    } else if (typeof entry === "string" && entry) {
      labels.push({ name: entry });
    }
  }
  return labels;
}

function labelNames(value: unknown): string[] {
  return labelList(value).map((label) => label.name);
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asLogin(value: unknown): string {
  if (value && typeof value === "object") {
    const login = (value as Record<string, unknown>).login;
    if (typeof login === "string" && login) return login;
  }
  return "unknown";
}

function toIssues(rows: unknown[], openOnly: boolean): ForgeIssue[] {
  const issues: ForgeIssue[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const candidate = {
      number: record.number,
      title: record.title,
      state: record.state,
      labels: labelNames(record.labels),
      labelDetails: labelList(record.labels),
      updatedAt: typeof record.updated_at === "string" ? record.updated_at : undefined,
    };
    const parsed = ForgeIssueSchema.safeParse(candidate);
    if (parsed.success && (!openOnly || parsed.data.state === "open")) issues.push(parsed.data);
  }
  return issues;
}

export interface ForgejoLabel {
  id: number;
  name: string;
  color?: string;
  exclusive?: boolean;
  description?: string;
}

export interface ForgejoComment {
  id: number;
  author: string;
  createdAt: string;
  updatedAt: string;
  body: string;
  url: string;
}

function toLabel(entry: unknown): ForgejoLabel | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name) return null;
  return {
    id: typeof record.id === "number" ? record.id : 0,
    name: record.name,
    color: typeof record.color === "string" ? record.color : undefined,
    exclusive: typeof record.exclusive === "boolean" ? record.exclusive : undefined,
    description: typeof record.description === "string" ? record.description : undefined,
  };
}

export interface ForgejoIssueDetail {
  number: number;
  title: string;
  state: string;
  labels: string[];
  labelDetails: ForgeLabel[];
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  webUrl: string;
  comments: ForgejoComment[];
}

function toComment(entry: unknown): ForgejoComment | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.id !== "number") return null;
  const body = asText(record.body);
  return {
    id: record.id,
    author: asLogin(record.user),
    createdAt: asText(record.created_at),
    updatedAt: asText(record.updated_at, asText(record.created_at)),
    body,
    url: asText(record.html_url),
  };
}

function toDetail(repo: string, host: string, payload: unknown): ForgejoIssueDetail | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const rawIssue = (root.issue ?? root) as Record<string, unknown>;
  if (!rawIssue || typeof rawIssue !== "object" || typeof rawIssue.number !== "number") {
    return null;
  }
  const rawComments = Array.isArray(root.comments) ? root.comments : [];
  const comments: ForgejoComment[] = [];
  for (const entry of rawComments) {
    const comment = toComment(entry);
    if (comment) comments.push(comment);
  }
  return {
    number: rawIssue.number,
    title: asText(rawIssue.title, `Issue #${rawIssue.number}`),
    state: asText(rawIssue.state, "open"),
    labels: labelNames(rawIssue.labels),
    labelDetails: labelList(rawIssue.labels),
    body: asText(rawIssue.body),
    author: asLogin(rawIssue.user),
    createdAt: asText(rawIssue.created_at),
    updatedAt: asText(rawIssue.updated_at),
    webUrl:
      asText(rawIssue.html_url) ||
      `https://${host}/${repo}/issues/${rawIssue.number}`,
    comments,
  };
}

export class ForgeClient {
  readonly host: string;
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(options: ForgeClientOptions) {
    this.host = options.host;
    this.baseUrl = `https://${options.host}/api/v1`;
    this.token = options.token?.trim() ? options.token.trim() : undefined;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  private async requestWithStatus(
    path: string,
    init?: RequestInit,
    timeoutMs = this.timeoutMs,
  ): Promise<{ status: number; payload: unknown | null; ok: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      };
      if (this.token) headers.Authorization = `token ${this.token}`;
      if (init?.body !== undefined && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal as any,
      });
      if (!res.ok) return { status: res.status, payload: null, ok: false };
      if (res.status === 204) return { status: res.status, payload: {}, ok: true };
      const text = await res.text();
      if (!text) return { status: res.status, payload: {}, ok: true };
      try {
        return { status: res.status, payload: JSON.parse(text) as unknown, ok: true };
      } catch {
        return { status: res.status, payload: null, ok: false };
      }
    } catch {
      return { status: 0, payload: null, ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(
    path: string,
    init?: RequestInit,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown | null> {
    const { ok, payload } = await this.requestWithStatus(path, init, timeoutMs);
    return ok ? payload : null;
  }

  async repoIsPublic(repo: string): Promise<boolean | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/repos/${repo}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal as any,
      });
      if (res.ok) return true;
      if (res.status === 404 || res.status === 403) return false;
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async isForgeHost(): Promise<boolean> {
    const payload = await this.request("/version", undefined, FORGE_PROBE_TIMEOUT_MS);
    if (!payload || typeof payload !== "object") return false;
    return typeof (payload as Record<string, unknown>).version === "string";
  }

  hasToken(): boolean {
    return Boolean(this.token);
  }

  async tokenIsValid(): Promise<boolean | null> {
    if (!this.token) return null;
    const { status, ok } = await this.requestWithStatus("/user");
    if (ok) return true;
    if (status === 403) return true;
    if (status === 0) return null;
    return false;
  }

  async repoWritePermission(repo: string): Promise<boolean | null> {
    if (!this.token) return null;
    const { ok, payload } = await this.requestWithStatus(`/repos/${repo}`);
    if (ok) return forgeCapabilityFromRepo(payload);
    const anonymous = await this.anonymousRepo(repo);
    if (anonymous === null) return null;
    return forgeCapabilityFromRepo(anonymous);
  }

  async openIssueCount(repo: string): Promise<number | null> {
    const count = (payload: unknown): number | null => {
      if (!payload || typeof payload !== "object") return null;
      const value = (payload as Record<string, unknown>).open_issues_count;
      return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
    };
    const authed = await this.requestWithStatus(`/repos/${repo}`);
    if (authed.ok) return count(authed.payload);
    return count(await this.anonymousRepo(repo));
  }

  private async anonymousRepo(repo: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/repos/${repo}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal as any,
      });
      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async listIssues(repo: string, page = 1, limit = 50): Promise<{ issues: ForgeIssue[]; hasMore: boolean } | null> {
    const payload = await this.request(
      `/repos/${repo}/issues?state=open&type=issues&limit=${limit}&page=${page}`,
    );
    if (!Array.isArray(payload)) return null;
    return { issues: toIssues(payload, true), hasMore: payload.length >= limit };
  }

  async searchIssues(
    repo: string,
    query: string,
    page = 1,
    limit = 50,
  ): Promise<{ issues: ForgeIssue[]; hasMore: boolean } | null> {
    const payload = await this.request(
      `/repos/${repo}/issues?state=all&type=issues&q=${encodeURIComponent(query)}&limit=${limit}&page=${page}`,
    );
    if (!Array.isArray(payload)) return null;
    return { issues: toIssues(payload, false), hasMore: payload.length >= limit };
  }

  async listComments(repo: string, issueNumber: number): Promise<ForgejoComment[] | null> {
    const payload = await this.request(
      `/repos/${repo}/issues/${issueNumber}/comments`,
    );
    if (!Array.isArray(payload)) return null;
    const comments: ForgejoComment[] = [];
    for (const entry of payload) {
      const comment = toComment(entry);
      if (comment) comments.push(comment);
    }
    return comments;
  }

  async getIssue(repo: string, host: string, issueNumber: number): Promise<ForgejoIssueDetail | null> {
    const payload = await this.request(`/repos/${repo}/issues/${issueNumber}`);
    const detail = toDetail(repo, host, payload);
    if (!detail) return null;
    const comments = await this.listComments(repo, issueNumber);
    if (comments) detail.comments = comments;
    return detail;
  }

  async listLabels(repo: string): Promise<ForgejoLabel[] | null> {
    const labels: ForgejoLabel[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const payload = await this.request(`/repos/${repo}/labels?limit=100&page=${page}`);
      if (!Array.isArray(payload)) return null;
      for (const entry of payload) {
        const label = toLabel(entry);
        if (label) labels.push(label);
      }
      if (payload.length < 100) break;
    }
    return labels;
  }

  async createLabel(
    repo: string,
    label: { name: string; color: string; exclusive: boolean; description: string },
  ): Promise<boolean> {
    const created = await this.request(`/repos/${repo}/labels`, {
      method: "POST",
      body: JSON.stringify(label),
    });
    return created !== null;
  }

  async deleteLabel(repo: string, id: number): Promise<boolean> {
    const removed = await this.request(`/repos/${repo}/labels/${id}`, { method: "DELETE" });
    return removed !== null;
  }

  async setLabels(
    repo: string,
    issueNumber: number,
    add: string[],
    remove: string[],
  ): Promise<string[] | null> {
    const current = await this.request(`/repos/${repo}/issues/${issueNumber}`);
    if (!current || typeof current !== "object") return null;
    const existing = labelNames((current as Record<string, unknown>).labels);
    const next = existing.filter((label) => !remove.includes(label));
    for (const label of add) {
      if (!next.includes(label)) next.push(label);
    }
    const updated = await this.request(`/repos/${repo}/issues/${issueNumber}`, {
      method: "PATCH",
      body: JSON.stringify({ labels: next }),
    });
    if (!updated || typeof updated !== "object") return null;
    return labelNames((updated as Record<string, unknown>).labels);
  }

  async addComment(repo: string, issueNumber: number, body: string): Promise<number | null> {
    const created = await this.request(`/repos/${repo}/issues/${issueNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    if (!created || typeof created !== "object") return null;
    const id = (created as Record<string, unknown>).id;
    return typeof id === "number" ? id : null;
  }

  async createIssue(
    repo: string,
    issue: { title: string; body?: string; labels?: string[] },
  ): Promise<number | null> {
    const created = await this.request(`/repos/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: issue.title,
        ...(issue.body ? { body: issue.body } : {}),
        ...(issue.labels && issue.labels.length ? { labels: issue.labels } : {}),
      }),
    });
    if (!created || typeof created !== "object") return null;
    const number = (created as Record<string, unknown>).number;
    return typeof number === "number" ? number : null;
  }
}

// ============================================================================
// Token and Forge resolution
// ============================================================================

export async function resolveForgeToken(
  host: string,
  options?: TicketHandlerOptions,
): Promise<string | undefined> {
  if (options?.resolveToken) {
    try {
      const explicit = await options.resolveToken(host);
      if (explicit && explicit.trim()) return explicit.trim();
    } catch {}
  }

  const storagePluginId = options?.storagePluginId ?? "forges";
  try {
    const storage = new PluginStorage<{ tokensByHost?: Record<string, string> }>(
      storagePluginId,
      "settings.json",
    );
    const data = await storage.readAsync();
    const token = data?.tokensByHost?.[host];
    if (typeof token === "string" && token.trim()) {
      return token.trim();
    }
  } catch {}

  if (process.env.FORGEJO_TOKEN?.trim()) {
    return process.env.FORGEJO_TOKEN.trim();
  }
  if (process.env.GITEA_TOKEN?.trim()) {
    return process.env.GITEA_TOKEN.trim();
  }

  try {
    const teaConfigPath = join(homedir(), ".config", "tea", "config.yml");
    const content = await readFile(teaConfigPath, "utf8");
    const lines = content.split("\n");
    let currentLoginMatches = false;
    for (const line of lines) {
      if (line.includes(host) || line.includes("https://" + host)) {
        currentLoginMatches = true;
      } else if (line.trim().startsWith("- name:")) {
        currentLoginMatches = line.includes(host);
      }
      if (currentLoginMatches && line.trim().startsWith("token:")) {
        const token = line.replace(/.*token:\s*/, "").trim();
        if (token) return token;
      }
    }
  } catch {}

  return undefined;
}

export async function resolveDefaultForgeHost(): Promise<string> {
  if (process.env.FORGEJO_HOST?.trim()) {
    return process.env.FORGEJO_HOST.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
  if (process.env.GITEA_HOST?.trim()) {
    return process.env.GITEA_HOST.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
  try {
    const teaConfigPath = join(homedir(), ".config", "tea", "config.yml");
    const content = await readFile(teaConfigPath, "utf8");
    const lines = content.split("\n");
    let defaultLoginUrl = "";
    let firstLoginUrl = "";
    let inDefaultLogin = false;
    for (const line of lines) {
      if (line.trim().startsWith("- name:")) {
        inDefaultLogin = false;
      }
      if (line.trim().startsWith("default: true")) {
        inDefaultLogin = true;
      }
      if (line.trim().startsWith("url:") || line.trim().startsWith("ssh_host:")) {
        const urlOrHost = line.replace(/.*(?:url|ssh_host):\s*/, "").trim();
        if (urlOrHost) {
          const host = urlOrHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
          if (inDefaultLogin && !defaultLoginUrl) {
            defaultLoginUrl = host;
          }
          if (!firstLoginUrl) {
            firstLoginUrl = host;
          }
        }
      }
    }
    if (defaultLoginUrl) return defaultLoginUrl;
    if (firstLoginUrl) return firstLoginUrl;
  } catch {}

  return "forge.mrs.uppidi.com";
}

export async function storedForgeSelection(
  directory: string | undefined,
  storagePluginId = "forges",
): Promise<string | undefined> {
  if (!directory) return undefined;
  try {
    const storage = new PluginStorage<Record<string, any>>(storagePluginId, "settings.json");
    const settings = await storage.readAsync();
    return activeForgeForDirectory(settings, directory) ?? undefined;
  } catch {
    return undefined;
  }
}

type OpenIssuesResult = RpcOutput<typeof openIssuesContract>;

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

export interface TicketHandlerOptions {
  storagePluginId?: string;
  resolveToken?: (host: string) => Promise<string | undefined | null>;
  guard?: ForgeGuard;
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
}

export function createTicketHandlers(options: TicketHandlerOptions = {}): TicketHandlers {
  const storagePluginId = options.storagePluginId ?? "forges";
  const log = createPluginLogger(storagePluginId, { banner: false });
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
    const stored = await storedForgeSelection(directory, storagePluginId);
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
      const issues: OpenIssuesResult["issues"] = rankIssues(paged.issues);
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

/**
 * Registers all forge ticket RPC contracts on any plugin server context.
 * Handles open-issues, search-issues, context, issue-detail, set-label, add-comment, create-issue.
 */
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

  return handlers;
}
