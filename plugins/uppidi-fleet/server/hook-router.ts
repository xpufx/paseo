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
  coalesceDisable?: boolean;
  watchdogIntervalMs?: number;
  watchdogBusyThreshold?: number;
  watchdogAlertCooldownMs?: number;
  boardSweepIntervalMs?: number;
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

export function repositoryFromPayload(body: any): any {
  return body?.repository ?? body?.run?.repository ?? {};
}

export function senderFromPayload(body: any): any {
  return body?.sender ?? body?.run?.sender ?? body?.run?.trigger_user ?? {};
}

export function keyFromPayload(body: any): string | null {
  const repo = body?.repository ?? body?.run?.repository;
  if (!repo) return null;
  return (
    normalizeRepoKey(repo.html_url) ||
    normalizeRepoKey(repo.clone_url) ||
    normalizeRepoKey(repo.ssh_url) ||
    (repo.full_name ? `forge.mrs.uppidi.com/${repo.full_name}` : null)
  );
}

export function issueNumberOf(body: any): number | null {
  return body?.issue?.number ?? body?.pull_request?.number ?? null;
}

export function labelNamesOf(body: any): string[] {
  const names: string[] = [];
  if (body?.label?.name) names.push(String(body.label.name));
  for (const l of body?.issue?.labels ?? body?.pull_request?.labels ?? []) {
    if (typeof l === "string") names.push(l);
    else if (l?.name) names.push(String(l.name));
  }
  return names;
}

export function isPingEvent(body: any): boolean {
  return labelNamesOf(body).some((n) => n.toLowerCase().startsWith("ping/"));
}

// Forgejo agents share an account, so sender.login cannot distinguish the
// orchestrator from workers. The standard envelope carries the short Paseo
// agent id, which can be matched to this repository's registered orchestrator.
const AGENT_ENVELOPE_ID_RE = /<sub>\s*🤖[\s\S]*?\(`([^`]+)`\)[\s\S]*?<\/sub>/i;

export function envelopeAgentId(body: any): string | null {
  const comment = body?.comment?.body ?? body?.review?.body;
  if (typeof comment !== "string") return null;
  return AGENT_ENVELOPE_ID_RE.exec(comment)?.[1] ?? null;
}

/**
 * Operator attention is strictly signaled by user attention labels. The
 * canonical scoped form is `attention/2-user`; legacy `attention/user` and
 * `attention:user` spellings are accepted case-insensitively.
 */
export const USER_ATTENTION_LABELS = new Set([
  "attention/2-user",
  "attention/user",
  "attention:user",
]);

export function isUserAttentionLabel(label: string): boolean {
  return USER_ATTENTION_LABELS.has((label ?? "").trim().toLowerCase());
}

export function isFrontDeskEvent(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  const label = body.label?.name ?? "";
  if (label === "attention/frontdesk" || isUserAttentionLabel(label)) return true;
  const comment = body.comment?.body ?? body.review?.body;
  if (typeof comment === "string" && /(?:^|\s)\/frontdesk\b/i.test(comment)) return true;
  return false;
}

const SLASH_BYPASS_RE = /(?:^|\s)\/(?:orchestrator|hold|rework|approve|verify|done|close|instruction|agent|sos|stop)\b/i;
const BYPASS_LABELS = new Set(["priority/0-sos", "flag/stop-work", "attention/frontdesk", "ping/req"]);
const SOS_STATE_LABELS = new Set(["priority/0-sos", "flag/stop-work"]);

export function isBypassEvent(event: string, body: any): boolean {
  if (!body || typeof body !== "object") return false;
  const label = body.label?.name ?? "";
  const lowerLabel = label.toLowerCase();
  if (
    lowerLabel.startsWith("attention/") ||
    isUserAttentionLabel(lowerLabel) ||
    BYPASS_LABELS.has(lowerLabel) ||
    lowerLabel.startsWith("ping/")
  ) {
    return true;
  }
  const comment = body.comment?.body ?? body.review?.body;
  if (typeof comment === "string" && SLASH_BYPASS_RE.test(comment)) return true;
  return false;
}

/**
 * A label transition can produce several webhook deliveries (e.g. an edit or
 * comment after the label was applied). SOS and stop-work must still bypass the
 * debounce, but only the first delivery for each resulting SOS state should
 * interrupt. Slash commands deliberately remain outside this guard.
 */
export function sosStateOf(event: string, body: any): string | null {
  if (event !== "issues") return null;
  const command = body?.comment?.body ?? body?.review?.body ?? "";
  if (typeof command === "string" && /^\s*\/hold\b/im.test(command)) return null;

  const action = String(body?.action ?? "").toLowerCase();
  const changed = String(body?.label?.name ?? "").toLowerCase();
  const subject = body?.issue ?? body?.pull_request ?? {};
  const labels = new Set(
    (subject?.labels ?? [])
      .map((label: any) => (typeof label === "string" ? label : label?.name))
      .filter(Boolean)
      .map((label: any) => String(label).toLowerCase())
      .filter((label: string) => SOS_STATE_LABELS.has(label)),
  );
  if (SOS_STATE_LABELS.has(changed)) {
    if (action === "unlabeled") labels.delete(changed);
    else if (action === "labeled") labels.add(changed);
  }
  return labels.size > 0 || SOS_STATE_LABELS.has(changed) ? [...labels].sort().join(",") : null;
}

export function eventKind(event: string, body: any): string {
  const action = String(body?.action ?? "");
  if (event === "issues" && ["labeled", "unlabeled", "edited", "label_updated"].includes(action)) {
    const names = labelNamesOf(body).map((n) => n.toLowerCase());
    if (names.some((n) => n.startsWith("state/") || n.startsWith("priority/") || n.startsWith("flag/"))) {
      return "state-transition";
    }
  }
  return `${event}:${action || "event"}`;
}

export function eventHash(repoKey: string, issue: number | null, kind: string, actor: string, bodyText?: string): string {
  return `${repoKey}#${issue}|${kind}|${actor}|${bodyText ?? ""}`;
}

