import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FleetAgent, FleetOutput } from "../client/types.js";
import { DEFAULT_PROJECT } from "../client/types.js";
import { repoMatches } from "../client/filter.js";
import type { RawAgentRecord, WorkspaceProjectMap } from "../shared/classify.js";
import { inheritProjectFromParents } from "../shared/classify.js";
import { buildAgentTree } from "../shared/tree.js";
import {
  readOnDiskAgentMetadata,
  readQuotaAlertAgentIds,
  readWorkspaceProjectMap,
} from "./storage.js";
import { normalizeRawAgent } from "./normalize.js";

const defaultExecFileAsync = promisify(execFile);

export interface ReadFleetOptions {
  home?: string;
  enrolledRepos?: string[];
  mutedRepos?: string[];
  execFileAsync?: (
    file: string,
    args: readonly string[],
    options?: any,
  ) => Promise<{ stdout: string; stderr?: string }>;
}

export async function readRawRoster(
  context?: any,
  options?: ReadFleetOptions,
): Promise<{ roster: RawAgentRecord[]; source: "sdk" | "cli" | "disk" | "none" }> {
  const disk = readOnDiskAgentMetadata({ home: options?.home });
  const execFn = options?.execFileAsync || defaultExecFileAsync;

  // 1. Try SDK
  if (context?.paseo?.agents?.list) {
    try {
      const list = await context.paseo.agents.list();
      const entries = Array.isArray(list?.entries) ? list.entries : [];
      const roster: RawAgentRecord[] = [];
      for (const entry of entries) {
        const agent = (entry as any)?.agent ?? entry;
        const id = String(agent?.id ?? "");
        if (!id) continue;
        const local = disk.get(id) ?? {};
        roster.push({
          id,
          name: (agent.name as string) || (agent.title as string) || local.name,
          title: (agent.title as string) || local.title,
          status: (agent.status as string) || local.status,
          provider: (agent.provider as string) || local.provider,
          model: (agent.model as string) ?? local.model ?? null,
          cwd: (agent.cwd as string) || local.cwd,
          workspaceId: (agent.workspaceId as string) || local.workspaceId,
          created: (agent.created as string) || (agent.createdAt as string) || local.createdAt,
          updatedAt: (agent.updatedAt as string) || local.updatedAt,
          lastActivityAt: (agent.lastActivityAt as string) ?? local.lastActivityAt,
          labels: { ...(local.labels || {}), ...((agent.labels as Record<string, string>) || {}) },
          parentId:
            (agent.labels as Record<string, string>)?.["paseo.parent-agent-id"] || local.parentId || null,
          lastError: (agent.lastError as string) || local.lastError,
          requiresAttention: (agent.requiresAttention as boolean) ?? local.requiresAttention,
          attentionReason: (agent.attentionReason as string) || local.attentionReason,
          attentionTimestamp: (agent.attentionTimestamp as string) || local.attentionTimestamp,
          pendingPermissions:
            (agent.pendingPermissions as Array<Record<string, unknown>>) ?? local.pendingPermissions,
          activeTurn: (agent.activeTurn as RawAgentRecord["activeTurn"]) || local.activeTurn,
          lastUsage: (agent.lastUsage as RawAgentRecord["lastUsage"]) || local.lastUsage,
        });
      }
      if (roster.length > 0) return { roster, source: "sdk" };
    } catch {
      // Fall through to CLI
    }
  }

  // 2. Try CLI
  try {
    const { stdout } = await execFn("paseo", ["ls", "--json"], { timeout: 5000, encoding: "utf-8" });
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) {
      const roster: RawAgentRecord[] = [];
      for (const item of parsed) {
        const id = String(item?.id ?? "");
        if (!id) continue;
        const local = disk.get(id) ?? {};
        const provider = (item.provider as string) || local.provider;
        roster.push({
          id,
          name: item.name || item.title || local.name,
          title: item.title || local.title,
          status: item.status || local.status,
          provider,
          model: local.model ?? (provider?.includes("/") ? provider.split("/")[1] : undefined) ?? null,
          cwd: item.cwd || local.cwd,
          created: item.created || local.createdAt,
          updatedAt: local.updatedAt,
          lastActivityAt: local.lastActivityAt,
          workspaceId: local.workspaceId,
          labels: local.labels,
          parentId: local.parentId || null,
          lastError: local.lastError,
          requiresAttention: local.requiresAttention,
          attentionReason: local.attentionReason,
          attentionTimestamp: local.attentionTimestamp,
          pendingPermissions: local.pendingPermissions,
          activeTurn: local.activeTurn,
          lastUsage: local.lastUsage,
        });
      }
      if (roster.length > 0) return { roster, source: "cli" };
    }
  } catch {
    // Fall through to disk only
  }

  // 3. Fall back to on-disk metadata if available
  if (disk.size > 0) {
    const roster: RawAgentRecord[] = [];
    for (const [id, meta] of disk) {
      roster.push({
        id,
        ...meta,
      });
    }
    return { roster, source: "disk" };
  }

  return { roster: [], source: "none" };
}

