import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Defer queue: outbound items held because their target is mid-turn (#598).
 *
 * Distinct from the outbox (outbox.ts), which holds a message because the
 * *transport* failed. Here the message is deliverable right now; the target is
 * simply not accepting a new turn without preemption, because Paseo's daemon
 * sends with `replaceRunning: true`. Deferring is the whole point: an agent's
 * turn is never cut short by an inbound x-comms message, and neither is the
 * sender's turn by a delivery notice.
 *
 * ## One file per item, not one document
 *
 * Two long-lived-ish processes write this queue on the same daemon: the plugin
 * server (periodic drain, turn-ended hook) and the injected MCP server (one per
 * agent, on its send path). A shared JSON document would need a cross-process
 * lock around every read-modify-write, and a lock held across a network send
 * has a failure mode a queue must not have.
 *
 * So each item is its own file and the filesystem provides the atomicity:
 *
 *   <id>.json      waiting
 *   <id>.sending   claimed by a drainer that has begun dispatch
 *
 * `rename()` of a `.json` to `.sending` succeeds for exactly one caller, so two
 * processes racing to drain the same target cannot both dispatch it — the
 * loser simply finds nothing to claim. An enqueue is a fresh uniquely-named
 * file and never reads the queue, so it cannot clobber or be clobbered.
 *
 * A `.sending` file that is still there at the start of a later pass is a claim
 * whose process died mid-send. The target may already have the message, so it
 * is reported to the sender as "outcome unknown" and dropped — never
 * re-dispatched. That is the restart guard, and it needs no bookkeeping field
 * and no clock.
 *
 * ## Bounds (both mandatory — this directory must never grow without limit)
 *
 *   DEFER_MAX_DEPTH_PER_TARGET = 8
 *     A target works its backlog one message per turn, so the useful backlog is
 *     "what still fits before the queue is stale", not "everything the sender
 *     ever pushed". 8 is a few round trips of a two-agent exchange: enough that
 *     a bursty sender loses nothing it plausibly still wants, small enough that
 *     one target's backlog is a single screenful and a drain is a handful of
 *     sends. Overflow evicts the OLDEST waiting item for that target and tells
 *     its sender — a superseded leading message is the one the later messages
 *     in the same burst made redundant, and the sender learns it was dropped
 *     rather than believing it landed.
 *
 *   DEFER_MAX_TOTAL = 200
 *     Fleet guard for a fan-out across many targets. Every existing item is
 *     already somebody's outstanding obligation, so at the ceiling the NEW item
 *     is refused outright and the caller is told; only within a single target
 *     is eviction the right trade. 200 files is a few hundred KB and a readdir
 *     is re-run on every pass.
 *
 *   DEFER_EXPIRY_MS = 30 minutes
 *     A turn can legitimately run long (a large refactor), so the outbox's
 *     10-minute undeliverable window would expire work that is clearly still
 *     wanted. 24 hours is the opposite failure: after a night, a message about
 *     yesterday's state is noise and its sender has moved on. Half an hour is
 *     "if the target has not picked this up by now, the context is stale".
 *
 * Delivery contract: queued means deferred, not guaranteed. See the "Delivery
 * contract" section of README.md — no item is ever delivered by preemption, and
 * no item is ever dropped without its sender being told.
 */

export const DEFER_QUEUE_DIRNAME = "pending";

/** How long a busy/idle verdict is trusted before the target is re-probed. */
export const DEFER_VERDICT_TTL_MS = 5_000;

export const DEFER_MAX_DEPTH_PER_TARGET = 8;
export const DEFER_MAX_TOTAL = 200;
export const DEFER_EXPIRY_MS = 30 * 60 * 1000;
export const DEFER_DRAIN_INTERVAL_MS = 15_000;

/**
 * Items drained per pass, fleet-wide. A pass probes each target and sends at
 * most one item to it, so this also bounds how long a pass can take — which is
 * what keeps a single stuck peer from stalling every other target's backlog.
 */
export const DEFER_MAX_TARGETS_PER_PASS = 3;

/**
 * Marker for a delivery aimed at an agent on THIS daemon. x-comms senders are
 * always local (the caller is an agent on this daemon), so a notice back to the
 * sender is addressed locally and does not need a registry name to route.
 */
export const LOCAL_DAEMON = "local";

export type DeferKind = "message" | "notice";

export interface DeferEntry {
  id: string;
  kind: DeferKind;
  /** Registry name, serverId, or {@link LOCAL_DAEMON}. Part of the target key. */
  daemon: string;
  /** Agent the item is addressed to. Part of the target key. */
  agentId: string;
  /** Local sender, when there is one. A notice has none. */
  fromAgentId: string | null;
  fromAgentName: string | null;
  prompt: string;
  /** Stable across the queue wait and every delivery attempt. */
  messageId: string;
  /**
   * The text already carries its envelope and signature.
   *
   * The plugin server enqueues raw prose and stamps at delivery, so its items are
   * `stamped: false`. The injected MCP server stamps before enqueueing, so a
   * queued item carries the exact bytes it will deliver. Each side therefore
   * delivers only what it can deliver correctly: neither re-stamps (which would
   * change `sentAt` and invalidate the signature) nor sends an unstamped prompt
   * (which would drop the attribution #594 added).
   */
  stamped: boolean;
  /** Ask for a delivery notice back to the sender once this item lands. */
  notifyOnFinish: boolean;
  /** For a notice: the item whose delivery it reports on. */
  reportsOnEntryId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface DeferTarget {
  daemon: string;
  agentId: string;
}

/**
 * Per-target identity for the FIFO and the depth cap. The daemon alone is not
 * enough: one peer hosts many agents, each with its own turn.
 */
export function deferTargetKey(target: DeferTarget): string {
  return `${target.daemon} ${target.agentId}`;
}

export function parseDeferTargetKey(key: string): DeferTarget | null {
  const at = key.indexOf(" ");
  if (at < 0) return null;
  return { daemon: key.slice(0, at), agentId: key.slice(at + 1) };
}

export function deferQueueDir(): string {
  return join(homedir(), ".paseo", "paseo-x-comms", DEFER_QUEUE_DIRNAME);
}

/** Same directory the injected MCP server reads, by construction. */
function waitingPath(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

function sendingPath(dir: string, id: string): string {
  return join(dir, `${id}.sending`);
}

export interface EnqueueInput {
  kind?: DeferKind;
  daemon: string;
  agentId: string;
  fromAgentId?: string | null;
  fromAgentName?: string | null;
  prompt: string;
  messageId: string;
  /** Set when `prompt` already carries its envelope and signature. */
  stamped?: boolean;
  notifyOnFinish?: boolean;
  reportsOnEntryId?: string;
}

export interface EnqueueOptions {
  id?: string;
  nowMs?: number;
  expiryMs?: number;
  maxDepth?: number;
  maxTotal?: number;
  dir?: string;
}

export interface EnqueueResult {
  entry: DeferEntry | null;
  /** Items evicted by the per-target cap; each has a sender to notify. */
  evicted: DeferEntry[];
  /** Set when the fleet-wide cap refused the new item. */
  error: string | null;
  depth: number;
}

/**
 * Write a new item into its target's FIFO, applying both caps. An evicted or
 * refused item is always reported so the caller can tell its sender.
 */
export function enqueueDefer(
  input: EnqueueInput,
  options: EnqueueOptions = {},
): EnqueueResult {
  const dir = options.dir ?? deferQueueDir();
  const nowMs = options.nowMs ?? Date.now();
  const maxDepth = options.maxDepth ?? DEFER_MAX_DEPTH_PER_TARGET;
  const maxTotal = options.maxTotal ?? DEFER_MAX_TOTAL;
  const target = { daemon: input.daemon, agentId: input.agentId };

  const waiting = listWaiting(dir);
  const depth = waiting.filter((item) => deferTargetKey(item) === deferTargetKey(target)).length;
  if (waiting.length + listStaleClaims(dir).length >= maxTotal) {
    return {
      entry: null,
      evicted: [],
      error: `defer queue is full (${maxTotal} items across all targets); not queued`,
      depth,
    };
  }

  // Over the cap, the oldest waiting item goes first. A claimed (.sending) item
  // is already being dispatched and must not be pulled back out from under it.
  const oldestFirst = waiting
    .filter((item) => deferTargetKey(item) === deferTargetKey(target))
    .sort(byAge);
  const evicted: DeferEntry[] = [];
  while (oldestFirst.length + 1 > maxDepth && oldestFirst.length > 0) {
    evicted.push(oldestFirst.shift()!);
  }
  for (const item of evicted) removeDeferItem(dir, item.id);

  const entry: DeferEntry = {
    id: options.id ?? randomUUID(),
    kind: input.kind ?? "message",
    daemon: input.daemon,
    agentId: input.agentId,
    fromAgentId: input.fromAgentId ?? null,
    fromAgentName: input.fromAgentName ?? null,
    prompt: input.prompt,
    messageId: input.messageId,
    stamped: input.stamped === true,
    notifyOnFinish: input.notifyOnFinish === true,
    ...(input.reportsOnEntryId ? { reportsOnEntryId: input.reportsOnEntryId } : {}),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + (options.expiryMs ?? DEFER_EXPIRY_MS)).toISOString(),
  };
  writeAtomic(waitingPath(dir, entry.id), entry);
  return {
    entry,
    evicted,
    error: null,
    depth: depth + 1 - evicted.length,
  };
}

/** Items waiting for a target, oldest first. */
export function listDeferTarget(dir: string, target: DeferTarget): DeferEntry[] {
  return listWaiting(dir).filter((item) => deferTargetKey(item) === deferTargetKey(target));
}

export function deferDepth(dir: string, target: DeferTarget): number {
  return listWaiting(dir).filter((item) => deferTargetKey(item) === deferTargetKey(target)).length;
}

/**
 * Every waiting item, oldest first.
 *
 * The sort is load-bearing, not cosmetic: readdir order is filesystem-dependent,
 * so relying on it would make "first come, first served" vary between passes
 * and between machines. It also keeps this side in step with the MCP server's
 * copy, which sorts for the same reason.
 */
export function listWaiting(dir: string): DeferEntry[] {
  return readEntries(dir, ".json").sort(byAge);
}

/**
 * Items a previous process claimed and never finished. Their delivery outcome
 * is unknowable, so they are reported to the sender and dropped rather than
 * re-dispatched.
 */
export function listStaleClaims(dir: string): DeferEntry[] {
  return readEntries(dir, ".sending");
}

export function expiredDeferEntries(entries: DeferEntry[], nowMs: number): DeferEntry[] {
  return entries.filter((entry) => Date.parse(entry.expiresAt) <= nowMs);
}

export function removeDeferItem(dir: string, id: string): void {
  rmSync(waitingPath(dir, id), { force: true });
  rmSync(sendingPath(dir, id), { force: true });
}

/** Drop a claimed item after it was delivered. */
export function completeDeferItem(dir: string, id: string): void {
  rmSync(sendingPath(dir, id), { force: true });
}

/** Hand a claim back after a failed delivery so a later pass can retry it. */
export function releaseDeferItem(dir: string, id: string): void {
  const from = sendingPath(dir, id);
  if (existsSync(from)) renameSync(from, waitingPath(dir, id));
}

/**
 * Take the oldest unexpired item for a target and claim it. The `.json` to
 * `.sending` rename is the claim: exactly one caller wins it, so two processes
 * draining the same target cannot both dispatch the same message.
 */
export function claimNextDefer(
  dir: string,
  target: DeferTarget,
  nowMs: number = Date.now(),
): DeferEntry | null {
  const next = listDeferTarget(dir, target).find((entry) => Date.parse(entry.expiresAt) > nowMs);
  if (!next) return null;
  try {
    renameSync(waitingPath(dir, next.id), sendingPath(dir, next.id));
  } catch {
    // Another drainer claimed it between the listing and the rename.
    return null;
  }
  return next;
}

/** Targets with something waiting, in first-come order. */
export function pendingDeferTargets(dir: string): DeferTarget[] {
  const seen = new Map<string, DeferTarget>();
  for (const entry of listWaiting(dir)) {
    const key = deferTargetKey(entry);
    if (!seen.has(key)) seen.set(key, { daemon: entry.daemon, agentId: entry.agentId });
  }
  return [...seen.values()];
}

export const DEFER_NOTICE_KIND = "x-comms-delivery-notice";
export const DEFER_NOTICE_VERSION = 1;

/**
 * Prose for a `notifyOnFinish` delivery notice. Fixed shape so a sender can
 * recognise it without a parser, and it carries the messageId so a sender that
 * wants to confirm can quote the key it already holds.
 */
export function deliveryNoticeText(entry: DeferEntry, landedAt: string): string {
  const target = `${entry.daemon}/${entry.agentId}`;
  if (entry.kind === "notice") {
    return `[x-comms] delivery notice: an earlier notice to '${entry.agentId}' landed at ${landedAt}.`;
  }
  return `[x-comms] delivery notice: your message to '${target}' landed at ${landedAt} (messageId ${entry.messageId}). The target read it at the start of a turn of its own; nothing was interrupted.`;
}

/** Why a queued item is being dropped, for the sender's timeline notice. */
export function deferDropReason(entry: DeferEntry, cause: "expired" | "evicted" | "unknown"): string {
  const target = `${entry.daemon}/${entry.agentId}`;
  if (cause === "evicted") {
    return `x-comms dropped your queued message to '${target}': that target's queue is full (${DEFER_MAX_DEPTH_PER_TARGET} deep) and this was the oldest waiting item (messageId ${entry.messageId})`;
  }
  if (cause === "expired") {
    return `x-comms dropped your queued message to '${target}': it waited out its ${Math.round(DEFER_EXPIRY_MS / 60000)} minute window without the target ever going idle (messageId ${entry.messageId})`;
  }
  return `x-comms does not know whether your queued message to '${target}' was delivered: its claim was still in flight when x-comms restarted, so it was not retried rather than risk a duplicate (messageId ${entry.messageId})`;
}

function byAge(a: DeferEntry, b: DeferEntry): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

function readEntries(dir: string, suffix: string): DeferEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const entries: DeferEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(suffix)) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as DeferEntry;
      // A file without a usable id cannot be claimed or completed by name.
      if (parsed?.id && parsed.daemon && parsed.agentId) entries.push(parsed);
    } catch {
      // Unreadable item: leave it in place rather than silently dropping a
      // message. It ages out on its own expiry and the dir stays inspectable.
    }
  }
  return entries;
}

function writeAtomic(path: string, entry: DeferEntry): void {
  mkdirSync(dirnameOf(path), { recursive: true });
  const temp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(temp, JSON.stringify(entry, null, 2), "utf8");
  renameSync(temp, path);
}

function dirnameOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "." : path.slice(0, at);
}
