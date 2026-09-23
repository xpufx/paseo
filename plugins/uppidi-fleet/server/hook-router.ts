import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "@getpaseo/client";
import type {
  HookServiceStatusOutput,
  HookServiceActionOutput,
  HookLogTailOutput,
  HookServiceConfigInput,
  HookServiceConfigOutput,
} from "../shared/contracts.js";
import { getUppidiFleetSettingsStorage } from "./settings.js";

export interface RouterConfig {
  host?: string;
  port?: number;
  mutedRepos?: string[];
  enrolledRepos?: string[];
}

export function getAvailableNetworkInterfaces(): string[] {
  const interfaces = os.networkInterfaces();
  const result = new Set<string>();
  result.add("127.0.0.1");
  result.add("0.0.0.0");

  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const item of netList as Array<{ family?: string | number; address?: string }>) {
      const family = typeof item.family === "string" ? item.family : String(item.family ?? "");
      if (family === "IPv4" || family === "4") {
        if (item.address && typeof item.address === "string") {
          result.add(item.address);
        }
      }
    }
  }

  return Array.from(result);
}

export function getRouterConfigPath(): string {
  if (process.env.NODE_ENV === "test" && !process.env.FORGE_HOOK_CONFIG) {
    return "";
  }
  if (process.env.FORGE_HOOK_CONFIG) {
    return process.env.FORGE_HOOK_CONFIG;
  }
  const home = process.env.HOME ?? os.homedir();
  return join(home, ".config", "uppidi-fleet", "router-config.json");
}

export function loadRouterConfig(customPath?: string): RouterConfig {
  const configPath = customPath ?? getRouterConfigPath();
  if (configPath && existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          host: typeof parsed.host === "string" && parsed.host.trim() ? parsed.host.trim() : undefined,
          port: typeof parsed.port === "number" && !isNaN(parsed.port) ? parsed.port : undefined,
          mutedRepos: Array.isArray(parsed.mutedRepos) ? parsed.mutedRepos.filter((r: unknown) => typeof r === "string") : undefined,
          enrolledRepos: Array.isArray(parsed.enrolledRepos) ? parsed.enrolledRepos.filter((r: unknown) => typeof r === "string") : undefined,
        };
      }
    } catch {
      // ignore corrupted config file
    }
  }
  return {};
}

export function saveRouterConfig(config: RouterConfig, customPath?: string): void {
  const configPath = customPath ?? getRouterConfigPath();
  if (!configPath) return;
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  const existing = loadRouterConfig(configPath);
  const merged: RouterConfig = {
    ...existing,
    ...config,
    mutedRepos: config.mutedRepos !== undefined ? config.mutedRepos : existing.mutedRepos,
    enrolledRepos: config.enrolledRepos !== undefined ? config.enrolledRepos : existing.enrolledRepos,
  };
  const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf8");
  renameSync(tmp, configPath);

  try {
    const storage = getUppidiFleetSettingsStorage();
    const updateData: Record<string, any> = {};
    if (merged.host !== undefined) updateData.hookHost = merged.host;
    if (merged.port !== undefined) updateData.hookPort = merged.port;
    if (merged.enrolledRepos !== undefined) updateData.enrolledRepos = merged.enrolledRepos;
    if (merged.mutedRepos !== undefined) updateData.mutedRepos = merged.mutedRepos;
    if (Object.keys(updateData).length > 0) {
      storage.update((prev) => ({ ...prev, ...updateData }));
    }
  } catch {
    // ignore when storage not accessible or in isolated testing
  }
}

export interface HookRouterOptions {
  port?: number;
  host?: string;
  configPath?: string;
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

const MAX_LOG_LINES = 1000;
const logBuffer: string[] = [];

export function appendHookLog(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_LINES);
  }
}

export function getHookLogs(lines = 50): string[] {
  const count = Math.max(1, Math.min(lines, MAX_LOG_LINES));
  return logBuffer.slice(-count);
}

export function clearHookLogs(): void {
  logBuffer.length = 0;
}

export class HookRouter {
  public configuredPort: number;
  public configuredHost: string;
  public boundPort = 0;
  public boundHost = "";
  public readonly configPath?: string;
  public readonly queueDir: string;
  public readonly stateDir: string;
  public readonly secret?: string;