export function buildFleetOutput(
  agents: FleetAgent[],
  options?: {
    enrolledRepos?: string[];
    mutedRepos?: string[];
    pausedRepos?: string[];
    repoQueuedHooks?: Record<string, number>;
  },
): FleetOutput {
  const frontDesk: FleetAgent[] = [];
  const orchestrators: FleetAgent[] = [];
  const workers: FleetAgent[] = [];
  let runningCount = 0;
  let idleCount = 0;
  let errorCount = 0;

  const enrolledRepos = options?.enrolledRepos || [];
  const mutedRepos = options?.mutedRepos || [];
  const pausedRepos = options?.pausedRepos || [];
  const repoQueuedHooks = options?.repoQueuedHooks || {};

  for (const agent of agents) {
    if (agent.status === "running") runningCount += 1;
    else if (agent.status === "idle") idleCount += 1;
    else if (agent.status === "error") errorCount += 1;

    if (agent.category === "front-desk") frontDesk.push(agent);
    else if (agent.category === "orchestrator") orchestrators.push(agent);
    else workers.push(agent);

    const project = agent.project || DEFAULT_PROJECT;
    agent.isEnrolled = enrolledRepos.some((r) => repoMatches(r, project));
    agent.isDetached = !agent.isEnrolled;
    agent.isMuted = mutedRepos.some((m) => repoMatches(m, project));
    agent.isPaused = pausedRepos.some((p) => repoMatches(p, project));
    agent.hasOrchestrator = orchestrators.some((o) => repoMatches(o.project || DEFAULT_PROJECT, project));
    agent.queuedHooksCount = repoQueuedHooks[project] || 0;
  }

  const tree = buildAgentTree(agents);

  return {
    ok: true,
    registryAuthoritative: false,
    roleDivergences: [],
    frontDesk,
    orchestrators,
    workers,
    tree,
    enrolledRepos,
    pausedRepos,
    mutedRepos,
    repoQueuedHooks,
    totalCount: agents.length,
    runningCount,
    idleCount,
    errorCount,
  };
}

export async function readFleetRoster(
  context?: any,
  options?: ReadFleetOptions & {
    pausedRepos?: string[];
    repoQueuedHooks?: Record<string, number>;
    workspaceProjectMap?: WorkspaceProjectMap;
  },
): Promise<FleetOutput> {
  const { roster } = await readRawRoster(context, options);
  const quota = readQuotaAlertAgentIds({ home: options?.home });
  const map = options?.workspaceProjectMap ?? readWorkspaceProjectMap({ home: options?.home, forceRefresh: true });

  const agents = roster.map((raw) => normalizeRawAgent(raw, { quotaAlertAgentIds: quota, workspaceProjectMap: map, home: options?.home }));
  inheritProjectFromParents(agents);

  return buildFleetOutput(agents, options);
}
