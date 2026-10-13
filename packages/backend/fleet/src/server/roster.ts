import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FleetAgent, FleetOutput } from "../client/types.js";
import { DEFAULT_PROJECT } from "../client/types.js";
import { repoMatches } from "../client/filter.js";
import type { RawAgentRecord, WorkspaceProjectMap } from "../shared/classify.js";
import { inheritProjectFromParents } from "../shared/classify.js";
import { buildAgentTree } from "../shared/tree.js";
import {
  buildWorkspaceProjectMapFromRegistry,
  readQuotaAlertAgentIds,
  readWorkspaceProjectMap,
} from "./storage.js";
import {
  canonicalDescriptorsToRegistry,
  type WorkspaceRecord,
  type ProjectRecord,
} from "./workspace.js";
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
): Promise<{ roster: RawAgentRecord[]; source: "sdk" | "cli" | "none"; error?: string }> {
  const execFn = options?.execFileAsync || defaultExecFileAsync;

  // 1. Try SDK (Pure RPC / daemon-owned state — no disk reads)
  if (context?.paseo?.agents?.list) {
    try {
      const list = await context.paseo.agents.list();
      const entries = Array.isArray(list?.entries) ? list.entries : [];
      const roster: RawAgentRecord[] = [];
      for (const entry of entries) {
        const agent = (entry as any)?.agent ?? entry;
        const id = String(agent?.id ?? "");
        if (!id) continue;
        roster.push({
          id,
          name: (agent.name as string) || (agent.title as string) || "",
          title: (agent.title as string) || (agent.name as string) || "",
          status: (agent.status as string) || "idle",
          provider: (agent.provider as string) || "",
          model: (agent.model as string) ?? null,
          cwd: (agent.cwd as string) || "",
          workspaceId: (agent.workspaceId as string) || undefined,
          created: (agent.created as string) || (agent.createdAt as string) || undefined,
          updatedAt: (agent.updatedAt as string) || undefined,
          lastActivityAt: (agent.lastActivityAt as string) ?? undefined,
          labels: ((agent.labels as Record<string, string>) || {}),
          parentId:
            (agent.labels as Record<string, string>)?.["paseo.parent-agent-id"] ||
            (agent.parentId as string) ||
            null,
          lastError: (agent.lastError as string) || undefined,
          requiresAttention: (agent.requiresAttention as boolean) ?? undefined,
          attentionReason: (agent.attentionReason as string) || undefined,
          attentionTimestamp: (agent.attentionTimestamp as string) || undefined,
          pendingPermissions:
            (agent.pendingPermissions as Array<Record<string, unknown>>) ?? undefined,
          activeTurn: (agent.activeTurn as RawAgentRecord["activeTurn"]) || undefined,
          lastUsage: (agent.lastUsage as RawAgentRecord["lastUsage"]) || undefined,
        });
      }
      return { roster, source: "sdk" };
    } catch (err: any) {
      // Deterministic fail-fast: if the daemon SDK exists and throws, fail fast
      return { roster: [], source: "none", error: err?.message || String(err) };
    }
  }

  // 2. Try CLI (daemon client via CLI when running in CLI-only environment without SDK)
  try {
    const { stdout } = await execFn("paseo", ["ls", "--json"], { timeout: 5000, encoding: "utf-8" });
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const roster: RawAgentRecord[] = [];
      for (const item of parsed) {
        const id = String(item?.id ?? "");
        if (!id) continue;
        const provider = (item.provider as string) || "";
        roster.push({
          id,
          name: item.name || item.title || "",
          title: item.title || item.name || "",
          status: item.status || "idle",
          provider,
          model: (provider?.includes("/") ? provider.split("/")[1] : undefined) ?? null,
          cwd: item.cwd || "",
          created: item.created || undefined,
          updatedAt: item.updatedAt || undefined,
          lastActivityAt: item.lastActivityAt || undefined,
          workspaceId: item.workspaceId || undefined,
          labels: item.labels || {},
          parentId: item.parentId || null,
          lastError: item.lastError,
          requiresAttention: item.requiresAttention,
          attentionReason: item.attentionReason,
          attentionTimestamp: item.attentionTimestamp,
          pendingPermissions: item.pendingPermissions,
          activeTurn: item.activeTurn,
          lastUsage: item.lastUsage,
        });
      }
      return { roster, source: "cli" };
    }
  } catch (err: any) {
    return { roster: [], source: "none", error: err?.message || String(err) };
  }

  return { roster: [], source: "none" };
}

export function buildFleetOutput(
  agents: FleetAgent[],
  options?: {
    enrolledRepos?: string[];
    mutedRepos?: string[];
    pausedRepos?: string[];
    kanbanOnlyRepos?: string[];
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
  const kanbanOnlyRepos = options?.kanbanOnlyRepos || [];
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
    kanbanOnlyRepos,
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
    kanbanOnlyRepos?: string[];
    repoQueuedHooks?: Record<string, number>;
    workspaceProjectMap?: WorkspaceProjectMap;
    workspacesData?: readonly WorkspaceRecord[];
    projectsData?: readonly ProjectRecord[];
  },
): Promise<FleetOutput> {
  const { roster } = await readRawRoster(context, options);
  const quota = readQuotaAlertAgentIds({ home: options?.home });

  let map = options?.workspaceProjectMap;
  if (!map) {
    if (options?.workspacesData) {
      map = buildWorkspaceProjectMapFromRegistry(options.workspacesData, options.projectsData);
    } else if (context?.paseo?.workspaces?.list) {
      try {
        const listed = await context.paseo.workspaces.list({});
        const entries = Array.isArray(listed?.entries) ? listed.entries : [];
        const { workspaces, projects } = canonicalDescriptorsToRegistry(entries);
        map = buildWorkspaceProjectMapFromRegistry(workspaces, projects);
      } catch {
        map = readWorkspaceProjectMap({ home: options?.home, forceRefresh: true });
      }
    } else {
      map = readWorkspaceProjectMap({ home: options?.home, forceRefresh: true });
    }
  }

  const agents = roster.map((raw) =>
    normalizeRawAgent(raw, {
      quotaAlertAgentIds: quota,
      workspaceProjectMap: map,
      home: options?.home,
    }),
  );
  inheritProjectFromParents(agents);

  return buildFleetOutput(agents, options);
}
