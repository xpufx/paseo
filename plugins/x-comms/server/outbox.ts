import { randomUUID } from "node:crypto";
import { PluginStorage } from "./vendor/paseo-plugin-helper/index";

/**
 * Outbox for outbound conversation messages that could not be delivered.
 *
 * Retry strategy: per-entry exponential backoff, a periodic sweep, and an
 * explicit immediate retry when a peer is observed reconnecting. Entries expire
 * after a configurable window; expiry notifies the local sender with the reason.
 *
 * Every entry retains the first attempt's messageId. Paseo's daemon receives
 * that same key on a retry and deduplicates before the target agent sees it.
 */

export const OUTBOX_FILE = "outbox.json";
export const DEFAULT_OUTBOX_EXPIRY_MS = 10 * 60 * 1000;
export const OUTBOX_BACKOFF_BASE_MS = 5_000;
export const OUTBOX_BACKOFF_MAX_MS = 60_000;
export const OUTBOX_POLL_INTERVAL_MS = 15_000;

export interface OutboxMessageInput {
  daemon: string;
  agentId: string;
  prompt: string;
  fromAgentId?: string | null;
  fromAgentName?: string | null;
  messageId: string;
}

export interface OutboxEntry {
  id: string;
  daemon: string;
  agentId: string;
  prompt: string;
  fromAgentId: string | null;
  fromAgentName: string | null;
  messageId: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  nextAttemptAt: string;
}

export interface OutboxState {
  entries: OutboxEntry[];
}

export function emptyOutboxState(): OutboxState {
  return { entries: [] };
}

/**
 * Delay before the next attempt after `attempts` failures:
 * `base * 2^(attempts-1)`, capped at `maxMs`.
 */
export function outboxBackoffMs(
  attempts: number,
  baseMs: number = OUTBOX_BACKOFF_BASE_MS,
  maxMs: number = OUTBOX_BACKOFF_MAX_MS,
): number {
  if (attempts <= 0) return 0;
  return Math.min(baseMs * 2 ** (attempts - 1), maxMs);
}

export interface HoldOptions {
  id?: string;
  nowMs?: number;
  expiryMs?: number;
  /** Failure that caused the hold; counts as the first attempt. */
  error?: string | null;
}

/** Append a held message and schedule its first retry after the backoff. */
export function holdMessage(
  state: OutboxState,
  input: OutboxMessageInput,
  options: HoldOptions = {},
): OutboxEntry {
  const nowMs = options.nowMs ?? Date.now();
  const expiryMs = options.expiryMs ?? DEFAULT_OUTBOX_EXPIRY_MS;
  const error = options.error ?? null;
  const attempts = error ? 1 : 0;
  const entry: OutboxEntry = {
    id: options.id ?? randomUUID(),
    daemon: input.daemon,
    agentId: input.agentId,
    prompt: input.prompt,
    fromAgentId: input.fromAgentId ?? null,
    fromAgentName: input.fromAgentName ?? null,
    messageId: input.messageId,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + expiryMs).toISOString(),
    attempts,
    lastAttemptAt: attempts > 0 ? new Date(nowMs).toISOString() : null,
    lastError: error,
    nextAttemptAt: new Date(nowMs + outboxBackoffMs(attempts)).toISOString(),
  };
  state.entries.push(entry);
  return entry;
}

export function dueEntries(state: OutboxState, nowMs: number): OutboxEntry[] {
  return state.entries.filter((entry) => Date.parse(entry.nextAttemptAt) <= nowMs);
}

export function expiredEntries(state: OutboxState, nowMs: number): OutboxEntry[] {
  return state.entries.filter((entry) => Date.parse(entry.expiresAt) <= nowMs);
}

export function removeEntries(state: OutboxState, ids: Iterable<string>): void {
  const drop = new Set(ids);
  state.entries = state.entries.filter((entry) => !drop.has(entry.id));
}

export interface OutboxDelivery {
  /** Resolve when delivered; reject to schedule a backoff retry. */
  deliver(entry: OutboxEntry): Promise<void>;
  /** Best-effort notice to the sender for an entry that expired. */
  notify(entry: OutboxEntry, reason: string): Promise<void>;
}

export interface OutboxPassOptions {
  nowMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Retry every held entry for this daemon immediately (peer reconnect). */
  forceDaemon?: string;
}

export interface OutboxPassResult {
  delivered: string[];
  retried: string[];
  expired: string[];
  notified: string[];
  notifyFailed: string[];
}

export function formatOutboxDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function outboxExpiryReason(entry: OutboxEntry, nowMs: number): string {
  const held = formatOutboxDuration(nowMs - Date.parse(entry.createdAt));
  const attempts = entry.attempts === 1 ? "1 attempt" : `${entry.attempts} attempts`;
  const last = entry.lastError ? `; last error: ${entry.lastError}` : "";
  return `could not deliver to '${entry.daemon}/${entry.agentId}' after ${held} (${attempts}${last})`;
}

/**
 * One sweep: expire overdue entries (notify the sender, then drop), then retry
 * every due entry once. Mutates `state`; returns what happened.
 */
export async function runOutboxPass(
  state: OutboxState,
  delivery: OutboxDelivery,
  options: OutboxPassOptions = {},
): Promise<OutboxPassResult> {
  const nowMs = options.nowMs ?? Date.now();
  const baseMs = options.baseDelayMs ?? OUTBOX_BACKOFF_BASE_MS;
  const maxMs = options.maxDelayMs ?? OUTBOX_BACKOFF_MAX_MS;
  const result: OutboxPassResult = {
    delivered: [],
    retried: [],
    expired: [],
    notified: [],
    notifyFailed: [],
  };

  const expired = expiredEntries(state, nowMs);
  for (const entry of expired) {
    const reason = outboxExpiryReason(entry, nowMs);
    try {
      await delivery.notify(entry, reason);
      result.notified.push(entry.id);
    } catch {
      result.notifyFailed.push(entry.id);
    }
  }
  removeEntries(state, expired.map((entry) => entry.id));
  result.expired.push(...expired.map((entry) => entry.id));

  if (options.forceDaemon) {
    const forcedAt = new Date(nowMs).toISOString();
    for (const entry of state.entries) {
      if (entry.daemon === options.forceDaemon) entry.nextAttemptAt = forcedAt;
    }
  }

  for (const entry of dueEntries(state, nowMs)) {
    try {
      await delivery.deliver(entry);
      removeEntries(state, [entry.id]);
      result.delivered.push(entry.id);
    } catch (cause) {
      entry.attempts += 1;
      entry.lastAttemptAt = new Date(nowMs).toISOString();
      entry.lastError = cause instanceof Error ? cause.message : String(cause);
      entry.nextAttemptAt = new Date(nowMs + outboxBackoffMs(entry.attempts, baseMs, maxMs)).toISOString();
      result.retried.push(entry.id);
    }
  }

  return result;
}

const outboxStore = new PluginStorage<OutboxState>("paseo-x-comms", OUTBOX_FILE, {
  defaultData: emptyOutboxState(),
});

export function outboxPath(): string {
  return outboxStore.filePath;
}

export function readOutbox(): OutboxState {
  try {
    const data = outboxStore.read();
    if (data && typeof data === "object" && Array.isArray(data.entries)) {
      return { entries: data.entries as OutboxEntry[] };
    }
  } catch {
    // Corrupt state falls back to empty; the held message is lost and logged by callers.
  }
  return emptyOutboxState();
}

export function writeOutbox(state: OutboxState): void {
  outboxStore.write(state);
}