export const FORGEJO_DIGEST_PREFIX = "🔔 Forgejo digest";

export interface CoalesceEvent {
  hash: string;
  kind: string;
  msg: string;
  commentBody?: string;
  title?: string;
  stateLabels?: string[];
  url?: string;
}

export interface CoalesceEntry {
  repoKey: string;
  issue: number | null;
  events: CoalesceEvent[];
  firstAt: number;
  timer: NodeJS.Timeout | null;
}

export type CoalesceResult =
  | "direct"
  | "disabled"
  | "bypass"
  | "buffered"
  | "capped"
  | "window-capped"
  | "deduped"
  | "sos-deduped"
  | "suppressed";

export interface CoalesceInput {
  repoKey: string;
  issue: number | null;
  kind: string;
  actor: string;
  commentBody?: string;
  title?: string;
  stateLabels?: string[];
  url?: string;
  msg: string;
  bypass: boolean;
  sosState?: string | null;
}

function latestCommentBody(buffered: CoalesceEvent[]): string {
  for (let i = buffered.length - 1; i >= 0; i--) {
    if (buffered[i].commentBody) return buffered[i].commentBody as string;
  }
  return "";
}

export function formatDigest(repoKey: string, issue: number | null, buffered: CoalesceEvent[]): string {
  const counts: Record<string, number> = {};
  for (const e of buffered) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  const parts = Object.entries(counts).map(([k, n]) => (n > 1 ? `${k} x${n}` : k));
  const last = buffered[buffered.length - 1];
  const line = `#${issue} ${last?.title ?? ""} [${(last?.stateLabels ?? []).join(", ")}]`.trim();
  const head = `${FORGEJO_DIGEST_PREFIX} ${repoKey}${line} (${buffered.length} events: ${parts.join(", ")})`;
  const bodyText = latestCommentBody(buffered);
  const withBody = bodyText ? `${head}\nLatest comment: ${bodyText.slice(0, 2000)}` : head;
  return last?.url && !withBody.includes(last.url) ? `${withBody} ${last.url}` : withBody;
}

export function bufferKey(repoKey: string, issue: number | null): string {
  return `${repoKey}#${issue ?? "?"}`;
}

export interface WatchdogPermission {
  id?: string;
  requestId?: string;
  title?: string;
  tool?: string;
  name?: string;
}

export interface WatchdogAgent {
  id: string;
  title?: string | null;
  name?: string | null;
  status?: string | null;
  lastError?: string | null;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  pendingPermissions?: WatchdogPermission[] | null;
  archivedAt?: string | null;
}

export interface WatchdogAnomaly {
  type: "AGENT_PERMISSION_REQUIRED" | "AGENT_ATTENTION_REQUIRED" | "AGENT_ERROR" | "ORCHESTRATOR_MISSING" | "QUEUE_WEDGED";
  agentId?: string;
  key?: string;
  title?: string | null;
  reason?: string | null;
  error?: string;
  permissions?: WatchdogPermission[];
  attempts?: number;
  queueDepth?: number;
}

