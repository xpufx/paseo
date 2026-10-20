import { useMemo } from "react";
import * as pluginClient from "@getpaseo/plugin/client";
import type { PluginHostSummary, usePaseo } from "@getpaseo/plugin/client";

type PaseoApi = ReturnType<typeof usePaseo>;

function readFunction<T>(source: unknown, key: string): T | undefined {
  if (source === null || typeof source !== "object") return undefined;
  if (!Object.keys(source).includes(key)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "function" ? (value as T) : undefined;
}

const EMPTY_HOSTS: readonly PluginHostSummary[] = [];
const noHosts = () => EMPTY_HOSTS;
const useHostsPrimitive =
  readFunction<() => readonly PluginHostSummary[]>(pluginClient, "useHosts") ?? noHosts;

/** Safe hook for retrieving connected hosts without crashing on platforms lacking multi-host. */
export function useOptionalHosts(): readonly PluginHostSummary[] {
  return useHostsPrimitive();
}

export interface DiscoveredHostCandidate {
  serverId: string;
  label: string;
  name: string;
  status: string;
  isRegistered: boolean;
  registeredName?: string | null;
}

/**
 * Derives discovered host candidates from live connected client hosts and registered daemons.
 * Connected hosts that do not match any registered daemon are candidates for registration.
 */
export function deriveHostCandidates(
  hosts: readonly PluginHostSummary[],
  registeredDaemons: readonly { name: string; serverId?: string | null }[],
): DiscoveredHostCandidate[] {
  const registeredServerIds = new Set<string>();
  const registeredNames = new Set<string>();
  for (const d of registeredDaemons) {
    registeredNames.add(d.name.toLowerCase());
    if (d.serverId) {
      registeredServerIds.add(d.serverId);
    }
  }

  return hosts.map((host) => {
    const matchedDaemon = registeredDaemons.find(
      (d) =>
        (d.serverId && d.serverId === host.serverId) ||
        d.name.toLowerCase() === host.label.toLowerCase() ||
        d.name.toLowerCase() === host.serverId.toLowerCase(),
    );

    return {
      serverId: host.serverId,
      label: host.label,
      name: host.label || host.serverId,
      status: host.status,
      isRegistered: matchedDaemon !== undefined,
      registeredName: matchedDaemon?.name ?? null,
    };
  });
}

/**
 * Shared client hook for live host discovery and candidate identification.
 * Uses Paseo's live client host primitives (useOptionalHosts()).
 * Only functions when an interactive client/app is active.
 */
export function useDiscoveredHostCandidates(
  registeredDaemons: readonly { name: string; serverId?: string | null }[] = [],
): {
  allCandidates: DiscoveredHostCandidate[];
  unregisteredCandidates: DiscoveredHostCandidate[];
  hosts: readonly PluginHostSummary[];
} {
  const hosts = useOptionalHosts();
  const allCandidates = useMemo(
    () => deriveHostCandidates(hosts, registeredDaemons),
    [hosts, registeredDaemons],
  );
  const unregisteredCandidates = useMemo(
    () => allCandidates.filter((c) => !c.isRegistered),
    [allCandidates],
  );

  return { allCandidates, unregisteredCandidates, hosts };
}

export interface ConfiguredHostAgent {
  serverId: string;
  hostLabel: string;
  agentId: string;
  name: string;
  status: string | null;
}

export interface ConfiguredHostAgents {
  host: PluginHostSummary;
  agents: ConfiguredHostAgent[];
  error: string | null;
}

/** A host/agent pair is the fleet identity; agent ids are host-local. */
export function configuredHostAgentKey(serverId: string, agentId: string): string {
  return `${serverId}/${agentId}`;
}

/**
 * Query only currently online configured hosts. Each call obtains a fresh
 * borrowed API; callers must discard the result after a host-status change.
 *
 * The client getter may yield `undefined` on a host that omits the multi-host
 * seam (`useOptionalHosts`/`getOptionalPaseoClient`); that is reported as a
 * per-host unavailable error rather than a throw (#1043).
 */
export async function listConfiguredHostAgents(
  hosts: readonly PluginHostSummary[],
  getClient: (serverId: string) => PaseoApi | undefined,
): Promise<ConfiguredHostAgents[]> {
  return Promise.all(hosts.map(async (host) => {
    if (host.status !== "online") return { host, agents: [], error: null };
    try {
      const client = getClient(host.serverId);
      if (!client) {
        return { host, agents: [], error: "Multi-host access is unavailable on this host." };
      }
      const result = await client.agents.list();
      return {
        host,
        agents: result.entries.map(({ agent }) => ({
          serverId: host.serverId,
          hostLabel: host.label,
          agentId: agent.id,
          name: agent.title ?? agent.id,
          status: agent.status ?? null,
        })),
        error: null,
      };
    } catch (cause) {
      return { host, agents: [], error: cause instanceof Error ? cause.message : String(cause) };
    }
  }));
}

// Sending to a configured host is `sendConfiguredHostViaGate` in
// conversation-send.ts, which goes through the defer gate like every other route.
// The borrowed client here is for *listing* agents only: it was also used to send
// directly, which preempted a mid-turn target and then reported `dispatched`
// (#611). Nothing on this surface borrows a client to send any more.
