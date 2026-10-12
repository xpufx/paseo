import { isTimeoutError, withTimeout } from "paseo-plugin-helper/shared";

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

export const DEFAULT_MULTI_HOST_INTERVAL_MS = 15_000;
export const DEFAULT_MULTI_HOST_TIMEOUT_MS = 4_000;

export interface MultiHostPoller {
  setHosts(hosts: readonly FleetHostInput[]): void;
  start(): void;
  stop(): void;
  pollOnce(): Promise<void>;
  getSnapshots(): FleetHostSnapshot[];
  dispose(): void;
}

/**
 * Closure-based on purpose: plugin client bundles are evaluated by Hermes from
 * source, where a `class` expression binds as `undefined`. A class here made the
 * Fleet tab crash with "Cannot read property 'prototype' of undefined"
 * (#1066, #510). Never use `class` in client-reachable code.
 */
export function createMultiHostPoller(opts: MultiHostPollerOptions): MultiHostPoller {
  const options = {
    timeoutMs: opts.timeoutMs ?? DEFAULT_MULTI_HOST_TIMEOUT_MS,
    intervalMs: opts.intervalMs ?? DEFAULT_MULTI_HOST_INTERVAL_MS,
    now: opts.now ?? (() => Date.now()),
    acquire: opts.acquire,
    onUpdate: opts.onUpdate,
  };
  const snapshots = new Map<string, FleetHostSnapshot>();
  const clients = new Map<string, FleetHostClient>();
  const inFlight = new Set<string>();
  /** Bumped on any connection transition so in-flight results are discarded. */
  const generation = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let tickInFlight = false;
  let disposed = false;

  function currentGeneration(serverId: string): number {
    return generation.get(serverId) ?? 0;
  }
  function bumpGeneration(serverId: string): void {
    generation.set(serverId, currentGeneration(serverId) + 1);
  }
  function getSnapshots(): FleetHostSnapshot[] {
    return sortFleetSnapshots([...snapshots.values()]);
  }
  function emit(): void {
    options.onUpdate?.(getSnapshots());
  }
  function acquireClient(serverId: string): FleetHostClient {
    const existing = clients.get(serverId);
    if (existing) return existing;
    const client = options.acquire(serverId);
    clients.set(serverId, client);
    return client;
  }
  function disposeClient(serverId: string): void {
    const client = clients.get(serverId);
    if (!client) return;
    clients.delete(serverId);
    try {
      void client.dispose();
    } catch {
      // A released borrowed client may already be disposed; ignore.
    }
  }

  async function probeHost(serverId: string): Promise<void> {
    const snapshot = snapshots.get(serverId);
    if (!snapshot) return;

    if (snapshot.connectionStatus !== "online") {
      snapshot.status = fleetStatusFor(snapshot.connectionStatus);
      snapshot.error =
        snapshot.connectionStatus === "error" ? "Host connection error" : null;
      return;
    }
    if (inFlight.has(serverId)) return;

    inFlight.add(serverId);
    const startGeneration = currentGeneration(serverId);
    const startedAt = options.now();
    try {
      const client = acquireClient(serverId);
      const counts = await withTimeout(
        client.readCounts(),
        options.timeoutMs,
        `fleet probe ${snapshot.label}`,
      );
      if (currentGeneration(serverId) !== startGeneration) return;
      snapshot.status = "online";
      snapshot.counts = counts;
      snapshot.latencyMs = options.now() - startedAt;
      snapshot.lastUpdatedAt = options.now();
      snapshot.staleAt = null;
      snapshot.error = null;
    } catch (cause) {
      if (currentGeneration(serverId) !== startGeneration) return;
      if (isTimeoutError(cause)) {
        // Unresponsive: mark stale with a timestamp and keep the borrowed
        // client. The next 15s tick is the only retry.
        snapshot.status = "stale";
        snapshot.staleAt = options.now();
        snapshot.error = "Timed out";
      } else {
        // A released/replaced connection surfaces here; drop the client so the
        // next probe reacquires a fresh one.
        snapshot.status = "error";
        snapshot.error = errorMessage(cause);
        disposeClient(serverId);
      }
    } finally {
      inFlight.delete(serverId);
    }
  }

  async function pollOnce(): Promise<void> {
    if (disposed || tickInFlight) return;
    tickInFlight = true;
    try {
      await Promise.all([...snapshots.keys()].map((serverId) => probeHost(serverId)));
    } finally {
      tickInFlight = false;
      emit();
    }
  }

  function setHosts(hosts: readonly FleetHostInput[]): void {
    if (disposed) return;
    const next = new Map(hosts.map((host) => [host.serverId, host]));

    for (const serverId of [...snapshots.keys()]) {
      if (!next.has(serverId)) {
        bumpGeneration(serverId);
        disposeClient(serverId);
        snapshots.delete(serverId);
        inFlight.delete(serverId);
      }
    }

    for (const host of next.values()) {
      const existing = snapshots.get(host.serverId);
      if (!existing) {
        snapshots.set(host.serverId, {
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
        bumpGeneration(host.serverId);
        disposeClient(host.serverId);
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

    emit();
  }

  function stop(): void {
    running = false;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    setHosts,
    /** Start the immediate poll plus the fixed-cadence loop. */
    start() {
      if (disposed || running) return;
      running = true;
      void pollOnce();
      timer = setInterval(() => void pollOnce(), options.intervalMs);
    },
    stop,
    /** Run one bounded pass over all hosts. Safe to await in tests. */
    pollOnce,
    getSnapshots,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      for (const serverId of [...clients.keys()]) disposeClient(serverId);
      snapshots.clear();
      inFlight.clear();
    },
  };
}
