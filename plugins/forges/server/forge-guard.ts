/**
 * Poll-path guard for the forges plugin (issue #114). Holds in-memory state
 * only — no timers, no network, no logging — so the caller stays in charge of
 * emitting at most one WARN/INFO per host while a non-forge remote or a
 * flapping repo is polled every cycle.
 */

/**
 * How long a negative host probe is trusted. A real forge that is briefly
 * unreachable (daemon start, network blip) must not be written off for the
 * lifetime of the process, so the miss expires and is re-probed.
 */
export const NEGATIVE_PROBE_TTL_MS = 300_000;

export type GuardLogLevel = "info" | "debug" | "warn";

interface ProbeEntry {
  speaksForgeApi: boolean;
  at: number;
}

export class ForgeGuard {
  private readonly probes = new Map<string, ProbeEntry>();
  private readonly quietLogged = new Set<string>();
  private readonly failures = new Map<string, number>();
  private readonly now: () => number;
  private readonly negativeProbeTtlMs: number;

  constructor(
    options: { now?: () => number; negativeProbeTtlMs?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.negativeProbeTtlMs = options.negativeProbeTtlMs ?? NEGATIVE_PROBE_TTL_MS;
  }

  /**
   * Cached verdict: a host that speaks the forge API stays cached, a negative
   * verdict expires. Null means the caller must probe.
   */
  cachedProbe(host: string): boolean | null {
    const entry = this.probes.get(host);
    if (!entry) return null;
    if (entry.speaksForgeApi) return true;
    return this.now() - entry.at < this.negativeProbeTtlMs ? false : null;
  }

  recordProbe(host: string, speaksForgeApi: boolean): void {
    this.probes.set(host, { speaksForgeApi, at: this.now() });
  }

  /** Skip-log level for a non-forge host: info the first time, debug after. */
  skipLogLevel(host: string): GuardLogLevel {
    if (this.quietLogged.has(host)) return "debug";
    this.quietLogged.add(host);
    return "info";
  }

  /** List-failure level: warn the first time per repo, debug on repeats. */
  failureLogLevel(host: string, repo: string): GuardLogLevel {
    const key = `${host}/${repo}`;
    const count = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, count);
    return count <= 1 ? "warn" : "debug";
  }

  /** A successful list clears the backoff so the next failure warns again. */
  noteSuccess(host: string, repo: string): void {
    this.failures.delete(`${host}/${repo}`);
  }
}
