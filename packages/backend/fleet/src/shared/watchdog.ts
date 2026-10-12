// ---------------------------------------------------------------------------
// Headless Watchdog Anomaly Classifier & Recovery Planner
// ---------------------------------------------------------------------------

export const WATCHDOG_TAXONOMY = [
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "IDLE_POST_ERROR_AMNESIA",
  "ZOMBIE_HUNG_TURN",
  "STALE_ERROR_GHOSTING",
  "PROVIDER_QUOTA_EXHAUSTION",
  "REPETITIVE_TOOL_LOOP",
] as const;
export type WatchdogTaxonomyType = (typeof WATCHDOG_TAXONOMY)[number];

export type WatchdogSeverity = "high" | "medium";

export const DEFAULT_RUNNING_STALE_SECONDS = 1800;
export const DEFAULT_CANCELLATION_RECENCY_SECONDS = 86400;
export const DEFAULT_WATCHDOG_STEER_MESSAGE =
  "Health check: your previous turn ended without resuming work. " +
  "Sweep the board for triage and continue dispatching pending work.";

export const DEFAULT_WATCHDOG_BUSY_THRESHOLD = 5;
export const DEFAULT_WATCHDOG_ALERT_COOLDOWN_MS = 2 * 60 * 1000;
export const DEFAULT_REPETITIVE_TOOL_LOOP_THRESHOLD = 15;

export const WATCHDOG_SEVERITIES: Record<WatchdogTaxonomyType, WatchdogSeverity> = {
  TURN_CONCURRENCY_LOCK: "high",
  TURN_CANCELLATION_TIMEOUT: "high",
  ZOMBIE_HUNG_TURN: "high",
  PROVIDER_QUOTA_EXHAUSTION: "high",
  STALE_ERROR_GHOSTING: "medium",
  IDLE_POST_ERROR_AMNESIA: "medium",
  REPETITIVE_TOOL_LOOP: "high",
};

export const STOP_TRIGGERS: ReadonlySet<WatchdogTaxonomyType> = new Set([
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "ZOMBIE_HUNG_TURN",
  "REPETITIVE_TOOL_LOOP",
]);

export const STEER_TRIGGERS: ReadonlySet<WatchdogTaxonomyType> = new Set([
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "ZOMBIE_HUNG_TURN",
  "IDLE_POST_ERROR_AMNESIA",
  "REPETITIVE_TOOL_LOOP",
]);

const TURN_LOCK_MARKERS = [
  "foreground turn is already active",
  "a turn is already active",
  "concurrent turn",
  "turn concurrency",
];

export const QUOTA_MARKERS = [
  "quota",
  "rate limit",
  "rate_limit",
  "429",
  "too many requests",
  "resource exhausted",
  "insufficient credit",
  "out of credits",
  "model unavailable",
  "usage limit",
  "upgrade to pro",
  "usage exceeded",
  "free usage",
  "subscribe to",
];

const TRANSIENT_MARKERS = [
  "fetch failed",
  "econnreset",
  "etimedout",
  "connection refused",
  "socket hang up",
  "temporarily unavailable",
];

const ATTENTION_STALL_REASONS = ["error", "stalled", "interrupted", "failed"];

export function hasMarker(text: unknown, markers: readonly string[]): boolean {
  const lowered = String(text ?? "").toLowerCase();
  return markers.some((marker) => lowered.includes(marker));
}

export function parseIsoTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function coerceEpochMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      return num < 100_000_000_000 ? Math.round(num * 1000) : Math.round(num);
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

export function detectTurnConcurrencyLock(liveStatus: unknown, lastError: unknown): boolean {
  if (String(liveStatus ?? "").toLowerCase() !== "error") return false;
  return hasMarker(lastError, TURN_LOCK_MARKERS);
}

export function detectCancellationTimeout(
  agentId: string,
  cancellations: ReadonlyMap<string, number | string | null> | null | undefined,
  liveStatus: unknown,
  nowEpochMs?: number,
  recencySeconds?: number,
  lastError?: unknown,
  lastActivityAt?: unknown,
  lastHandledCancellationAt?: unknown,
): boolean {
  const status = String(liveStatus ?? "").toLowerCase();
  if (status !== "error" && status !== "idle") return false;
  if (!cancellations || !cancellations.has(agentId)) return false;

  const rawCanceledAt = cancellations.get(agentId);
  const canceledAt = rawCanceledAt != null ? coerceEpochMs(rawCanceledAt) : null;

  if (recencySeconds !== undefined && nowEpochMs !== undefined && canceledAt !== null) {
    if ((nowEpochMs - canceledAt) / 1000 > recencySeconds) {
      return false;
    }
  }

  if (lastHandledCancellationAt != null) {
    const handledMs = coerceEpochMs(lastHandledCancellationAt);
    if (handledMs != null && (canceledAt == null || handledMs >= canceledAt)) {
      return false;
    }
  }

  const hasError = Boolean(String(lastError ?? "").trim());
  if (status === "idle" && !hasError) {
    if (lastActivityAt != null && canceledAt != null) {
      const activityMs = coerceEpochMs(lastActivityAt);
      if (activityMs != null && activityMs > canceledAt) {
        return false;
      }
    }
  }

  return true;
}

