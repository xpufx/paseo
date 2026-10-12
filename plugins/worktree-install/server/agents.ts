import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  AgentCategory,
  AgentMetrics,
  AgentUsage,
  FleetAgent,
  FleetOutput,
  PendingPermission,
} from "../shared/contracts.js";
import {
  DEFAULT_PROJECT,
  attributedWork,
  blockDetailFor,
  isBlocked,
  lifecycleState,
  permissionScope,
  projectKey,
  repoMatches,
  worktreeSlug,
} from "../shared/derive.js";
import {
  categorizeAgent,
  normalizeAgentMetrics as normalizeMetrics,
  readWorkspaceProjectMap,
  resetWorkspaceProjectCache,
  readQuotaAlertAgentIds,
  readRawRoster,
  normalizeRawAgent,
  inheritProjectFromParents,
  deriveDeterministicState,
  type RawAgentRecord,
} from "@xpufx/backend-fleet/server";

export function categorize(name: string): AgentCategory {
  const cat = categorizeAgent(name);
  return cat === "coding-agent" ? "worker" : (cat as AgentCategory);
}

export {
  normalizeMetrics,
  resetWorkspaceProjectCache,
  inheritProjectFromParents,
};

const execFileAsync = promisify(execFile);

/** Sentinel the operator can point the plugin at until it is enrolled. */
const FALLBACK_ENROLLED = "xpufx-org/paseo";

export type RawAgent = RawAgentRecord;

export interface DerivedState {
  state: FleetAgent["deterministicState"];
  detail?: string;
}

/**
 * The deterministic state ladder, delegating to @xpufx/backend-fleet.
 */
export function deriveState(
  raw: RawAgent,
  quotaAlertIds: Set<string>,
): DerivedState {
  const work = attributedWork(raw);
  return deriveDeterministicState(raw, work, quotaAlertIds);
}

/**
 * Normalizes a raw agent into the FleetAgent contract shape.
 */
export function normalizeAgent(
  raw: RawAgent,
  quotaAlertIds: Set<string>,
  workspaceProjectMap: Record<string, string>,
): FleetAgent {
  const base = normalizeRawAgent(raw, {
    quotaAlertAgentIds: quotaAlertIds,
    workspaceProjectMap,
  });

  return {
    ...base,
    project: projectKey(raw, undefined, workspaceProjectMap),
    worktree: worktreeSlug(raw),
  } as FleetAgent;
}

/**
 * workspaceId -> repository, joined from the daemon's own project/workspace
 * registries via @xpufx/backend-fleet. Cached with 30s TTL.
 */
export function workspaceProjectMap(options: { forceRefresh?: boolean } = {}): Record<string, string> {
  return readWorkspaceProjectMap({ forceRefresh: options.forceRefresh });
}

/** Open quota alerts from the daemon's limit-alert index via @xpufx/backend-fleet. */
export function quotaAlertAgentIds(): Set<string> {
  return readQuotaAlertAgentIds();
}

async function mainCheckoutDirty(cwd?: string): Promise<{ isDirty: boolean; summary?: string }> {
  if (!cwd) return { isDirty: false };
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd,
      timeout: 3000,
      encoding: "utf-8",
    });
    const lines = stdout.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return { isDirty: false };
    return { isDirty: true, summary: `${lines.length} uncommitted file${lines.length === 1 ? "" : "s"}` };
  } catch {
    return { isDirty: false };
  }
}

/**
 * Which repositories the fleet is staffed against. Derived from what the
 * daemon actually knows (worktrees, workspaces) rather than from another
 * plugin's config files, with an operator-settable override for the common
 * single-fleet case.
 */
export function enrolledRepoList(agents: FleetAgent[]): string[] {
  const configured = process.env.WORKTREE_INSTALL_ENROLLED_REPOS
    ?.split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (configured && configured.length > 0) return configured;

  const discovered = new Set<string>();
  for (const agent of agents) {
    const project = agent.project;
    if (project && project !== DEFAULT_PROJECT) discovered.add(project);
  }
  if (discovered.size === 0) return [FALLBACK_ENROLLED];
  return Array.from(discovered);
}

export async function readFleet(context: PluginHandlerContext): Promise<FleetOutput> {
  const empty: FleetOutput = {
    ok: false,
    frontDesk: [],
    orchestrators: [],
    workers: [],
    tree: [],
    enrolledRepos: [],
    mutedRepos: [],
    repoQueuedHooks: {},
    totalCount: 0,
    runningCount: 0,
    idleCount: 0,
    errorCount: 0,
  };

  try {
    const { roster } = await readRawRoster(context, { execFileAsync });
    const quota = readQuotaAlertAgentIds();
    const map = readWorkspaceProjectMap({ forceRefresh: true });
    const agents = roster.map((raw) => normalizeAgent(raw, quota, map));
    inheritProjectFromParents(agents);

    const enrolledRepos = enrolledRepoList(agents);
    const mutedRepos = readMutedRepos();

    const frontDesk: FleetAgent[] = [];
    const orchestrators: FleetAgent[] = [];
    const workers: FleetAgent[] = [];
    let runningCount = 0;
    let idleCount = 0;
    let errorCount = 0;

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
      agent.hasOrchestrator = orchestrators.some((o) => repoMatches(o.project || DEFAULT_PROJECT, project));

      if (agent.category === "orchestrator" && agent.cwd) {
        const dirty = await mainCheckoutDirty(agent.cwd);
        agent.isMainDirty = dirty.isDirty;
        agent.mainDirtySummary = dirty.summary;
      }
    }

    return {
      ok: true,
      frontDesk,
      orchestrators,
      workers,
      tree: [],
      enrolledRepos,
      mutedRepos,
      repoQueuedHooks: {},
      totalCount: agents.length,
      runningCount,
      idleCount,
      errorCount,
    };
  } catch (err: unknown) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleFleet(
  _input: Record<string, never>,
  context: PluginHandlerContext,
): Promise<FleetOutput> {
  return readFleet(context);
}

