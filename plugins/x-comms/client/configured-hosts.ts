import type { PluginHostSummary, usePaseo } from "@getpaseo/plugin/client";

type PaseoApi = ReturnType<typeof usePaseo>;

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
