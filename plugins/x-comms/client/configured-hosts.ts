import type { PaseoApi } from "@getpaseo/client";
import type { PluginHostSummary } from "@getpaseo/plugin/client";

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
 */
export async function listConfiguredHostAgents(
  hosts: readonly PluginHostSummary[],
  getClient: (serverId: string) => PaseoApi,
): Promise<ConfiguredHostAgents[]> {
  return Promise.all(hosts.map(async (host) => {
    if (host.status !== "online") return { host, agents: [], error: null };
    try {
      const result = await getClient(host.serverId).agents.list();
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