export interface WatchdogAuditOptions {
  now?: number;
  agentMap?: Map<string, WatchdogAgent> | null;
  orchestratorRecords?: OrchestratorRecord[];
  frontDeskId?: string | null;
  deliver?: (targetAgentId: string, msg: string, options?: { noWait?: boolean; steer?: boolean }) => Promise<boolean>;
  reloadAgent?: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export interface WatchdogAuditResult {
  ok: boolean;
  timestamp: number;
  audited: { orchestrators: number; agents: number; queues: number };
  anomalies: WatchdogAnomaly[];
}

export interface PruneResult {
  ok: boolean;
  prunedCount: number;
  pruned: Array<{ key: string; agentId: string; reason: string }>;
  error?: string;
}

export interface HandoffStatus {
  agentId: string | null;
  updatedAt: string | null;
  handoffPath: string;
  summary: string;
}

export interface HandoffResult extends HandoffStatus {
  orchestratorsNotified: number;
}

export interface BoardCandidate {
  number: number;
  title: string;
  labels: string[];
  category: string;
  is_dispatchable: boolean;
  reason: string;
}

export interface BoardCheckResult {
  repo: string;
  ok: boolean;
  candidates: BoardCandidate[];
  error?: string;
}

export interface BoardSweepResult {
  ok: boolean;
  swept: number;
  actionable: Array<{ repo: string; count: number; dispatchable: number }>;
  notified: number;
  error?: string;
}

/** Append a bare URL so chat linkifiers can pick it up. */
function withUrl(text: string, url: unknown): string {
  const value = typeof url === "string" ? url.trim() : "";
  if (!value || text.includes(value)) return text;
  return `${text} ${value}`;
}

export function httpError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export function issueCommentUrl(issue: any, comment: any): string {
  const issueUrl = typeof issue?.html_url === "string" ? issue.html_url.trim() : "";
  return (
    (typeof comment?.html_url === "string" && comment.html_url.trim()) ||
    (issueUrl && comment?.id != null ? `${issueUrl}#issuecomment-${comment.id}` : issueUrl)
  );
}

export function forgejoEnvelope(event: string, body: any): Record<string, unknown> {
  const repository = repositoryFromPayload(body);
  const sender = senderFromPayload(body);
  const name = repository.full_name ?? repository.name ?? "unknown repo";
  const envelope: any = {
    forgejo: {
      version: 1,
      event: String(event ?? "unknown"),
      action: String(body?.action ?? ""),
      repo: name,
      repoUrl: typeof repository.html_url === "string" ? repository.html_url : "",
      sender: sender.login ?? sender.username ?? "unknown",
      subject: { kind: "unknown" },
    },
  };

  if (event === "issues") {
    const issue = body?.issue ?? {};
    envelope.forgejo.subject = {
      kind: "issue",
      number: issue.number ?? null,
      title: issue.title ?? "",
      url: typeof issue.html_url === "string" ? issue.html_url : "",
    };
  } else if (event === "issue_comment") {
    const issue = body?.issue ?? {};
    const comment = body?.comment ?? {};
    envelope.forgejo.subject = {
      kind: "issue_comment",
      number: issue.number ?? null,
      title: issue.title ?? "",
      url: issueCommentUrl(issue, comment),
      commentId: comment.id ?? null,
    };
  } else if (event === "pull_request") {
    const pr = body?.pull_request ?? {};
    envelope.forgejo.subject = {
      kind: "pull_request",
      number: pr.number ?? null,
      title: pr.title ?? "",
      url: typeof pr.html_url === "string" ? pr.html_url : "",
    };
  } else if (event === "push") {
    envelope.forgejo.subject = {
      kind: "push",
      ref: body?.ref ?? "",
      commits: Array.isArray(body?.commits) ? body.commits.length : 0,
    };
  }

  return envelope;
}

export function summarize(event: string, body: any): string {
  const repository = repositoryFromPayload(body);
  const actor = senderFromPayload(body);
  const repo = repository?.full_name ?? "unknown repo";
  const sender = actor?.login ?? actor?.username ?? "unknown";
  const isPing = isPingEvent(body);
  const pingLabel = labelNamesOf(body).find((n) => n.toLowerCase().startsWith("ping/"));
  const head = isPing ? `🔔 Operator Ping [${pingLabel ?? "ping"}]` : "🔔 Forgejo webhook incoming";
  if (event === "ping") return `${head} (ping test) ${repo} (by ${sender})`;
  if (event === "issues") {
    const issue = body?.issue ?? {};
    const action = body?.action ?? "";
    const prefix = isPing ? head : `${head} [issues:${action}]`;
    return withUrl(
      `${prefix} ${repo}#${issue.number ?? "?"} ${issue.title ?? ""} (by ${sender})`.trim(),
      issue.html_url,
    );
  }
  if (event === "issue_comment") {
    const issue = body?.issue ?? {};
    const comment = body?.comment ?? {};
    const action = body?.action ?? "";
    const commentUrl = issueCommentUrl(issue, comment);
    return withUrl(
      `${head} [issue_comment:${action}] ${repo}#${issue.number ?? "?"} ${issue.title ?? ""} (by ${sender})`.trim(),
      commentUrl,
    );
  }
  if (event === "push") {
    const commits = (body?.commits ?? []).length;
    return withUrl(
      `${head} [push] ${repo} ${body?.ref ?? ""} ${commits} commit(s) by ${sender}`,
      repository?.html_url,
    );
  }
  if (event === "pull_request") {
    const pr = body?.pull_request ?? {};
    return withUrl(
      `${head} [pull_request:${body?.action ?? ""}] ${repo}#${pr.number ?? "?"} ${pr.title ?? ""} (by ${sender})`,
      pr.html_url,
    );
  }
  return withUrl(`${head} [${event}] ${repo} (by ${sender})`, repository?.html_url);
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

  public readonly coalesceBuffers = new Map<string, CoalesceEntry>();
  public readonly sosStates = new Map<string, { state: string; transition: number }>();
  public readonly watchdogAlerts = new Map<string, number>();
  public readonly coalesceDisable: boolean;
  public readonly debounceMs: number;
  public readonly coalesceMaxEvents: number;
  public readonly coalesceWindowMaxMs: number;
  public readonly watchdogIntervalMs: number;
  public readonly watchdogBusyThreshold: number;
  public readonly watchdogAlertCooldownMs: number;
  public readonly boardSweepIntervalMs: number;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private boardSweepTimer: NodeJS.Timeout | null = null;

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
    const isTestMode = process.env.NODE_ENV === "test" && !process.env.FORGE_HOOK_CONFIG && !options?.configPath;

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

    this.coalesceDisable =
      options?.coalesceDisable ??
      (isTestMode ? true : (process.env.HOOK_COALESCE_DISABLE ?? "") === "1");
    this.debounceMs = options?.debounceMs ?? Number(process.env.HOOK_DEBOUNCE_MS ?? 7000);
    this.coalesceMaxEvents = Number(process.env.HOOK_COALESCE_MAX ?? 20);
    this.coalesceWindowMaxMs = Number(process.env.HOOK_COALESCE_WINDOW_MAX_MS ?? 30000);
    this.watchdogIntervalMs =
      options?.watchdogIntervalMs ?? (isTestMode ? 0 : Number(process.env.WATCHDOG_INTERVAL_MS ?? 60000));
    this.watchdogBusyThreshold =
      options?.watchdogBusyThreshold ?? Number(process.env.WATCHDOG_BUSY_THRESHOLD ?? 10);
    this.watchdogAlertCooldownMs =
      options?.watchdogAlertCooldownMs ?? Number(process.env.WATCHDOG_ALERT_COOLDOWN_MS ?? 15 * 60 * 1000);
    this.boardSweepIntervalMs =
      options?.boardSweepIntervalMs ?? (isTestMode ? 0 : Number(process.env.BOARD_SWEEP_INTERVAL_MS ?? 15 * 60 * 1000));

    mkdirSync(this.queueDir, { recursive: true });
    mkdirSync(this.stateDir, { recursive: true });

    this.loadPersistedQueues();
    this.bindLifecycleEvents();
  }

