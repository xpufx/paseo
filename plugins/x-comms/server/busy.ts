import { DEFER_VERDICT_TTL_MS, LOCAL_DAEMON, deferTargetKey, type DeferTarget } from "./defer-queue";

/**
 * Busy detection for a send target (#598).
 *
 * There is no cross-daemon subscription to another daemon's agent turns, so
 * "is this target mid-turn" is answered from two sources:
 *
 *   - local: the plugin server's own `agent.turn_started` / `agent.turn_ended`
 *     hooks. Free and authoritative, but only for agents on this daemon, and
 *     only for turns that started after the plugin loaded.
 *   - remote (or any local agent the hooks have not seen): a status probe —
 *     the SDK snapshot for a local agent, `paseo inspect --host` for a peer.
 *
 * The verdict cache is not just an optimisation. A send starts a turn, so after
 * a successful dispatch the target is busy by construction; without recording
 * that, a second send in the same burst would re-probe, read the *pre-turn*
 * status off a stale snapshot, and preempt the turn the first send just
 * started. `noteDispatched` closes that window.
 */

/**
 * Lifecycle states that mean a turn is in progress or about to be.
 *
 * A deny-list, not `status !== "idle"`: `error` and `closed` are not preemption
 * hazards (nothing is running to replace) and treating them as busy would pin a
 * queue against an agent that has already crashed, with no turn ever coming to
 * drain it. The daemon's own lifecycle set is
 * initializing | idle | running | error | closed; `permission` variants and the
 * plain `busy` spelling are included because a blocked-on-permission turn is
 * still live, and because a peer may report the state under that name.
 */
export const BUSY_LIFECYCLE_STATUSES: ReadonlySet<string> = new Set([
  "initializing",
  "running",
  "busy",
  "permission",
  "awaiting_permission",
  "waiting_permission",
]);

/**
 * Read the lifecycle out of a probe payload. Daemons are inconsistent about
 * casing: `paseo inspect --json` answers `Status`, `paseo ls --json` answers
 * `status`. Unreadable returns null, which the gate treats as "do not block".
 */
export function readLifecycleStatus(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  for (const key of ["Status", "status", "lifecycle", "Lifecycle"]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
  }
  return null;
}

export function isBusyStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return BUSY_LIFECYCLE_STATUSES.has(status.trim().toLowerCase());
}

/** Answers the lifecycle of a target, or null when it cannot be read. */
export type BusyProbe = (target: DeferTarget) => Promise<string | null>;

interface Verdict {
  busy: boolean;
  at: number;
}

export interface BusyGateOptions {
  probe: BusyProbe;
  now?: () => number;
  ttlMs?: number;
}

export class BusyGate {
  private readonly probe: BusyProbe;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly verdicts = new Map<string, Verdict>();
  /** Local agents with a turn in progress, from the daemon's own hooks. */
  private readonly runningTurns = new Set<string>();

  constructor(options: BusyGateOptions) {
    this.probe = options.probe;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFER_VERDICT_TTL_MS;
  }

  noteLocalTurnStarted(agentId: string): void {
    this.runningTurns.add(agentId);
    // The hook is a stronger signal than any cached verdict for this agent.
    this.verdicts.delete(this.key({ daemon: LOCAL_DAEMON, agentId }));
  }

  noteLocalTurnEnded(agentId: string): void {
    this.runningTurns.delete(agentId);
    this.verdicts.delete(this.key({ daemon: LOCAL_DAEMON, agentId }));
  }

  /**
   * Record that we just started this target's turn. Without this the next send
   * in the same burst re-probes and can read a snapshot taken before the turn
   * started, which is exactly the preemption this gate exists to stop.
   */
  noteDispatched(target: DeferTarget): void {
    this.verdicts.set(this.key(target), { busy: true, at: this.now() });
  }

  invalidate(target?: DeferTarget): void {
    if (target) this.verdicts.delete(this.key(target));
    else this.verdicts.clear();
  }

  /**
   * True when the target must not be sent to right now.
   *
   * Fails open: a probe that errors or reports a state we cannot read dispatches
   * and lets the outbox handle an undeliverable target. Failing closed would
   * turn "cannot tell" into "silently swallow the message", which is a worse
   * failure than the preemption it was meant to prevent.
   */
  async isBusy(target: DeferTarget): Promise<boolean> {
    if (target.daemon === LOCAL_DAEMON && this.runningTurns.has(target.agentId)) return true;
    const cached = this.verdicts.get(this.key(target));
    if (cached && this.now() - cached.at < this.ttlMs) return cached.busy;
    let status: string | null = null;
    try {
      status = await this.probe(target);
    } catch {
      status = null;
    }
    const busy = isBusyStatus(status);
    this.verdicts.set(this.key(target), { busy, at: this.now() });
    return busy;
  }

  private key(target: DeferTarget): string {
    return deferTargetKey(target);
  }
}