export function detectStaleErrorGhosting(liveStatus: unknown, lastError: unknown): boolean {
  if (!["idle", "running"].includes(String(liveStatus ?? "").toLowerCase())) return false;
  return Boolean(String(lastError ?? "").trim());
}

export interface ProviderQuotaDetectionOptions {
  now?: number;
  recencySeconds?: number;
  lastActivityAt?: unknown;
  liveStatus?: unknown;
}

export function findProviderRetryQuotaError(
  recentTimeline: unknown,
  options?: ProviderQuotaDetectionOptions,
): string | null {
  if (!recentTimeline) return null;
  const entries: Array<{ text: string; timestamp?: number | null }> = [];
  if (typeof recentTimeline === "string") {
    for (const line of recentTimeline.split("\n")) {
      entries.push({ text: line });
    }
  } else if (Array.isArray(recentTimeline)) {
    for (const item of recentTimeline) {
      if (typeof item === "string") {
        entries.push({ text: item });
      } else if (item && typeof item === "object") {
        const text =
          (item as any).message ??
          (item as any).msg ??
          (item as any).text ??
          (item as any).detail ??
          (item as any).error ??
          "";
        if (typeof text === "string" && text) {
          const rawTime =
            (item as any).timestamp ??
            (item as any).time ??
            (item as any).createdAt ??
            (item as any).date ??
            null;
          entries.push({ text, timestamp: coerceEpochMs(rawTime) });
        }
      }
    }
  }

  for (const entry of entries) {
    const raw = String(entry.text ?? "").trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const isRetryOrError =
      lower.includes("provider-retry") ||
      lower.includes("provider retry") ||
      lower.includes("[error]") ||
      lower.includes("error:");
    if (!isRetryOrError) continue;
    if (hasMarker(lower, TRANSIENT_MARKERS)) continue;
    if (hasMarker(lower, QUOTA_MARKERS)) {
      if (options) {
        const { now, recencySeconds, lastActivityAt } = options;
        if (entry.timestamp != null) {
          if (now !== undefined && recencySeconds !== undefined) {
            if ((now - entry.timestamp) / 1000 > recencySeconds) {
              continue;
            }
          }
          if (lastActivityAt != null) {
            const activityMs = coerceEpochMs(lastActivityAt);
            if (activityMs != null && activityMs > entry.timestamp) {
              continue;
            }
          }
        }
      }
      return raw;
    }
  }
  return null;
}

export function detectProviderQuotaExhaustion(
  lastError: unknown,
  recentTimeline?: unknown,
  options?: ProviderQuotaDetectionOptions,
): boolean {
  const text = String(lastError ?? "").toLowerCase();
  if (text && !hasMarker(text, TRANSIENT_MARKERS) && hasMarker(text, QUOTA_MARKERS)) {
    return true;
  }
  if (recentTimeline) {
    if (options?.liveStatus) {
      const status = String(options.liveStatus).toLowerCase();
      if (status === "running" && !text.trim()) {
        return false;
      }
    }
    return Boolean(findProviderRetryQuotaError(recentTimeline, options));
  }
  return false;
}

export function detectIdlePostErrorAmnesia(
  liveStatus: unknown,
  lastError: unknown,
  requiresAttention: unknown,
  attentionReason: unknown,
  activeWorkers: number,
  assumePendingWork = false,
): boolean {
  if (String(liveStatus ?? "").toLowerCase() !== "idle") return false;
  if (activeWorkers > 0) return false;
  const reason = String(attentionReason ?? "").toLowerCase();
  const stalled =
    ATTENTION_STALL_REASONS.includes(reason) || Boolean(String(lastError ?? "").trim());
  if (stalled) return true;
  return Boolean(assumePendingWork && requiresAttention);
}

export function detectZombieHungTurn(
  liveStatus: unknown,
  lastActivityAt: unknown,
  now: number,
  staleSeconds: number,
): boolean {
  if (String(liveStatus ?? "").toLowerCase() !== "running") return false;
  const activity = parseIsoTimestamp(lastActivityAt);
  if (activity === null) return false;
  return (now - activity) / 1000 >= staleSeconds;
}

