import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "@getpaseo/client";

export interface HookRouterOptions {
  port?: number;
  host?: string;
  queueDir?: string;
  stateDir?: string;
  secret?: string;
  paseo?: PaseoApi;
  debounceMs?: number;
}

export interface QueueEntry {
  id: string;
  key: string;
  msg: string;
  ts: number;
  isSos?: boolean;
}

export interface OrchestratorRecord {
  key: string;
  agentId: string;
  updatedAt?: string | null;
  by?: string | null;
}

export interface FrontDeskRecord {
  version?: number;
  agentId: string;
  updatedAt?: string | null;
  by?: string | null;
}

export function sanitizeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function normalizeRepoKey(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  s = s.replace(/^git@([^:]+):/, "$1/");
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^ssh:\/\/git@/, "");
  s = s.replace(/:\d+\//, "/");
  s = s.replace(/\.git$/, "");
  s = s.replace(/^\/+|\/+$/g, "");
  return s || null;
}

export function keyFromPayload(body: any): string | null {
  if (!body || typeof body !== "object") return null;
  const repo = body.repository ?? body.run?.repository;
  if (!repo) return null;
  return (
    normalizeRepoKey(repo.html_url) ||
    normalizeRepoKey(repo.clone_url) ||
    normalizeRepoKey(repo.ssh_url) ||
    (repo.full_name ? `forge.mrs.uppidi.com/${repo.full_name}` : null)
  );
}

export function isFrontDeskEvent(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  const label = body.label?.name ?? "";
  if (label === "attention/frontdesk" || label === "attention/2-user") return true;
  const comment = body.comment?.body;
  if (typeof comment === "string" && /(?:^|\s)\/frontdesk\b/i.test(comment)) return true;
  return false;
}

export function isBypassEvent(event: string, body: any): boolean {
  if (!body || typeof body !== "object") return false;
  const label = body.label?.name ?? "";
  if (label === "priority/0-sos" || label === "flag/stop-work" || label.startsWith("attention/")) return true;
  const comment = body.comment?.body;
  if (typeof comment === "string" && /(?:^|\s)\/(?:orchestrator|hold|rework|sos|stop)\b/i.test(comment)) return true;
  return false;
}

export function forgejoEnvelope(event: string, body: any): Record<string, unknown> {
  const repo = body?.repository ?? body?.run?.repository ?? {};
  const sender = body?.sender ?? {};
  const subject = body?.issue ?? body?.pull_request ?? body?.release ?? body?.review ?? null;
  return {
    forgejo: {
      version: 1,
      event,
      action: body?.action ?? null,
      repo: repo.full_name ?? repo.name ?? null,
      repoUrl: repo.html_url ?? repo.clone_url ?? null,
      sender: sender.login ?? sender.username ?? null,
      subject: subject
        ? {
            kind: body?.pull_request ? "pull_request" : body?.issue ? "issue" : "other",
            number: subject.number ?? null,
            title: subject.title ?? null,
            url: subject.html_url ?? null,
          }
        : null,
    },
  };
}

export function summarize(event: string, body: any): string {
  const repo = body?.repository?.full_name ?? body?.repository?.name ?? "unknown-repo";
  const sender = body?.sender?.login ?? body?.sender?.username ?? "unknown";
  const action = body?.action ? `:${body.action}` : "";
  const issue = body?.issue ?? body?.pull_request;
  const num = issue?.number ? `#${issue.number}` : "";
  const title = issue?.title ? ` "${issue.title}"` : "";
  const url = issue?.html_url ?? body?.repository?.html_url ?? "";
  return `🔔 Forgejo webhook incoming [${event}${action}] ${repo}${num}${title} (by ${sender})\n${url}`.trim();
}

export function formatWebhookMessage(event: string, body: any): string {
  const env = forgejoEnvelope(event, body);
  const sum = summarize(event, body);
  return `[forgejo-hook] ${JSON.stringify(env)}\n\n${sum}`;
}

export function stableId(key: string, msg: string): string {
  const h = createHash("sha256");
  h.update(`${key}:${msg}`);
  return h.digest("hex").slice(0, 16);
}

export class HookRouter {
  public configuredPort: number;
  public boundPort = 0;
  public readonly host: string;
  public readonly queueDir: string;
  public readonly stateDir: string;
  public readonly secret?: string;

