import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ForgeIssueSchema,
  type ForgeIssue,
  type ForgeLabel,
} from "../shared/schemas.js";
import { forgeCapabilityFromRepo } from "../shared/remote.js";

export interface ForgeClientOptions {
  host: string;
  token?: string;
  timeoutMs?: number;
}

export const FORGE_PROBE_TIMEOUT_MS = 5000;

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
      comments: typeof record.comments === "number" ? record.comments : 0,
      updatedAt: typeof record.updated_at === "string" ? record.updated_at : undefined,
      createdAt: typeof record.created_at === "string" ? record.created_at : undefined,
      author: asLogin(record.user),
      url: typeof record.html_url === "string" ? record.html_url : undefined,
      body: typeof record.body === "string" ? record.body : undefined,
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

// ---------------------------------------------------------------------------
// Pull Request types
// ---------------------------------------------------------------------------

export interface ForgejoPullRequest {
  id: number;
  number: number;
  title: string;
  state: string; // "open" | "closed" | "merged"
  labels: unknown;
  head: { ref: string; sha: string; repo: string };
  base: { ref: string; sha: string; repo: string };
  user: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  merged_at?: string;
  closed_at?: string;
  mergeable: boolean;
  merge_commit_sha?: string;
  comments_count: number;
  review_comments_count: number;
  commits_count: number;
  additions: number;
  deletions: number;
  changed_files: number;
  html_url: string;
  body?: string;
}

export interface ForgejoReviewComment {
  id: number;
  user: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  body: string;
  html_url: string;
}

// ---------------------------------------------------------------------------
// CI / Action Run types
// ---------------------------------------------------------------------------

export interface ForgejoCiStep {
  id: number;
  name: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  log_url?: string;
}