const TOOL_CALL_INPUT_KEYS: Record<string, readonly string[]> = {
  shell: ["command", "cwd"],
  read: ["filePath", "offset", "limit"],
  edit: ["filePath", "oldString", "newString"],
  write: ["filePath", "content"],
  search: ["query", "toolName", "mode"],
  fetch: ["url", "prompt"],
  plain_text: ["label", "text"],
  plan: ["text"],
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

export function toolCallSignature(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  if (raw.type !== "tool_call" && raw.type !== "tool_use") return null;
  const nested = raw.toolCall && typeof raw.toolCall === "object" ? (raw.toolCall as Record<string, unknown>) : null;
  const name = String(raw.name ?? raw.toolName ?? nested?.name ?? "").trim();
  if (!name) return null;
  const detail = raw.detail ?? raw.input ?? nested?.input ?? null;
  let args: unknown = detail;
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    const inputKeys = typeof d.type === "string" ? TOOL_CALL_INPUT_KEYS[d.type] : undefined;
    if (inputKeys) {
      args = Object.fromEntries(inputKeys.filter((key) => key in d).map((key) => [key, d[key]]));
    } else if (d.type === "unknown") {
      args = d.input ?? null;
    }
  }
  return `${name}:${stableStringify(args)}`;
}

export function detectRepetitiveToolLoop(
  timeline: unknown,
  threshold: number = DEFAULT_REPETITIVE_TOOL_LOOP_THRESHOLD,
): number {
  const items = normalizeTimelineItems(timeline);
  if (threshold <= 1 || items.length === 0) return 0;
  let best = 0;
  let run = 0;
  let last: string | null = null;
  for (const item of items) {
    const signature = toolCallSignature(item);
    if (signature === null) continue;
    run = signature === last ? run + 1 : 1;
    last = signature;
    if (run > best) best = run;
  }
  return best >= threshold ? best : 0;
}

function normalizeTimelineItems(timeline: unknown): unknown[] {
  if (!timeline) return [];
  if (Array.isArray(timeline)) return timeline;
  if (typeof timeline === "string") {
    const trimmed = timeline.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not a JSON array
    }
  }
  return [];
}

export interface WatchdogAgentLike {
  id?: string;
  name?: string;
  title?: string;
  status?: string;
  lastStatus?: string;
  lastError?: string;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  lastActivityAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
  labels?: Record<string, string>;
  lastHandledCancellationAt?: number | string | null;
  cancellationHandledAt?: number | string | null;
  path?: string | null;
  [key: string]: any;
}

export interface WatchdogAssessment {
  agentId: string;
  name: string | null;
  liveStatus: string;
  taxonomy: WatchdogTaxonomyType[];
  severities: Partial<Record<WatchdogTaxonomyType, WatchdogSeverity>>;
  details: Partial<Record<WatchdogTaxonomyType, string>>;
  archived: boolean;
  lastError: string;
  requiresAttention: boolean;
  attentionReason: string | null;
  lastActivityAt: string | null;
  lastHandledCancellationAt?: number | string | null;
  cancellationTime?: number | null;
  diskPath: string | null;
  healthy: boolean;
}