  private server: PluginServerContext | null;
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
  private startedAt: number | null = null;
  private mutedRepos = new Set<string>();
  private enrolledRepos = new Set<string>();

  constructor(server?: PluginServerContext | null, options?: HookRouterOptions) {
    this.server = server ?? null;
    this.configPath = options?.configPath;
    const persisted = loadRouterConfig(this.configPath);
    const settings = (() => {
      try {
        return getUppidiFleetSettingsStorage().read();
      } catch {
        return null;
      }
    })();

    const envPort = process.env.FORGE_HOOK_PORT ?? process.env.HOOK_PORT;
    const isTestMode = process.env.NODE_ENV === "test" && !process.env.FORGE_HOOK_CONFIG;

    this.configuredPort =
      options?.port !== undefined
        ? options.port
        : isTestMode && envPort !== undefined
          ? Number(envPort)
          : settings?.hookPort !== undefined
            ? settings.hookPort
            : persisted.port !== undefined
              ? persisted.port
              : Number(envPort ?? 8099);
    this.configuredHost =
      options?.host !== undefined
        ? options.host
        : isTestMode
          ? (process.env.FORGE_HOOK_HOST ?? "127.0.0.1")
          : settings?.hookHost !== undefined
            ? settings.hookHost
            : persisted.host !== undefined
              ? persisted.host
              : process.env.FORGE_HOOK_HOST ?? "127.0.0.1";
    this.secret = options?.secret ?? process.env.FORGE_HOOK_SECRET;
    this.activePaseo = options?.paseo ?? (server as any)?.paseo ?? null;

    if (persisted.mutedRepos) {
      for (const r of persisted.mutedRepos) {
        if (r) this.mutedRepos.add(r);
      }
    }
    if (persisted.enrolledRepos) {
      for (const r of persisted.enrolledRepos) {
        if (r) this.enrolledRepos.add(r);
      }
    }

    const home = process.env.HOME ?? os.homedir();
    this.queueDir = options?.queueDir ?? process.env.HOOK_QUEUE_DIR ?? join(home, ".config", "uppidi-fleet", "queues");
    this.stateDir =
      options?.stateDir ?? process.env.HOOK_STATE_DIR ?? join(home, ".paseo", "forgejo-hook", "orchestrators");

    mkdirSync(this.queueDir, { recursive: true });
    mkdirSync(this.stateDir, { recursive: true });

    this.loadPersistedQueues();
    this.bindLifecycleEvents();
  }

