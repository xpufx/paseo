import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  AgentCategory,
  AgentMetrics,
  AgentUsage,
  AttentionReason,
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

const execFileAsync = promisify(execFile);

/** Sentinel the operator can point the plugin at until it is enrolled. */
const FALLBACK_ENROLLED = "xpufx-org/paseo";

/**
 * The raw daemon shape, kept loose on purpose: the SDK payload, the on-disk
 * agent record, and the `paseo ls` JSON all overlap but none of them agree on
 * which fields are present, and every read below is optional.
 */
interface RawAgent {
  id: string;
  shortId?: string;
  name?: string;
  title?: string;
  provider?: string;
  model?: string | null;
  status?: string;
  cwd?: string;
  created?: string;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string | null;
  workspaceId?: string;
  parentId?: string | null;
  /** Canonical repository, when the daemon already resolved one. */
  project?: string;
  labels?: Record<string, string>;
  lastError?: string;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  attentionTimestamp?: string | null;
  pendingPermissions?: Array<Record<string, unknown>> | null;
  activeTurn?: { turnId?: string; startedAt?: string | null } | null;
  lastUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    totalCostUsd?: number;
    contextWindowUsedTokens?: number;
    contextWindowMaxTokens?: number;
  } | null;
  url?: string;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function categorize(name: string): AgentCategory {
  const lower = (name || "").toLowerCase();
  if (lower.includes("front desk") || lower === "frontdesk") return "front-desk";
  if (lower.includes("orchestrator")) return "orchestrator";
  return "worker";
}

function normalizePermissions(raw: RawAgent["pendingPermissions"]): PendingPermission[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingPermission[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id || entry.requestId || "").trim();
    if (!id) continue;
    const permission: PendingPermission = { id };
    for (const key of ["requestId", "name", "title", "tool", "kind", "description"] as const) {
      const value = textOrUndefined(entry[key]);
      if (value) permission[key] = value;
    }
    const input = entry.input && typeof entry.input === "object" ? entry.input : entry.metadata;
    if (input && typeof input === "object") {
      permission.input = input as Record<string, unknown>;
    }
    const scope = permissionScope(permission);
    if (scope) permission.scope = scope;
    out.push(permission);
  }
  return out;
}

function normalizeReason(raw: unknown): AttentionReason | null {
  return raw === "finished" || raw === "error" || raw === "permission" || raw === "input" ? raw : null;
}

function normalizeUsage(raw: RawAgent["lastUsage"]): AgentUsage | null {
  if (!raw) return null;
  const usage: AgentUsage = {};
  const input = numberOrUndefined(raw.inputTokens);
  const output = numberOrUndefined(raw.outputTokens);
  const cached = numberOrUndefined(raw.cachedInputTokens);
  const cost = numberOrUndefined(raw.totalCostUsd);
  if (input !== undefined) usage.inputTokens = input;
  if (output !== undefined) usage.outputTokens = output;
  if (cached !== undefined) usage.cachedInputTokens = cached;
  if (cost !== undefined) usage.totalCostUsd = cost;
  return Object.keys(usage).length > 0 ? usage : null;
}

/**
 * Projects the daemon's usage/turn signals onto the client metrics block. Null
 * when nothing is present, so a legacy record renders no gauge at all rather
 * than a misleading zero.
 */
export function normalizeMetrics(raw: RawAgent): AgentMetrics | null {
  const usage = raw.lastUsage ?? null;
  const metrics: AgentMetrics = {};

  const used = numberOrUndefined(usage?.contextWindowUsedTokens);
  const max = numberOrUndefined(usage?.contextWindowMaxTokens);
  const cached = numberOrUndefined(usage?.cachedInputTokens);
  const input = numberOrUndefined(usage?.inputTokens);
  const output = numberOrUndefined(usage?.outputTokens);
  const cost = numberOrUndefined(usage?.totalCostUsd);
  const turnStart = textOrUndefined(raw.activeTurn?.startedAt);
  const attention = textOrUndefined(raw.attentionTimestamp);

  if (used !== undefined) metrics.contextUsedTokens = used;
  if (max !== undefined) metrics.contextMaxTokens = max;
  if (cached !== undefined) metrics.cachedTokens = cached;
  if (input !== undefined) metrics.inputTokens = input;
  if (output !== undefined) metrics.outputTokens = output;
  if (cost !== undefined) metrics.costUsd = cost;
  if (turnStart !== undefined) metrics.activeTurnStartedAt = turnStart;
  if (attention !== undefined) metrics.attentionTimestamp = attention;

  return Object.keys(metrics).length > 0 ? metrics : null;
}

