import { ForgeIssueSchema, type ForgeIssue, type ForgeLabel } from "../shared/issues.js";

export interface ForgeClientOptions {
  host: string;
  token?: string;
  timeoutMs?: number;
}

/** The identity probe sits on the 30s poll path, so it gets a tighter bound. */
const FORGE_PROBE_TIMEOUT_MS = 5000;

interface ApiLabel {
  name?: unknown;
  color?: unknown;
  description?: unknown;
}

/**
 * Map the Gitea-family label objects on an issue to `{ name, color,
 * description? }`. Bare string entries (older shapes) degrade to name-only.
 * The API returns `color` as hex without `#`; it is passed through untouched.
 */
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

/** Label-name view, derived from the full label objects. */
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

/**
 * Parse Gitea-family issue rows. `openOnly` keeps the open snapshot contract of
 * `listIssues`; search drops the filter so closed issues are included.
 */
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

  private async request(
    path: string,
    init?: RequestInit,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown | null> {
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
        signal: controller.signal,
      });
      if (!res.ok) return null;
      if (res.status === 204) return {};
      const text = await res.text();
      if (!text) return {};
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

  /**
   * Anonymous repo probe: true when the repo answers without credentials
   * (public), false when it 404/403s anonymously (private or missing),
   * null on network failure.
   */
  async repoIsPublic(repo: string): Promise<boolean | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/repos/${repo}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
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

  /**
   * Forgejo/Gitea API identity probe (issue #114): only the Gitea family
   * answers `/api/v1/version` with a `version` string. Runs with the
   * configured token and fails closed, so a non-forge host (github.com, ...)
   * is never issued a list or search call.
   */
  async isForgeHost(): Promise<boolean> {
    const payload = await this.request("/version", undefined, FORGE_PROBE_TIMEOUT_MS);
    if (!payload || typeof payload !== "object") return false;
    return typeof (payload as Record<string, unknown>).version === "string";
  }

  /** Whether a token is configured for this client's host. */
  hasToken(): boolean {
    return Boolean(this.token);
  }

  /**
   * Token validity probe: null when no token is configured, otherwise true
   * when /user answers with it.
   */
  async tokenIsValid(): Promise<boolean | null> {
    if (!this.token) return null;
    const payload = await this.request("/user");
    return payload ? true : false;
  }

  async openIssueCount(repo: string): Promise<number | null> {
    const payload = await this.request(`/repos/${repo}`);
    if (!payload || typeof payload !== "object") return null;
    const count = (payload as Record<string, unknown>).open_issues_count;
    return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
  }

  async listIssues(repo: string, page = 1, limit = 50): Promise<{ issues: ForgeIssue[]; hasMore: boolean } | null> {
    const payload = await this.request(
      `/repos/${repo}/issues?state=open&type=issues&limit=${limit}&page=${page}`,
    );
    if (!Array.isArray(payload)) return null;
    return { issues: toIssues(payload, true), hasMore: payload.length >= limit };
  }

  /**
   * Live keyword search over open and closed issues (never pull requests).
   * The Gitea/Forgejo issues endpoint's `q` matches title, body, and comments.
   * Returns null on a transport/API failure so the handler can surface an error.
   */
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

  /** All labels defined on the repo, following the Gitea-family page window. */
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

  /** Create one repo label; false when the API rejects it (e.g. 409 duplicate). */
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

  /** Delete one repo label by id; false when the API rejects the delete. */
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
}
