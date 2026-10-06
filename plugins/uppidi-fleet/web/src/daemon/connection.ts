import { resolveDaemonHttpUrl, resolveDaemonToken, resolveDaemonWsUrl, storeDaemonToken } from "../config.js";
import { normalizeAgentCategory, type CandidateIssue, type FleetAgent, type FleetAgentsSnapshot } from "../types.js";

export type FleetTeardownTarget = "workers" | "orchestrators" | "frontdesk";

export interface FleetTeardownResult {
  ok: boolean;
  tornDown: Record<FleetTeardownTarget, number>;
  errors: string[];
  message?: string;
  error?: string;
}

export function buildTeardownInput(targets: FleetTeardownTarget[]): { targets: FleetTeardownTarget[]; confirm: true } {
  const unique = [...new Set(targets)];
  if (unique.length === 0) throw new Error("Select at least one teardown target.");
  return { targets: unique, confirm: true as const };
}

interface ConnectionOptions {
  host?: string;
  token?: string;
  onStatus?: (status: ConnectionStatus) => void;
  onEvent?: (event: DaemonEvent) => void;
  onError?: (message: string) => void;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";

export interface DaemonEvent {
  type: string;
  [key: string]: unknown;
}

interface NativeSubscription {
  ready?: Promise<unknown>;
  subscribe(observer: { snapshot?: (value: unknown) => void; update?: (value: unknown) => void; error?: (error: unknown) => void }): () => void;
  release(): Promise<void>;
}

interface DaemonClientLike {
  connect(): Promise<unknown>;
  close(): Promise<unknown> | unknown;
  agents: {
    list(options?: { subscribe?: Record<string, never> }): Promise<{ entries?: unknown[]; subscription?: NativeSubscription }>;
    ref(agent: unknown): { archive(): Promise<unknown> };
  };
  workspaces: {
    list(options?: { subscribe?: Record<string, never> }): Promise<{ entries?: unknown[]; subscription?: NativeSubscription }>;
  };
  searchForge(options: { cwd: string; query: string; limit?: number; kinds?: string[] }): Promise<{ items?: unknown[] }>;
  subscribeConnectionStatus?(listener: (status: string) => void): () => void;
  subscribe?(handler: (event: DaemonEvent) => void): () => void;
}

type DaemonClientFactory = (config: Record<string, unknown>) => DaemonClientLike;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/** Turn a dial failure into an actionable dashboard message. */
export function classifyConnectionError(raw: string, wsUrl: string): string {
  if (/password required/i.test(raw)) {
    return "Daemon requires a password: enter the daemon token and reconnect.";
  }
  if (/incorrect password/i.test(raw)) {
    return "Daemon rejected the password: check the token and reconnect.";
  }
  return (
    `Could not reach ${wsUrl}. ` +
    "If the browser blocks the socket, add this dashboard origin to the daemon hostnames list " +
    "(daemon.hostnames / PASEO_HOSTNAMES) and retry."
  );
}

export class DaemonConnection {
  private status: ConnectionStatus = "disconnected";
  private client: DaemonClientLike | null = null;
  private ctor: DaemonClientFactory | null = null;
  private ctorFailed = false;
  private host: string;
  private token: string | undefined;
  private lastError: string | null = null;
  private onStatus: ((status: ConnectionStatus) => void) | undefined;
  private onEvent: ((event: DaemonEvent) => void) | undefined;
  private onError: ((message: string) => void) | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private closed = false;
  private unsubscribers: Array<() => void> = [];

  constructor(options: ConnectionOptions = {}) {
    this.host = options.host ?? "";
    this.token = options.token;
    this.onStatus = options.onStatus;
    this.onEvent = options.onEvent;
    this.onError = options.onError;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  setToken(token: string | undefined): void {
    this.token = token && token.length > 0 ? token : undefined;
  }

  getToken(): string | undefined {
    return this.token ?? resolveDaemonToken();
  }

  getHost(): string {
    return this.host;
  }

  getWsUrl(): string {
    return resolveDaemonWsUrl(this.host || undefined);
  }

  getHttpUrl(): string {
    return resolveDaemonHttpUrl(this.host || undefined);
  }

  private setStatus(next: ConnectionStatus): void {
    this.status = next;
    this.onStatus?.(next);
  }

  /** Backoff schedule shared with tests: capped exponential growth. */
  static backoffForAttempt(attempt: number): number {
    return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(Math.max(0, attempt), 5));
  }

  async connect(host?: string, token?: string): Promise<void> {
    if (host !== undefined) this.host = host;
    if (token !== undefined) {
      this.setToken(token);
      storeDaemonToken(this.token);
    }
    this.closed = false;
    this.reconnectAttempt = 0;
    this.lastError = null;
    this.setStatus("connecting");
    await this.dial();
  }