export interface DerivedState {
  state: FleetAgent["deterministicState"];
  detail?: string;
}

/**
 * The deterministic state ladder, in precedence order: blocked-on-permission,
 * fatal error, blocked-on-input, running, idle, unknown. A stale error string
 * on a live agent never overrides its healthy state.
 */
export function deriveState(
  raw: RawAgent,
  quotaAlertIds: Set<string>,
): DerivedState {
  const status = (raw.status || "idle").toLowerCase();
  const error = (raw.lastError || "").toLowerCase();
  const quota = raw.id ? quotaAlertIds.has(raw.id) : false;
  const permissions = normalizePermissions(raw.pendingPermissions);
  const reason = normalizeReason(raw.attentionReason);

  if (permissions.length > 0 || reason === "permission") {
    const first = permissions[0];
    const action = first
      ? first.title?.trim() || first.tool?.trim() || first.name?.trim() || first.kind?.trim() || "tool permission"
      : "tool permission";
    const scope = first ? permissionScope(first) : undefined;
    return { state: "permission-prompt", detail: scope ? `${action} (${scope})` : action };
  }

  const explicitError =
    status === "error" ||
    Boolean(raw.requiresAttention && reason === "error") ||
    (status !== "running" && status !== "idle" && error.length > 0);

  if (explicitError) {
    if (
      quota ||
      /quota|rate limit|429|credit|exhausted|usage limit/.test(error)
    ) {
      return { state: "failed:quota-exhausted", detail: raw.lastError || "Usage limit reached" };
    }
    if (/spawn|enoent|failed to start|connection refused/.test(error)) {
      return { state: "failed:spawn", detail: raw.lastError || "Spawn error" };
    }
    if (/timeout|timed out|etimedout/.test(error)) {
      return { state: "failed:timeout", detail: raw.lastError || "Execution timeout" };
    }
    return { state: "failed:error", detail: raw.lastError || "Agent error" };
  }

  if (raw.requiresAttention === true && reason && reason !== "finished" && reason !== "error") {
    return { state: "attention-required", detail: reason };
  }

  const work = attributedWork(raw);
  if (status === "running") {
    if (work?.issue !== undefined) {
      return {
        state: "working",
        detail: work.slug ? `#${work.issue} (${work.slug})` : `#${work.issue}`,
      };
    }
    return { state: "running", detail: "Active turn" };
  }

  if (status === "idle") {
    if (quota) return { state: "idle:quota-exhausted", detail: "Quota cooldown" };
    const category = categorize(raw.name || raw.title || "");
    const lastActivity = raw.lastActivityAt || raw.updatedAt;
    if ((category === "orchestrator" || category === "front-desk") && lastActivity) {
      const idleMs = Date.now() - Date.parse(lastActivity);
      if (!Number.isNaN(idleMs) && idleMs > 15 * 60 * 1000) {
        return { state: "sleeping", detail: "Standby" };
      }
    }
    return { state: "idle:waiting", detail: "Waiting for turn" };
  }

  return { state: "unknown", detail: raw.status || undefined };
}

