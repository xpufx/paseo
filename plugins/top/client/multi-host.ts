import * as pluginClient from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MultiHostPoller,
  type FleetHostClient,
  type FleetHostCounts,
  type FleetHostSnapshot,
} from "../shared/multi-host";

/** The host summary shape `useHosts` returns (the SDK's `PluginHostSummary`). */
interface HostSummary {
  readonly serverId: string;
  readonly label: string;
  readonly status: "idle" | "connecting" | "online" | "offline" | "error";
}

/** The structural slice of the borrowed host client this module reads. */
interface BorrowedPaseoClient {
  agents: { list(): Promise<{ entries?: Array<{ agent?: { status?: string } }> }> };
  workspaces: { list(): Promise<{ entries?: unknown[] }> };
  dispose(): Promise<void> | void;
}

/**
 * `@getPaseo/plugin/client` declares `useHosts`/`getPaseoClient` but only the
 * app's client bundle loader supplies them, and not every host does: the mobile
 * bundle omits them, so the named imports bind `undefined` there. Access them
 * through a namespace and feature-detect, rather than calling an absent hook
 * and crashing the whole Fleet tab.
 */
const clientPrimitives = pluginClient as unknown as {
  useHosts?: () => readonly HostSummary[];
  getPaseoClient?: (serverId: string) => BorrowedPaseoClient;
};

/** True when the running host supplies the multi-host primitives. */
export function multiHostSupported(): boolean {
  return (
    typeof clientPrimitives.useHosts === "function" &&
    typeof clientPrimitives.getPaseoClient === "function"
  );
}

/**
 * Wrap a borrowed `getPaseoClient(serverId)` as a fleet client.
 *
 * Only counts are read. The borrowed API exposes agents/workspaces/projects/
 * terminals/providers/config and no host-metrics RPC, so the fleet view cannot
 * show remote CPU/RAM/load/uptime; fabricating them would be mock data.
 */
export function createFleetClient(serverId: string): FleetHostClient {
  const getClient = clientPrimitives.getPaseoClient;
  if (!getClient) {
    throw new Error("multi-host fleet is not available on this host");
  }
  // getPaseoClient throws for a non-online/unknown host; the poller only
  // acquires for online hosts, and the throw is caught per host so one bad
  // host cannot break the others.
  const client = getClient(serverId);
  return {
    async readCounts(): Promise<FleetHostCounts> {
      const [agents, workspaces] = await Promise.all([
        client.agents.list(),
        client.workspaces.list(),
      ]);
      const entries = agents.entries ?? [];
      return {
        agents: entries.length,
        activeAgents: entries.filter((entry) => entry.agent?.status === "running")
          .length,
        workspaces: workspaces.entries?.length ?? 0,
      };
    },
    dispose() {
      return client.dispose();
    },
  };
}

export interface UseFleetPollingOptions {
  /** Poll only while the fleet view is visible; keeps local-only paths idle. */
  enabled?: boolean;
}

/**
 * Bounded multi-host fleet polling hook.
 *
 * Enumerates online hosts with `useHosts()`, acquires a borrowed
 * `getPaseoClient(serverId)` per online host, and drives the pure
 * {@link MultiHostPoller} state machine: max one in-flight probe per host,
 * 15s cadence, 4s per-host timeout, stale marking, and dispose/reacquire on
 * host status transitions. Local Top behavior is untouched because nothing
 * starts unless the fleet view is mounted and enabled.
 */
export function useFleetPolling({ enabled = true }: UseFleetPollingOptions = {}) {
  // The mobile host omits the primitives; nothing to poll, so no hooks run and
  // the caller renders an unavailable state. The check is module-constant, so
  // the hook order is stable for a given host.
  const supported = multiHostSupported();
  const hosts = supported ? clientPrimitives.useHosts!() : [];
  const [snapshots, setSnapshots] = useState<FleetHostSnapshot[]>([]);
  const pollerRef = useRef<MultiHostPoller | null>(null);

  const hostInputs = useMemo(
    () =>
      hosts.map((host) => ({
        serverId: host.serverId,
        label: host.label,
        status: host.status,
      })),
    [hosts],
  );

  // Keep the latest host list in a ref so the create-once effect can seed from
  // it without re-subscribing on every status change.
  const hostInputsRef = useRef(hostInputs);
  hostInputsRef.current = hostInputs;

  useEffect(() => {
    if (!enabled || !supported) return;
    const poller = new MultiHostPoller({
      acquire: createFleetClient,
      onUpdate: setSnapshots,
    });
    pollerRef.current = poller;
    poller.setHosts(hostInputsRef.current);
    poller.start();
    return () => {
      poller.dispose();
      pollerRef.current = null;
      setSnapshots([]);
    };
  }, [enabled, supported]);

  useEffect(() => {
    pollerRef.current?.setHosts(hostInputs);
  }, [hostInputs]);

  return snapshots;
}
