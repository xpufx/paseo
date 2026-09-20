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

/**
 * Native configured-host send. This deliberately gets exactly one freshly
 * borrowed target handle and sends to that selected agent only—never a peer
 * registry route and never a broadcast.
 */
export async function sendConfiguredHostAgent(args: {
  serverId: string;
  agentId: string;
  message: string;
  getClient: (serverId: string) => PaseoApi;
}): Promise<void> {
  await args.getClient(args.serverId).agents.ref(args.agentId).send(args.message);
}
