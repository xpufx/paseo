import { TimeoutError, withTimeout } from "paseo-plugin-helper/shared";

/**
 * Bounded multi-host fleet polling state machine.
 *
 * Pure, framework-free logic shared by the client hook and exercised directly
 * by unit tests. It owns the exact contract from #299: at most one in-flight
 * probe per host, a slower cadence than the local five-second poll, a
 * per-host timeout that marks the host `stale` with a timestamp, and
 * dispose/reacquire of the borrowed host client across connection
 * transitions.
 *
 * It deliberately does not model CPU/RAM/disk gauges: the Paseo plugin SDK
 * exposes no host-metrics RPC on a borrowed host client (verified against
 * 0.9.0 and 0.9.2), and fabricating them would be mock data. Only counts are
 * aggregated (never summed/averaged gauges), matching the #299 rule.
 */

export type HostConnectionStatus =
  | "idle"
  | "connecting"
  | "online"
  | "offline"
  | "error";

export type FleetHostStatus = "online" | "stale" | "offline" | "error";

export interface FleetHostInput {
  serverId: string;
  label: string;
  status: HostConnectionStatus;
}

/** Cross-host counts. These are the only fleet-additive metrics. */
export interface FleetHostCounts {
  agents: number;
  activeAgents: number;
  workspaces: number;
}

export interface FleetHostSnapshot {
  serverId: string;
  label: string;
  connectionStatus: HostConnectionStatus;
  status: FleetHostStatus;
  /** Round-trip latency of the last successful probe, in milliseconds. */
  latencyMs: number | null;
  /** Epoch ms of the last successful probe. */
  lastUpdatedAt: number | null;
  /** Epoch ms when the host was first marked stale; cleared on recovery. */
  staleAt: number | null;
  error: string | null;
  counts: FleetHostCounts | null;
}

/**
 * A borrowed host client. Mirrors the structural slice of `PaseoApi` the
 * fleet needs, so `getPaseoClient(serverId)` satisfies it without importing
 * the Paseo SDK types into shared code.
 */
export interface FleetHostClient {
  readCounts(): Promise<FleetHostCounts>;
  dispose(): Promise<void> | void;
}

export interface MultiHostPollerOptions {
  acquire(serverId: string): FleetHostClient;
  /** Per-host request timeout. Default 4000ms (#299). */
  timeoutMs?: number;
  /** Polling cadence. Default 15000ms, slower than the local 5s poll (#299). */
  intervalMs?: number;
  now?: () => number;
  onUpdate?: (snapshots: FleetHostSnapshot[]) => void;
}

export interface FleetAggregate {
  hosts: number;
  online: number;
  stale: number;
  offline: number;
  error: number;
  /** Hosts currently returning real data (online or stale). */
  responsive: number;
  /** Sum of counts across responsive hosts. Gauges are never aggregated. */
  counts: FleetHostCounts;
}

function emptyCounts(): FleetHostCounts {
  return { agents: 0, activeAgents: 0, workspaces: 0 };
}