  private server: PluginServerContext;
  private httpServer: HttpServer | null = null;
  private activePaseo: PaseoApi | null = null;
  private queues = new Map<string, QueueEntry[]>();
  private pausedQueues = new Set<string>();
  private busyQueues = new Set<string>();
  private busyAttempts = new Map<string, number>();
  private droppedCount = new Map<string, number>();
  private draining = new Set<string>();
  private backoffTimers = new Map<string, NodeJS.Timeout>();
  private unsubscribeLifecycle?: () => void;
  private isClosed = false;

  constructor(server: PluginServerContext, options?: HookRouterOptions) {
    this.server = server;
    this.configuredPort = options?.port ?? Number(process.env.FORGE_HOOK_PORT ?? process.env.HOOK_PORT ?? 8099);
    this.host = options?.host ?? process.env.FORGE_HOOK_HOST ?? "127.0.0.1";
    this.secret = options?.secret ?? process.env.FORGE_HOOK_SECRET;
    this.activePaseo = options?.paseo ?? (server as any).paseo ?? null;

    const home = process.env.HOME ?? "/home/xpufx";
    this.queueDir = options?.queueDir ?? process.env.HOOK_QUEUE_DIR ?? join(home, ".config", "uppidi-forge", "queues");
    this.stateDir =
      options?.stateDir ?? process.env.HOOK_STATE_DIR ?? join(home, ".paseo", "forgejo-hook", "orchestrators");

    mkdirSync(this.queueDir, { recursive: true });
    mkdirSync(this.stateDir, { recursive: true });

    this.loadPersistedQueues();
    this.bindLifecycleEvents();
  }

  public get port(): number {
    return this.boundPort || this.configuredPort;
  }

  public getHttpServer(): HttpServer | null {
    return this.httpServer;
  }

  private getPaseo(): PaseoApi | null {
    return this.activePaseo ?? (this.server as any).paseo ?? null;
  }

  public readFrontDesk(): FrontDeskRecord | null {
    const parentDir = dirname(this.stateDir);
    const candidates = [
      join(this.stateDir, "frontdesk.json"),
      join(parentDir, "frontdesk.json"),
      join(this.queueDir, "frontdesk.json"),
    ];

    for (const path of candidates) {
      if (existsSync(path)) {
        try {
          const raw = readFileSync(path, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.agentId === "string" && parsed.agentId.trim()) {
            return {
              version: parsed.version ?? 1,
              agentId: parsed.agentId.trim(),
              updatedAt: parsed.updatedAt ?? null,
              by: parsed.by ?? null,
            };
          }
        } catch {
          // ignore corrupted file
        }
      }
    }
    return null;
  }

