/**
 * agent-health.ts — Deterministic fleet agent health detector and recovery tool.
 *
 * Ported from platform `scripts/agent-health-check`. Pure functions classify a
 * single fused live/disk/log signal set against a wedged/degraded-state taxonomy
 * and derive explicit *dead* verdicts from named, individually testable
 * predicates. Every destructive step is opt-in; the default run is read-only.
 *
 * Taxonomy (7 rules):
 *   1. TURN_CONCURRENCY_LOCK       – errored lifecycle carrying a turn-concurrency failure.
 *   2. TURN_CANCELLATION_TIMEOUT   – daemon force-canceled an acknowledged turn.
 *   3. PENDING_PERMISSION_BLOCKED  – agent blocked waiting on external tool permissions.
 *   4. IDLE_POST_ERROR_AMNESIA    – idle with stalled attention, no active workers.
 *   5. ZOMBIE_HUNG_TURN           – running with no activity inside the stale window.
 *   6. STALE_ERROR_GHOSTING       – healthy/idle lifecycle still carrying disk lastError.
 *   7. PROVIDER_QUOTA_EXHAUSTION  – fatal provider errors (quota/429).
 *
 * Dead predicates (5 rules):
 *   1. DEAD_ORPHANED_DISK_RECORD        – absent from daemon, still on disk.
 *   2. DEAD_TERMINAL_FATAL_ERROR        – error/closed with non-transient lastError.
 *   3. DEAD_WEDGED_RUNNING_TURN         – running turn with no activity in stale window.
 *   4. DEAD_REGISTRY_WITHOUT_PROCESS    – registry references id but daemon list does not.
 *   5. DEAD_SUPERSEDED_BY_RETRY         – terminal session superseded by newer retry.
 */

import { join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import {
  type WatchdogTaxonomyType,
  type WatchdogSeverity,
  WATCHDOG_SEVERITIES,
  hasMarker,
  coerceEpochMs,
  parseIsoTimestamp,
  DEFAULT_RUNNING_STALE_SECONDS,
  DEFAULT_CANCELLATION_RECENCY_SECONDS,
  QUOTA_MARKERS,
  CANCELLATION_TIMEOUT_MARKER,
} from "./hook-router.js";

// ---------------------------------------------------------------------------
// Constants & markers
// ---------------------------------------------------------------------------

const TURN_LOCK_MARKERS = [
  "foreground turn is already active",
  "a turn is already active",
  "concurrent turn",
  "turn concurrency",
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
const HEALTHY_DISK_STATUSES = ["idle", "running"];
const TERMINAL_DEAD_STATUSES = ["error", "closed"];

/** Consecutive identical tool calls that classify as a runaway loop (#1265). */
export const DEFAULT_REPETITIVE_TOOL_LOOP_THRESHOLD = 15;

// ---------------------------------------------------------------------------
// Taxonomy classification helpers
// ---------------------------------------------------------------------------

/** Taxonomy 1: errored lifecycle carrying a turn-concurrency failure. */
export function detectTurnConcurrencyLock(liveStatus: unknown, lastError: unknown): boolean {
  if (String(liveStatus ?? "").toLowerCase() !== "error") return false;
  return hasMarker(lastError, TURN_LOCK_MARKERS);
}

/** Taxonomy 2: an acknowledged turn was force-canceled after the timeout. */
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
    if ((nowEpochMs - canceledAt) / 1000 > recencySeconds) return false;
  }

  if (lastHandledCancellationAt != null) {
    const handledMs = coerceEpochMs(lastHandledCancellationAt);
    if (handledMs != null && (canceledAt == null || handledMs >= canceledAt)) return false;
  }

  const hasError = Boolean(String(lastError ?? "").trim());
  if (status === "idle" && !hasError) {
    if (lastActivityAt != null && canceledAt != null) {
      const activityMs = coerceEpochMs(lastActivityAt);
      if (activityMs != null && activityMs > canceledAt) return false;
    }
  }

  return true;
}