  public isRepoMuted(repoKey: string): boolean {
    if (!repoKey) return false;
    if (this.mutedRepos.has(repoKey)) return true;
    for (const m of this.mutedRepos) {
      if (m.toLowerCase() === repoKey.toLowerCase()) return true;
      const cleanM = m.toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "");
      const cleanK = repoKey.toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "");
      if (cleanM === cleanK || cleanK.endsWith(`/${cleanM}`) || cleanM.endsWith(`/${cleanK}`)) {
        return true;
      }
    }
    return false;
  }

  public muteRepo(repoKey: string): string[] {
    this.mutedRepos.add(repoKey);
    this.saveConfigState();
    this.log(`[info] Repository ${repoKey} muted (circuit breaker engaged)`);
    return Array.from(this.mutedRepos);
  }

  public unmuteRepo(repoKey: string): string[] {
    for (const m of Array.from(this.mutedRepos)) {
      if (m === repoKey || this.isRepoMutedMatch(m, repoKey)) {
        this.mutedRepos.delete(m);
      }
    }
    this.saveConfigState();
    this.log(`[info] Repository ${repoKey} unmuted; resuming processing`);
    void this.drain(repoKey);
    return Array.from(this.mutedRepos);
  }

  public toggleRepoMute(repoKey: string, forceMute?: boolean): { isMuted: boolean; mutedRepos: string[] } {
    const current = this.isRepoMuted(repoKey);
    const shouldMute = forceMute !== undefined ? forceMute : !current;
    if (shouldMute) {
      this.muteRepo(repoKey);
    } else {
      this.unmuteRepo(repoKey);
    }
    return {
      isMuted: shouldMute,
      mutedRepos: Array.from(this.mutedRepos),
    };
  }

  public getMutedRepos(): string[] {
    return Array.from(this.mutedRepos);
  }

  public enrollRepo(repoKey: string): string[] {
    this.enrolledRepos.add(repoKey);
    this.saveConfigState();
    return Array.from(this.enrolledRepos);
  }

  public getEnrolledRepos(): string[] {
    const set = new Set<string>(this.enrolledRepos);
    try {
      if (existsSync(this.stateDir)) {
        const files = readdirSync(this.stateDir);
        for (const file of files) {
          if (!file.endsWith(".json") || file === "frontdesk.json") continue;
          try {
            const raw = readFileSync(join(this.stateDir, file), "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.key === "string" && parsed.key.trim()) {
              set.add(parsed.key.trim());
            }
          } catch {}
        }
      }
    } catch {}

    for (const key of this.queues.keys()) {
      if (key !== "frontdesk") {
        set.add(key);
      }
    }

    return Array.from(set);
  }

  private isRepoMutedMatch(a: string, b: string): boolean {
    if (a.toLowerCase() === b.toLowerCase()) return true;
    const cleanA = a.toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "");
    const cleanB = b.toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "");
    return cleanA === cleanB || cleanA.endsWith(`/${cleanB}`) || cleanB.endsWith(`/${cleanA}`);
  }

  private saveConfigState(): void {
    saveRouterConfig(
      {
        mutedRepos: Array.from(this.mutedRepos),
        enrolledRepos: Array.from(this.enrolledRepos),
      },
      this.configPath
    );
  }

  public get port(): number {
    return this.boundPort || this.configuredPort;
  }

  public get host(): string {
    return (this.isListening() && this.boundHost) ? this.boundHost : this.configuredHost;
  }

  public getHttpServer(): HttpServer | null {
    return this.httpServer;
  }

  public isListening(): boolean {
    return this.httpServer !== null && Boolean(this.httpServer.listening);
  }

  public getUptime(): number {
    return this.isListening() && this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  }

  public getTotalQueued(): number {
    let total = 0;
    for (const entries of this.queues.values()) {
      total += entries.length;
    }
    return total;
  }

  public getQueueCount(): number {
    return this.queues.size;
  }

  public getLifecycleStatus(): {
    listening: boolean;
    host: string;
    configuredHost: string;
    port: number;
    configuredPort: number;
    uptime: number;
    totalQueued: number;
    repoCount: number;
  } {
    return {
      listening: this.isListening(),
      host: this.host,
      configuredHost: this.configuredHost,
      port: this.port,
      configuredPort: this.configuredPort,
      uptime: this.getUptime(),
      totalQueued: this.getTotalQueued(),
      repoCount: this.queues.size,
    };
  }

  private log(message: string): void {
    appendHookLog(message);
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

  public async deliverMessage(
    targetAgentId: string,
    msg: string,
    options?: { noWait?: boolean; steer?: boolean },
  ): Promise<boolean> {
    const paseo = this.getPaseo();
    if (paseo?.agents?.ref) {
      try {
        const agentRef = paseo.agents.ref(targetAgentId);
        await agentRef.send(msg, { steer: options?.steer ?? true } as any);
        return true;
      } catch (err) {
        this.log(`[warn] SDK send failed for ${targetAgentId}, falling back to CLI: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const args = ["send"];
      if (options?.noWait !== false) {
        args.push("--no-wait");
      }
      args.push(targetAgentId, msg);
      await execFileAsync("paseo", args, { timeout: options?.noWait ? 5000 : 15000 });
      return true;
    } catch (err) {
      this.log(`[error] CLI send failed for ${targetAgentId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  public async updateAgentMetadata(
    agentId: string,
    name: string,
    labels: Record<string, string>,
  ): Promise<boolean> {
    const paseo = this.getPaseo();
    if (paseo?.agents) {
      try {
        const ref = typeof paseo.agents.ref === "function" ? paseo.agents.ref(agentId) : null;
        if (typeof (ref as any)?.update === "function") {
          await (ref as any).update({ name, labels });
          return true;
        } else if (typeof (paseo.agents as any)?.update === "function") {
          await (paseo.agents as any).update(agentId, { name, labels });
          return true;
        }
      } catch (err) {
        this.log(`[warn] SDK updateAgent failed for ${agentId}, falling back to CLI: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const args = ["agent", "update", agentId, "--name", name];
      for (const [k, v] of Object.entries(labels)) {
        args.push("--label", `${k}=${v}`);
      }
      await execFileAsync("paseo", args, { timeout: 10000 });
      return true;
    } catch (err) {
      this.log(`[error] CLI updateAgent failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  public async getActiveAgentIds(): Promise<Set<string>> {
    const active = new Set<string>();
    try {
      const { stdout } = await execFileAsync("paseo", ["ls", "--json"], { timeout: 5000 });
      const list = JSON.parse(stdout);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.id && item?.status !== "closed" && item?.status !== "archived") {
            active.add(item.id);
          }
        }
      }
    } catch {}
    return active;
  }

  public listOrchestratorAgentIds(): string[] {
    const ids = new Set<string>();
    try {
      if (existsSync(this.stateDir)) {
        const files = readdirSync(this.stateDir);
        for (const file of files) {
          if (!file.endsWith(".json") || file === "frontdesk.json") continue;
          try {
            const raw = readFileSync(join(this.stateDir, file), "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.agentId === "string" && parsed.agentId.trim()) {
              ids.add(parsed.agentId.trim());
            }
          } catch {}
        }
      }
    } catch {}
    return Array.from(ids);
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
      console.error(`[uppidi-fleet:hook-router] Failed to persist queue for ${key}:`, err);
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
      this.log(`[warn] Queue ${key} exceeded depth limit; dropped ${dropped.length} messages`);
    }

    this.queues.set(key, list);
    this.persistQueue(key);
    this.log(`[info] Enqueued message ${entry.id} for ${key} (total depth: ${list.length}, sos: ${Boolean(isSos)})`);
    if (!this.isRepoMuted(key)) {
      void this.drain(key);
    } else {
      this.log(`[info] Drain suppressed for muted repository ${key}`);
    }
    return entry;
  }

  public getQueue(key: string): QueueEntry[] {
    return [...(this.queues.get(key) ?? [])];
  }

  public pause(key?: string): string[] {
    if (key) {
      this.pausedQueues.add(key);
      this.log(`[info] Queue ${key} paused`);
    } else {
      for (const k of this.queues.keys()) {
        this.pausedQueues.add(k);
      }
      this.log("[info] All queues paused");
    }
    return Array.from(this.pausedQueues);
  }

  public resume(key?: string): string[] {
    if (key) {
      this.pausedQueues.delete(key);
      this.log(`[info] Queue ${key} resumed`);
      if (!this.isRepoMuted(key)) {
        void this.drain(key);
      }
    } else {
      this.pausedQueues.clear();
      this.log("[info] All queues resumed");
      for (const k of this.queues.keys()) {
        if (!this.isRepoMuted(k)) {
          void this.drain(k);
        }
      }
    }
    return Array.from(this.pausedQueues);
  }

  public isPaused(key: string): boolean {
    return this.pausedQueues.has(key);
  }

  private bindLifecycleEvents(): void {
    if (this.unsubscribeLifecycle) return;
    if (this.server && typeof this.server.on === "function") {
      this.unsubscribeLifecycle = this.server.on("agent.turn_ended", async (event, context) => {
        if (context?.paseo) {
          this.activePaseo = context.paseo;
        }
        const endedAgentId = event?.agent?.id;
        if (!endedAgentId) return;

        this.log(`[info] Agent turn ended for agent ${endedAgentId}, triggering queue drain`);

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
          if (!this.isRepoMuted("frontdesk")) {
            void this.drain("frontdesk");
          }
        }

        for (const [key, items] of this.queues.entries()) {
          if (key === "frontdesk" || items.length === 0) continue;
          if (this.isRepoMuted(key)) continue;
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
        if (!this.isRepoMuted(k)) {
          void this.drain(k);
        }
      }
      return;
    }

    if (this.isRepoMuted(key)) {
      this.log(`[info] Drain suppressed for muted repository ${key}`);
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

      const agentRef = paseo?.agents?.ref ? paseo.agents.ref(targetAgentId) : null;

      if (agentRef) {
        // Check if agent is currently busy
        try {
          const currentSnapshot = agentRef.current ? agentRef.current() : null;
          const refreshed = (!currentSnapshot && agentRef.refresh) ? await agentRef.refresh().catch(() => null) : null;
          const agent = refreshed?.agent ?? currentSnapshot;

          if (agent && (agent.status === "running" || Boolean(agent.activeTurn))) {
            this.busyQueues.add(key);
            const attempts = (this.busyAttempts.get(key) ?? 0) + 1;
            this.busyAttempts.set(key, attempts);
            this.log(`[info] Agent ${targetAgentId} busy for ${key}, retry scheduled (attempt ${attempts})`);

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
      }

      this.busyQueues.delete(key);
      this.busyAttempts.delete(key);

      // Deliver queued messages in FIFO order
      while (list.length > 0) {
        const entry = list[0];
        const ok = await this.deliverMessage(targetAgentId, entry.msg, {
          steer: !entry.isSos,
          noWait: false,
        });
        if (ok) {
          list.shift();
          this.persistQueue(key);
          this.log(`[info] Delivered message ${entry.id} to agent ${targetAgentId} for ${key}`);
        } else {
          this.log(`[error] Failed to deliver message to ${targetAgentId} for ${key}`);
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
    const totalQueued = this.getTotalQueued();

    const allKeys = new Set<string>();
    for (const r of this.getEnrolledRepos()) allKeys.add(r);
    for (const k of this.queues.keys()) allKeys.add(k);

    return {
      ok: true,
      service: "uppidi-fleet-hook-router",
      version: 1,
      uptime: this.getUptime(),
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
      repoCount: allKeys.size,
    };
  }

  public getQueuesOverview(): Record<string, unknown> {
    const queueItems: Record<string, unknown>[] = [];

    // Enumerate enrolled repositories as well as any active queues so idle/empty enrolled queues appear (#448)
    const allKeys = new Set<string>();
    for (const r of this.getEnrolledRepos()) allKeys.add(r);
    for (const k of this.queues.keys()) allKeys.add(k);

    for (const key of allKeys) {
      const entries = this.queues.get(key) ?? [];
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
      service: "uppidi-fleet-hook-router",
      uptime: this.getUptime(),
      paused: Array.from(this.pausedQueues),
      queues: queueItems,
    };
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isClosed = false;
      this.bindLifecycleEvents();

      if (this.httpServer && this.httpServer.listening) {
        resolve();
        return;
      }

      this.httpServer = createServer((req, res) => {
        void this.handleHttpRequest(req, res);
      });

      this.httpServer.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          this.log(
            `[warn] Port ${this.port} is already in use. Bundled hook router HTTP listener paused (external service active).`,
          );
          this.httpServer = null;
          this.boundPort = 0;
          this.startedAt = null;
          resolve();
        } else {
          this.log(`[error] HTTP server error: ${err.message}`);
          reject(err);
        }
      });

      this.httpServer.listen(this.configuredPort, this.configuredHost, () => {
        const addr = this.httpServer?.address();
        if (addr && typeof addr === "object") {
          this.boundPort = addr.port;
          this.boundHost = addr.address;
        }
        this.startedAt = Date.now();
        this.log(`[info] Bundled hook router listening on http://${this.configuredHost}:${this.port}`);
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
          this.boundPort = 0;
          this.boundHost = "";
          this.startedAt = null;
          this.log("[info] Bundled hook router stopped");
          resolve();
        });
      } else {
        this.boundPort = 0;
        this.boundHost = "";
        this.startedAt = null;
        resolve();
      }
    });
  }

  public async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  public async configure(options: {
    host?: string;
    port?: number;
    restart?: boolean;
  }): Promise<{
    configuredHost: string;
    configuredPort: number;
    activeHost: string;
    activePort: number;
    restarted: boolean;
  }> {
    const updatedHost =
      options.host !== undefined && options.host.trim() ? options.host.trim() : this.configuredHost;
    const updatedPort =
      options.port !== undefined && options.port > 0 ? options.port : this.configuredPort;

    saveRouterConfig(
      {
        host: updatedHost,
        port: updatedPort,
      },
      this.configPath,
    );

    this.configuredHost = updatedHost;
    this.configuredPort = updatedPort;

    let restarted = false;
    const shouldRestart = options.restart !== false;
    if (shouldRestart && this.isListening()) {
      await this.restart();
      restarted = true;
    }

    return {
      configuredHost: this.configuredHost,
      configuredPort: this.configuredPort,
      activeHost: this.isListening() ? this.host : this.configuredHost,
      activePort: this.isListening() ? this.port : this.configuredPort,
      restarted,
    };
  }

  public async reload(): Promise<void> {
    this.loadPersistedQueues();
    this.log("[info] Bundled hook router reloaded persisted queues and configuration");
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
          uptime: this.getUptime(),
          service: "uppidi-fleet-hook-router",
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

      if (req.method === "GET" && pathname === "/frontdesk") {
        const record = this.readFrontDesk();
        this.sendJson(res, 200, record ?? { agentId: null });
        return;
      }

      if (req.method === "POST" && pathname === "/frontdesk") {
        const body = await this.readJsonBody(req);
        const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
        if (!agentId) {
          this.sendJson(res, 400, { ok: false, error: "agentId is required" });
          return;
        }

        const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
        const previous = this.readFrontDesk()?.agentId ?? null;
        this.writeFrontDesk(agentId, "frontdesk");
        void this.drain("frontdesk");

        await this.updateAgentMetadata(agentId, "Front Desk", {
          role: "front-desk",
          category: "front-desk",
        });

        if (previous && previous !== agentId) {
          await this.updateAgentMetadata(previous, "Front Desk (retired)", {
            role: "retired-front-desk",
          });
        }

        const orchestrators = this.listOrchestratorAgentIds();
        const activeAgents = await this.getActiveAgentIds();
        const targetOrchestrators = orchestrators.filter(
          (id) => id !== agentId && (activeAgents.size === 0 || activeAgents.has(id)),
        );

        const notice =
          instruction ||
          `Front Desk registered: ${agentId}. Orchestrators must maintain composer silence and route all operator-escalation requests (attention/2-user) to Front Desk (${agentId}) via 'paseo send --steer --no-wait ${agentId} <msg>'.`;

        let notified = 0;
        for (const orchId of targetOrchestrators) {
          const ok = await this.deliverMessage(orchId, notice, { noWait: true, steer: true });
          if (ok) notified++;
        }

        this.log(`[info] Front Desk registered: ${agentId}, notified ${notified} orchestrator(s)`);
        this.sendJson(res, 200, {
          ok: true,
          agentId,
          orchestratorsNotified: notified,
        });
        return;
      }

      if (req.method === "GET" && (pathname === "/orchestrators" || pathname.startsWith("/orchestrators/"))) {
        const pathRepo = pathname.startsWith("/orchestrators/")
          ? decodeURIComponent(pathname.slice("/orchestrators/".length))
          : null;
        const requestedRepo = pathRepo ?? url.searchParams.get("repo");
        if (requestedRepo) {
          const orch = this.readOrchestrator(requestedRepo);
          if (!orch) {
            this.sendJson(res, 404, { ok: false, error: "orchestrator not registered", key: requestedRepo });
            return;
          }
          this.sendJson(res, 200, { ok: true, orchestrator: orch });
          return;
        }

        const list: OrchestratorRecord[] = [];
        try {
          if (existsSync(this.stateDir)) {
            const files = readdirSync(this.stateDir);
            for (const file of files) {
              if (!file.endsWith(".json") || file === "frontdesk.json") continue;
              try {
                const raw = readFileSync(join(this.stateDir, file), "utf8");
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.agentId === "string" && parsed.agentId.trim()) {
                  list.push({
                    key: parsed.key ?? file.replace(/\.json$/, ""),
                    agentId: parsed.agentId.trim(),
                    updatedAt: parsed.updatedAt ?? null,
                    by: parsed.by ?? null,
                  });
                }
              } catch {}
            }
          }
        } catch {}
        list.sort((a, b) => a.key.localeCompare(b.key));
        this.sendJson(res, 200, { ok: true, orchestrators: list });
        return;
      }

      if (req.method === "POST" && (pathname === "/orchestrator" || pathname === "/orchestrate")) {
        const body = await this.readJsonBody(req);
        const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
        const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
        if (!repo || !agentId) {
          this.sendJson(res, 400, { ok: false, error: "repo and agentId are required" });
          return;
        }
        this.writeOrchestrator(repo, agentId, "orchestrator");
        void this.drain(repo);
        this.sendJson(res, 200, { ok: true, repo, agentId });
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
          this.log("[info] Webhook ping received on POST /forgejo");
          this.sendJson(res, 200, { ok: true, ping: true });
          return;
        }

        const repoKey = keyFromPayload(body);
        if (!repoKey) {
          this.log("[warn] Webhook rejected: could not derive repository key from payload");
          this.sendJson(res, 400, { ok: false, error: "Could not derive repository key from payload" });
          return;
        }

        const isFd = isFrontDeskEvent(body);
        const isBypass = isBypassEvent(event, body);
        const targetKey = isFd ? "frontdesk" : repoKey;
        const msg = formatWebhookMessage(event, body);

        this.log(`[info] Webhook received: event=${event} repo=${targetKey} bypass=${isBypass} frontDesk=${isFd}`);
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
      this.log(`[error] Request handling error: ${err instanceof Error ? err.message : String(err)}`);
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

let activeRouter: HookRouter | null = null;

export function getActiveHookRouter(): HookRouter | null {
  return activeRouter;
}

export function setActiveHookRouter(router: HookRouter | null): void {
  activeRouter = router;
}

export function getOrCreateHookRouter(
  server?: PluginServerContext,
  options?: HookRouterOptions,
): HookRouter {
  if (!activeRouter) {
    activeRouter = new HookRouter(server, options);
  }
  return activeRouter;
}

export function getHookServiceStatus(): HookServiceStatusOutput {
  const router = getActiveHookRouter();
  const listening = router ? router.isListening() : false;
  const persisted = loadRouterConfig(router?.configPath);
  const configuredPort = router
    ? router.configuredPort
    : (persisted.port ?? Number(process.env.FORGE_HOOK_PORT ?? process.env.HOOK_PORT ?? 8099));
  const configuredHost = router
    ? router.configuredHost
    : (persisted.host ?? process.env.FORGE_HOOK_HOST ?? "127.0.0.1");
  const port = listening && router ? router.port : undefined;
  const host = listening && router ? router.host : undefined;
  const uptime = router ? router.getUptime() : 0;
  const queued = router ? router.getTotalQueued() : 0;

  return {
    ok: true,
    active: listening,
    state: listening ? "active" : "inactive",
    description: listening
      ? `Bundled hook router listening on port ${port} (${host}, uptime: ${uptime}s, queued: ${queued})`
      : "Bundled hook router is inactive",
    pid: process.pid,
    host,
    configuredHost,
    port,
    configuredPort,
    availableInterfaces: getAvailableNetworkInterfaces(),
  };
}

export async function configureHookService(input: {
  host?: string;
  port?: number;
  restart?: boolean;
  configPath?: string;
}): Promise<HookServiceConfigOutput> {
  try {
    let router = getActiveHookRouter();
    if (!router) {
      const persisted = loadRouterConfig(input.configPath);
      const configuredHost =
        input.host?.trim() || persisted.host || process.env.FORGE_HOOK_HOST || "127.0.0.1";
      const configuredPort =
        input.port || persisted.port || Number(process.env.FORGE_HOOK_PORT ?? process.env.HOOK_PORT ?? 8099);

      saveRouterConfig({ host: configuredHost, port: configuredPort }, input.configPath);

      appendHookLog(`[info] Saved hook router configuration: host=${configuredHost}, port=${configuredPort}`);
      return {
        ok: true,
        configuredHost,
        configuredPort,
        activeHost: configuredHost,
        activePort: configuredPort,
        restarted: false,
        message: `Hook router configuration saved (${configuredHost}:${configuredPort})`,
      };
    }

    const result = await router.configure(input);
    appendHookLog(
      `[info] Configured hook router: host=${result.configuredHost}, port=${result.configuredPort}, restarted=${result.restarted}`,
    );

    return {
      ok: true,
      configuredHost: result.configuredHost,
      configuredPort: result.configuredPort,
      activeHost: result.activeHost,
      activePort: result.activePort,
      restarted: result.restarted,
      message: result.restarted
        ? `Hook router reconfigured and restarted on ${result.configuredHost}:${result.configuredPort}`
        : `Hook router configuration saved (${result.configuredHost}:${result.configuredPort})`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appendHookLog(`[error] Failed to configure hook router: ${msg}`);
    const router = getActiveHookRouter();
    const persisted = loadRouterConfig(router?.configPath ?? input.configPath);
    const cfgHost = router?.configuredHost ?? input.host ?? persisted.host ?? "127.0.0.1";
    const cfgPort = router?.configuredPort ?? input.port ?? persisted.port ?? 8099;
    return {
      ok: false,
      configuredHost: cfgHost,
      configuredPort: cfgPort,
      activeHost: router?.isListening() ? router.host : cfgHost,
      activePort: router?.isListening() ? router.port : cfgPort,
      restarted: false,
      error: msg,
    };
  }
}

export async function executeHookServiceAction(
  action: "start" | "stop" | "restart" | "reload",
): Promise<HookServiceActionOutput> {
  try {
    let router = getActiveHookRouter();
    switch (action) {
      case "start": {
        if (!router) {
          router = new HookRouter();
          setActiveHookRouter(router);
        }
        await router.start();
        appendHookLog(`[info] Service action executed: start (port ${router.port})`);
        return {
          ok: true,
          action,
          message: `Bundled hook router started on port ${router.port}`,
        };
      }
      case "stop": {
        if (router) {
          await router.stop();
        }
        appendHookLog("[info] Service action executed: stop");
        return {
          ok: true,
          action,
          message: "Bundled hook router stopped successfully",
        };
      }
      case "restart": {
        if (!router) {
          router = new HookRouter();
          setActiveHookRouter(router);
        }
        await router.restart();
        appendHookLog(`[info] Service action executed: restart (port ${router.port})`);
        return {
          ok: true,
          action,
          message: `Bundled hook router restarted on port ${router.port}`,
        };
      }
      case "reload": {
        if (!router) {
          return {
            ok: true,
            action,
            message: "Bundled hook router is not running; nothing to reload",
          };
        }
        await router.reload();
        appendHookLog("[info] Service action executed: reload");
        return {
          ok: true,
          action,
          message: "Bundled hook router reloaded successfully",
        };
      }
      default: {
        return {
          ok: false,
          action,
          error: `Unknown action: ${String(action)}`,
        };
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appendHookLog(`[error] Service action ${action} failed: ${msg}`);
    return {
      ok: false,
      action,
      error: msg,
    };
  }
}

export function getHookLogTail(lines?: number): HookLogTailOutput {
  const count = Math.min(Math.max(lines ?? 50, 1), 200);
  return {
    ok: true,
    lines: getHookLogs(count),
  };
}

export function startHookRouter(
  server?: PluginServerContext,
  options?: HookRouterOptions,
): () => Promise<void> {
  const router = new HookRouter(server, options);
  setActiveHookRouter(router);
  void router.start();
  return async () => {
    await router.stop();
    if (getActiveHookRouter() === router) {
      setActiveHookRouter(null);
    }
  };
}

export function getFleetRosterInfo(): {
  enrolledRepos: string[];
  mutedRepos: string[];
  repoQueuedHooks: Record<string, number>;
} {
  const router = getActiveHookRouter();
  const home = process.env.HOME ?? os.homedir();
  const config = loadRouterConfig();
  const mutedRepos = router ? router.getMutedRepos() : (config.mutedRepos ?? []);

  const enrolledSet = new Set<string>(router ? router.getEnrolledRepos() : (config.enrolledRepos ?? []));

  const stateDir = process.env.HOOK_STATE_DIR ?? join(home, ".paseo", "forgejo-hook", "orchestrators");
  if (existsSync(stateDir)) {
    try {
      const files = readdirSync(stateDir);
      for (const f of files) {
        if (!f.endsWith(".json") || f === "frontdesk.json") continue;
        try {
          const raw = readFileSync(join(stateDir, f), "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.key === "string" && parsed.key.trim()) {
            enrolledSet.add(parsed.key.trim());
          }
        } catch {}
      }
    } catch {}
  }

  const repoQueuedHooks: Record<string, number> = {};
  if (router) {
    const overview = router.getQueuesOverview() as any;
    if (Array.isArray(overview?.queues)) {
      for (const q of overview.queues) {
        if (q.key && typeof q.depth === "number") {
          repoQueuedHooks[q.key] = q.depth;
        }
      }
    }
  } else {
    const queueDir = process.env.HOOK_QUEUE_DIR ?? join(home, ".config", "uppidi-fleet", "queues");
    if (existsSync(queueDir)) {
      try {
        const files = readdirSync(queueDir);
        for (const f of files) {
          if (!f.endsWith(".json")) continue;
          try {
            const raw = readFileSync(join(queueDir, f), "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const key = parsed[0]?.key || f.replace(/\.json$/, "");
              repoQueuedHooks[key] = parsed.length;
              enrolledSet.add(key);
            }
          } catch {}
        }
      } catch {}
    }
  }

  return {
    enrolledRepos: Array.from(enrolledSet),
    mutedRepos,
    repoQueuedHooks,
  };
}