export interface ForgejoCiRun {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion?: string;
  created_at: string;
  updated_at: string;
  triggered_by?: string;
  ref: string;
  workflow_id: number;
  workflow_name: string;
  steps?: ForgejoCiStep[];
  html_url: string;
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

export function toDetail(repo: string, host: string, payload: unknown): ForgejoIssueDetail | null {
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

  // ---------------------------------------------------------------------------
  // Pull Request API methods
  // ---------------------------------------------------------------------------

  async listPullRequests(
    repo: string,
    state: "open" | "closed" | "merged" = "open",
    page = 1,
    limit = 50,
  ): Promise<{ pullRequests: ForgejoPullRequest[]; hasMore: boolean } | null> {
    const payload = await this.request(
      `/repos/${repo}/pulls?state=${state}&limit=${limit}&page=${page}`,
    );
    if (!Array.isArray(payload)) return null;
    return { pullRequests: payload as ForgejoPullRequest[], hasMore: payload.length >= limit };
  }

  async getPullRequest(repo: string, number: number): Promise<ForgejoPullRequest | null> {
    const payload = await this.request(`/repos/${repo}/pulls/${number}`);
    if (!payload || typeof payload !== "object") return null;
    return payload as ForgejoPullRequest;
  }

  async getPullRequestDiff(repo: string, number: number): Promise<string | null> {
    const payload = await this.request(`/repos/${repo}/pulls/${number}/diff`);
    if (!payload || typeof payload !== "string") return null;
    return payload;
  }

  async getPullRequestPatch(repo: string, number: number): Promise<string | null> {
    const payload = await this.request(`/repos/${repo}/pulls/${number}.patch`);
    if (!payload || typeof payload !== "string") return null;
    return payload;
  }

  async getSreviewComments(repo: string, number: number): Promise<ForgejoReviewComment[] | null> {
    const payload = await this.request(`/repos/${repo}/pulls/${number}/comments`);
    if (!Array.isArray(payload)) return null;
    return payload as ForgejoReviewComment[];
  }

  async mergePullRequest(
    repo: string,
    number: number,
    options?: { title?: string; commit_msg?: string; squash?: boolean },
  ): Promise<boolean> {
    const body: Record<string, unknown> = {
      ...(options?.squash !== false ? { squash: true } : {}),
      ...(options?.title ? { title: options.title } : {}),
      ...(options?.commit_msg ? { commit_msg: options.commit_msg } : {}),
    };
    const result = await this.request(`/repos/${repo}/pulls/${number}/merge`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return result !== null;
  }

  async createPullRequest(
    repo: string,
    pr: {
      title: string;
      head: string;
      base: string;
      body?: string;
      draft?: boolean;
    },
  ): Promise<number | null> {
    const created = await this.request(`/repos/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: pr.title,
        head: pr.head,
        base: pr.base,
        ...(pr.body ? { body: pr.body } : {}),
        ...(pr.draft !== undefined ? { draft: pr.draft } : {}),
      }),
    });
    if (!created || typeof created !== "object") return null;
    const number = (created as Record<string, unknown>).number;
    return typeof number === "number" ? number : null;
  }

  // ---------------------------------------------------------------------------
  // CI / Action Run API methods
  // ---------------------------------------------------------------------------

  async listCiRuns(
    repo: string,
    page = 1,
    limit = 50,
  ): Promise<{ runs: ForgejoCiRun[]; hasMore: boolean } | null> {
    const payload = await this.request(
      `/repos/${repo}/actions/runs?limit=${limit}&page=${page}`,
    );
    if (!Array.isArray(payload)) return null;
    return { runs: payload as ForgejoCiRun[], hasMore: payload.length >= limit };
  }

  async getCiRun(repo: string, runId: number): Promise<ForgejoCiRun | null> {
    const payload = await this.request(`/repos/${repo}/actions/runs/${runId}`);
    if (!payload || typeof payload !== "object") return null;
    return payload as ForgejoCiRun;
  }

  async listCiRunSteps(repo: string, runId: number): Promise<ForgejoCiStep[] | null> {
    const payload = await this.request(`/repos/${repo}/actions/runs/${runId}/jobs`);
    if (!Array.isArray(payload)) return null;
    const steps: ForgejoCiStep[] = [];
    for (const job of payload) {
      if (!job || typeof job !== "object") continue;
      const record = job as Record<string, unknown>;
      const jobSteps = Array.isArray(record.steps) ? record.steps : [];
      for (const stepEntry of jobSteps) {
        if (!stepEntry || typeof stepEntry !== "object") continue;
        const s = stepEntry as Record<string, unknown>;
        steps.push({
          id: typeof s.id === "number" ? s.id : 0,
          name: typeof s.name === "string" ? s.name : `step-${steps.length + 1}`,
          status: typeof s.status === "string" ? s.status : "completed",
          started_at: typeof s.started_at === "string" ? s.started_at : undefined,
          completed_at: typeof s.completed_at === "string" ? s.completed_at : undefined,
          log_url: typeof s.log_url === "string" ? s.log_url : undefined,
        });
      }
    }
    return steps.length > 0 ? steps : null;
  }

  async getStepLog(repo: string, runId: number, stepIndex: number): Promise<string | null> {
    // Forgejo exposes step logs via the actions log endpoint
    const payload = await this.request(
      `/repos/${repo}/actions/runs/${runId}/logs`,
    );
    // The response may be structured data; attempt to extract text
    if (typeof payload === "string") return payload;
    if (payload && typeof payload === "object") {
      const text = (payload as Record<string, unknown>)?.log;
      return typeof text === "string" ? text : null;
    }
    return null;
  }
}

export interface ResolveTokenOptions {
  storagePluginId?: string;
  resolveToken?: (host: string) => Promise<string | undefined | null>;
  readSettings?: (pluginId: string, filename: string) => Promise<any>;
}

export async function resolveForgeToken(
  host: string,
  options?: ResolveTokenOptions,
): Promise<string | undefined> {
  if (options?.resolveToken) {
    try {
      const explicit = await options.resolveToken(host);
      if (explicit && explicit.trim()) return explicit.trim();
    } catch {}
  }

  // Read ONLY from the caller's own plugin scope — never fall back to 'forges'.
  if (options?.storagePluginId) {
    try {
      let data: any = null;
      if (options?.readSettings) {
        data = await options.readSettings(options.storagePluginId!, "settings.json");
      } else {
        const paseoHome = process.env.PASEO_HOME || join(homedir(), ".paseo");
        const settingsPath = join(paseoHome, "plugin-data", "xpufx", options.storagePluginId, "settings.json");
        const raw = await readFile(settingsPath, "utf8");
        data = JSON.parse(raw);
      }
      const token = data?.tokensByHost?.[host];
      if (typeof token === "string" && token.trim()) {
        return token.trim();
      }
    } catch {}
  }

  if (process.env.FORGEJO_TOKEN?.trim()) {
    return process.env.FORGEJO_TOKEN.trim();
  }
  if (process.env.GITEA_TOKEN?.trim()) {
    return process.env.GITEA_TOKEN.trim();
  }

  return undefined;
}

export async function resolveDefaultForgeHost(): Promise<string> {
  if (process.env.FORGEJO_HOST?.trim()) {
    return process.env.FORGEJO_HOST.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
  if (process.env.GITEA_HOST?.trim()) {
    return process.env.GITEA_HOST.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }

  return "forge.mrs.uppidi.com";
}