  // -------------------------------------------------------------------------
  // Event coalescing & digest
  // -------------------------------------------------------------------------

  public flushCoalesced(bkey: string): void {
    const entry = this.coalesceBuffers.get(bkey);
    if (!entry || entry.events.length === 0) {
      this.coalesceBuffers.delete(bkey);
      return;
    }
    this.coalesceBuffers.delete(bkey);
    if (entry.timer) clearTimeout(entry.timer);
    const { repoKey, issue, events } = entry;
    if (events.length === 1) {
      this.handleMessage(repoKey, events[0].msg);
      return;
    }
    this.handleMessage(repoKey, formatDigest(repoKey, issue, events));
  }

  public coalesceOrSend(input: CoalesceInput): CoalesceResult {
    const {
      repoKey,
      issue,
      kind,
      actor,
      commentBody,
      title,
      stateLabels,
      url,
      msg,
      bypass,
      sosState = null,
    } = input;

    let directOpts: { id: string } | undefined;
    if (bypass && sosState !== null && issue != null) {
      const key = bufferKey(repoKey, issue);
      const previous = this.sosStates.get(key);
      if (previous?.state === sosState) return "sos-deduped";
      const transition = (previous?.transition ?? 0) + 1;
      this.sosStates.set(key, { state: sosState, transition });
      directOpts = { id: stableId(repoKey, `${msg}\nSOS transition ${transition}`) };
    }

    if (this.coalesceDisable || bypass || issue == null) {
      if (!this.coalesceDisable && bypass && issue != null) {
        const bkey = bufferKey(repoKey, issue);
        const entry = this.coalesceBuffers.get(bkey);
        this.handleMessage(repoKey, msg, directOpts?.id);
        if (entry && entry.events.length > 0) this.flushCoalesced(bkey);
        return "bypass";
      }
      this.handleMessage(repoKey, msg, directOpts?.id);
      return this.coalesceDisable ? "disabled" : "direct";
    }

    const bkey = bufferKey(repoKey, issue);
    let entry = this.coalesceBuffers.get(bkey);
    if (!entry) {
      entry = { repoKey, issue, events: [], firstAt: Date.now(), timer: null };
      this.coalesceBuffers.set(bkey, entry);
    }
    const hash = eventHash(repoKey, issue, kind, actor, commentBody ?? kind);
    const last = entry.events[entry.events.length - 1];
    if (last && last.hash === hash) return "deduped";
    entry.events.push({ hash, kind, msg, commentBody, title, stateLabels, url });
    if (entry.events.length >= this.coalesceMaxEvents) {
      this.flushCoalesced(bkey);
      return "capped";
    }
    if (Date.now() - entry.firstAt >= this.coalesceWindowMaxMs) {
      this.flushCoalesced(bkey);
      return "window-capped";
    }
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.flushCoalesced(bkey), this.debounceMs);
    entry.timer.unref?.();
    return "buffered";
  }

  private handleMessage(key: string, msg: string, stableIdOverride?: string): QueueEntry {
    return this.enqueue(key, msg, false, stableIdOverride);
  }

  public async ingestWebhook(event: string, body: any): Promise<{
    key: string;
    result: CoalesceResult;
    frontDesk: boolean;
    bypass: boolean;
  }> {
    const repoKey = keyFromPayload(body);
    if (!repoKey) {
      throw new Error("Could not derive repository key from payload");
    }
    const ev = String(event ?? "unknown");
    const issue = issueNumberOf(body);
    const actor = senderFromPayload(body)?.login ?? "unknown";
    const kind = eventKind(ev, body);
    const isFd = isFrontDeskEvent(body);
    const bypass = isFd || isBypassEvent(ev, body);
    const sosState = sosStateOf(ev, body);
    const commentBody = typeof body?.comment?.body === "string" ? body.comment.body : "";
    const subj = body?.issue ?? body?.pull_request ?? {};
    const stateLabels = (subj?.labels ?? [])
      .map((l: any) => (typeof l === "string" ? l : l?.name))
      .filter(Boolean);
    const msg = formatWebhookMessage(ev, body);

    const orch = isFd ? null : this.readOrchestrator(repoKey);
    if (!isFd && !bypass && ev === "issue_comment") {
      const stampedId = envelopeAgentId(body);
      if (orch && stampedId && stampedId === orch.agentId.slice(0, 7)) {
        this.log(`[info] Suppressing routine self-authored orchestrator comment for ${repoKey}#${issue ?? "?"}`);
        return { key: repoKey, result: "suppressed", frontDesk: false, bypass: false };
      }
    }

    if (isFd) {
      this.enqueue("frontdesk", msg, bypass);
      return { key: "frontdesk", result: bypass ? "bypass" : "direct", frontDesk: true, bypass };
    }

    const result = this.coalesceOrSend({
      repoKey,
      issue,
      kind,
      actor,
      commentBody: commentBody || kind,
      title: subj?.title ?? "",
      stateLabels,
      url: subj?.html_url ?? "",
      msg,
      bypass,
      sosState,
    });
    return { key: repoKey, result, frontDesk: false, bypass };
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

  public listOrchestratorRecords(): OrchestratorRecord[] {
    const records: OrchestratorRecord[] = [];
    try {
      if (existsSync(this.stateDir)) {
        const files = readdirSync(this.stateDir);
        for (const file of files) {
          if (!file.endsWith(".json") || file === "frontdesk.json") continue;
          try {
            const raw = readFileSync(join(this.stateDir, file), "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.key === "string" && typeof parsed.agentId === "string" && parsed.agentId) {
              records.push({
                key: parsed.key,
                agentId: parsed.agentId,
                updatedAt: parsed.updatedAt ?? null,
                by: parsed.by ?? null,
              });
            }
          } catch {}
        }
      }
    } catch {}
    return records.sort((a, b) => a.key.localeCompare(b.key));
  }

  public deleteOrchestrator(repoOrKey: string): { ok: boolean; key?: string; error?: string; path?: string } {
    const key = normalizeRepoKey(repoOrKey) ?? (typeof repoOrKey === "string" && repoOrKey.trim() ? repoOrKey.trim() : null);
    if (!key) return { ok: false, error: "invalid repo key" };
    const target = join(this.stateDir, `${sanitizeKey(key)}.json`);
    if (existsSync(target)) {
      try {
        unlinkSync(target);
        return { ok: true, key, path: target };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), key };
      }
    }
    return { ok: false, error: "not found", key };
  }

  public async fetchAgentMap(): Promise<Map<string, WatchdogAgent> | null> {
    const map = new Map<string, WatchdogAgent>();
    const paseo = this.getPaseo();
    if (paseo?.agents) {
      try {
        const list = await (paseo.agents as any).list();
        const entries = list?.entries ?? list;
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            const a: any = entry?.agent ?? entry;
            if (a?.id) map.set(a.id, a);
          }
          if (map.size > 0) return map;
        }
      } catch {
        // fall through to CLI
      }
    }
    try {
      const { stdout } = await execFileAsync("paseo", ["ls", "--json"], { timeout: 5000 });
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.id) map.set(item.id, item);
        }
      }
      return map;
    } catch {
      return null;
    }
  }

  public canWatchdogAlert(alertKey: string, now = Date.now()): boolean {
    const last = this.watchdogAlerts.get(alertKey) ?? 0;
    return now - last >= this.watchdogAlertCooldownMs;
  }

  public reloadAgent(id: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      execFile("paseo", ["agent", "reload", id], { timeout: 10000 }, (err) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true });
      });
    });
  }

  /**
   * Zero-token fleet audit: intercepts stuck permission requests, attempts
   * auto-recovery of ACP turn locks, and detects missing/stalled orchestrators
   * and wedged queues. Alerts are throttled per key by the watchdog cooldown.
   */
  public async runWatchdogAudit(opts: WatchdogAuditOptions = {}): Promise<WatchdogAuditResult> {
    const now = opts.now ?? Date.now();
    const reloadFn = opts.reloadAgent ?? ((id: string) => this.reloadAgent(id));
    const deliverFn = opts.deliver ?? ((id: string, msg: string, o?: any) => this.deliverMessage(id, msg, o));
    const anomalies: WatchdogAnomaly[] = [];

    let agentMap = opts.agentMap ?? null;
    if (!agentMap) {
      agentMap = await this.fetchAgentMap();
    }

    const frontDeskId = opts.frontDeskId ?? this.readFrontDesk()?.agentId ?? null;
    const orchRecords = opts.orchestratorRecords ?? this.listOrchestratorRecords();

    if (agentMap) {
      for (const agent of agentMap.values()) {
        if (agent.pendingPermissions && agent.pendingPermissions.length > 0) {
          const perm = agent.pendingPermissions[0] || {};
          const reqId = perm.id || perm.requestId;
          const action = perm.title || perm.tool || perm.name || "tool permission";
          anomalies.push({
            type: "AGENT_PERMISSION_REQUIRED",
            agentId: agent.id,
            title: agent.title || agent.name,
            permissions: agent.pendingPermissions,
          });
          const alertKey = `permission:${agent.id}:${reqId || "pending"}`;
          if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
            this.watchdogAlerts.set(alertKey, now);
            const cmd = reqId ? `paseo permit allow ${agent.id} ${reqId}` : `paseo permit allow ${agent.id}`;
            const alert = `[Fleet Watchdog] Agent ${agent.title || agent.id.slice(0, 7)} (${agent.id.slice(0, 7)}) requires permission: ${action}. Front Desk adjudication command: ${cmd}`;
            void deliverFn(frontDeskId, alert, { noWait: true, steer: true });
          }
        } else if (
          agent.requiresAttention === true &&
          agent.attentionReason !== "error" &&
          agent.attentionReason !== "finished" &&
          (!agent.pendingPermissions || agent.pendingPermissions.length === 0)
        ) {
          anomalies.push({
            type: "AGENT_ATTENTION_REQUIRED",
            agentId: agent.id,
            title: agent.title || agent.name,
            reason: agent.attentionReason,
          });
          const alertKey = `attention:${agent.id}:${agent.attentionReason || "stall"}`;
          if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
            this.watchdogAlerts.set(alertKey, now);
            const alert = `[Fleet Watchdog] Agent ${agent.title || agent.id.slice(0, 7)} (${agent.id.slice(0, 7)}) requires attention (${agent.attentionReason || "stalled"}). Operator or Front Desk triage required.`;
            void deliverFn(frontDeskId, alert, { noWait: true, steer: true });
          }
        }
      }

      for (const record of orchRecords) {
        const { key, agentId } = record;
        if (!agentId) continue;
        const agent = agentMap.get(agentId);
        if (!agent) {
          anomalies.push({ type: "ORCHESTRATOR_MISSING", key, agentId });
          const alertKey = `missing:${agentId}`;
          if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
            this.watchdogAlerts.set(alertKey, now);
            const alert = `[Fleet Watchdog] Registered orchestrator for ${key} (${agentId.slice(0, 7)}) was not found on daemon.`;
            void deliverFn(frontDeskId, alert, { noWait: true, steer: true });
          }
          continue;
        }

        if (agent.status === "error" || (agent.requiresAttention && agent.attentionReason === "error")) {
          const rawErr = agent.lastError ?? "";
          const errMsg = rawErr || "unknown error";
          anomalies.push({ type: "AGENT_ERROR", key, agentId, error: errMsg });

          const isUnrecoverable = /usage limit|quota|upgrade to pro|rate limit/i.test(errMsg);
          const isTurnLock =
            /foreground turn is already active/i.test(errMsg) ||
            (!rawErr && agent.requiresAttention && agent.attentionReason === "error");

          if (!isUnrecoverable) {
            this.log(`[info] watchdog: attempting auto-recovery reload for ${agentId.slice(0, 7)} (${key})`);
            const reloadRes = await reloadFn(agentId);
            if (reloadRes.ok) {
              this.log(`[info] watchdog: successfully reloaded ${agentId.slice(0, 7)}`);
              const alertKey = `recovered:${agentId}`;
              if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
                this.watchdogAlerts.set(alertKey, now);
                const reasonDesc = isTurnLock ? "clearing foreground turn lock" : "reloading agent";
                const alert = `[Fleet Watchdog] Auto-recovered orchestrator for ${key} (${agentId.slice(0, 7)}) by ${reasonDesc}.`;
                void deliverFn(frontDeskId, alert, { noWait: true, steer: true });
              }
              continue;
            }
          }

          const alertKey = `error:${agentId}`;
          if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
            this.watchdogAlerts.set(alertKey, now);
            const alert = `[Fleet Watchdog] Orchestrator for ${key} (${agentId.slice(0, 7)}) is in status error: "${errMsg}". Operator attention may be required.`;
            void deliverFn(frontDeskId, alert, { noWait: true, steer: true });
          }
        }
      }
    }

    for (const [key, attempts] of this.busyAttempts.entries()) {
      if (attempts >= this.watchdogBusyThreshold) {
        const q = this.queues.get(key) ?? [];
        if (q.length > 0) {
          anomalies.push({ type: "QUEUE_WEDGED", key, attempts, queueDepth: q.length });
          const orchId = orchRecords.find((r) => r.key === key)?.agentId;
          let reloaded = false;
          if (orchId && reloadFn) {
            this.log(`[info] watchdog: attempting auto-recovery reload for wedged orchestrator ${orchId.slice(0, 7)} (${key})`);
            const reloadRes = await reloadFn(orchId);
            if (reloadRes.ok) {
              this.busyAttempts.delete(key);
              this.busyQueues.delete(key);
              const timer = this.backoffTimers.get(key);
              if (timer) {
                clearTimeout(timer);
                this.backoffTimers.delete(key);
              }
              reloaded = true;
              void this.drain(key);
            }
          }

          const alertKey = `queue_wedged:${key}`;
          if (frontDeskId && this.canWatchdogAlert(alertKey, now)) {
            this.watchdogAlerts.set(alertKey, now);
            const alert = reloaded
              ? `[Fleet Watchdog] Auto-recovered wedged queue for ${key} (${q.length} pending, ${attempts} failed attempts) by reloading orchestrator ${orchId?.slice(0, 7)}.`
              : `[Fleet Watchdog] Queue for ${key} has ${q.length} pending message(s) and has failed delivery ${attempts} times.`;
            void deliverFn(frontDeskId, alert, { noWait: true, steer: true });
          }
        }
      }
    }

    return {
      ok: true,
      timestamp: now,
      audited: {
        orchestrators: orchRecords.length,
        agents: agentMap ? agentMap.size : 0,
        queues: this.busyAttempts.size,
      },
      anomalies,
    };
  }

  public async pruneOrchestrators(opts: {
    agentMap?: Map<string, WatchdogAgent> | null;
    orchestratorRecords?: OrchestratorRecord[];
  } = {}): Promise<PruneResult> {
    let agentMap = opts.agentMap ?? null;
    if (!agentMap) {
      agentMap = await this.fetchAgentMap();
    }
    if (!agentMap) {
      return { ok: false, error: "daemon unreachable", prunedCount: 0, pruned: [] };
    }

    const orchRecords = opts.orchestratorRecords ?? this.listOrchestratorRecords();
    const pruned: Array<{ key: string; agentId: string; reason: string }> = [];
    for (const record of orchRecords) {
      const { key, agentId } = record;
      if (!agentId || !agentMap.has(agentId)) {
        const res = this.deleteOrchestrator(key);
        if (res.ok) {
          pruned.push({ key, agentId, reason: "agent not found on daemon" });
        }
      }
    }
    return { ok: true, prunedCount: pruned.length, pruned };
  }

  // -------------------------------------------------------------------------
  // Front Desk context handoff
  // -------------------------------------------------------------------------

  public handoffPath(): string {
    return join(dirname(this.stateDir), "latest-handoff.md");
  }

  public readHandoff(): string | null {
    try {
      const text = readFileSync(this.handoffPath(), "utf8");
      return text || null;
    } catch {
      return null;
    }
  }

  public writeHandoff(text: string): string {
    const target = this.handoffPath();
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, String(text ?? ""), "utf8");
    renameSync(tmp, target);
    return target;
  }

  public handoffSummary(text: string | null, maxChars = 500): string {
    if (!text) return "";
    const flat = String(text).replace(/\s+/g, " ").trim();
    return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
  }

  public frontDeskHandoffStatus(): HandoffStatus {
    const current = this.readFrontDesk();
    return {
      agentId: current?.agentId ?? null,
      updatedAt: current?.updatedAt ?? null,
      handoffPath: this.handoffPath(),
      summary: this.handoffSummary(this.readHandoff()),
    };
  }

  public async doFrontDeskHandoff(input: {
    agentId?: string | null;
    handoffText?: string | null;
    handoffFile?: string | null;
  }): Promise<HandoffResult> {
    const id = String(input.agentId ?? "").trim();
    const text = typeof input.handoffText === "string" && input.handoffText.trim() ? input.handoffText : null;
    let snapshot: string | null = text;
    if (!snapshot && typeof input.handoffFile === "string" && input.handoffFile.trim()) {
      try {
        snapshot = readFileSync(input.handoffFile.trim(), "utf8");
      } catch {
        throw httpError(400, `could not read handoffFile: ${input.handoffFile.trim()}`);
      }
      if (!snapshot || !snapshot.trim()) throw httpError(400, "handoffFile is empty");
    }
    if (snapshot) this.writeHandoff(snapshot);
    else snapshot = this.readHandoff();

    if (!id) {
      if (!text && !input.handoffFile?.trim?.()) throw httpError(400, "handoffText or agentId is required");
      return {
        agentId: null,
        updatedAt: new Date().toISOString(),
        handoffPath: this.handoffPath(),
        summary: this.handoffSummary(snapshot),
        orchestratorsNotified: 0,
      };
    }
    if (!snapshot || !String(snapshot).trim()) throw httpError(400, "no handoff snapshot available");

    const previous = this.readFrontDesk()?.agentId ?? null;
    const paseo = this.getPaseo();
    if (paseo?.agents?.ref) {
      try {
        const ref = paseo.agents.ref(id);
        const current = ref.current?.();
        if (!current) {
          const refreshed = await ref.refresh?.().catch(() => null);
          const agent = refreshed?.agent;
          if (!agent?.id) throw httpError(404, `agent not found: ${id}`);
        }
      } catch (err) {
        if ((err as any)?.status) throw err;
      }
    }

    await this.updateAgentMetadata(id, "Front Desk", { role: "front-desk" });
    if (previous && previous !== id) {
      await this.updateAgentMetadata(previous, "Front Desk (retired)", { role: "retired-front-desk" });
    }

    const updatedAt = new Date().toISOString();
    this.writeFrontDesk(id, "frontdesk-handoff");
    void this.drain("frontdesk");

    const onboarding =
      `You are now the Front Desk agent. Read the active handoff snapshot at ${this.handoffPath()}. ` +
      `Handoff snapshot:\n${String(snapshot).slice(0, 4000)}`;
    await this.deliverMessage(id, onboarding, { noWait: true, steer: true });

    const orchestrators = this.listOrchestratorAgentIds();
    const notice = `Front Desk handover: ${id} is now Front Desk (handoff at ${this.handoffPath()}). Route operator escalations to it via 'paseo send --no-wait ${id} <msg>'.`;
    let notified = 0;
    for (const orchId of orchestrators) {
      if (orchId !== id) {
        const ok = await this.deliverMessage(orchId, notice, { noWait: true, steer: true });
        if (ok) notified++;
      }
    }

    this.log(`[info] front desk handoff -> ${id.slice(0, 7)}, notified ${notified} orchestrator(s)`);
    return {
      agentId: id,
      updatedAt,
      handoffPath: this.handoffPath(),
      summary: this.handoffSummary(snapshot),
      orchestratorsNotified: notified,
    };
  }

  // -------------------------------------------------------------------------
  // Deterministic board sweep
  // -------------------------------------------------------------------------

  public async runBoardCheck(repo: string, hostname = "forge.mrs.uppidi.com"): Promise<BoardCheckResult> {
    const script = process.env.FORGEJO_ISSUES_CHECK ?? join(os.homedir(), "bin", "forgejo-issues-check");
    // Enrolled keys may be `owner/repo` or the forge-qualified `host/owner/repo`;
    // the checker's `-R` argument always wants the trailing `owner/repo`.
    const parts = String(repo ?? "").split("/").filter(Boolean);
    const ownerRepo = parts.length > 2 ? parts.slice(-2).join("/") : parts.join("/");
    try {
      const { stdout } = await execFileAsync(script, ["--hostname", hostname, "-R", ownerRepo, "--json"], {
        timeout: 30000,
        maxBuffer: 5 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout || "{}");
      const candidates: BoardCandidate[] = Array.isArray(parsed?.ranked_candidates)
        ? parsed.ranked_candidates
        : [];
      return { repo, ok: true, candidates };
    } catch (err: any) {
      // The checker exits 1 whenever candidates exist; stdout still carries the report.
      if (err?.stdout) {
        try {
          const parsed = JSON.parse(err.stdout);
          const candidates: BoardCandidate[] = Array.isArray(parsed?.ranked_candidates)
            ? parsed.ranked_candidates
            : [];
          return { repo, ok: true, candidates };
        } catch {}
      }
      return { repo, ok: false, candidates: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async runBoardSweep(repos?: string[]): Promise<BoardSweepResult> {
    const targets = Array.from(
      new Set((repos ?? this.getEnrolledRepos()).filter((k) => k && k !== "frontdesk")),
    );
    const actionable: Array<{ repo: string; count: number; dispatchable: number }> = [];
    for (const repo of targets) {
      const res = await this.runBoardCheck(repo);
      if (!res.ok || res.candidates.length === 0) continue;
      const dispatchable = res.candidates.filter((c) => c.is_dispatchable).length;
      actionable.push({ repo, count: res.candidates.length, dispatchable });
    }

    let notified = 0;
    const frontDeskId = this.readFrontDesk()?.agentId ?? null;
    if (actionable.length > 0 && frontDeskId) {
      const lines = actionable.map(
        (a) => `- ${a.repo}: ${a.count} actionable (${a.dispatchable} dispatchable)`,
      );
      const msg = `[Fleet Board Sweep] ${actionable.length} repo(s) with actionable tickets:\n${lines.join("\n")}`;
      const ok = await this.deliverMessage(frontDeskId, msg, { noWait: true, steer: true });
      if (ok) notified = 1;
    }
    this.log(`[info] Board sweep complete: ${targets.length} repo(s) swept, ${actionable.length} actionable`);
    return { ok: true, swept: targets.length, actionable, notified };
  }

  public startBackgroundLoops(): void {
    if (this.watchdogIntervalMs > 0 && !this.watchdogTimer) {
      this.watchdogTimer = setInterval(() => {
        void this.runWatchdogAudit().catch(() => {});
      }, this.watchdogIntervalMs);
      this.watchdogTimer.unref?.();
    }
    if (this.boardSweepIntervalMs > 0 && !this.boardSweepTimer) {
      this.boardSweepTimer = setInterval(() => {
        void this.runBoardSweep().catch(() => {});
      }, this.boardSweepIntervalMs);
      this.boardSweepTimer.unref?.();
    }
  }

  public stopBackgroundLoops(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.boardSweepTimer) {
      clearInterval(this.boardSweepTimer);
      this.boardSweepTimer = null;
    }
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

  public enqueue(key: string, msg: string, isSos = false, stableIdOverride?: string): QueueEntry {
    const list = this.queues.get(key) ?? [];
    const id = stableIdOverride ?? stableId(key, msg);

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
      this.startBackgroundLoops();

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
        this.startBackgroundLoops();
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    this.isClosed = true;
    this.stopBackgroundLoops();

    for (const timer of this.backoffTimers.values()) {
      clearTimeout(timer);
    }
    this.backoffTimers.clear();

    for (const entry of this.coalesceBuffers.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.coalesceBuffers.clear();

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

      if (req.method === "GET" && (pathname === "/frontdesk-handoff" || pathname === "/handoff")) {
        this.sendJson(res, 200, this.frontDeskHandoffStatus());
        return;
      }

      if (req.method === "POST" && (pathname === "/frontdesk-handoff" || pathname === "/handoff")) {
        const body = await this.readJsonBody(req);
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          this.sendJson(res, 400, { ok: false, error: "body must be a JSON object" });
          return;
        }
        try {
          const out = await this.doFrontDeskHandoff({
            agentId: body.agentId,
            handoffText: body.handoffText,
            handoffFile: body.handoffFile,
          });
          this.sendJson(res, 200, out);
        } catch (err: any) {
          this.sendJson(res, Number(err?.status) || 500, { ok: false, error: err?.message ?? String(err) });
        }
        return;
      }

      if (req.method === "POST" && pathname === "/orchestrators/prune") {
        try {
          const result = await this.pruneOrchestrators();
          this.sendJson(res, 200, result);
        } catch (err: any) {
          this.sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
        }
        return;
      }

      if (req.method === "POST" && pathname === "/board-sweep") {
        try {
          const body = await this.readJsonBody(req).catch(() => ({}));
          const repos = Array.isArray(body?.repos)
            ? body.repos.filter((r: unknown) => typeof r === "string")
            : undefined;
          const result = await this.runBoardSweep(repos);
          this.sendJson(res, 200, result);
        } catch (err: any) {
          this.sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
        }
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

        this.log(`[info] Webhook received: event=${event} repo=${isFrontDeskEvent(body) ? "frontdesk" : repoKey}`);
        const outcome = await this.ingestWebhook(event, body);
        this.sendJson(res, 200, {
          ok: true,
          queued: true,
          key: outcome.key,
          isBypass: outcome.bypass,
          frontDesk: outcome.frontDesk,
          coalesce: outcome.result,
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