/** Taxonomy 3: pending permission blocks the agent. */
export function detectPendingPermissionBlocked(pendingPermissions: unknown): boolean {
  if (!pendingPermissions) return false;
  if (Array.isArray(pendingPermissions)) return pendingPermissions.length > 0;
  return false;
}

/** Taxonomy 4: idle with a stall signal, no active workers, and pending work. */
export function detectIdlePostErrorAmnesia(
  liveStatus: unknown,
  lastError: unknown,
  requiresAttention: unknown,
  attentionReason: unknown,
  activeWorkers: number,
  assumePendingWork = false,
  attentionTimestamp?: unknown,
  lastActivityAt?: unknown,
): boolean {
  if (String(liveStatus ?? "").toLowerCase() !== "idle") return false;
  if (activeWorkers > 0) return false;

  // Activity after the attention timestamp means the agent resumed since the
  // flag was raised, so it is recovered rather than amnesiac.
  if (attentionTimestamp != null && lastActivityAt != null) {
    const attMs = coerceEpochMs(attentionTimestamp);
    const actMs = coerceEpochMs(lastActivityAt);
    if (attMs != null && actMs != null && actMs > attMs) return false;
  }

  const reason = String(attentionReason ?? "").toLowerCase();
  const stalled = ATTENTION_STALL_REASONS.includes(reason) || Boolean(String(lastError ?? "").trim());
  if (stalled) return true;
  return Boolean(assumePendingWork && requiresAttention);
}

/** Taxonomy 5: running lifecycle with no activity inside the stale window. */
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

/** Taxonomy 6: healthy/idle lifecycle still carrying a disk lastError. */
export function detectStaleErrorGhosting(liveStatus: unknown, lastError: unknown): boolean {
  if (!HEALTHY_DISK_STATUSES.includes(String(liveStatus ?? "").toLowerCase())) return false;
  return Boolean(String(lastError ?? "").trim());
}

/** Taxonomy 7: fatal provider/quota error (not a recoverable transient). */
export function detectProviderQuotaExhaustion(lastError: unknown): boolean {
  const text = String(lastError ?? "").toLowerCase();
  if (!text) return false;
  if (hasMarker(text, TRANSIENT_MARKERS)) return false;
  return hasMarker(text, QUOTA_MARKERS);
}

// ---------------------------------------------------------------------------
// Safe-permission scope checks
// ---------------------------------------------------------------------------

const SAFE_PERMISSION_SCOPES = ["/tmp", "~/.paseo", "~/code"] as const;

export function extractPermissionScope(description: string): string | null {
  const match = description.match(/Scope:\s*([^\s]+)/);
  if (!match) return null;
  return match[1].replace(/\/+$/, "");
}