  public readOrchestrator(key: string): OrchestratorRecord | null {
    const sanitized = sanitizeKey(key);
    const filePath = join(this.stateDir, `${sanitized}.json`);
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.agentId === "string" && parsed.agentId.trim()) {
          return {
            key: parsed.key ?? key,
            agentId: parsed.agentId.trim(),
            updatedAt: parsed.updatedAt ?? null,
            by: parsed.by ?? null,
          };
        }
      } catch {
        // ignore corrupted file
      }
    }
    return null;
  }

  public writeOrchestrator(key: string, agentId: string, by = "orchestrator"): void {
    mkdirSync(this.stateDir, { recursive: true });
    const sanitized = sanitizeKey(key);
    const target = join(this.stateDir, `${sanitized}.json`);
    const record: OrchestratorRecord = {
      key,
      agentId,
      updatedAt: new Date().toISOString(),
      by,
    };
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
    renameSync(tmp, target);
  }

  public writeFrontDesk(agentId: string, by = "frontdesk"): void {
    const parentDir = dirname(this.stateDir);
    mkdirSync(parentDir, { recursive: true });
    const target = join(parentDir, "frontdesk.json");
    const record: FrontDeskRecord = {
      version: 1,
      agentId,
      updatedAt: new Date().toISOString(),
      by,
    };
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
    renameSync(tmp, target);
  }

  private queueFilePath(key: string): string {
    return join(this.queueDir, `${sanitizeKey(key)}.json`);
  }

  private loadPersistedQueues(): void {
    if (!existsSync(this.queueDir)) return;
    try {
      const files = readdirSync(this.queueDir);
      for (const file of files) {
        if (!file.endsWith(".json") && !file.endsWith(".jsonl")) continue;
        const fullPath = join(this.queueDir, file);
        try {
          const content = readFileSync(fullPath, "utf8").trim();
          if (!content) continue;

          let entries: QueueEntry[] = [];
          if (file.endsWith(".jsonl")) {
            entries = content
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
              .filter((e) => e && typeof e.msg === "string");
          } else {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
              entries = parsed.filter((e) => e && typeof e.msg === "string");
            }
          }

          if (entries.length > 0) {
            const queueKey = entries[0].key || file.replace(/\.jsonl?$/, "");
            this.queues.set(queueKey, entries);
          }
        } catch {
          // ignore corrupted queue files
        }
      }
    } catch {
      // ignore read failures
    }
  }

  private persistQueue(key: string): void {
    if (this.isClosed) return;
    const target = this.queueFilePath(key);
    const entries = this.queues.get(key) ?? [];

    if (entries.length === 0) {
      if (existsSync(target)) {
        try {
          unlinkSync(target);
        } catch {}
      }
      return;
    }

    try {
      mkdirSync(this.queueDir, { recursive: true });
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
      renameSync(tmp, target);
    } catch (err) {
      console.error(`[uppidi-forge:hook-router] Failed to persist queue for ${key}:`, err);
    }
  }

  public enqueue(key: string, msg: string, isSos = false): QueueEntry {
    const list = this.queues.get(key) ?? [];
    const id = stableId(key, msg);

    const existingIdx = list.findIndex((item) => item.id === id);
    if (existingIdx !== -1) {
      return list[existingIdx];
    }

    const entry: QueueEntry = {
      id,
      key,
      msg,
      ts: Date.now(),
      isSos,
    };

    if (isSos) {
      list.unshift(entry);
    } else {
      list.push(entry);
    }

    // Prune excessive depth if needed (> 50 entries)
    if (list.length > 50) {
      const dropped = list.splice(0, list.length - 50);
      this.droppedCount.set(key, (this.droppedCount.get(key) ?? 0) + dropped.length);
    }

    this.queues.set(key, list);
    this.persistQueue(key);
    void this.drain(key);
    return entry;
  }

  public getQueue(key: string): QueueEntry[] {
    return [...(this.queues.get(key) ?? [])];
  }

  public pause(key?: string): string[] {
    if (key) {
      this.pausedQueues.add(key);
    } else {
      for (const k of this.queues.keys()) {
        this.pausedQueues.add(k);
      }
    }
    return Array.from(this.pausedQueues);
  }

  public resume(key?: string): string[] {
    if (key) {
      this.pausedQueues.delete(key);
      void this.drain(key);
    } else {
      this.pausedQueues.clear();
      for (const k of this.queues.keys()) {
        void this.drain(k);
      }
    }
    return Array.from(this.pausedQueues);
  }

  public isPaused(key: string): boolean {
    return this.pausedQueues.has(key);
  }

  private bindLifecycleEvents(): void {
    if (typeof this.server.on === "function") {
      this.unsubscribeLifecycle = this.server.on("agent.turn_ended", async (event, context) => {
        if (context?.paseo) {
          this.activePaseo = context.paseo;
        }
        const endedAgentId = event?.agent?.id;
        if (!endedAgentId) return;

        // Immediate event-driven draining for any queue targeting this agent
        const frontDesk = this.readFrontDesk();
        if (frontDesk?.agentId === endedAgentId) {
          this.busyQueues.delete("frontdesk");
          this.busyAttempts.delete("frontdesk");
          const timer = this.backoffTimers.get("frontdesk");
          if (timer) {
            clearTimeout(timer);
            this.backoffTimers.delete("frontdesk");
          }
          void this.drain("frontdesk");
        }

        for (const [key, items] of this.queues.entries()) {
          if (key === "frontdesk" || items.length === 0) continue;
          const orch = this.readOrchestrator(key);
          if (orch?.agentId === endedAgentId) {
            this.busyQueues.delete(key);
            this.busyAttempts.delete(key);
            const timer = this.backoffTimers.get(key);
            if (timer) {
              clearTimeout(timer);
              this.backoffTimers.delete(key);
            }
            void this.drain(key);
          }
        }
      });
    }
  }

  public async drain(key?: string): Promise<void> {
    if (this.isClosed) return;
    if (!key) {
      for (const k of this.queues.keys()) {
        void this.drain(k);
      }
      return;
    }

    if (this.pausedQueues.has(key)) return;
    if (this.draining.has(key)) return;

    const list = this.queues.get(key);
    if (!list || list.length === 0) return;

    this.draining.add(key);

    try {
      let targetAgentId: string | null = null;
      if (key === "frontdesk") {
        targetAgentId = this.readFrontDesk()?.agentId ?? null;
      } else {
        targetAgentId = this.readOrchestrator(key)?.agentId ?? null;
      }

      if (!targetAgentId) {
        // No target orchestrator / frontdesk registered yet. Leave messages queued.
        return;
      }

      const paseo = this.getPaseo();
      if (!paseo?.agents?.ref) {
        // Paseo client not yet ready/connected
        return;
      }

      const agentRef = paseo.agents.ref(targetAgentId);

      // Check if agent is currently busy
      try {
        const currentSnapshot = agentRef.current ? agentRef.current() : null;
        const refreshed = (!currentSnapshot && agentRef.refresh) ? await agentRef.refresh().catch(() => null) : null;
        const agent = refreshed?.agent ?? currentSnapshot;

        if (agent && (agent.status === "running" || Boolean(agent.activeTurn))) {
          this.busyQueues.add(key);
          const attempts = (this.busyAttempts.get(key) ?? 0) + 1;
          this.busyAttempts.set(key, attempts);

          // Schedule a backoff retry in case turn_ended was missed
          if (!this.backoffTimers.has(key)) {
            const delay = Math.min(30000, 3000 * Math.pow(1.5, Math.min(attempts, 5)));
            const timer = setTimeout(() => {
              this.backoffTimers.delete(key);
              void this.drain(key);
            }, delay);
            timer.unref?.();
            this.backoffTimers.set(key, timer);
          }
          return;
        }
      } catch {
        // Proceed if status inspection fails
      }

      this.busyQueues.delete(key);
      this.busyAttempts.delete(key);

      // Deliver queued messages in FIFO order
      while (list.length > 0) {
        const entry = list[0];
        try {
          await agentRef.send(entry.msg, { steer: !entry.isSos } as any);
          list.shift();
          this.persistQueue(key);
        } catch (error) {
          console.error(`[uppidi-forge:hook-router] Failed to deliver message to ${targetAgentId} for ${key}:`, error);
          // Keep message in queue, back off
          break;
        }
      }
    } finally {
      this.draining.delete(key);
    }
  }

  public getStatusOverview(): Record<string, unknown> {
    const frontDesk = this.readFrontDesk();
    let totalQueued = 0;
    for (const entries of this.queues.values()) {
      totalQueued += entries.length;
    }

    return {
      ok: true,
      service: "uppidi-forge-hook-router",
      version: 1,
      uptime: Math.round(process.uptime()),
      frontDesk: frontDesk
        ? {
            version: frontDesk.version ?? 1,
            agentId: frontDesk.agentId,
            updatedAt: frontDesk.updatedAt ?? undefined,
            by: frontDesk.by ?? undefined,
          }
        : null,
      paused: Array.from(this.pausedQueues),
      totalQueued,
      repoCount: this.queues.size,
    };
  }

  public getQueuesOverview(): Record<string, unknown> {
    const queueItems: Record<string, unknown>[] = [];

    for (const [key, entries] of this.queues.entries()) {
      const orch = key === "frontdesk" ? null : this.readOrchestrator(key);
      const isBusy = this.busyQueues.has(key);
      const busyAttempts = this.busyAttempts.get(key) ?? 0;
      const dropped = this.droppedCount.get(key) ?? 0;

      queueItems.push({
        key,
        depth: entries.length,
        dropped,
        paused: this.pausedQueues.has(key),
        isBusy,
        busyAttempts,
        orchestrator: orch
          ? {
              agentId: orch.agentId,
              updatedAt: orch.updatedAt ?? undefined,
              by: orch.by ?? undefined,
            }
          : null,
        messages: entries.map((e) => ({
          id: e.id,
          ts: e.ts,
          preview: e.msg.length > 120 ? `${e.msg.slice(0, 120)}...` : e.msg,
        })),
      });
    }

    return {
      ok: true,
      service: "uppidi-forge-hook-router",
      uptime: Math.round(process.uptime()),
      paused: Array.from(this.pausedQueues),
      queues: queueItems,
    };
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.httpServer) {
        resolve();
        return;
      }

      this.httpServer = createServer((req, res) => {
        void this.handleHttpRequest(req, res);
      });

      this.httpServer.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.warn(
            `[uppidi-forge:hook-router] Port ${this.port} is already in use. Embedded hook router HTTP listener paused (external service active).`,
          );
          resolve();
        } else {
          console.error(`[uppidi-forge:hook-router] HTTP server error:`, err);
          reject(err);
        }
      });

      this.httpServer.listen(this.configuredPort, this.host, () => {
        const addr = this.httpServer?.address();
        if (addr && typeof addr === "object") {
          this.boundPort = addr.port;
        }
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    this.isClosed = true;

    for (const timer of this.backoffTimers.values()) {
      clearTimeout(timer);
    }
    this.backoffTimers.clear();

    if (this.unsubscribeLifecycle) {
      this.unsubscribeLifecycle();
      this.unsubscribeLifecycle = undefined;
    }

    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          this.httpServer = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Forgejo-Event, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${this.host}:${this.port}`);
    const pathname = url.pathname;

    try {
      if (req.method === "GET" && pathname === "/health") {
        this.sendJson(res, 200, {
          ok: true,
          status: "healthy",
          uptime: Math.round(process.uptime()),
          service: "uppidi-forge-hook-router",
          port: this.port,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/status") {
        this.sendJson(res, 200, this.getStatusOverview());
        return;
      }

      if (req.method === "GET" && pathname === "/queues") {
        this.sendJson(res, 200, this.getQueuesOverview());
        return;
      }

      // Queue pause endpoints: POST /queues/:key/pause or POST /queue/pause
      const pauseMatch = pathname.match(/^\/queues\/(.+)\/pause$/);
      if (req.method === "POST" && (pauseMatch || pathname === "/queue/pause")) {
        const body = await this.readJsonBody(req).catch(() => ({}));
        const target = pauseMatch ? decodeURIComponent(pauseMatch[1]) : (body?.repo as string | undefined);
        const allPaused = this.pause(target);
        this.sendJson(res, 200, { ok: true, paused: target ?? "all", allPaused });
        return;
      }

      // Queue resume endpoints: POST /queues/:key/resume or POST /queue/resume
      const resumeMatch = pathname.match(/^\/queues\/(.+)\/resume$/);
      if (req.method === "POST" && (resumeMatch || pathname === "/queue/resume")) {
        const body = await this.readJsonBody(req).catch(() => ({}));
        const target = resumeMatch ? decodeURIComponent(resumeMatch[1]) : (body?.repo as string | undefined);
        const allPaused = this.resume(target);
        this.sendJson(res, 200, { ok: true, resumed: target ?? "all", allPaused });
        return;
      }

      // Queue drain endpoints: POST /queues/:key/drain or POST /queue/drain
      const drainMatch = pathname.match(/^\/queues\/(.+)\/drain$/);
      if (req.method === "POST" && (drainMatch || pathname === "/queue/drain")) {
        const body = await this.readJsonBody(req).catch(() => ({}));
        const target = drainMatch ? decodeURIComponent(drainMatch[1]) : (body?.repo as string | undefined);
        void this.drain(target);
        this.sendJson(res, 200, { ok: true, draining: target ?? "all" });
        return;
      }

      // Webhook receiver ingress: POST /forgejo or POST /hook
      if (req.method === "POST" && (pathname === "/forgejo" || pathname === "/hook")) {
        const event = (req.headers["x-forgejo-event"] as string | undefined) ?? "unknown";
        const body = await this.readJsonBody(req);

        if (event === "ping") {
          this.sendJson(res, 200, { ok: true, ping: true });
          return;
        }

        const repoKey = keyFromPayload(body);
        if (!repoKey) {
          this.sendJson(res, 400, { ok: false, error: "Could not derive repository key from payload" });
          return;
        }

        const isFd = isFrontDeskEvent(body);
        const isBypass = isBypassEvent(event, body);
        const targetKey = isFd ? "frontdesk" : repoKey;
        const msg = formatWebhookMessage(event, body);

        const entry = this.enqueue(targetKey, msg, isBypass);
        this.sendJson(res, 200, {
          ok: true,
          queued: true,
          key: targetKey,
          id: entry.id,
          isBypass,
          frontDesk: isFd,
        });
        return;
      }

      this.sendJson(res, 404, { ok: false, error: "Not Found" });
    } catch (err) {
      console.error("[uppidi-forge:hook-router] Request handling error:", err);
      this.sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    const payload = JSON.stringify(data);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  private readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 5 * 1024 * 1024) {
          reject(new Error("Payload too large"));
        }
      });
      req.on("end", () => {
        if (!data.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }
}

export function startHookRouter(
  server: PluginServerContext,
  options?: HookRouterOptions,
): () => Promise<void> {
  const router = new HookRouter(server, options);
  void router.start();
  return () => router.stop();
}