export function assessAgentHealth(
  agentId: string,
  live: WatchdogAgentLike | null | undefined,
  disk: WatchdogAgentLike | null | undefined,
  now: number,
  options: {
    cancellations?: Map<string, number | null> | null;
    cancellationRecencySeconds?: number;
    activeWorkers?: number;
    assumePendingWork?: boolean;
    runningStaleSeconds?: number;
    recentTimeline?: string | unknown[] | null;
    repetitiveToolLoopThreshold?: number;
  } = {},
): WatchdogAssessment {
  const liveStatus = String(live?.status ?? disk?.lastStatus ?? "").toLowerCase();
  const rawLastError = live?.lastError ?? disk?.lastError ?? "";
  const requiresAttention = Boolean(live?.requiresAttention ?? disk?.requiresAttention);
  const attentionReason = live?.attentionReason ?? disk?.attentionReason ?? null;
  const lastActivityAt = disk?.lastActivityAt ?? live?.lastActivityAt ?? disk?.updatedAt ?? live?.updatedAt ?? null;
  const lastHandledCancellationAt = disk?.lastHandledCancellationAt ?? disk?.cancellationHandledAt ?? null;
  const archived = Boolean(live?.archivedAt ?? disk?.archivedAt);
  const activeWorkers = options.activeWorkers ?? 0;
  const staleSeconds = options.runningStaleSeconds ?? DEFAULT_RUNNING_STALE_SECONDS;
  const recencySeconds = options.cancellationRecencySeconds ?? DEFAULT_CANCELLATION_RECENCY_SECONDS;

  const agentTimeline =
    options.recentTimeline ??
    live?.recentTimeline ??
    live?.timeline ??
    disk?.recentTimeline ??
    disk?.timeline ??
    null;

  const quotaOpts: ProviderQuotaDetectionOptions = {
    now,
    recencySeconds,
    lastActivityAt,
    liveStatus,
  };

  const repetitiveRun =
    liveStatus === "running" || liveStatus === "working"
      ? detectRepetitiveToolLoop(agentTimeline, options.repetitiveToolLoopThreshold)
      : 0;

  const quotaDetected = detectProviderQuotaExhaustion(rawLastError, agentTimeline, quotaOpts);
  const timelineQuotaError =
    quotaDetected && !String(rawLastError ?? "").trim()
      ? findProviderRetryQuotaError(agentTimeline, quotaOpts)
      : null;
  const lastError = timelineQuotaError ?? rawLastError;

  const turnLock =
    detectTurnConcurrencyLock(liveStatus, rawLastError) ||
    (!String(rawLastError ?? "").trim() && requiresAttention && attentionReason === "error");

  const cancellationTimeout = detectCancellationTimeout(
    agentId,
    options.cancellations,
    liveStatus,
    now,
    recencySeconds,
    rawLastError,
    lastActivityAt,
    lastHandledCancellationAt,
  );

  const rawCancellation = options.cancellations?.get(agentId);
  let cancellationTime: number | null = rawCancellation != null ? coerceEpochMs(rawCancellation) : null;
  if (cancellationTime == null && cancellationTimeout) {
    cancellationTime = now;
  }

  const checks: Record<WatchdogTaxonomyType, boolean> = {
    TURN_CONCURRENCY_LOCK: turnLock,
    TURN_CANCELLATION_TIMEOUT: cancellationTimeout,
    IDLE_POST_ERROR_AMNESIA: detectIdlePostErrorAmnesia(
      liveStatus,
      rawLastError,
      requiresAttention,
      attentionReason,
      activeWorkers,
      options.assumePendingWork ?? false,
    ),
    ZOMBIE_HUNG_TURN: detectZombieHungTurn(liveStatus, lastActivityAt, now, staleSeconds),
    STALE_ERROR_GHOSTING: detectStaleErrorGhosting(liveStatus, rawLastError),
    PROVIDER_QUOTA_EXHAUSTION: quotaDetected,
    REPETITIVE_TOOL_LOOP: repetitiveRun > 0,
  };

  const taxonomy = archived ? [] : WATCHDOG_TAXONOMY.filter((name) => checks[name]);
  const severities: Partial<Record<WatchdogTaxonomyType, WatchdogSeverity>> = {};
  const details: Partial<Record<WatchdogTaxonomyType, string>> = {};
  for (const name of taxonomy) {
    severities[name] = WATCHDOG_SEVERITIES[name];
    const detail =
      name === "TURN_CANCELLATION_TIMEOUT"
        ? "acknowledged turn still active after timeout"
        : name === "IDLE_POST_ERROR_AMNESIA"
          ? attentionReason ?? undefined
          : name === "ZOMBIE_HUNG_TURN"
            ? lastActivityAt ?? undefined
            : name === "REPETITIVE_TOOL_LOOP"
              ? `${repetitiveRun} identical consecutive tool calls`
              : String(lastError || "").trim() || undefined;
    if (detail) details[name] = detail;
  }

  return {
    agentId,
    name: live?.name ?? live?.title ?? null,
    liveStatus,
    taxonomy,
    severities,
    details,
    archived,
    lastError: String(lastError ?? ""),
    requiresAttention,
    attentionReason,
    lastActivityAt,
    lastHandledCancellationAt,
    cancellationTime,
    diskPath: disk?.path ?? null,
    healthy: taxonomy.length === 0,
  };
}

export interface WatchdogRecoveryPlan {
  stop: boolean;
  clearError: boolean;
  clearAttention: boolean;
  recordCancellationHandled: boolean;
  steer: boolean;
  steerMessage: string;
  blockedReason: string | null;
}

export function planWatchdogRecovery(
  taxonomy: readonly WatchdogTaxonomyType[],
  steerMessage: string = DEFAULT_WATCHDOG_STEER_MESSAGE,
): WatchdogRecoveryPlan {
  const set = new Set(taxonomy);
  const stop = [...set].some((type) => STOP_TRIGGERS.has(type));
  const steer = [...set].some((type) => STEER_TRIGGERS.has(type)) && !set.has("PROVIDER_QUOTA_EXHAUSTION");
  return {
    stop,
    clearError: set.has("STALE_ERROR_GHOSTING") || stop,
    clearAttention: set.has("IDLE_POST_ERROR_AMNESIA") || stop,
    recordCancellationHandled: set.has("TURN_CANCELLATION_TIMEOUT"),
    steer,
    steerMessage,
    blockedReason:
      set.has("PROVIDER_QUOTA_EXHAUSTION") && !stop
        ? "provider/quota exhaustion requires operator circuit-break"
        : null,
  };
}