export function normalizeAgent(
  raw: RawAgent,
  quotaAlertIds: Set<string>,
  workspaceProjectMap: Record<string, string>,
): FleetAgent {
  const id = raw.id || "";
  const shortId = raw.shortId || id.slice(0, 7);
  const name = raw.name || raw.title || `Agent ${shortId}`;
  const permissions = normalizePermissions(raw.pendingPermissions);
  const reason = normalizeReason(raw.attentionReason);
  const { state, detail } = deriveState(raw, quotaAlertIds);
  const life = lifecycleState(state);

  return {
    id,
    shortId,
    name,
    category: categorize(name),
    provider: raw.provider,
    model: raw.model || null,
    status: raw.status || "idle",
    cwd: raw.cwd,
    created: raw.created || raw.createdAt,
    updatedAt: raw.updatedAt,
    lastActivityAt: raw.lastActivityAt || null,
    workspaceId: raw.workspaceId,
    parentId: raw.parentId ?? raw.labels?.["paseo.parent-agent-id"] ?? null,
    deterministicState: state,
    stateDetail: detail,
    lifecycleState: life,
    blockDetail: life === "waiting_for_input" ? (blockDetailFor(id, permissions) ?? null) : null,
    attributedWork: attributedWork(raw),
    usage: normalizeUsage(raw.lastUsage),
    metrics: normalizeMetrics(raw),
    lastError: raw.lastError || null,
    url: raw.url || (id ? `paseo://agent/${id}` : undefined),
    worktree: worktreeSlug(raw),
    project: projectKey(raw, undefined, workspaceProjectMap),
    labels: raw.labels,
    pendingPermissions: permissions,
    requiresAttention: isBlocked({
      pendingPermissions: permissions,
      requiresAttention: raw.requiresAttention,
      attentionReason: reason,
    }),
    attentionReason: reason,
  };
}

/** Walks children up to a resolved project, so a worker inherits its parent's repo. */
export function inheritProjectFromParents(agents: FleetAgent[]): void {
  const byId = new Map(agents.map((a) => [a.id, a]));
  let changed = true;
  let guard = 0;
  while (changed && guard <= agents.length) {
    changed = false;
    guard += 1;
    for (const agent of agents) {
      if (agent.project && agent.project !== DEFAULT_PROJECT) continue;
      const parent = agent.parentId ? byId.get(agent.parentId) : undefined;
      if (parent?.project && parent.project !== DEFAULT_PROJECT) {
        agent.project = parent.project;
        changed = true;
      }
    }
  }
}

function parseRemoteProjectKey(key?: string | null): string | undefined {
  const cleaned = key?.trim().replace(/\.git$/, "");
  if (!cleaned?.startsWith("remote:")) return undefined;
  const body = cleaned.slice("remote:".length);
  const slash = body.indexOf("/");
  if (slash === -1) return undefined;
  const segments = body.slice(slash + 1).split("/").filter(Boolean);
  if (segments.length >= 2) return segments.slice(-2).join("/");
  return segments[0];
}

interface WorkspaceRecord {
  workspaceId?: string;
  projectId?: string;
  cwd?: string;
  worktreeRoot?: string | null;
  mainRepoRoot?: string | null;
  displayName?: string;
}

interface ProjectRecord {
  projectId?: string;
  rootPath?: string;
  displayName?: string;
  projectKey?: string | null;
}

/**
 * workspaceId → repository, joined from the daemon's own project/workspace
 * registries. Cached briefly because the fleet view polls. Best-effort: when
 * the registries are unreadable the caller falls back to labels and then to
 * `Default Project`, which is also what an unstaffed enrolled repo shows.
 */
export function workspaceProjectMap(options: { forceRefresh?: boolean } = {}): Record<string, string> {
  const now = Date.now();
  if (!options.forceRefresh && cache && now - cache.cachedAt < 30_000) return cache.map;

  const map: Record<string, string> = {};
  try {
    const dir = join(homedir(), ".paseo", "projects");

    const projectsById = new Map<string, ProjectRecord>();
    const projectsPath = join(dir, "projects.json");
    if (existsSync(projectsPath)) {
      const parsed = JSON.parse(readFileSync(projectsPath, "utf-8"));
      if (Array.isArray(parsed)) {
        for (const project of parsed) {
          if (project?.projectId) projectsById.set(project.projectId, project);
        }
      }
    }

    const workspacesPath = join(dir, "workspaces.json");
    if (existsSync(workspacesPath)) {
      const parsed = JSON.parse(readFileSync(workspacesPath, "utf-8"));
      if (Array.isArray(parsed)) {
        for (const workspace of parsed as WorkspaceRecord[]) {
          if (!workspace?.workspaceId) continue;
          const project = workspace.projectId ? projectsById.get(workspace.projectId) : undefined;
          const repo =
            parseRemoteProjectKey(project?.projectKey) ||
            project?.displayName?.trim() ||
            workspace.displayName?.trim() ||
            basename(workspace.mainRepoRoot || project?.rootPath || workspace.worktreeRoot || workspace.cwd);
          if (repo) map[workspace.workspaceId] = repo;
        }
      }
    }
  } catch {
    // Registry unavailable: callers fall back through labels to the default.
  }

  cache = { map, cachedAt: now };
  return map;
}