  private async loadClientCtor(): Promise<DaemonClientFactory | null> {
    if (this.ctor || this.ctorFailed) return this.ctor;
    try {
      const mod = (await import("@getpaseo/client")) as unknown as {
        createPaseoClient: (config: Record<string, unknown>) => DaemonClientLike;
      };
      this.ctor = mod.createPaseoClient;
      return this.ctor;
    } catch {
      this.ctorFailed = true;
      return null;
    }
  }

  private async dial(): Promise<void> {
    if (this.closed) return;
    const Ctor = await this.loadClientCtor();
    if (!Ctor) {
      this.setStatus("failed");
      return;
    }
    try {
      const token = this.token ?? resolveDaemonToken();
      const client = Ctor({
        url: this.getWsUrl(),
        clientId: `uppidi-fleet-web-${Math.random().toString(36).slice(2, 10)}`,
        clientType: "browser",
        appVersion: "uppidi-fleet-web/0.1.0",
        ...(token ? { password: token } : {}),
        reconnect: { enabled: false },
      });
      const maybeUnsubStatus = client.subscribeConnectionStatus?.((s) => {
        if (s === "connected") {
          this.reconnectAttempt = 0;
          this.setStatus("connected");
        } else if (s === "reconnecting" || s === "connecting") {
          this.setStatus("reconnecting");
        } else if (s === "disconnected" || s === "failed" || s === "closed") {
          this.scheduleReconnect();
        }
      });
      if (maybeUnsubStatus) this.unsubscribers.push(maybeUnsubStatus);
      await client.connect();
      this.client = client;
      await this.startNativeSubscriptions(client);
      this.reconnectAttempt = 0;
      this.lastError = null;
      this.setStatus("connected");
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      this.lastError = classifyConnectionError(raw, this.getWsUrl());
      this.onError?.(this.lastError);
      this.scheduleReconnect();
    }
  }

  private async startNativeSubscriptions(client: DaemonClientLike): Promise<void> {
    const subscribe = async (load: () => Promise<{ subscription?: NativeSubscription }>) => {
      try {
        const result = await load();
        const subscription = result.subscription;
        if (!subscription) return;
        const unsubscribe = subscription.subscribe({
          snapshot: () => this.onEvent?.({ type: "native_snapshot" }),
          update: (event) => this.onEvent?.({ type: "native_update", payload: event }),
          error: (error) => this.onError?.(error instanceof Error ? error.message : String(error)),
        });
        this.unsubscribers.push(() => {
          unsubscribe();
          void subscription.release();
        });
      } catch (error) {
        this.onError?.(error instanceof Error ? error.message : String(error));
      }
    };
    await Promise.all([
      subscribe(() => client.agents.list({ subscribe: {} })),
      subscribe(() => client.workspaces.list({ subscribe: {} })),
    ]);
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.setStatus(this.reconnectAttempt === 0 ? "disconnected" : "reconnecting");
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = DaemonConnection.backoffForAttempt(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.dial();
    }, delay);
  }

  async fetchAgents(): Promise<FleetAgentsSnapshot> {
    if (!this.client) throw new Error("Not connected to the Paseo daemon.");
    const raw = await this.client.agents.list();
    const pick = (list: unknown[] | undefined): FleetAgent[] =>
      (Array.isArray(list) ? list : []).map((entry) => {
        const agent = ((entry as Record<string, unknown>)?.agent ?? entry ?? {}) as Record<string, unknown>;
        const status = String(agent["status"] ?? "unknown");
        const labels = (agent["labels"] ?? {}) as Record<string, unknown>;
        const category = agent["category"] ?? labels["uppidi.category"] ?? agent["role"] ?? agent["name"];
        return {
          id: String(agent["id"] ?? ""),
          name: String(agent["name"] ?? agent["id"] ?? "unknown"),
          category: normalizeAgentCategory(category),
          provider: typeof agent["provider"] === "string" ? agent["provider"] : undefined,
          model: typeof agent["model"] === "string" ? agent["model"] : typeof agent["provider"] === "string" && agent["provider"].includes("/") ? agent["provider"].split("/")[1] : null,
          deterministicState: (status === "running" ? "running" : status === "error" || status === "failed" ? "failed:error" : status === "idle" ? "idle:waiting" : "unknown") as FleetAgentsSnapshot["workers"][number]["deterministicState"],
          project: typeof agent["project"] === "string" ? agent["project"] : typeof agent["cwd"] === "string" ? agent["cwd"] : undefined,
          branch: typeof agent["branch"] === "string" ? agent["branch"] : undefined,
          updatedAt: typeof agent["updatedAt"] === "string" ? agent["updatedAt"] : typeof agent["lastActivityAt"] === "string" ? agent["lastActivityAt"] : undefined,
          requiresAttention: agent["requiresAttention"] === true || (Array.isArray(agent["pendingPermissions"]) && agent["pendingPermissions"].length > 0),
        };
      });
    const all = pick(raw.entries);
    const frontdesk = all.filter((agent) => agent.category === "frontdesk");
    const orchestrators = all.filter((agent) => agent.category === "orchestrator");
    const workers = all.filter((agent) => agent.category === "worker");
    const runningCount = all.filter((agent) => agent.deterministicState === "running").length;
    const errorCount = all.filter((agent) => agent.deterministicState.startsWith("failed:")).length;
    return {
      frontdesk,
      orchestrators,
      workers,
      totalCount: all.length,
      runningCount,
      idleCount: Math.max(0, all.length - runningCount - errorCount),
      errorCount,
    };
  }

