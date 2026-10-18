import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PluginStorage } from "paseo-plugin-helper/server";
import { detectTurnConcurrencyLock } from "./agent-health.js";

export const TURN_LOCK_MARKERS = [
  "foreground turn is already active",
  "a turn is already active",
  "concurrent turn",
  "turn concurrency",
];

export type WatchdogRecoveryRootCause =
  | "TURN_LOCK"
  | "SOCKET_HANG"
  | "DAEMON_DISCONNECT"
  | "BUSY_TIMEOUT";

export interface WatchdogRecoveryAgentDiagnostics {
  agentId: string;
  targetAgentId?: string;
  role: string | null;
  status: string;
  activeTurnState: unknown;
  attentionReason: string | null;
  lastError: string | null;
  lockState: boolean;
}

export interface WatchdogRecoveryQueueTelemetry {
  queueDepth: number;
  deliveryAttemptCount: number;
  attempts?: number;
  lastAttemptedDeliveryTimestamp: number | string | null;
  lastAttemptedDelivery?: number | string | null;
}

export interface WatchdogRecoveryActionResult {
  action: "reload" | string;
  ok: boolean;
}

export interface WatchdogRecoveryRecord {
  timestamp: string;
  repo: string;
  kind: "agent" | "queue";
  rootCause: WatchdogRecoveryRootCause;
  agentDiagnostics: WatchdogRecoveryAgentDiagnostics | null;
  queueTelemetry: WatchdogRecoveryQueueTelemetry;
  recoveryActionResult: WatchdogRecoveryActionResult;
  actionResult?: WatchdogRecoveryActionResult;
}

export interface ClassifyRecoveryRootCauseInput {
  kind?: "agent" | "queue";
  status?: string | null;
  lastError?: string | null;
  attentionReason?: string | null;
  taxonomy?: readonly string[] | null;
  lockState?: boolean;
  attempts?: number;
  busyThreshold?: number;
  deliveryDeadlineExceeded?: boolean;
}

/**
 * Classifies failure root causes into the standard four-element taxonomy:
 * - TURN_LOCK: Foreground turn or concurrency collision.
 * - SOCKET_HANG: Connection reset or broken socket.
 * - DAEMON_DISCONNECT: Paseo daemon unreachable / ECONNREFUSED.
 * - BUSY_TIMEOUT: Continuous busy streak exceeding threshold or delivery deadline exceeded.
 */
export function classifyRecoveryRootCause(
  input: ClassifyRecoveryRootCauseInput,
): WatchdogRecoveryRootCause {
  const {
    kind,
    status,
    lastError,
    attentionReason,
    taxonomy = [],
    lockState,
    attempts = 0,
    busyThreshold = 10,
    deliveryDeadlineExceeded,
  } = input;

  const errStr = String(lastError ?? "");
  const loweredErr = errStr.toLowerCase();

  // 1. TURN_LOCK: Foreground turn or concurrency collision.
  const isTurnLockMarker =
    detectTurnConcurrencyLock(status, lastError) ||
    lockState === true ||
    (taxonomy && taxonomy.includes("TURN_CONCURRENCY_LOCK")) ||
    /foreground turn is already active|a turn is already active|concurrent turn|turn concurrency/i.test(loweredErr) ||
    (!errStr && String(status ?? "").toLowerCase() === "running" && attentionReason === "error") ||
    (!errStr && attentionReason === "error");

  if (isTurnLockMarker) {
    return "TURN_LOCK";
  }

  // 2. SOCKET_HANG: Connection reset or broken socket.
  const isSocketHang =
    /socket hang up|econnreset|connection reset|broken socket|broken pipe|epipe|esockettimedout|tls socket/i.test(loweredErr);

  if (isSocketHang) {
    return "SOCKET_HANG";
  }

  // 3. DAEMON_DISCONNECT: Paseo daemon unreachable / ECONNREFUSED.
  const isDaemonDisconnect =
    /econnrefused|connection refused|daemon unreachable|daemon disconnected|cannot connect to daemon|failed to connect to daemon|daemon died|daemon not running|daemon closed/i.test(loweredErr);

  if (isDaemonDisconnect) {
    return "DAEMON_DISCONNECT";
  }

  // 4. BUSY_TIMEOUT: Continuous busy streak exceeding threshold or delivery deadline exceeded.
  const isBusyTimeout =
    deliveryDeadlineExceeded === true ||
    attempts >= busyThreshold ||
    /delivery deadline exceeded|busy timeout|busy streak|timed? ?out/i.test(loweredErr) ||
    (taxonomy && taxonomy.includes("ZOMBIE_HUNG_TURN")) ||
    (taxonomy && taxonomy.includes("TURN_CANCELLATION_TIMEOUT")) ||
    kind === "queue";

  if (isBusyTimeout) {
    return "BUSY_TIMEOUT";
  }

  // Default to TURN_LOCK for agent failures without explicit network/timeout signals
  return "TURN_LOCK";
}