function fleetStatusFor(connection: HostConnectionStatus): FleetHostStatus {
  if (connection === "online") return "online";
  if (connection === "error") return "error";
  return "offline";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function sortFleetSnapshots(
  snapshots: readonly FleetHostSnapshot[],
): FleetHostSnapshot[] {
  return [...snapshots].sort((a, b) => {
    const byLabel = a.label.localeCompare(b.label);
    return byLabel !== 0 ? byLabel : a.serverId.localeCompare(b.serverId);
  });
}

/** Sum counts only; hardware gauges are per-host and never aggregated. */
export function aggregateFleet(
  snapshots: readonly FleetHostSnapshot[],
): FleetAggregate {
  const aggregate: FleetAggregate = {
    hosts: snapshots.length,
    online: 0,
    stale: 0,
    offline: 0,
    error: 0,
    responsive: 0,
    counts: emptyCounts(),
  };
  for (const snapshot of snapshots) {
    aggregate[snapshot.status] += 1;
    if (snapshot.counts) {
      aggregate.responsive += 1;
      aggregate.counts.agents += snapshot.counts.agents;
      aggregate.counts.activeAgents += snapshot.counts.activeAgents;
      aggregate.counts.workspaces += snapshot.counts.workspaces;
    }
  }
  return aggregate;
}

export class MultiHostPoller {
  static readonly DEFAULT_INTERVAL_MS = 15_000;
  static readonly DEFAULT_TIMEOUT_MS = 4_000;

  private readonly options: Required<
    Pick<MultiHostPollerOptions, "timeoutMs" | "intervalMs" | "now">
  > &
    Pick<MultiHostPollerOptions, "acquire" | "onUpdate">;
  private readonly snapshots = new Map<string, FleetHostSnapshot>();
  private readonly clients = new Map<string, FleetHostClient>();
  private readonly inFlight = new Set<string>();
  /** Bumped on any connection transition so in-flight results are discarded. */
  private readonly generation = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tickInFlight = false;
  private disposed = false;

  constructor(options: MultiHostPollerOptions) {
    this.options = {
      timeoutMs: options.timeoutMs ?? MultiHostPoller.DEFAULT_TIMEOUT_MS,
      intervalMs: options.intervalMs ?? MultiHostPoller.DEFAULT_INTERVAL_MS,
      now: options.now ?? (() => Date.now()),
      acquire: options.acquire,
      onUpdate: options.onUpdate,
    };
  }

  /** Reconcile the live host list, releasing clients across transitions. */
  setHosts(hosts: readonly FleetHostInput[]): void {
    if (this.disposed) return;
    const next = new Map(hosts.map((host) => [host.serverId, host]));

    for (const serverId of [...this.snapshots.keys()]) {
      if (!next.has(serverId)) {
        this.bumpGeneration(serverId);
        this.disposeClient(serverId);
        this.snapshots.delete(serverId);
        this.inFlight.delete(serverId);
      }
    }

    for (const host of next.values()) {
      const existing = this.snapshots.get(host.serverId);
      if (!existing) {
        this.snapshots.set(host.serverId, {
          serverId: host.serverId,
          label: host.label,
          connectionStatus: host.status,
          status: fleetStatusFor(host.status),
          latencyMs: null,
          lastUpdatedAt: null,
          staleAt: null,
          error: null,
          counts: null,
        });
        continue;
      }
      const transitioned = existing.connectionStatus !== host.status;
      if (transitioned) {
        // A status change (including reconnect/failover) invalidates the
        // borrowed client; reacquire on the next probe.
        this.bumpGeneration(host.serverId);
        this.disposeClient(host.serverId);
        existing.connectionStatus = host.status;
        existing.status = fleetStatusFor(host.status);
        if (host.status !== "online") {
          // Disconnected hosts keep no counts; only a `stale` probe retains
          // its last-known snapshot as a deliberate "unresponsive" state.
          existing.staleAt = null;
          existing.counts = null;
        }
      }
      existing.label = host.label;
    }

    this.emit();
  }

  /** Start the immediate poll plus the fixed-cadence loop. */
  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), this.options.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run one bounded pass over all hosts. Safe to await in tests. */
  async pollOnce(): Promise<void> {
    if (this.disposed || this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      await Promise.all(
        [...this.snapshots.keys()].map((serverId) => this.probeHost(serverId)),
      );
    } finally {
      this.tickInFlight = false;
      this.emit();
    }
  }

  getSnapshots(): FleetHostSnapshot[] {
    return sortFleetSnapshots([...this.snapshots.values()]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const serverId of [...this.clients.keys()]) {
      this.disposeClient(serverId);
    }
    this.snapshots.clear();
    this.inFlight.clear();
  }

  private async probeHost(serverId: string): Promise<void> {
    const snapshot = this.snapshots.get(serverId);
    if (!snapshot) return;

    if (snapshot.connectionStatus !== "online") {
      snapshot.status = fleetStatusFor(snapshot.connectionStatus);
      snapshot.error =
        snapshot.connectionStatus === "error" ? "Host connection error" : null;
      return;
    }
    if (this.inFlight.has(serverId)) return;

    this.inFlight.add(serverId);
    const generation = this.currentGeneration(serverId);
    const startedAt = this.options.now();
    let timedOut = false;
    try {
      const client = this.acquireClient(serverId);
      const counts = await withTimeout(
        client.readCounts(),
        this.options.timeoutMs,
        `fleet probe ${snapshot.label}`,
      );
      if (this.currentGeneration(serverId) !== generation) return;
      snapshot.status = "online";
      snapshot.counts = counts;
      snapshot.latencyMs = this.options.now() - startedAt;
      snapshot.lastUpdatedAt = this.options.now();
      snapshot.staleAt = null;
      snapshot.error = null;
    } catch (cause) {
      if (this.currentGeneration(serverId) !== generation) return;
      timedOut = cause instanceof TimeoutError;
      if (timedOut) {
        // Unresponsive: mark stale with a timestamp and keep the borrowed
        // client. The next 15s tick is the only retry.
        snapshot.status = "stale";
        snapshot.staleAt = this.options.now();
        snapshot.error = "Timed out";
      } else {
        // A released/replaced connection surfaces here; drop the client so the
        // next probe reacquires a fresh one.
        snapshot.status = "error";
        snapshot.error = errorMessage(cause);
        this.disposeClient(serverId);
      }
    } finally {
      this.inFlight.delete(serverId);
    }
  }

  private acquireClient(serverId: string): FleetHostClient {
    const existing = this.clients.get(serverId);
    if (existing) return existing;
    const client = this.options.acquire(serverId);
    this.clients.set(serverId, client);
    return client;
  }

  private disposeClient(serverId: string): void {
    const client = this.clients.get(serverId);
    if (!client) return;
    this.clients.delete(serverId);
    try {
      void client.dispose();
    } catch {
      // A released borrowed client may already be disposed; ignore.
    }
  }

  private currentGeneration(serverId: string): number {
    return this.generation.get(serverId) ?? 0;
  }

  private bumpGeneration(serverId: string): void {
    this.generation.set(serverId, this.currentGeneration(serverId) + 1);
  }

  private emit(): void {
    this.options.onUpdate?.(this.getSnapshots());
  }
}