export function isSafePermission(perm: Record<string, unknown>): boolean {
  const desc = String(perm.description ?? perm.title ?? "");
  const scope = extractPermissionScope(desc);
  if (!scope) return false;
  for (const safe of SAFE_PERMISSION_SCOPES) {
    const expanded = safe.startsWith("~") ? join(process.env.HOME || "", safe.slice(1)) : safe;
    if (scope === expanded || scope.startsWith(expanded + "/")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Dead predicates
// ---------------------------------------------------------------------------

export interface DeadPredicateResult {
  predicate: string;
  evidence: string;
}

/** Dead predicate 1: absent from the daemon, still on disk. Evidence: ls + disk. */
export function detectDeadOrphanedDiskRecord(livePresent: boolean, diskPresent: boolean): boolean {
  return (!livePresent) && diskPresent;
}

/** Dead predicate 2: terminal lifecycle with a fatal (non-transient) lastError. */
export function detectDeadTerminalFatalError(liveStatus: unknown, lastError: unknown): boolean {
  if (!TERMINAL_DEAD_STATUSES.includes(String(liveStatus ?? "").toLowerCase())) return false;
  const text = String(lastError ?? "").trim();
  if (!text) return false;
  if (hasMarker(text, TRANSIENT_MARKERS)) return false;
  return true;
}

/** Dead predicate 3: running turn with no activity inside the stale window. */
export function detectDeadWedgedRunningTurn(
  liveStatus: unknown,
  lastActivityAt: unknown,
  now: number,
  staleSeconds: number,
): boolean {
  return detectZombieHungTurn(liveStatus, lastActivityAt, now, staleSeconds);
}

/** Dead predicate 4: registry still claims the id with no live process. */
export function detectDeadRegistryWithoutProcess(registrations: readonly string[] | null | undefined, livePresent: boolean): boolean {
  return Boolean(registrations?.length) && !livePresent;
}

/**
 * Dead predicate 5: terminal error or closed agent superseded by a newer retry.
 *
 * Requires:
 *   1. Status error or closed, and terminal rather than transient.
 *   2. No live child workers (activeWorkers == 0).
 *   3. Not referenced by fleet registries (registrations is empty).
 *   4. Successor B created strictly after A with matching scope and task name,
 *      and cwd(A) != cwd(B).
 */
export interface AgentCandidate {
  id: string;
  name?: string | null;
  title?: string | null;
  cwd?: string | null;
  createdAt?: number | string | null;
  labels?: Record<string, string> | null;
  parentAgentId?: string | null;
  repo?: string | null;
}

export function extractTaskName(name: string | null | undefined): string {
  if (!name) return "";
  const text = String(name).trim();
  const m = text.match(/^Worker\s*[·-]\s*(.*)/i);
  return m ? m[1].trim() : text;
}

export function matchTaskName(nameA: string | null | undefined, nameB: string | null | undefined): boolean {
  const taskA = extractTaskName(nameA);
  const taskB = extractTaskName(nameB);
  if (!taskA || !taskB) return false;
  if (taskA.toLowerCase() === taskB.toLowerCase()) return true;
  const re = /^([a-zA-Z0-9_./-]+#\d+)\b/;
  const mA = taskA.match(re);
  const mB = taskB.match(re);
  if (mA && mB && mA[1].toLowerCase() === mB[1].toLowerCase()) return true;
  return false;
}

export function getAgentScope(agent: AgentCandidate | null | undefined): [string | null, string | null] {
  if (!agent) return [null, null];
  const labels = agent.labels ?? {};
  const parentId =
    labels["paseo.parent-agent-id"] ??
    labels["parentAgentId"] ??
    agent.parentAgentId ??
    null;
  let repo = agent.repo ?? labels["repo"] ?? null;
  if (!repo) {
    const name = agent.name ?? agent.title ?? "";
    const m = name.match(/(?:Worker\s*[·-]\s*)?([a-zA-Z0-9_.-]+)#\d+/);
    if (m) repo = m[1];
    else {
      const orch = name.match(/Orchestrator\s*[·-]\s*([a-zA-Z0-9_./-]+)/);
      if (orch) repo = orch[1];
    }
  }
  return [parentId, repo];
}

export function matchAgentScope(a: AgentCandidate, b: AgentCandidate): boolean {
  const [parentA, repoA] = getAgentScope(a);
  const [parentB, repoB] = getAgentScope(b);
  if (parentA && parentB && String(parentA) === String(parentB)) return true;
  if (repoA && repoB) {
    const ra = repoA.split("/").pop()?.toLowerCase() ?? "";
    const rb = repoB.split("/").pop()?.toLowerCase() ?? "";
    if (ra === rb) return true;
  }
  return false;
}

export function normalizeAgentCwd(cwd: string | null | undefined): string | null {
  if (!cwd || typeof cwd !== "string") return null;
  return cwd.trim().replace(/^~(?=$|[/\\])/, process.env.HOME ?? "") || null;
}

export function getAgentCreatedAtMs(agent: AgentCandidate): number | null {
  if (!agent) return null;
  const val = agent.createdAt;
  if (val == null) return null;
  return coerceEpochMs(val);
}

/** Find a candidate successor B strictly newer than A matching scope, task, and distinct cwd. */
export function findSuccessorRetry(agent: AgentCandidate, candidates: AgentCandidate[]): AgentCandidate | null {
  const aidA = agent.id;
  const timeA = getAgentCreatedAtMs(agent);
  if (timeA == null) return null;
  const nameA = agent.name ?? agent.title;
  const cwdA = normalizeAgentCwd(agent.cwd);

  let best: AgentCandidate | null = null;
  let bestTime = -1;

  for (const cand of candidates) {
    if (cand.id === aidA) continue;
    const timeB = getAgentCreatedAtMs(cand);
    if (timeB == null || timeB <= timeA) continue;
    if (!matchAgentScope(agent, cand)) continue;
    const nameB = cand.name ?? cand.title;
    if (!matchTaskName(nameA, nameB)) continue;
    const cwdB = normalizeAgentCwd(cand.cwd);
    if (cwdA && cwdB && cwdA === cwdB) continue;
    if (timeB > bestTime) {
      bestTime = timeB;
      best = cand;
    }
  }
  return best;
}

export function detectDeadSupersededByRetry(
  agent: AgentCandidate & { liveStatus?: string; status?: string; lastStatus?: string; lastError?: string; activeWorkers?: number; registrations?: readonly string[] },
  candidates: AgentCandidate[],
): boolean {
  const status = String(agent.liveStatus ?? agent.status ?? agent.lastStatus ?? "").toLowerCase();
  if (!TERMINAL_DEAD_STATUSES.includes(status)) return false;
  if (status === "error") {
    if (!detectDeadTerminalFatalError(status, agent.lastError ?? "")) return false;
  }
  if ((agent.activeWorkers ?? 0) > 0) return false;
  if (agent.registrations?.length) return false;
  return findSuccessorRetry(agent, candidates) !== null;
}

// ---------------------------------------------------------------------------
// Kill safety guards
// ---------------------------------------------------------------------------

export interface KillGuardResult {
  allowed: boolean;
  reasons: string[];
}

/** Return every reason this agent must NOT be killed (empty reasons means allowed). */
export function killGuardReasons(
  assessment: {
    agentId: string;
    liveStatus: string;
    taxonomy: WatchdogTaxonomyType[];
    deadPredicates: string[];
    activeWorkers: number;
    frontDeskId?: string | null;
    selfId?: string | null;
    sameCwdAsSuccessor?: boolean;
  },
  opts: { selfId?: string | null; frontDeskId?: string | null } = {},
): KillGuardResult {
  const reasons: string[] = [];
  const { selfId = opts.selfId, frontDeskId = opts.frontDeskId } = opts;
  const dead = assessment.deadPredicates;

  if (dead.length === 0) {
    reasons.push("not classified as dead (no dead predicate holds)");
  }
  if (assessment.liveStatus === "running" && !dead.includes("DEAD_WEDGED_RUNNING_TURN")) {
    reasons.push("healthy running agent with recent activity");
  }
  if (assessment.activeWorkers > 0) {
    reasons.push(`has ${assessment.activeWorkers} live child worker(s)`);
  }
  if (frontDeskId && assessment.agentId === frontDeskId) {
    reasons.push("registered front desk");
  }
  if (selfId && assessment.agentId === selfId) {
    reasons.push("self / dispatching agent");
  }
  if (assessment.sameCwdAsSuccessor) {
    reasons.push("shares worktree cwd with successor");
  }

  return { allowed: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Assessment fusion
// ---------------------------------------------------------------------------

/**
 * Full health assessment combining taxonomy classification and dead-predicate verdicts.
 * Self-contained to avoid circular imports with hook-router.ts.
 */
export interface HealthAssessment {
  agentId: string;
  name: string | null;
  liveStatus: string;
  /** Taxonomy rules that fired. */
  taxonomy: WatchdogTaxonomyType[];
  /** Severity map for each taxonomy rule. */
  severities: Partial<Record<WatchdogTaxonomyType, WatchdogSeverity>>;
  /** Per-signal details. */
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
  /** Ordered list of dead-predicate names that hold. */
  deadPredicates: string[];
  /** Whether the agent is dead. */
  dead: boolean;
  /** Human-readable death explanations. */
  deadReasons: string[];
  /** Active child worker count. */
  activeWorkers: number;
  /** Whether the agent is present in the live daemon list. */
  livePresent: boolean;
  /** Registry entries referencing this agent. */
  registrations: string[];
  /** Agent that superseded this one (if any). */
  supersededBy: string | null;
  /** Pending permission descriptions. */
  pendingPermissions: string[];
}

const SEVERITIES: Record<string, WatchdogSeverity> = {
  TURN_CONCURRENCY_LOCK: "high",
  TURN_CANCELLATION_TIMEOUT: "high",
  PENDING_PERMISSION_BLOCKED: "medium",
  ZOMBIE_HUNG_TURN: "high",
  PROVIDER_QUOTA_EXHAUSTION: "high",
  STALE_ERROR_GHOSTING: "medium",
  IDLE_POST_ERROR_AMNESIA: "medium",
};

const TAXONOMY_ORDER: WatchdogTaxonomyType[] = [
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "PENDING_PERMISSION_BLOCKED",
  "IDLE_POST_ERROR_AMNESIA",
  "ZOMBIE_HUNG_TURN",
  "STALE_ERROR_GHOSTING",
  "PROVIDER_QUOTA_EXHAUSTION",
];

const DEAD_PREDICATE_ORDER = [
  "DEAD_ORPHANED_DISK_RECORD",
  "DEAD_TERMINAL_FATAL_ERROR",
  "DEAD_WEDGED_RUNNING_TURN",
  "DEAD_REGISTRY_WITHOUT_PROCESS",
  "DEAD_SUPERSEDED_BY_RETRY",
] as const;

const DEAD_PREDICATE_EVIDENCE: Record<string, string> = {
  DEAD_ORPHANED_DISK_RECORD: "live daemon list no longer contains the agent, but ~/.paseo/agents/<id>.json still exists",
  DEAD_TERMINAL_FATAL_ERROR: "status is error/closed with a non-transient disk lastError",
  DEAD_WEDGED_RUNNING_TURN: "running turn with no activity inside the stale window",
  DEAD_REGISTRY_WITHOUT_PROCESS: "fleet registry still references the agent id, but the live daemon list does not",
  DEAD_SUPERSEDED_BY_RETRY: "terminal error/closed session superseded by a newer retry with matching scope/task",
};

export interface BuildAssessmentOptions {
  cancellations?: ReadonlyMap<string, number | string | null> | null;
  cancellationRecencySeconds?: number;
  activeWorkers?: number;
  assumePendingWork?: boolean;
  runningStaleSeconds?: number;
  pendingPermissions?: Array<Record<string, unknown>>;
  livePresent?: boolean;
  registrations?: readonly string[];
  candidates?: AgentCandidate[];
  attentionTimestamp?: unknown;
  lastHandledCancellationAt?: unknown;
  /** True when this agent is the registered Front Desk. */
  isFrontDesk?: boolean;
  /** True when this agent is a registered orchestrator. */
  isOrchestrator?: boolean;
  /** Queue depth for this agent's router queue. */
  queueDepth?: number;
}

export function buildHealthAssessment(
  agentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  live: Record<string, any> | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  disk: Record<string, any> | null | undefined,
  now: number,
  options: BuildAssessmentOptions = {},
): HealthAssessment {
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

  // Taxonomy checks
  const checks: Record<string, boolean> = {
    TURN_CONCURRENCY_LOCK: detectTurnConcurrencyLock(liveStatus, rawLastError),
    TURN_CANCELLATION_TIMEOUT: detectCancellationTimeout(
      agentId, options.cancellations, liveStatus, now, recencySeconds,
      rawLastError, lastActivityAt, lastHandledCancellationAt,
    ),
    PENDING_PERMISSION_BLOCKED: detectPendingPermissionBlocked(options.pendingPermissions),
    IDLE_POST_ERROR_AMNESIA: detectIdlePostErrorAmnesia(
      liveStatus, rawLastError, requiresAttention, attentionReason,
      activeWorkers, options.assumePendingWork ?? false,
      options.attentionTimestamp, lastActivityAt,
    ),
    ZOMBIE_HUNG_TURN: (() => {
      // Exempt front-desk and registered orchestrators from ZOMBIE_HUNG_TURN
      // when their router queues are empty (depth === 0) and active workers is 0 (#1364).
      if ((options.isFrontDesk || options.isOrchestrator) && (options.queueDepth ?? 0) === 0 && activeWorkers === 0) {
        return false;
      }
      return detectZombieHungTurn(liveStatus, disk?.lastActivityAt ?? disk?.updatedAt, now, staleSeconds);
    })(),
    STALE_ERROR_GHOSTING: detectStaleErrorGhosting(liveStatus, rawLastError),
    PROVIDER_QUOTA_EXHAUSTION: detectProviderQuotaExhaustion(rawLastError),
  };

  const taxonomy = archived ? [] : TAXONOMY_ORDER.filter((name) => checks[name]);
  const severities: Partial<Record<WatchdogTaxonomyType, WatchdogSeverity>> = {};
  const details: Partial<Record<WatchdogTaxonomyType, string>> = {};
  for (const name of taxonomy) {
    severities[name] = SEVERITIES[name] ?? "medium";
    if (name === "TURN_CANCELLATION_TIMEOUT") details[name] = "acknowledged turn still active after timeout";
    else if (name === "IDLE_POST_ERROR_AMNESIA") details[name] = attentionReason ?? undefined;
    else if (name === "ZOMBIE_HUNG_TURN") details[name] = lastActivityAt ?? undefined;
    else if (name === "PENDING_PERMISSION_BLOCKED") {
      const perms = options.pendingPermissions ?? [];
      details[name] = perms.map((p) => String(p.description ?? p.title ?? "permission")).join("; ");
    }
    else details[name] = String(rawLastError || "").trim() || undefined;
  }

  // Dead predicates
  const livePresent = options.livePresent ?? true;
  const diskPresent = Boolean(disk?.path);
  const registrations = [...(options.registrations ?? [])];
  const candidates = options.candidates ?? [];

  const agentInfo: AgentCandidate & { liveStatus: string; lastError: string; activeWorkers: number; registrations: string[] } = {
    id: agentId,
    name: live?.name ?? live?.title ?? null,
    title: live?.title ?? live?.name ?? null,
    cwd: live?.cwd ?? disk?.cwd ?? null,
    createdAt: disk?.createdAt ?? live?.createdAt ?? null,
    labels: live?.labels ?? disk?.labels,
    parentAgentId: (live?.labels?.["paseo.parent-agent-id"] ?? disk?.labels?.["paseo.parent-agent-id"]) ?? null,
    repo: live?.labels?.repo ?? disk?.labels?.repo ?? null,
    liveStatus,
    lastError: rawLastError,
    activeWorkers,
    registrations,
  } as AgentCandidate & { liveStatus: string; lastError: string; activeWorkers: number; registrations: string[] };

  const deadChecks: Record<string, boolean> = {
    DEAD_ORPHANED_DISK_RECORD: detectDeadOrphanedDiskRecord(livePresent, diskPresent),
    DEAD_TERMINAL_FATAL_ERROR: detectDeadTerminalFatalError(liveStatus, rawLastError),
    DEAD_WEDGED_RUNNING_TURN: (() => {
      // Exempt front-desk and registered orchestrators with empty queues (#1364).
      if ((options.isFrontDesk || options.isOrchestrator) && (options.queueDepth ?? 0) === 0 && activeWorkers === 0) {
        return false;
      }
      return detectDeadWedgedRunningTurn(liveStatus, lastActivityAt, now, staleSeconds);
    })(),
    DEAD_REGISTRY_WITHOUT_PROCESS: detectDeadRegistryWithoutProcess(registrations, livePresent),
    DEAD_SUPERSEDED_BY_RETRY: detectDeadSupersededByRetry(agentInfo, candidates),
  };

  const deadPredicates = archived
    ? []
    : [...DEAD_PREDICATE_ORDER].filter((name) => deadChecks[name]);

  const successor = deadChecks.DEAD_SUPERSEDED_BY_RETRY
    ? findSuccessorRetry(agentInfo, candidates)
    : null;
  const supersededBy = successor?.id ?? null;

  const deadReasons: string[] = [];
  for (const name of deadPredicates) {
    if (name === "DEAD_SUPERSEDED_BY_RETRY") {
      const sid = supersededBy ? ` (${supersededBy})` : "";
      deadReasons.push(
        status === "closed"
          ? `dead_superseded_by_retry: closed session superseded by newer retry${sid}`
          : `dead_superseded_by_retry: terminal error session superseded by newer retry${sid}`,
      );
    } else {
      deadReasons.push(`${name}: ${DEAD_PREDICATE_EVIDENCE[name] ?? ""}`);
    }
  }

  return {
    agentId,
    name: live?.name ?? live?.title ?? null,
    liveStatus,
    taxonomy,
    severities,
    details,
    archived,
    lastError: String(rawLastError ?? ""),
    requiresAttention,
    attentionReason,
    lastActivityAt,
    lastHandledCancellationAt,
    diskPath: disk?.path ?? null,
    healthy: taxonomy.length === 0 && deadPredicates.length === 0,
    deadPredicates,
    dead: deadPredicates.length > 0,
    deadReasons,
    activeWorkers,
    livePresent,
    registrations,
    supersededBy,
    pendingPermissions: (options.pendingPermissions ?? []).map((p) => String(p.description ?? p.title ?? "permission")),
  } as HealthAssessment;
}

// ---------------------------------------------------------------------------
// Recovery plan
// ---------------------------------------------------------------------------

export interface RecoveryPlan {
  stop: boolean;
  clearError: boolean;
  clearAttention: boolean;
  allowPermissions: boolean;
  recordCancellationHandled: boolean;
  steer: boolean;
  steerMessage: string;
  blockedReason: string | null;
}

const STOP_TRIGGERS = new Set<WatchdogTaxonomyType>([
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "ZOMBIE_HUNG_TURN",
]);
const STEER_TRIGGERS = new Set<WatchdogTaxonomyType>([
  "TURN_CONCURRENCY_LOCK",
  "TURN_CANCELLATION_TIMEOUT",
  "ZOMBIE_HUNG_TURN",
  "IDLE_POST_ERROR_AMNESIA",
]);

export function planRecovery(taxonomy: readonly WatchdogTaxonomyType[], steerMessage: string = "Health check: your previous turn ended without resuming work. Sweep the board for triage and continue dispatching pending work."): RecoveryPlan {
  const set = new Set(taxonomy);
  const stop = [...set].some((type) => STOP_TRIGGERS.has(type));
  const steer = [...set].some((type) => STEER_TRIGGERS.has(type)) && !set.has("PROVIDER_QUOTA_EXHAUSTION");
  return {
    stop,
    clearError: set.has("STALE_ERROR_GHOSTING") || stop,
    clearAttention: set.has("IDLE_POST_ERROR_AMNESIA") || stop,
    allowPermissions: set.has("PENDING_PERMISSION_BLOCKED"),
    recordCancellationHandled: set.has("TURN_CANCELLATION_TIMEOUT"),
    steer,
    steerMessage,
    blockedReason:
      set.has("PROVIDER_QUOTA_EXHAUSTION") && !stop
        ? "provider/quota exhaustion requires operator circuit-break"
        : null,
  };
}

// ---------------------------------------------------------------------------
// Prune plan
// ---------------------------------------------------------------------------

export interface PrunePlan {
  kill: boolean;
  killBlockedReasons: string[];
  registry: boolean;
  deadPredicates: string[];
}

export function planPrune(
  assessment: HealthAssessment,
  opts: { selfId?: string | null; frontDeskId?: string | null } = {},
): PrunePlan {
  const guard = killGuardReasons(assessment, opts);
  return {
    kill: assessment.dead && guard.allowed,
    killBlockedReasons: guard.reasons,
    registry: assessment.dead && assessment.registrations.length > 0,
    deadPredicates: assessment.deadPredicates,
  };
}

// ---------------------------------------------------------------------------
// Disk metadata loader
// ---------------------------------------------------------------------------

export interface LoadedDiskEntry {
  path: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

// Type aliases for disk metadata (avoids circular imports)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type _WDisk = Record<string, any>;

/** Discover agent files under agents directory for each agent id JSON file and load them. */
export async function discoverAgentFiles(agentsDir: string): Promise<Map<string, LoadedDiskEntry>> {
  const result = new Map<string, LoadedDiskEntry>();
  try {
    const dirs = await readdir(agentsDir);
    for (const dir of dirs) {
      const dirPath = join(agentsDir, dir);
      try {
        const st = await stat(dirPath);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }
      try {
        const files = await readdir(dirPath);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          const agentId = file.replace(/\.json$/, "");
          const filePath = join(dirPath, file);
          try {
            const content = await readFile(filePath, "utf-8");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = JSON.parse(content) as Record<string, any>;
            if (typeof data === "object" && data !== null) {
              result.set(agentId, { path: filePath, data });
            }
          } catch {
            // corrupt file — skip silently
          }
        }
      } catch {
        // unreadable directory — skip
      }
    }
  } catch {
    // agentsDir doesn't exist or isn't readable
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cancellation timeout scanner
// ---------------------------------------------------------------------------

/** Scan daemon log lines for cancellation-timeout markers. Returns agentId -> newest epoch-ms. */
export function scanCancellationTimeouts(logPaths: string[]): Map<string, number | null> {
  const latest = new Map<string, number | null>();
  const needle = CANCELLATION_TIMEOUT_MARKER.toLowerCase();

  for (const logPath of logPaths) {
    try {
      const content = readFileSync(logPath, "utf-8");
      for (const line of content.split("\n")) {
        if (!line.toLowerCase().includes(needle)) continue;
        // Try JSON parse first
        let payload: Record<string, unknown> | null = null;
        try {
          payload = JSON.parse(line);
        } catch { /* not JSON */ }

        let agentId: string | null = null;
        if (payload?.agentId && typeof payload.agentId === "string") {
          agentId = payload.agentId;
        } else {
          const m = line.match(/"agentId"\s*:\s*"([0-9a-fA-F-]{8,})"/);
          agentId = m?.[1] ?? null;
        }
        if (!agentId) continue;

        let timestamp: number | null = null;
        if (payload) {
          const raw = payload.time;
          if (typeof raw === "number") timestamp = raw;
          else if (typeof raw === "string") {
            const parsed = Date.parse(raw);
            if (Number.isFinite(parsed)) timestamp = parsed;
          }
        }

        const prev = latest.get(agentId);
        if (timestamp != null && (prev == null || timestamp > prev)) {
          latest.set(agentId, timestamp);
        }
      }
    } catch {
      // unreadable log — skip
    }
  }

  return latest;
}