let _watchdogRecoveriesPathOverride: string | null = null;

export function setWatchdogRecoveriesPathForTest(filePath: string | null): void {
  _watchdogRecoveriesPathOverride = filePath;
}

export function defaultWatchdogRecoveriesPath(context?: unknown): string {
  if (_watchdogRecoveriesPathOverride) {
    return _watchdogRecoveriesPathOverride;
  }
  const envOverride = process.env.UPPIDI_FLEET_WATCHDOG_RECOVERIES_FILE?.trim();
  if (envOverride) return envOverride;

  if (typeof context === "string" && context.trim()) {
    const trimmed = context.trim();
    return trimmed.endsWith(".jsonl") ? trimmed : join(trimmed, "watchdog-recoveries.jsonl");
  }

  if (context && typeof context === "object") {
    const ctx = context as Record<string, unknown>;
    const storage = ctx.storage;
    if (typeof storage === "string" && storage.trim()) {
      const s = storage.trim();
      return s.endsWith(".jsonl") ? s : join(s, "watchdog-recoveries.jsonl");
    }
    if (storage && typeof storage === "object") {
      const st = storage as Record<string, unknown>;
      if (typeof st.path === "string" && st.path.trim()) {
        const p = st.path.trim();
        return p.endsWith(".jsonl") ? p : join(p, "watchdog-recoveries.jsonl");
      }
      if (typeof st.path === "function") {
        try {
          const res = (st.path as (name: string) => unknown)("watchdog-recoveries.jsonl");
          if (typeof res === "string" && res.trim()) {
            const p = res.trim();
            return p.endsWith(".jsonl") ? p : join(p, "watchdog-recoveries.jsonl");
          }
        } catch {
          // Fall through
        }
      }
      if (typeof st.dir === "string" && st.dir.trim()) {
        return join(st.dir.trim(), "watchdog-recoveries.jsonl");
      }
    }
  }

  const storage = new PluginStorage<Record<string, never>>("uppidi-fleet", "watchdog-recoveries.jsonl");
  return storage.filePath;
}

export function appendWatchdogRecoveryRecord(
  record: WatchdogRecoveryRecord,
  options?: { logPath?: string; context?: unknown },
): void {
  const filePath = options?.logPath ?? defaultWatchdogRecoveriesPath(options?.context);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
}

export function readWatchdogRecoveryRecords(
  options?: { logPath?: string; context?: unknown },
): WatchdogRecoveryRecord[] {
  const filePath = options?.logPath ?? defaultWatchdogRecoveriesPath(options?.context);
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WatchdogRecoveryRecord);
}

export function formatWatchdogRecoveryAlert(opts: {
  kind: "agent" | "queue";
  rootCause: WatchdogRecoveryRootCause;
  repo: string;
  agentId?: string | null;
  reasonDesc?: string;
  queueDepth: number;
  attempts: number;
  status: string;
}): string {
  const { kind, rootCause, repo, agentId, reasonDesc, queueDepth, attempts, status } = opts;
  const shortId = agentId ? agentId.slice(0, 7) : "unknown";
  const stateSummary = `queue=${queueDepth}p/${attempts}a status=${status || "unknown"}`;

  if (kind === "queue") {
    return `[Fleet Watchdog] [${rootCause}] Auto-recovered wedged queue for ${repo} (${queueDepth} pending, ${attempts} failed attempts) by reloading orchestrator ${shortId} (${stateSummary}).`;
  }
  const reason = reasonDesc ?? (rootCause === "TURN_LOCK" ? "clearing foreground turn lock" : "reloading agent");
  return `[Fleet Watchdog] [${rootCause}] Auto-recovered orchestrator for ${repo} (${shortId}) by ${reason} (${stateSummary}).`;
}