let cache: { map: Record<string, string>; cachedAt: number } | null = null;

export function resetWorkspaceProjectCache(): void {
  cache = null;
}

function basename(path?: string | null): string | undefined {
  if (!path) return undefined;
  return path.replace(/\/+$/, "").split("/").filter(Boolean).pop();
}

/** Open quota alerts from the daemon's limit-alert index, as a set of agent ids. */
export function quotaAlertAgentIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const path = join(homedir(), ".paseo", "limit-alerts.json");
    if (!existsSync(path)) return ids;
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (Array.isArray(parsed?.alerts)) {
      for (const alert of parsed.alerts) {
        if (alert?.agentId && alert.status === "open") ids.add(alert.agentId);
      }
    }
  } catch {
    // Best-effort.
  }
  return ids;
}

/** Per-agent metadata the SDK listing omits, read from the daemon's own index. */
function onDiskMetadata(): Map<string, Partial<RawAgent>> {
  const out = new Map<string, Partial<RawAgent>>();
  try {
    const dir = join(homedir(), ".paseo", "agents");
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const files = readdirSync(join(dir, entry.name));
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const agentId = file.replace(/\.json$/, "");
        try {
          const data = JSON.parse(readFileSync(join(dir, entry.name, file), "utf-8"));
          out.set(agentId, {
            id: data.id || agentId,
            name: data.name || data.title,
            title: data.title,
            provider: data.provider,
            model: data.runtimeInfo?.model || data.config?.model || null,
            status: data.lastStatus || data.status,
            cwd: data.cwd,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            lastActivityAt: data.lastActivityAt || data.updatedAt,
            workspaceId: data.workspaceId,
            labels: data.labels,
            parentId: data.labels?.["paseo.parent-agent-id"] || null,
            lastError: data.lastError,
            requiresAttention: data.requiresAttention,
            attentionReason: data.attentionReason,
            attentionTimestamp: data.attentionTimestamp,
            pendingPermissions: data.pendingPermissions,
            activeTurn: data.activeTurn,
            lastUsage: data.lastUsage,
          });
        } catch {
          // A single unreadable record must not blank the roster.
        }
      }
    }
  } catch {
    // Best-effort.
  }
  return out;
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

async function readRoster(
  context: PluginHandlerContext,
): Promise<{ roster: RawAgent[]; source: "sdk" | "cli" | "none" }> {
  const disk = onDiskMetadata();

  if (context?.paseo?.agents?.list) {
    try {
      const list = await context.paseo.agents.list();
      const entries = Array.isArray(list?.entries) ? list.entries : [];
      const roster: RawAgent[] = [];
      for (const entry of entries) {
        const agent = (entry as { agent?: Record<string, unknown> }).agent ?? (entry as Record<string, unknown>);
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
          activeTurn: (agent.activeTurn as RawAgent["activeTurn"]) || local.activeTurn,
          lastUsage: (agent.lastUsage as RawAgent["lastUsage"]) || local.lastUsage,
        });
      }
      if (roster.length > 0) return { roster, source: "sdk" };
    } catch {
      // Fall through to the CLI.
    }
  }

  try {
    const { stdout } = await execFileAsync("paseo", ["ls", "--json"], { timeout: 5000, encoding: "utf-8" });
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) {
      const roster: RawAgent[] = [];
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
      return { roster, source: "cli" };
    }
  } catch {
    // No CLI either.
  }

  return { roster: [], source: "none" };
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
    const { roster } = await readRoster(context);
    const quota = quotaAlertAgentIds();
    const map = workspaceProjectMap({ forceRefresh: true });
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

    // Tree is built by the client from `parentId`; the server only ships the flat
    // roster plus the buckets, so there is one place that can disagree.
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

/**
 * Spawns a liaison/orchestrator session. The model is resolved from
 * `WORKTREE_INSTALL_MODEL` because the plugin has no role-model store of its
 * own to read it from.
 */
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
    // The SDK types `agents.create` against the protocol's create request; this
    // handler builds its payload from plugin settings, so it hands the options
    // over structurally.
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

/**
 * Per-repository muting. Held in this plugin's own storage under the plugin
 * directory so a second plugin never rewrites another plugin's state.
 */
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