  async fetchCandidates(): Promise<CandidateIssue[]> {
    if (!this.client) throw new Error("Not connected to the Paseo daemon.");
    const workspaces = await this.client.workspaces.list();
    const cwds = [...new Set((workspaces.entries ?? []).map((entry) => (entry as Record<string, unknown>).cwd).filter((cwd): cwd is string => typeof cwd === "string" && cwd.length > 0))];
    const responses = await Promise.all(cwds.map((cwd) => this.client!.searchForge({ cwd, query: "", limit: 50, kinds: ["issue"] })));
    const seen = new Set<number>();
    const issues = responses.flatMap((response) => response.items ?? []).filter((entry) => {
      const number = Number((entry as Record<string, unknown>).number ?? 0);
      if (!number || seen.has(number)) return false;
      seen.add(number);
      return true;
    });
    return issues.map((entry) => {
      const issue = (entry ?? {}) as Record<string, unknown>;
      const labels = Array.isArray(issue["labels"]) ? issue["labels"].map(String) : [];
      const status = String(issue["state"] ?? "open") === "closed" ? "Done" : labels.includes("state/wip") || labels.includes("state/1-wip") ? "In progress" : labels.some((label) => label === "state/review" || label === "state/2-review" || label === "state/verify" || label === "state/3-verify") ? "Review" : "Backlog";
      return {
        number: Number(issue["number"] ?? 0),
        title: String(issue["title"] ?? ""),
        repo: String(issue["projectPath"] ?? "").split("/").pop() ?? "",
        status: (["Backlog", "In progress", "Review", "Done"] as const).includes(
          status as CandidateIssue["status"],
        )
          ? (status as CandidateIssue["status"])
          : "Backlog",
        attention: labels.find((label) => label.startsWith("attention/")) ?? "attention/agent",
        branch: typeof issue["headRefName"] === "string" ? issue["headRefName"] : undefined,
        url: typeof issue["url"] === "string" ? issue["url"] : undefined,
        labels,
        comments: 0,
        updatedAt: typeof issue["updatedAt"] === "string" ? issue["updatedAt"] : undefined,
      };
    });
  }

  async teardownFleet(targets: FleetTeardownTarget[]): Promise<FleetTeardownResult> {
    if (!this.client) throw new Error("Not connected to the Paseo daemon.");
    const agents = await this.fetchAgents();
    const requested = new Set(targets);
    const selected = [...agents.frontdesk, ...agents.orchestrators, ...agents.workers].filter((agent) => requested.has(agent.category === "frontdesk" ? "frontdesk" : agent.category === "orchestrator" ? "orchestrators" : "workers"));
    const errors: string[] = [];
    const tornDown: Record<FleetTeardownTarget, number> = { workers: 0, orchestrators: 0, frontdesk: 0 };
    await Promise.all(selected.map(async (agent) => {
      try {
        await this.client!.agents.ref(agent.id).archive();
        tornDown[agent.category === "frontdesk" ? "frontdesk" : agent.category === "orchestrator" ? "orchestrators" : "workers"] += 1;
      } catch (error) {
        errors.push(`${agent.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
    return {
      ok: errors.length === 0,
      tornDown,
      errors,
      message: `Archived ${selected.length} native daemon agent(s).`,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const unsub of this.unsubscribers.splice(0)) {
      try {
        unsub();
      } catch {
        // Listener teardown must never break disconnect.
      }
    }
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.close();
      } catch {
        // Close races with daemon shutdown; status still flips below.
      }
    }
    this.setStatus("disconnected");
  }
}