// --- Actions --------------------------------------------------------------

export async function handleArchiveAgent(
  input: { agentId: string },
  context: PluginHandlerContext,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const agentId = input.agentId?.trim();
  if (!agentId) return { ok: false, error: "agentId is required" };
  try {
    const ref = context?.paseo?.agents?.ref?.(agentId) as unknown as
      | { archive?: (options?: unknown) => Promise<unknown> }
      | undefined;
    if (!ref?.archive) return { ok: false, error: "daemon does not support agent archive" };
    await ref.archive();
    return { ok: true, message: `Archived agent ${agentId}` };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleArchiveInactive(
  input: { agentIds?: string[] },
  context: PluginHandlerContext,
): Promise<{ ok: boolean; archivedCount?: number; message?: string; error?: string }> {
  const ids = (input.agentIds ?? []).filter(Boolean);
  if (ids.length === 0) return { ok: true, archivedCount: 0, message: "Nothing to archive" };

  let archived = 0;
  const failures: string[] = [];
  for (const id of ids) {
    const result = await handleArchiveAgent({ agentId: id }, context);
    if (result.ok) archived += 1;
    else failures.push(id);
  }
  if (archived === 0) return { ok: false, error: `Failed to archive ${failures.length} agent(s)` };
  return { ok: true, archivedCount: archived, message: `Archived ${archived} agent(s)` };
}

interface SpawnInput {
  model?: string;
  prompt?: string;
  title?: string;
  cwd?: string;
}

async function spawn(
  input: SpawnInput,
  context: PluginHandlerContext,
  role: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const cwd = input.cwd?.trim() || process.env.WORKTREE_INSTALL_WORKSPACE;
  if (!cwd) return { ok: false, error: `Set WORKTREE_INSTALL_WORKSPACE so a ${role} has a checkout to run in` };

  const provider = process.env.WORKTREE_INSTALL_PROVIDER?.trim() || "opencode";
  const model = input.model?.trim() || process.env.WORKTREE_INSTALL_MODEL?.trim();
  if (!model) return { ok: false, error: "Set WORKTREE_INSTALL_MODEL so the session has a model" };

  try {
    const agents = context?.paseo?.agents as unknown as
      | { create?: (options: Record<string, unknown>) => Promise<{ id?: string }> }
      | undefined;
    if (!agents?.create) return { ok: false, error: "daemon does not support agent create" };
    const created = await agents.create({
      cwd,
      title: input.title?.trim() || `${role} session`,
      prompt: input.prompt?.trim(),
      config: { provider: model.includes("/") ? model : `${provider}/${model}`, modeId: process.env.WORKTREE_INSTALL_MODE },
    });
    return { ok: true, message: `Spawned ${role} ${created?.id ?? ""}`.trim() };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleCreateFrontDesk(
  input: SpawnInput,
  context: PluginHandlerContext,
) {
  return spawn(input, context, "front desk");
}

export async function handleReplaceFrontDesk(
  input: SpawnInput & { existingAgentId?: string },
  context: PluginHandlerContext,
) {
  if (input.existingAgentId) {
    const archived = await handleArchiveAgent({ agentId: input.existingAgentId }, context);
    if (!archived.ok) return { ok: false, error: `Could not retire the current session: ${archived.error}` };
  }
  return spawn(input, context, "front desk");
}

export async function handleAddOrchestrator(
  input: { repo: string; cwd?: string; model?: string; prompt?: string; title?: string },
  context: PluginHandlerContext,
) {
  return spawn({ ...input, title: input.title ?? `orchestrator for ${input.repo}` }, context, "orchestrator");
}

export async function handleReplaceOrchestrator(
  input: { repo: string; existingAgentId?: string; cwd?: string; model?: string; prompt?: string; title?: string },
  context: PluginHandlerContext,
) {
  if (input.existingAgentId) {
    const archived = await handleArchiveAgent({ agentId: input.existingAgentId }, context);
    if (!archived.ok) return { ok: false, error: `Could not retire the current orchestrator: ${archived.error}` };
  }
  return handleAddOrchestrator(input, context);
}

export async function handleMuteRepo(input: {
  repo: string;
  muted?: boolean;
}): Promise<{ ok: boolean; isMuted?: boolean; mutedRepos?: string[]; message?: string; error?: string }> {
  if (!input.repo) return { ok: false, error: "repo is required" };
  const current = readMutedRepos();
  const next = input.muted ?? !current.includes(input.repo);
  const updated = next ? Array.from(new Set([...current, input.repo])) : current.filter((r) => r !== input.repo);
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(mutedFile(), `${JSON.stringify(updated, null, 2)}\n`, "utf-8");
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, isMuted: next, mutedRepos: updated, message: `Repo ${input.repo} ${next ? "muted" : "unmuted"}` };
}

function stateDir(): string {
  return join(homedir(), ".paseo", "plugin-state", "worktree-install");
}

function mutedFile(): string {
  return join(stateDir(), "muted-repos.json");
}

export function readMutedRepos(): string[] {
  try {
    if (!existsSync(mutedFile())) return [];
    const parsed = JSON.parse(readFileSync(mutedFile(), "utf-8"));
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}
