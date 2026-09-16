import { ForgejoIssueSchema, type ForgejoIssue } from "../shared/issues.js";

export interface ForgejoClientOptions {
  host: string;
  token?: string;
  timeoutMs?: number;
}

interface ApiLabel {
  name?: unknown;
}

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[])
    .map((entry) =>
      entry && typeof entry === "object"
        ? (entry as ApiLabel).name
        : entry,
    )
    .filter((name): name is string => typeof name === "string");
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

export interface ForgejoComment {
  id: number;
  author: string;
  createdAt: string;
  updatedAt: string;
  body: string;
}

export interface ForgejoIssueDetail {
  number: number;
  title: string;
  state: string;
  labels: string[];
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

export class ForgejoClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(options: ForgejoClientOptions) {
    this.baseUrl = `https://${options.host}/api/v1`;
    this.token = options.token?.trim() ? options.token.trim() : undefined;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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

  async listIssues(repo: string, page = 1, limit = 50): Promise<{ issues: ForgejoIssue[]; hasMore: boolean } | null> {
    const payload = await this.request(
      `/repos/${repo}/issues?state=open&type=issues&limit=${limit}&page=${page}`,
    );
    if (!Array.isArray(payload)) return null;
    const issues: ForgejoIssue[] = [];
    for (const row of payload) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const candidate = {
        number: record.number,
        title: record.title,
        state: record.state,
        labels: labelNames(record.labels),
        updatedAt: typeof record.updated_at === "string" ? record.updated_at : undefined,
      };
      const parsed = ForgejoIssueSchema.safeParse(candidate);
      if (parsed.success && parsed.data.state === "open") issues.push(parsed.data);
    }
    return { issues, hasMore: payload.length >= limit };
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
