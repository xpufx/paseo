import type {
  RotationPolicy,
  RotationRole,
  RotationRolePolicy,
} from "../shared/contracts.js";
import { canonicalRepoKey } from "../shared/repo-identity.js";

/**
 * Provider-independent rotation core for the long-lived fleet roles (#1019).
 *
 * This module is deliberately pure: it resolves the layered policy, evaluates
 * the trigger thresholds and renders the rotation brief. The side-effecting
 * protocol (spawn -> verify -> brief -> archive) lives on `HookRouter`, which
 * reuses the existing spawn/archive/handoff primitives rather than inventing a
 * second lifecycle.
 */

export const ROTATION_ROLES: readonly RotationRole[] = [
  "orchestrator",
  "front-desk",
  "auditor",
  "coding-agent",
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Built-in defaults from the approved #1019 spec. */
export const DEFAULT_ROTATION_ROLE_POLICY: Record<RotationRole, Required<RotationRolePolicy>> = {
  orchestrator: {
    enabled: true,
    maxAgeMs: 2 * HOUR,
    maxTurns: 50,
    tokenPressure: 0.85,
    failureWindowMs: 15 * MINUTE,
    failureThreshold: 3,
    cooldownMs: 30 * MINUTE,
  },
  "front-desk": {
    enabled: true,
    maxAgeMs: 3 * HOUR,
    maxTurns: 75,
    tokenPressure: 0.85,
    failureWindowMs: 15 * MINUTE,
    failureThreshold: 3,
    cooldownMs: 30 * MINUTE,
  },
  auditor: {
    enabled: false,
    maxAgeMs: 2 * HOUR,
    maxTurns: 50,
    tokenPressure: 0.85,
    failureWindowMs: 15 * MINUTE,
    failureThreshold: 3,
    cooldownMs: 30 * MINUTE,
  },
  "coding-agent": {
    enabled: false,
    maxAgeMs: 2 * HOUR,
    maxTurns: 50,
    tokenPressure: 0.85,
    failureWindowMs: 15 * MINUTE,
    failureThreshold: 3,
    cooldownMs: 30 * MINUTE,
  },
};

export const DEFAULT_ROTATION_POLICY: RotationPolicy = {
  roles: {},
  byRepo: {},
};

export function isRotationRole(value: unknown): value is RotationRole {
  return typeof value === "string" && (ROTATION_ROLES as readonly string[]).includes(value);
}

function roleDefaults(role: string): Required<RotationRolePolicy> {
  return isRotationRole(role)
    ? DEFAULT_ROTATION_ROLE_POLICY[role]
    : DEFAULT_ROTATION_ROLE_POLICY.orchestrator;
}

/**
 * Resolve the effective policy for `role` in `repo`. Precedence, most specific
 * last: built-in defaults -> global role override -> per-repo role override.
 * Every field is optional in storage, so a partial override preserves the
 * default for the fields it does not name.
 */
export function resolveRotationPolicy(
  policy: RotationPolicy | null | undefined,
  role: string,
  repo?: string | null,
): Required<RotationRolePolicy> {
  const base = roleDefaults(role);
  const global = policy?.roles?.[role];
  const canonical = repo ? (canonicalRepoKey(repo) ?? repo) : undefined;
  const perRepo =
    (canonical ? policy?.byRepo?.[canonical]?.[role] : undefined) ??
    (repo ? policy?.byRepo?.[repo]?.[role] : undefined) ??
    findRepoOverride(policy, repo ?? undefined, role);
  return { ...base, ...(global ?? {}), ...(perRepo ?? {}) };
}

function findRepoOverride(
  policy: RotationPolicy | null | undefined,
  repo: string | undefined,
  role: string,
): RotationRolePolicy | undefined {
  const byRepo = policy?.byRepo;
  if (!byRepo || !repo) return undefined;
  const target = canonicalRepoKey(repo) ?? repo;
  for (const [key, roles] of Object.entries(byRepo)) {
    if ((canonicalRepoKey(key) ?? key) === target && roles[role]) return roles[role];
  }
  return undefined;
}

export interface RotationObservation {
  role: string;
  repo?: string | null;
  /** Epoch ms when the incumbent session was spawned, when known. */
  spawnedAtMs?: number | null;
  /** Turns recorded for the incumbent. */
  turns?: number | null;
  contextWindowUsedTokens?: number | null;
  contextWindowMaxTokens?: number | null;
  /** Epoch ms of each recent failure/timeout inside the observation window. */
  failureTimestampsMs?: number[] | null;
}

export interface RotationTriggerContext {
  nowMs: number;
  lastRotationAtMs?: number | null;
  /** True while the incumbent is mid-turn. */
  midTurn?: boolean;
  /** True while a rotation for this role/repo is already running. */
  inFlight?: boolean;
  /** Explicit manual trigger: bypasses enabled/cooldown/thresholds/mid-turn. */
  forced?: boolean;
}

export type RotationTriggerReason =
  | "manual"
  | "age"
  | "turns"
  | "token-pressure"
  | "failures";

export type RotationBlockReason = "disabled" | "cooldown" | "mid-turn" | "in-flight";

export interface RotationTriggerDecision {
  shouldRotate: boolean;
  reason: RotationTriggerReason | null;
  triggers: RotationTriggerReason[];
  blocked: RotationBlockReason | null;
  cooldownRemainingMs: number;
  policy: Required<RotationRolePolicy>;
  reasons: string[];
}

function countRecentFailures(timestamps: number[] | null | undefined, nowMs: number, windowMs: number): number {
  if (!timestamps || timestamps.length === 0) return 0;
  const floor = nowMs - windowMs;
  let count = 0;
  for (const ts of timestamps) {
    if (typeof ts === "number" && Number.isFinite(ts) && ts >= floor && ts <= nowMs) count += 1;
  }
  return count;
}

/**
 * Evaluate whether a role should rotate. Automatic triggers fire on age OR
 * turns (whichever first) plus token pressure and repeated failures. Manual
 * triggers always win, but never overlap an in-flight rotation: the fixed
 * one-at-a-time guardrail applies to both paths.
 */
export function evaluateRotationTrigger(
  observation: RotationObservation,
  context: RotationTriggerContext,
  policyInput?: RotationPolicy | null,
): RotationTriggerDecision {
  const policy = resolveRotationPolicy(policyInput, observation.role, observation.repo);
  const nowMs = context.nowMs;
  const cooldownElapsed = context.lastRotationAtMs == null ? Infinity : nowMs - context.lastRotationAtMs;
  const cooldownRemainingMs = Number.isFinite(cooldownElapsed)
    ? Math.max(0, policy.cooldownMs - cooldownElapsed)
    : 0;

  const empty = (
    blocked: RotationBlockReason | null,
    reason: RotationTriggerReason | null = null,
  ): RotationTriggerDecision => ({
    shouldRotate: false,
    reason,
    triggers: [],
    blocked,
    cooldownRemainingMs,
    policy,
    reasons: [],
  });

  if (context.inFlight) return empty("in-flight");

  if (context.forced) {
    return {
      shouldRotate: true,
      reason: "manual",
      triggers: ["manual"],
      blocked: null,
      cooldownRemainingMs,
      policy,
      reasons: ["manual rotation requested"],
    };
  }

  if (!policy.enabled) return empty("disabled");
  if (cooldownRemainingMs > 0) return empty("cooldown");
  if (context.midTurn) return empty("mid-turn");

  const triggers: RotationTriggerReason[] = [];
  const reasons: string[] = [];

  if (observation.spawnedAtMs != null && policy.maxAgeMs > 0) {
    const ageMs = nowMs - observation.spawnedAtMs;
    if (ageMs >= policy.maxAgeMs) {
      triggers.push("age");
      reasons.push(`age ${Math.round(ageMs / MINUTE)}m >= ${Math.round(policy.maxAgeMs / MINUTE)}m`);
    }
  }

  if (observation.turns != null && policy.maxTurns > 0 && observation.turns >= policy.maxTurns) {
    triggers.push("turns");
    reasons.push(`turns ${observation.turns} >= ${policy.maxTurns}`);
  }

  if (
    observation.contextWindowUsedTokens != null &&
    observation.contextWindowMaxTokens != null &&
    observation.contextWindowMaxTokens > 0
  ) {
    const pressure = observation.contextWindowUsedTokens / observation.contextWindowMaxTokens;
    if (pressure >= policy.tokenPressure) {
      triggers.push("token-pressure");
      reasons.push(`token pressure ${(pressure * 100).toFixed(1)}% >= ${(policy.tokenPressure * 100).toFixed(0)}%`);
    }
  }

  const failures = countRecentFailures(observation.failureTimestampsMs, nowMs, policy.failureWindowMs);
  if (policy.failureThreshold > 0 && failures >= policy.failureThreshold) {
    triggers.push("failures");
    reasons.push(`failures ${failures} >= ${policy.failureThreshold}/${Math.round(policy.failureWindowMs / MINUTE)}m`);
  }

  if (triggers.length === 0) {
    return { shouldRotate: false, reason: null, triggers, blocked: null, cooldownRemainingMs, policy, reasons };
  }

  // Age OR turns fire first; the remaining triggers are additional signals.
  const reason = triggers.includes("age")
    ? "age"
    : triggers.includes("turns")
      ? "turns"
      : triggers.includes("token-pressure")
        ? "token-pressure"
        : "failures";

  return { shouldRotate: true, reason, triggers, blocked: null, cooldownRemainingMs, policy, reasons };
}

export interface RotationBriefTicket {
  number: number;
  title: string;
  reason?: string;
}

export interface RotationBriefInput {
  role: string;
  repo?: string | null;
  reason?: string | null;
  previousAgentId?: string | null;
  generatedAt: string;
  skillPath?: string | null;
  /** Effective skill text, inlined so the replacement never needs a file read (#1080). */
  skillText?: string | null;
  activeTickets?: RotationBriefTicket[];
  pendingAttention?: RotationBriefTicket[];
  queueDepth?: number | null;
  lastHookDigest?: string | null;
  lastSweepDigest?: string | null;
  notes?: string | null;
}

function renderTickets(label: string, tickets: RotationBriefTicket[] | undefined): string[] {
  const lines: string[] = [`- **${label}**: ${tickets?.length ?? 0}`];
  for (const t of tickets ?? []) {
    lines.push(`  - #${t.number}: ${t.title}${t.reason ? ` (${t.reason})` : ""}`);
  }
  return lines;
}

/**
 * Render the rotation brief handed to the replacement. Board-native by design:
 * the fresh agent re-reads its skill file and rebuilds orientation from this
 * snapshot of what the incumbent was holding.
 */
export function buildRotationBrief(input: RotationBriefInput): string {
  const lines: string[] = [
    `# Rotation Brief — ${input.role}${input.repo ? ` · ${input.repo}` : ""}`,
    `*Generated at: ${input.generatedAt}*`,
    "",
    "## Rotation",
    `- Role: ${input.role}`,
    input.repo ? `- Repository: ${input.repo}` : "- Repository: (singleton role)",
    `- Reason: ${input.reason?.trim() || "triggered"}`,
    `- Previous agent: ${input.previousAgentId ? `\`${input.previousAgentId}\`` : "_none registered_"}`,
  ];
  if (input.skillPath) {
    lines.push(`- Skill to follow: \`${input.skillPath}\``);
  }
  if (input.skillText?.trim()) {
    lines.push("", "## Effective Skill (inlined)", input.skillText.trim());
  }
  lines.push("", "## Board");
  lines.push(...renderTickets("Active tickets", input.activeTickets));
  lines.push(...renderTickets("Pending attention", input.pendingAttention));
  lines.push(`- Queue depth: ${input.queueDepth ?? 0}`);
  lines.push("", "## Recent context");
  lines.push(`- Last hook digest: ${input.lastHookDigest?.trim() || "_none_"}`);
  lines.push(`- Last sweep digest: ${input.lastSweepDigest?.trim() || "_none_"}`);
  if (input.notes?.trim()) {
    lines.push("", "## Notes", input.notes.trim());
  }
  lines.push(
    "",
    "## Next steps",
    "1. Re-read the skill file above.",
    "2. Reconcile the board and worker roster for this role.",
    "3. Continue from the pending attention items; do not double-dispatch active tickets.",
  );
  return lines.join("\n");
}

/**
 * Tracks at most one in-flight rotation per role (and per repo for
 * orchestrators). Exported so the one-at-a-time guardrail is unit-testable
 * independently of the spawn path.
 */
export class RotationLock {
  private readonly locked = new Set<string>();

  public static key(role: string, repo?: string | null): string {
    return repo ? `${role}:${repo.toLowerCase()}` : role;
  }

  public acquire(role: string, repo?: string | null): boolean {
    const key = RotationLock.key(role, repo);
    if (this.locked.has(key)) return false;
    this.locked.add(key);
    return true;
  }

  public release(role: string, repo?: string | null): void {
    this.locked.delete(RotationLock.key(role, repo));
  }

  public isLocked(role: string, repo?: string | null): boolean {
    return this.locked.has(RotationLock.key(role, repo));
  }
}
