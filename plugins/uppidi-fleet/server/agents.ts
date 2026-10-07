import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs, { mkdirSync, writeFileSync, renameSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path, { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  UppidiAgent,
  UppidiAgentsOutput,
  UppidiAgentTreeNode,
  UppidiAgentWork,
  UppidiAgentMetrics,
  DeterministicAgentState,
  PendingPermission,
  AgentAttentionReason,
  AgentBlockDetail,
  AgentLifecycleState,
  AgentRoleDivergence,
  UppidiArchiveAgentInput,
  UppidiArchiveAgentOutput,
  UppidiArchiveInactiveAgentsInput,
  UppidiArchiveInactiveAgentsOutput,
  UppidiCreateFrontDeskInput,
  UppidiCreateFrontDeskOutput,
  UppidiReplaceFrontDeskInput,
  UppidiReplaceFrontDeskOutput,
  UppidiAddOrchestratorInput,
  UppidiAddOrchestratorOutput,
  UppidiReplaceOrchestratorInput,
  UppidiReplaceOrchestratorOutput,
  UppidiToggleRepoPauseInput,
  UppidiToggleRepoPauseOutput,
  FleetTeardownInput,
  FleetTeardownOutput,
  FleetResetStateInput,
  FleetResetStateOutput,
  FleetHaltInput,
  FleetHaltOutput,
  FleetResumeInput,
  FleetResumeOutput,
  UppidiFrontDeskActivityInput,
  UppidiFrontDeskActivityOutput,
  UppidiFrontDeskActivityItem,
  UppidiFrontDeskPromptInput,
  UppidiFrontDeskPromptOutput,
} from "../shared/contracts.js";
import {
  parseTranscriptToActivityItems,
  isSignalActivityItem,
  extractAgentWorktree,
  extractAgentProject,
  getPendingPermissionAction,
  extractPermissionScope,
  buildAgentBlockDetail,
  deriveLifecycleState,
  normalizeProjectName,
  DEFAULT_PROJECT,
} from "../shared/contracts.js";
import type { WorkspaceProjectMap } from "../shared/contracts.js";
import { isAgentEligibleForBulkArchive, isRepoMatching } from "../shared/sort-filter.js";
import {
  appendHookLog,
  formatFleetTeardownNotice,
  getActiveHookRouter,
  getFleetRosterInfo,
  loadRouterConfig,
  saveRouterConfig,
} from "./hook-router.js";
import { resolveHookAuthPosture, resolveHookEndpoint } from "./hook.js";
import { resolveWorkspaceForRepo } from "./workspace-lookup.js";
import {
  evaluateWorkerSpawnWorkspace,
  WORKER_PRIMARY_CHECKOUT_ERROR,
} from "./workspace-guard.js";
import { loadSavedRoleModels, DEFAULT_ROLE_MODELS, resolveHostHome } from "./role-models.js";
import { getEffectiveSkillPath } from "./skills.js";


export type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  options?: any
) => Promise<{ stdout: string; stderr?: string }>;

const defaultExecFileAsync: ExecFileAsyncFn = promisify(execFile);
let execFileAsync: ExecFileAsyncFn = defaultExecFileAsync;

export function setExecFileAsyncForTest(fn: ExecFileAsyncFn | null): void {
  execFileAsync = fn || defaultExecFileAsync;
}

export interface RawAgentRecord {
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
  ParentAgentId?: string | null;
  labels?: Record<string, string>;
  lastError?: string;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  attentionTimestamp?: string | null;
  pendingPermissions?: Array<Record<string, any>> | null;
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

export function categorizeAgent(name: string): "front-desk" | "orchestrator" | "worker" {
  const lower = (name || "").toLowerCase();
  if (lower.includes("front desk") || lower === "frontdesk") {
    return "front-desk";
  }
  if (lower.includes("orchestrator")) {
    return "orchestrator";
  }
  return "worker";
}

export function extractAttributedWork(raw: RawAgentRecord): UppidiAgentWork | null {
  const textSources = [
    raw.name || "",
    raw.title || "",
    raw.cwd || "",
    raw.labels?.["branch"] || "",
    raw.labels?.["worktree"] || "",
    raw.labels?.["issue"] || "",
    raw.labels?.["slug"] || "",
  ].filter(Boolean);

  let issueNum: number | undefined;
  let repoName: string | undefined;
  let slugName: string | undefined;
  let branchName: string | undefined;

  // Check labels first
  if (raw.labels?.["forgejo.issue"]) {
    const parsed = parseInt(raw.labels["forgejo.issue"], 10);
    if (!Number.isNaN(parsed)) issueNum = parsed;
  }
  if (raw.labels?.["repo"]) {
    repoName = raw.labels["repo"];
  }

  for (const src of textSources) {
    // Check issue pattern like #385 or paseo#385 or repo#385
    const issueMatch = src.match(/(?:([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+))?#(\d+)/);
    if (issueMatch && issueMatch[3]) {
      if (!issueNum) issueNum = parseInt(issueMatch[3], 10);
      if (!repoName && issueMatch[1] && issueMatch[2]) {
        repoName = `${issueMatch[1]}/${issueMatch[2]}`;
      }
    }

    // Check branch/worktree pattern like feat/385-tree-fleet-view or feat-385-tree-fleet-view
    const branchMatch = src.match(/(?:(?:feat|fix|chore|docs|audit|refactor)[/-](\d+)(?:[/-]([a-zA-Z0-9_-]+))?)/i);
    if (branchMatch) {
      if (!issueNum && branchMatch[1]) issueNum = parseInt(branchMatch[1], 10);
      if (!slugName) slugName = branchMatch[0];
      if (!branchName) branchName = branchMatch[0];
    }
  }

  // Check repo from cwd if available (e.g. /home/user/code/paseo -> forge.mrs.uppidi.com/xpufx-org/paseo)
  if (!repoName && raw.cwd) {
    const match = raw.cwd.match(/\/code\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      repoName = `forge.mrs.uppidi.com/xpufx-org/${match[1]}`;
    }
  }

  if (issueNum || repoName || slugName || branchName) {
    return {
      repo: repoName ? normalizeProjectName(repoName) : repoName,
      issue: issueNum,
      slug: slugName,
      branch: branchName,
    };
  }

  return null;
}

/**
 * Normalizes a raw daemon `pendingPermissions` payload into the client contract
 * shape (#534). Drops malformed entries rather than emitting partial rows.
 */
export function normalizePendingPermissions(
  raw?: Array<Record<string, any>> | null
): PendingPermission[] {
  if (!Array.isArray(raw)) return [];
  const result: PendingPermission[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id || entry.requestId || "").trim();
    if (!id) continue;
    const permission: PendingPermission = { id };
    if (entry.requestId) permission.requestId = String(entry.requestId);
    if (entry.name) permission.name = String(entry.name);
    if (entry.title) permission.title = String(entry.title);
    if (entry.tool) permission.tool = String(entry.tool);
    if (entry.kind) permission.kind = String(entry.kind);
    if (entry.description) permission.description = String(entry.description);
    const input = entry.input && typeof entry.input === "object" ? entry.input : entry.metadata;
    if (input && typeof input === "object") {
      permission.input = input as Record<string, unknown>;
    }
    const scope = extractPermissionScope(permission);
    if (scope) permission.scope = scope;
    result.push(permission);
  }
  return result;
}

/** Normalizes the daemon attention reason into the client contract union (#534). */
export function normalizeAttentionReason(
  raw?: string | null
): AgentAttentionReason | null {
  if (!raw) return null;
  if (raw === "finished" || raw === "error" || raw === "permission" || raw === "input") {
    return raw;
  }
  return null;
}

/** Coerces a finite number, dropping malformed/legacy values (#510 idiom). */
function coerceFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Projects the daemon snapshot's `lastUsage`/`activeTurn`/`attentionTimestamp`
 * onto the optional client metrics block (#560). Returns null when none of the
 * signals are present so legacy payloads render no gauge at all.
 */
export function normalizeAgentMetrics(raw: RawAgentRecord): UppidiAgentMetrics | null {
  const usage = raw.lastUsage ?? null;
  const activeTurn = raw.activeTurn ?? null;

  const metrics: UppidiAgentMetrics = {};
  const contextUsedTokens = coerceFiniteNumber(usage?.contextWindowUsedTokens);
  const contextMaxTokens = coerceFiniteNumber(usage?.contextWindowMaxTokens);
  const cachedTokens = coerceFiniteNumber(usage?.cachedInputTokens);
  const inputTokens = coerceFiniteNumber(usage?.inputTokens);
  const outputTokens = coerceFiniteNumber(usage?.outputTokens);
  const costUsd = coerceFiniteNumber(usage?.totalCostUsd);
  const activeTurnStartedAt =
    typeof activeTurn?.startedAt === "string" ? activeTurn.startedAt : undefined;
  const attentionTimestamp =
    typeof raw.attentionTimestamp === "string" ? raw.attentionTimestamp : undefined;

  if (contextUsedTokens !== undefined) metrics.contextUsedTokens = contextUsedTokens;
  if (contextMaxTokens !== undefined) metrics.contextMaxTokens = contextMaxTokens;
  if (cachedTokens !== undefined) metrics.cachedTokens = cachedTokens;
  if (inputTokens !== undefined) metrics.inputTokens = inputTokens;
  if (outputTokens !== undefined) metrics.outputTokens = outputTokens;
  if (costUsd !== undefined) metrics.costUsd = costUsd;
  if (activeTurnStartedAt !== undefined) metrics.activeTurnStartedAt = activeTurnStartedAt;
  if (attentionTimestamp !== undefined) metrics.attentionTimestamp = attentionTimestamp;

  return Object.keys(metrics).length > 0 ? metrics : null;
}

export function deriveDeterministicState(
  raw: RawAgentRecord,
  attributedWork: UppidiAgentWork | null,
  quotaAlertAgentIds: Set<string> = new Set()
): { state: DeterministicAgentState; detail?: string } {
  const status = (raw.status || "idle").toLowerCase();
  const errorMsg = (raw.lastError || "").toLowerCase();
  const hasQuotaAlert = raw.id ? quotaAlertAgentIds.has(raw.id) : false;
  const permissions = normalizePendingPermissions(raw.pendingPermissions);
  const attentionReason = normalizeAttentionReason(raw.attentionReason);

  // 0. Blocked states (#534): a pending permission prompt or a permission
  // attention flag means the agent cannot progress until a human adjudicates.
  if (permissions.length > 0 || attentionReason === "permission") {
    const action = permissions[0]
      ? getPendingPermissionAction(permissions[0])
      : "tool permission";
    const scope = permissions[0] ? extractPermissionScope(permissions[0]) : undefined;
    return { state: "permission-prompt", detail: scope ? `${action} (${scope})` : action };
  }

  // 1. Error / Failed states
  // Only evaluate errorMsg as a fatal failure when status is explicitly "error",
  // requiresAttention is set with an error reason, or status is unknown/empty with an errorMsg.
  // Stale or transient errors (e.g. foreground turn lock) on active "running" or "idle"
  // agents must not override the healthy state (#516).
  const isExplicitError =
    status === "error" ||
    Boolean(raw.requiresAttention && raw.attentionReason === "error") ||
    (status !== "running" && status !== "idle" && errorMsg.length > 0);

  if (isExplicitError) {
    if (
      hasQuotaAlert ||
      errorMsg.includes("quota") ||
      errorMsg.includes("rate limit") ||
      errorMsg.includes("429") ||
      errorMsg.includes("credit") ||
      errorMsg.includes("exhausted") ||
      errorMsg.includes("usage limit")
    ) {
      return { state: "failed:quota-exhausted", detail: raw.lastError || "Usage limit reached" };
    }
    if (
      errorMsg.includes("spawn") ||
      errorMsg.includes("enoent") ||
      errorMsg.includes("failed to start") ||
      errorMsg.includes("connection refused")
    ) {
      return { state: "failed:spawn", detail: raw.lastError || "Spawn error" };
    }
    if (errorMsg.includes("timeout") || errorMsg.includes("timed out") || errorMsg.includes("etimedout")) {
      return { state: "failed:timeout", detail: raw.lastError || "Execution timeout" };
    }
    return { state: "failed:error", detail: raw.lastError || "Agent error" };
  }

  // 2. Blocked awaiting operator input (#534): the daemon flagged a non-error,
  // non-permission reason (e.g. an interactive ask question). Checked before
  // "running" because a blocked turn can still report a running process.
  if (raw.requiresAttention === true && attentionReason && attentionReason !== "finished" && attentionReason !== "error") {
    return { state: "attention-required", detail: attentionReason };
  }

  // 3. Running states
  if (status === "running") {
    if (attributedWork?.issue) {
      const detail = `#${attributedWork.issue}${attributedWork.slug ? ` (${attributedWork.slug})` : ""}`;
      return { state: "working", detail };
    }
    return { state: "running", detail: "Active turn" };
  }

  // 4. Idle states
  if (status === "idle") {
    if (hasQuotaAlert) {
      return { state: "idle:quota-exhausted", detail: "Quota cooldown" };
    }

    const category = categorizeAgent(raw.name || raw.title || "");
    const lastActivity = raw.lastActivityAt || raw.updatedAt;
    if ((category === "orchestrator" || category === "front-desk") && lastActivity) {
      const idleMs = Date.now() - new Date(lastActivity).getTime();
      // Inactive for > 15 minutes = sleeping standby
      if (!Number.isNaN(idleMs) && idleMs > 15 * 60 * 1000) {
        return { state: "sleeping", detail: "Standby" };
      }
    }

    return { state: "idle:waiting", detail: "Waiting for turn" };
  }

  return { state: "unknown", detail: raw.status || undefined };
}

export function normalizeRawAgent(
  raw: RawAgentRecord,
  quotaAlertAgentIds: Set<string> = new Set(),
  workspaceProjectMap?: WorkspaceProjectMap
): UppidiAgent {
  const id = raw.id || "";
  const shortId = raw.shortId || id.slice(0, 7);
  const name = raw.name || raw.title || `Agent ${shortId}`;
  const category = categorizeAgent(name);
  const status = raw.status || "idle";

  const parentId =
    raw.parentId !== undefined
      ? raw.parentId
      : raw.ParentAgentId !== undefined
      ? raw.ParentAgentId
      : raw.labels?.["paseo.parent-agent-id"] || null;

  const attributedWork = extractAttributedWork(raw);
  const pendingPermissions = normalizePendingPermissions(raw.pendingPermissions);
  const attentionReason = normalizeAttentionReason(raw.attentionReason);
  const requiresAttention =
    pendingPermissions.length > 0 ||
    (raw.requiresAttention === true && attentionReason !== "finished");

  const { state: deterministicState, detail: stateDetail } = deriveDeterministicState(
    raw,
    attributedWork,
    quotaAlertAgentIds
  );
  const lifecycleState: AgentLifecycleState = deriveLifecycleState(deterministicState);
  const blockDetail: AgentBlockDetail | undefined =
    lifecycleState === "waiting_for_input"
      ? buildAgentBlockDetail(id, pendingPermissions)
      : undefined;
  const metrics = normalizeAgentMetrics(raw);

  const project = extractAgentProject(
    raw,
    undefined,
    workspaceProjectMap ?? getWorkspaceProjectMap()
  );

  return {
    id,
    shortId,
    name,
    category,
    provider: raw.provider,
    model: raw.model || null,
    status,
    cwd: raw.cwd,
    created: raw.created || raw.createdAt,
    updatedAt: raw.updatedAt,
    lastActivityAt: raw.lastActivityAt || null,
    workspaceId: raw.workspaceId,
    parentId: parentId || null,
    deterministicState,
    stateDetail,
    lifecycleState,
    blockDetail: blockDetail ?? null,
    attributedWork,
    usage: raw.lastUsage || null,
    metrics,
    lastError: raw.lastError || null,
    url: raw.url || (id ? `paseo://agent/${id}` : undefined),
    worktree: extractAgentWorktree(raw),
    project,
    labels: raw.labels,
    pendingPermissions,
    requiresAttention,
    attentionReason,
  };
}

export function buildAgentTree(agents: UppidiAgent[]): UppidiAgentTreeNode[] {
  const agentMap = new Map<string, UppidiAgent>();
  const childrenMap = new Map<string, UppidiAgent[]>();

  for (const agent of agents) {
    agentMap.set(agent.id, agent);
  }

  for (const agent of agents) {
    if (agent.parentId && agentMap.has(agent.parentId)) {
      const parent = agentMap.get(agent.parentId)!;
      agent.parentName = parent.name;
      agent.parentCategory = parent.category;
    }
  }

  const rootAgents: UppidiAgent[] = [];

  for (const agent of agents) {
    const parentId = agent.parentId;
    if (parentId && agentMap.has(parentId) && parentId !== agent.id) {
      const list = childrenMap.get(parentId) || [];
      list.push(agent);
      childrenMap.set(parentId, list);
    } else {
      rootAgents.push(agent);
    }
  }

  // Recursive tree builder
  function buildNode(agent: UppidiAgent, depth: number, visited: Set<string>): UppidiAgentTreeNode {
    visited.add(agent.id);
    const rawChildren = childrenMap.get(agent.id) || [];
    const children: UppidiAgentTreeNode[] = [];

    for (const child of rawChildren) {
      if (!visited.has(child.id)) {
        children.push(buildNode(child, depth + 1, visited));
      }
    }

    return {
      agent,
      depth,
      children,
    };
  }

  const visited = new Set<string>();
  const tree: UppidiAgentTreeNode[] = [];

  for (const root of rootAgents) {
    if (!visited.has(root.id)) {
      tree.push(buildNode(root, 0, visited));
    }
  }

  return tree;
}

// --- Authoritative workspace -> project resolution (#530) ---

interface WorkspaceProjectRecord {
  workspaceId?: string;
  projectId?: string;
  cwd?: string;
  worktreeRoot?: string | null;
  mainRepoRoot?: string | null;
  displayName?: string;
  kind?: string;
}

interface ProjectRecord {
  projectId?: string;
  rootPath?: string;
  displayName?: string;
  projectKey?: string | null;
}

const WORKSPACE_PROJECT_CACHE_TTL_MS = 30_000;
let workspaceProjectCache: { map: WorkspaceProjectMap; cachedAt: number } | null = null;

function parseProjectKey(key?: string | null): string | undefined {
  const cleaned = key?.trim().replace(/\.git$/, "");
  if (!cleaned || !cleaned.startsWith("remote:")) return undefined;
  const body = cleaned.slice("remote:".length);
  const slash = body.indexOf("/");
  if (slash === -1) return undefined;
  const segments = body.slice(slash + 1).split("/").filter(Boolean);
  if (segments.length >= 2) return segments.slice(-2).join("/");
  return segments[0];
}

function deriveRepoFromWorkspace(
  workspace: WorkspaceProjectRecord | undefined,
  project: ProjectRecord | undefined
): string | undefined {
  const fromKey = parseProjectKey(project?.projectKey);
  if (fromKey) return fromKey;

  const displayName = project?.displayName?.trim() || workspace?.displayName?.trim();
  if (displayName) return displayName;

  const root =
    workspace?.mainRepoRoot ||
    project?.rootPath ||
    workspace?.worktreeRoot ||
    workspace?.cwd;
  if (root) {
    const base = root.replace(/\/+$/, "").split("/").filter(Boolean).pop();
    if (base) return base;
  }

  return undefined;
}

/**
 * Builds a cached map of Paseo workspaceId -> canonical repository by joining
 * ~/.paseo/projects/workspaces.json with ~/.paseo/projects/projects.json.
 */
export function getWorkspaceProjectMap(options: { forceRefresh?: boolean } = {}): WorkspaceProjectMap {
  const now = Date.now();
  if (
    !options.forceRefresh &&
    workspaceProjectCache &&
    now - workspaceProjectCache.cachedAt < WORKSPACE_PROJECT_CACHE_TTL_MS
  ) {
    return workspaceProjectCache.map;
  }

  const map: WorkspaceProjectMap = {};
  try {
    const projectsDir = path.join(resolveHostHome(), ".paseo", "projects");

    const projectsById = new Map<string, ProjectRecord>();
    const projectsPath = path.join(projectsDir, "projects.json");
    if (fs.existsSync(projectsPath)) {
      const projects = JSON.parse(fs.readFileSync(projectsPath, "utf-8"));
      if (Array.isArray(projects)) {
        for (const project of projects) {
          if (project?.projectId) projectsById.set(project.projectId, project);
        }
      }
    }

    const workspacesPath = path.join(projectsDir, "workspaces.json");
    if (fs.existsSync(workspacesPath)) {
      const workspaces = JSON.parse(fs.readFileSync(workspacesPath, "utf-8"));
      if (Array.isArray(workspaces)) {
        for (const workspace of workspaces) {
          if (!workspace?.workspaceId) continue;
          const repo = deriveRepoFromWorkspace(workspace, projectsById.get(workspace.projectId));
          if (repo) map[workspace.workspaceId] = normalizeProjectName(repo);
        }
      }
    }
  } catch {
    // Best-effort: authoritative metadata unavailable, callers fall back.
  }

  workspaceProjectCache = { map, cachedAt: now };
  return map;
}

export function setWorkspaceProjectMapForTest(map: WorkspaceProjectMap | null): void {
  workspaceProjectCache = map ? { map, cachedAt: Date.now() } : null;
}

/**
 * Propagates a resolved project from parent agents to their children, walking
 * multi-level hierarchies until stable. `parentId` is authoritative (#530).
 */
export function applyParentProjectInheritance(agents: UppidiAgent[]): void {
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  let changed = true;
  let guard = 0;
  while (changed && guard < agents.length + 1) {
    changed = false;
    guard++;
    for (const agent of agents) {
      if (agent.project && agent.project !== DEFAULT_PROJECT) continue;
      const parent = agent.parentId ? agentMap.get(agent.parentId) : undefined;
      if (parent?.project && parent.project !== DEFAULT_PROJECT) {
        agent.project = parent.project;
        changed = true;
      }
    }
  }
}

// Read quota alerts from ~/.paseo/limit-alerts.json
export function getQuotaAlertAgentIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const paseoDir = process.env.PASEO_DIR || path.join(resolveHostHome(), ".paseo");
    const alertPath = path.join(paseoDir, "limit-alerts.json");
    if (fs.existsSync(alertPath)) {
      const content = fs.readFileSync(alertPath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed?.alerts)) {
        for (const alert of parsed.alerts) {
          if (alert?.agentId && alert.status === "open") {
            ids.add(alert.agentId);
          }
        }
      }
    }
  } catch {
    // Best-effort
  }
  return ids;
}

// Index on disk: ~/.paseo/agents/*/*.json
export function getAgentDiskMetadataMap(): Map<string, Partial<RawAgentRecord>> {
  const metaMap = new Map<string, Partial<RawAgentRecord>>();
  try {
    const paseoDir = process.env.PASEO_DIR || path.join(resolveHostHome(), ".paseo");
    const agentsDir = path.join(paseoDir, "agents");
    if (!fs.existsSync(agentsDir)) return metaMap;

    const subdirs = fs.readdirSync(agentsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const dir of subdirs) {
      const fullDir = path.join(agentsDir, dir.name);
      const files = fs.readdirSync(fullDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const agentId = file.replace(/\.json$/, "");
        const filePath = path.join(fullDir, file);
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const data = JSON.parse(content);
          metaMap.set(agentId, {
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
          // Ignore parse errors on individual files
        }
      }
    }
  } catch {
    // Best-effort
  }
  return metaMap;
}


export interface RepoRootInspection {
  isDirty: boolean;
  summary?: string;
  /** Checked-out branch of the primary checkout; `HEAD` when detached. */
  branch?: string;
  /** True unless the primary checkout is on `main` (detached HEAD counts as off-main). */
  isOffMain: boolean;
}

async function readGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: 3000,
      encoding: "utf-8",
    });
    return String(stdout).trim();
  } catch {
    return undefined;
  }
}

/**
 * Resolves the primary checkout root for an arbitrary checkout or linked
 * worktree. The orchestrator's `cwd` can be an ephemeral worktree; the invariant
 * this inspection guards lives on the primary checkout, which owns the shared
 * common git directory. A linked worktree's `--git-dir` differs from
 * `--git-common-dir`, whose parent is the primary checkout root.
 */
async function resolvePrimaryCheckoutRoot(cwd: string): Promise<string | undefined> {
  const [gitDir, commonDir] = await Promise.all([
    readGit(cwd, ["rev-parse", "--path-format=absolute", "--git-dir"]),
    readGit(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ]);
  if (!commonDir) return undefined;
  if (gitDir === commonDir) return cwd;
  if (path.basename(commonDir) === ".git") return path.dirname(commonDir);
  return undefined;
}

export async function checkRepoMainDirty(cwd?: string): Promise<RepoRootInspection> {
  if (!cwd) return { isDirty: false, isOffMain: false };
  const repoRoot = (await resolvePrimaryCheckoutRoot(cwd)) || cwd;
  const [status, branch] = await Promise.all([
    readGit(repoRoot, ["status", "--porcelain"]),
    readGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  if (status === undefined) return { isDirty: false, isOffMain: false };
  const lines = status ? status.split("\n").filter(Boolean) : [];
  return {
    isDirty: lines.length > 0,
    summary: lines.length > 0
      ? String(lines.length) + " uncommitted file" + (lines.length === 1 ? "" : "s")
      : undefined,
    branch: branch || undefined,
    isOffMain: branch !== undefined && branch !== "main",
  };
}

export async function fetchPaseoAgents(context?: PluginHandlerContext): Promise<UppidiAgent[]> {
  const quotaAlerts = getQuotaAlertAgentIds();
  const diskMeta = getAgentDiskMetadataMap();
  const mergedAgents = new Map<string, RawAgentRecord>();

  // 1. Try SDK context.paseo.agents.list()
  if (context?.paseo?.agents?.list) {
    try {
      const list = await context.paseo.agents.list();
      if (Array.isArray(list?.entries)) {
        for (const entry of list.entries) {
          const a: any = entry.agent || entry;
          if (!a?.id) continue;
          const disk = diskMeta.get(a.id) || {};
          mergedAgents.set(a.id, {
            id: a.id,
            name: a.name || a.title || disk.name,
            title: a.title || disk.title,
            status: a.status || disk.status,
            provider: a.provider || a.config?.provider || disk.provider,
            model: a.model || disk.model,
            cwd: a.cwd || a.config?.cwd || disk.cwd,
            workspaceId: a.workspaceId || disk.workspaceId,
            created: a.created || a.createdAt || disk.createdAt,
            updatedAt: a.updatedAt || disk.updatedAt,
            lastActivityAt: a.lastActivityAt || disk.lastActivityAt,
            labels: { ...(disk.labels || {}), ...(a.labels || {}) },
            parentId:
              a.labels?.["paseo.parent-agent-id"] ||
              disk.parentId ||
              null,
            lastError: a.lastError || disk.lastError,
            requiresAttention: a.requiresAttention ?? disk.requiresAttention,
            attentionReason: a.attentionReason || disk.attentionReason,
            attentionTimestamp: a.attentionTimestamp || disk.attentionTimestamp,
            pendingPermissions: a.pendingPermissions ?? disk.pendingPermissions,
            activeTurn: a.activeTurn || disk.activeTurn,
            lastUsage: a.lastUsage || disk.lastUsage,
          });
        }
      }
    } catch {
      // Fallback to CLI if SDK call throws
    }
  }

  // 2. If no agents from SDK, fallback to CLI: paseo ls --json
  if (mergedAgents.size === 0) {
    try {
      const { stdout } = await execFileAsync("paseo", ["ls", "--json", "--global"], {
        timeout: 5000,
        encoding: "utf-8",
      });
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item?.id) continue;
          const disk = diskMeta.get(item.id) || {};
          mergedAgents.set(item.id, {
            id: item.id,
            name: item.name || item.title || disk.name,
            title: item.title || disk.title,
            status: item.status || disk.status,
            provider: item.provider || disk.provider,
            model: disk.model || (item.provider?.includes("/") ? item.provider.split("/")[1] : undefined),
            cwd: item.cwd || disk.cwd,
            created: item.created || disk.createdAt,
            updatedAt: disk.updatedAt,
            lastActivityAt: disk.lastActivityAt,
            workspaceId: disk.workspaceId,
            labels: disk.labels,
            parentId: disk.parentId || null,
            lastError: disk.lastError,
            requiresAttention: disk.requiresAttention,
            attentionReason: disk.attentionReason,
            attentionTimestamp: disk.attentionTimestamp,
            pendingPermissions: disk.pendingPermissions,
            activeTurn: disk.activeTurn,
            lastUsage: disk.lastUsage,
          });
        }
      }
    } catch {
      // If CLI unavailable, return empty array
    }
  }

  const workspaceProjectMap = getWorkspaceProjectMap();
  const agents = Array.from(mergedAgents.values()).map((raw) =>
    normalizeRawAgent(raw, quotaAlerts, workspaceProjectMap)
  );

  // Children inherit their parent's project when no authoritative mapping exists (#530).
  applyParentProjectInheritance(agents);

  return agents;
}

export interface CanonicalFleetRegistry {
  /** True when the active hook router was reachable and its registry is authoritative. */
  available: boolean;
  frontDeskAgentId: string | null;
  /** Live registered orchestrator agent id -> canonical repo key from `GET /orchestrators`. */
  orchestratorAgentIdToRepo: Map<string, string>;
}

/**
 * Reads the canonical fleet registry (#1078): the Front Desk identity from
 * `GET /frontdesk` and the repo -> orchestrator mapping from `GET /orchestrators`.
 * Returns `available: false` when no router is active so callers can mark the
 * name-heuristic fallback display-only instead of pretending it is canonical.
 */
export function readCanonicalFleetRegistry(): CanonicalFleetRegistry {
  const router = getActiveHookRouter();
  if (!router) {
    return { available: false, frontDeskAgentId: null, orchestratorAgentIdToRepo: new Map() };
  }

  const orchestratorAgentIdToRepo = new Map<string, string>();
  for (const record of router.listOrchestratorRecords()) {
    if (record?.agentId && !orchestratorAgentIdToRepo.has(record.agentId)) {
      orchestratorAgentIdToRepo.set(record.agentId, record.key);
    }
  }

  return {
    available: true,
    frontDeskAgentId: router.readFrontDesk()?.agentId ?? null,
    orchestratorAgentIdToRepo,
  };
}

/**
 * Resolves an agent's canonical role from the registry (#1078). The registry is
 * the only source of truth for Front Desk and orchestrator identity; anything
 * not registered is a worker regardless of its display name.
 */
export function resolveCanonicalRole(
  agentId: string,
  registry: CanonicalFleetRegistry
): { role: "front-desk" | "orchestrator" | "worker"; registryRepoKey?: string } {
  if (registry.frontDeskAgentId && agentId === registry.frontDeskAgentId) {
    return { role: "front-desk" };
  }
  const registryRepoKey = registry.orchestratorAgentIdToRepo.get(agentId);
  if (registryRepoKey) {
    return { role: "orchestrator", registryRepoKey };
  }
  return { role: "worker" };
}

function describeRoleDivergence(
  nameCategory: "front-desk" | "orchestrator" | "worker",
  registryRole: "front-desk" | "orchestrator" | "worker"
): string {
  if (nameCategory === "front-desk") {
    return `Agent name implies Front Desk but the router registry says "${registryRole}"`;
  }
  return `Agent name implies orchestrator but the router registry says "${registryRole}"`;
}

/**
 * Projects the canonical registry role onto every agent (#1078). When the
 * registry is reachable `category` is overwritten with the registry role and
 * the name heuristic is preserved as `nameCategory`; divergences are collected
 * so the surface can show the mismatch instead of hiding it. When the registry
 * is unreachable the name heuristic is kept and marked display-only.
 */
export function applyCanonicalRoles(
  agents: UppidiAgent[],
  registry: CanonicalFleetRegistry
): AgentRoleDivergence[] {
  const divergences: AgentRoleDivergence[] = [];

  for (const agent of agents) {
    const nameCategory = agent.category;
    agent.nameCategory = nameCategory;

    if (!registry.available) {
      agent.roleSource = "name-heuristic";
      agent.roleDivergent = false;
      continue;
    }

    const canonical = resolveCanonicalRole(agent.id, registry);
    agent.category = canonical.role;
    agent.roleSource = "registry";
    // Only a name that *claims* a role the registry does not grant is a lie.
    // A generic display name under a registry-backed role is just a title.
    agent.roleDivergent = nameCategory !== "worker" && canonical.role !== nameCategory;
    if (canonical.registryRepoKey) {
      agent.registryRepoKey = canonical.registryRepoKey;
    }

    if (agent.roleDivergent) {
      divergences.push({
        agentId: agent.id,
        agentName: agent.name,
        nameCategory,
        registryRole: canonical.role,
        reason: describeRoleDivergence(nameCategory, canonical.role),
      });
    }
  }

  return divergences;
}

export async function handleUppidiAgents(
  _input: Record<string, never>,
  context: PluginHandlerContext
): Promise<UppidiAgentsOutput> {
  try {
    const agents = await fetchPaseoAgents(context);

    // Identity comes from the router registry, never from agent names (#1078).
    const registry = readCanonicalFleetRegistry();
    const roleDivergences = applyCanonicalRoles(agents, registry);

    const frontDesk: UppidiAgent[] = [];
    const orchestrators: UppidiAgent[] = [];
    const workers: UppidiAgent[] = [];

    let runningCount = 0;
    let idleCount = 0;
    let errorCount = 0;

    for (const agent of agents) {
      if (agent.status === "running") runningCount++;
      else if (agent.status === "idle") idleCount++;
      else if (agent.status === "error") errorCount++;

      if (agent.category === "front-desk") {
        frontDesk.push(agent);
      } else if (agent.category === "orchestrator") {
        orchestrators.push(agent);
      } else {
        workers.push(agent);
      }
    }

    // Parent-project inheritance already applied in fetchPaseoAgents (#530).

    const { enrolledRepos, pausedRepos, repoQueuedHooks } = getFleetRosterInfo();

    for (const a of agents) {
      const proj = a.project || DEFAULT_PROJECT;
      const isEnrolled = enrolledRepos.some((r) => isRepoMatching(r, proj));
      a.isEnrolled = isEnrolled;
      a.isDetached = !isEnrolled;
      a.isPaused = pausedRepos.some((m) => isRepoMatching(m, proj));
      let queued = 0;
      for (const [k, count] of Object.entries(repoQueuedHooks)) {
        if (isRepoMatching(k, proj)) {
          queued += count;
        }
      }
      a.queuedHooksCount = queued;

      if (a.category === "orchestrator" && a.cwd) {
        const rootStatus = await checkRepoMainDirty(a.cwd);
        a.isMainDirty = rootStatus.isDirty;
        a.mainDirtySummary = rootStatus.summary;
        a.repoHeadBranch = rootStatus.branch;
        a.isRepoRootOffMain = rootStatus.isOffMain;
      }
    }

    const tree = buildAgentTree(agents);

    return {
      ok: true,
      registryAuthoritative: registry.available,
      roleDivergences,
      frontDesk,
      orchestrators,
      workers,
      tree,
      enrolledRepos,
      pausedRepos,
      repoQueuedHooks,
      totalCount: agents.length,
      runningCount,
      idleCount,
      errorCount,
    };
  } catch (err: any) {
    return {
      ok: false,
      registryAuthoritative: getActiveHookRouter() !== null,
      roleDivergences: [],
      frontDesk: [],
      orchestrators: [],
      workers: [],
      tree: [],
      enrolledRepos: [],
      pausedRepos: [],
      repoQueuedHooks: {},
      totalCount: 0,
      runningCount: 0,
      idleCount: 0,
      errorCount: 0,
      error: err?.message || String(err),
    };
  }
}

export async function handleUppidiArchiveAgent(
  input: UppidiArchiveAgentInput,
  context: PluginHandlerContext
): Promise<UppidiArchiveAgentOutput> {
  const agentId = input.agentId?.trim();
  if (!agentId) {
    return { ok: false, error: "agentId is required" };
  }

  // 1. Try SDK context.paseo.agents.ref(agentId).archive()
  if (context?.paseo?.agents?.ref) {
    try {
      const ref = context.paseo.agents.ref(agentId);
      if (typeof ref?.archive === "function") {
        await ref.archive();
        return { ok: true, agentId, message: `Archived agent ${agentId}` };
      }
    } catch (err: any) {
      // Fall through to CLI fallback
    }
  }

  // 2. Fallback to CLI: paseo archive <agentId>
  try {
    await execFileAsync("paseo", ["archive", agentId], {
      timeout: 5000,
      encoding: "utf-8",
    });
    return { ok: true, agentId, message: `Archived agent ${agentId}` };
  } catch (err: any) {
    return {
      ok: false,
      agentId,
      error: err?.message || String(err),
    };
  }
}

export async function handleUppidiArchiveInactiveAgents(
  input: UppidiArchiveInactiveAgentsInput,
  context: PluginHandlerContext
): Promise<UppidiArchiveInactiveAgentsOutput> {
  try {
    const agents = await fetchPaseoAgents(context);
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    let targetIds: string[] = [];
    if (input.agentIds && input.agentIds.length > 0) {
      for (const id of input.agentIds) {
        const agent = agentMap.get(id);
        // Safety guard: ensure agent exists and is eligible for bulk archive
        if (agent && isAgentEligibleForBulkArchive(agent)) {
          targetIds.push(id);
        }
      }
    } else {
      targetIds = agents.filter(isAgentEligibleForBulkArchive).map((a) => a.id);
    }

    if (targetIds.length === 0) {
      return {
        ok: true,
        archivedCount: 0,
        archivedIds: [],
        message: "No eligible inactive agents found to archive",
      };
    }

    const archivedIds: string[] = [];
    const errors: string[] = [];

    for (const id of targetIds) {
      let success = false;
      if (context?.paseo?.agents?.ref) {
        try {
          const ref = context.paseo.agents.ref(id);
          if (typeof ref?.archive === "function") {
            await ref.archive();
            success = true;
          }
        } catch {
          // Fall through to CLI
        }
      }

      if (!success) {
        try {
          await execFileAsync("paseo", ["archive", id], {
            timeout: 5000,
            encoding: "utf-8",
          });
          success = true;
        } catch (err: any) {
          errors.push(`Failed to archive agent ${id}: ${err?.message || String(err)}`);
        }
      }

      if (success) {
        archivedIds.push(id);
      }
    }

    return {
      ok: errors.length === 0 || archivedIds.length > 0,
      archivedCount: archivedIds.length,
      archivedIds,
      message: `Archived ${archivedIds.length} inactive agent(s)`,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  } catch (err: any) {
    return {
      ok: false,
      archivedCount: 0,
      archivedIds: [],
      error: err?.message || String(err),
    };
  }
}

// --- Fleet Teardown Handler (#742) ---

/**
 * Maps a teardown target category to the agent category string used by the
 * daemon's agent categorization.
 */
function teardownTargetToCategory(target: string): "front-desk" | "orchestrator" | "worker" {
  switch (target) {
    case "frontdesk":
      return "front-desk";
    case "orchestrators":
      return "orchestrator";
    case "workers":
    default:
      return "worker";
  }
}

/**
 * Archives a single agent by id, trying SDK first and falling back to CLI.
 * Returns true on success, false on failure.
 */
async function archiveAgentById(
  agentId: string,
  context: PluginHandlerContext
): Promise<boolean> {
  if (context?.paseo?.agents?.ref) {
    try {
      const ref = context.paseo.agents.ref(agentId);
      if (typeof ref?.archive === "function") {
        await ref.archive();
        return true;
      }
    } catch {
      // Fall through to CLI
    }
  }

  try {
    await execFileAsync("paseo", ["archive", agentId], {
      timeout: 5000,
      encoding: "utf-8",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fleet teardown handler (#742). Archives all agents matching the requested
 * target categories. Returns structured counts of torn-down agents per
 * category and any errors encountered.
 */
export async function handleFleetTeardown(
  input: FleetTeardownInput,
  context: PluginHandlerContext
): Promise<FleetTeardownOutput> {
  // #1013: hold the teardown window for the whole handler so a dashboard RESUME
  // cannot clear the canonical halt while agents/state are still being archived.
  const router = getActiveHookRouter();
  router?.markTeardownStart();
  try {
    const targetSet = new Set(input.targets);
    const targetCategories = new Set(
      input.targets.map((t) => teardownTargetToCategory(t))
    );

    let agents: UppidiAgent[] = [];
    try {
      agents = await fetchPaseoAgents(context);
    } catch {
      // If fetching fails, proceed with state cleanup
    }

    let agentsToTeardown = agents.filter((a) => targetCategories.has(a.category));

    const tornDown = { workers: 0, orchestrators: 0, frontdesk: 0 };
    const errors: string[] = [];

    if (router) {
      try {
        router.halt();
      } catch (err: any) {
        errors.push(`Failed to engage router halt: ${err?.message || String(err)}`);
      }
    }

    if (input.drain) {
      const timeoutMs = input.drainTimeoutMs ?? 30000;
      const pollIntervalMs = 250;
      const startDrain = Date.now();
      while (Date.now() - startDrain < timeoutMs) {
        let currentAgents: UppidiAgent[] = [];
        try {
          currentAgents = await fetchPaseoAgents(context);
        } catch {
          break;
        }
        const activeRemaining = currentAgents.filter(
          (a) => targetCategories.has(a.category) && a.status === "running"
        );
        if (activeRemaining.length === 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      // Refresh agents to teardown after draining
      try {
        const refreshed = await fetchPaseoAgents(context);
        agentsToTeardown = refreshed.filter((a) => targetCategories.has(a.category));
      } catch {}
    }

    // Notify remaining registered groups BEFORE archiving/culling (#872).
    // Delivered via the hook-router queue so the payload survives teardown.
    // Preview counts are derived from the agents about to be culled.
    const previewCounts = {
      workers: agentsToTeardown.filter((a) => a.category === "worker").length,
      orchestrators: agentsToTeardown.filter((a) => a.category === "orchestrator").length,
      frontdesk: agentsToTeardown.filter((a) => a.category === "front-desk").length,
    };
    const teardownNotice = formatFleetTeardownNotice(input.targets, previewCounts);
    let teardownQueuedKeys: string[] = [];
    let teardownDelivered = 0;
    if (router) {
      try {
        const broadcast = await router.broadcastTeardownNotice(teardownNotice, {
          targets: input.targets,
        });
        teardownQueuedKeys = broadcast.queuedKeys;
        teardownDelivered = broadcast.delivered;
      } catch (err: any) {
        errors.push(`Failed to broadcast teardown notice: ${err?.message || String(err)}`);
      }
    }

    for (const agent of agentsToTeardown) {
      const success = await archiveAgentById(agent.id, context);
      if (success) {
        if (agent.category === "worker") tornDown.workers++;
        else if (agent.category === "orchestrator") tornDown.orchestrators++;
        else if (agent.category === "front-desk") tornDown.frontdesk++;
      } else {
        errors.push(`Failed to archive agent ${agent.id} (${agent.name})`);
      }
    }
    const home = process.env.HOME ?? os.homedir();
    const persistedDir = getPersistedStateDir();
    const pluginDataDir = join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet");

    // Clean up Front Desk state if targeted (#774)
    if (targetSet.has("frontdesk")) {
      const fdCandidates = new Set<string>([
        join(persistedDir, "frontdesk.json"),
        join(path.dirname(persistedDir), "frontdesk.json"),
        join(persistedDir, "orchestrators", "frontdesk.json"),
        join(pluginDataDir, "frontdesk.json"),
        join(pluginDataDir, "orchestrators", "frontdesk.json"),
        join(home, ".paseo", "forgejo-hook", "frontdesk.json"),
        join(home, ".paseo", "forgejo-hook", "orchestrators", "frontdesk.json"),
      ]);
      if (router?.stateDir) {
        fdCandidates.add(join(router.stateDir, "frontdesk.json"));
        fdCandidates.add(join(path.dirname(router.stateDir), "frontdesk.json"));
      }
      if (router?.queueDir) {
        fdCandidates.add(join(router.queueDir, "frontdesk.json"));
      }

      const removedFrontDeskFiles: string[] = [];
      for (const file of fdCandidates) {
        try {
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            removedFrontDeskFiles.push(file);
          }
        } catch (err: any) {
          errors.push(`Failed to delete frontdesk state file ${file}: ${err?.message || String(err)}`);
        }
      }
      if (removedFrontDeskFiles.length > 0 && router && typeof (router as any).recordStateMutation === "function") {
        try {
          (router as any).recordStateMutation({
            action: "clearFrontDesk",
            source: "fleet-teardown:frontdesk",
            actor: null,
            reason: `fleet teardown targets=${input.targets.join(",")}`,
            key: "frontdesk",
            priorValue: { paths: removedFrontDeskFiles },
          });
        } catch {}
      }

      if (router) {
        try {
          if (typeof (router as any).clearFrontDesk === "function") {
            (router as any).clearFrontDesk({ source: "fleet-teardown:frontdesk", reason: `targets=${input.targets.join(",")}` });
          } else if (typeof (router as any).clearQueue === "function") {
            (router as any).clearQueue("frontdesk");
          }
        } catch (err: any) {
          errors.push(`Failed to clean up router frontdesk state: ${err?.message || String(err)}`);
        }
      }
    }

    // Clean up Orchestrators state if targeted (#774)
    if (targetSet.has("orchestrators")) {
      const orchDirs = new Set<string>([
        join(persistedDir, "orchestrators"),
        join(pluginDataDir, "orchestrators"),
        join(home, ".paseo", "forgejo-hook", "orchestrators"),
      ]);
      if (router?.stateDir) {
        orchDirs.add(router.stateDir);
      }

      const removedOrchestratorFiles: string[] = [];
      for (const dir of orchDirs) {
        try {
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            for (const file of files) {
              if (file.endsWith(".json")) {
                if (file === "frontdesk.json" && !targetSet.has("frontdesk")) {
                  continue;
                }
                try {
                  fs.unlinkSync(join(dir, file));
                  removedOrchestratorFiles.push(join(dir, file));
                } catch (err: any) {
                  errors.push(`Failed to delete orchestrator file ${file}: ${err?.message || String(err)}`);
                }
              }
            }
          }
        } catch (err: any) {
          errors.push(`Failed to read orchestrators dir ${dir}: ${err?.message || String(err)}`);
        }
      }
      if (
        removedOrchestratorFiles.length > 0 &&
        router &&
        typeof (router as any).recordStateMutation === "function"
      ) {
        try {
          (router as any).recordStateMutation({
            action: "clearAllOrchestrators",
            source: "fleet-teardown:orchestrators",
            actor: null,
            reason: `fleet teardown targets=${input.targets.join(",")}`,
            key: null,
            priorValue: { paths: removedOrchestratorFiles },
          });
        } catch {}
      }

      if (router) {
        try {
          if (typeof (router as any).clearAllOrchestrators === "function") {
            (router as any).clearAllOrchestrators({
              source: "fleet-teardown:orchestrators",
              reason: `targets=${input.targets.join(",")}`,
            });
          }
        } catch (err: any) {
          errors.push(`Failed to clear router orchestrator mappings: ${err?.message || String(err)}`);
        }
      }
    }

    // Clean up worker / repo queues if workers is targeted or general teardown (#774)
    const isGeneralTeardown =
      targetSet.has("workers") && targetSet.has("orchestrators") && targetSet.has("frontdesk");
    if (targetSet.has("workers") || isGeneralTeardown) {
      if (router) {
        try {
          if (isGeneralTeardown && typeof (router as any).clearAllQueues === "function") {
            (router as any).clearAllQueues();
          } else if (typeof (router as any).clearQueue === "function") {
            const queueKeys = (router as any).queues
              ? Array.from(((router as any).queues as Map<string, any>).keys())
              : [];
            for (const key of queueKeys) {
              if (key === "frontdesk" && !targetSet.has("frontdesk")) continue;
              (router as any).clearQueue(key);
            }
          }
        } catch (err: any) {
          errors.push(`Failed to clear router worker queues: ${err?.message || String(err)}`);
        }
      }

      const queueDirs = new Set<string>([
        join(pluginDataDir, "queues"),
        join(home, ".paseo", "forgejo-hook", "queues"),
      ]);
      if (process.env.HOOK_QUEUE_DIR) {
        queueDirs.add(process.env.HOOK_QUEUE_DIR);
      }
      if (router?.queueDir) {
        queueDirs.add(router.queueDir);
      }

      for (const qDir of queueDirs) {
        try {
          if (fs.existsSync(qDir)) {
            const files = fs.readdirSync(qDir);
            for (const file of files) {
              if (file.endsWith(".json") || file.endsWith(".jsonl")) {
                if (file.startsWith("frontdesk") && !targetSet.has("frontdesk")) {
                  continue;
                }
                try {
                  fs.unlinkSync(join(qDir, file));
                } catch (err: any) {
                  errors.push(`Failed to delete queue file ${file}: ${err?.message || String(err)}`);
                }
              }
            }
          }
        } catch (err: any) {
          errors.push(`Failed to read queue dir ${qDir}: ${err?.message || String(err)}`);
        }
      }
    }

    // Reconcile router registry + queue states to teardown status (#872):
    // release stale locks, suppress false amnesia/lock alerts for culled ids,
    // and persist the teardown stamp.
    if (router) {
      try {
        const culledIds = agentsToTeardown.map((a) => a.id);
        if (typeof (router as any).markFleetTeardown === "function") {
          (router as any).markFleetTeardown(input.targets, culledIds);
        }
        // Ensure the pre-cull broadcast survives the queue purge above for
        // remaining groups. `frontdesk` is exempt from QUEUE_UNORCHESTRATED, so
        // it doubles as the audit trail when everything was culled.
        const survivingFrontDesk = !targetSet.has("frontdesk") && teardownQueuedKeys.includes("frontdesk");
        const survivingOrchestrators = !targetSet.has("orchestrators")
          ? teardownQueuedKeys.filter((k) => k !== "frontdesk")
          : [];
        if (survivingFrontDesk || survivingOrchestrators.length > 0) {
          for (const key of survivingOrchestrators) {
            try {
              if ((router as any).getQueue(key).length === 0) {
                (router as any).enqueue(key, teardownNotice, true);
              }
            } catch {}
          }
          try {
            if (survivingFrontDesk && (router as any).getQueue("frontdesk").length === 0) {
              (router as any).enqueue("frontdesk", teardownNotice, true);
            }
          } catch {}
        } else if (isGeneralTeardown) {
          try {
            (router as any).enqueue("frontdesk", teardownNotice, true);
            teardownQueuedKeys = ["frontdesk"];
          } catch {}
        }
      } catch (err: any) {
        errors.push(`Failed to reconcile teardown router state: ${err?.message || String(err)}`);
      }
    }

    const totalTornDown = tornDown.workers + tornDown.orchestrators + tornDown.frontdesk;

    let message = "";
    if (totalTornDown === 0 && agentsToTeardown.length === 0) {
      message = "No agents found matching the selected teardown targets";
      if (teardownQueuedKeys.length > 0) {
        message += `; notified ${teardownQueuedKeys.length} group(s) via hook-router queue`;
      }
    } else {
      message = `Torn down ${totalTornDown} agent(s) — ${tornDown.workers} workers, ${tornDown.orchestrators} orchestrators, ${tornDown.frontdesk} frontdesk`;
      if (teardownQueuedKeys.length > 0 || teardownDelivered > 0) {
        message += `; notified ${teardownQueuedKeys.length} group(s) via hook-router queue`;
      }
    }

    try {
      appendHookLog(
        `[info] [fleet-teardown] targets=${input.targets.join(",")} tornDown=${totalTornDown} ` +
          `queued=${teardownQueuedKeys.join(",") || "none"} delivered=${teardownDelivered}`
      );
    } catch {}

    return {
      ok: errors.length === 0 || totalTornDown > 0,
      tornDown,
      errors,
      message,
    };
  } catch (err: any) {
    return {
      ok: false,
      tornDown: { workers: 0, orchestrators: 0, frontdesk: 0 },
      errors: [err?.message || String(err)],
      error: err?.message || String(err),
    };
  } finally {
    router?.markTeardownEnd();
  }
}

/**
 * Engage the canonical ALL HALT (#1013). Reuses the #994 `HookRouter.halt()`
 * path rather than introducing a second halt mechanism. A double-engage is a
 * no-op that reports `alreadyHalted` so the dashboard can disable the control.
 */
export async function handleFleetHalt(
  _input: FleetHaltInput,
  _context?: PluginHandlerContext
): Promise<FleetHaltOutput> {
  const router = getActiveHookRouter();
  if (!router) {
    return {
      ok: false,
      halted: false,
      alreadyHalted: false,
      teardownInProgress: false,
      error: "Hook router is not running; cannot engage halt",
    };
  }

  if (router.isHalted()) {
    return {
      ok: true,
      halted: true,
      alreadyHalted: true,
      teardownInProgress: router.isTeardownInProgress(),
      message: "Canonical ALL HALT is already engaged",
    };
  }

  try {
    router.halt();
    return {
      ok: true,
      halted: true,
      alreadyHalted: false,
      teardownInProgress: router.isTeardownInProgress(),
      message: "Canonical ALL HALT engaged — ingress paused, background loops stopped, auto-provisioning disabled",
    };
  } catch (err: any) {
    return {
      ok: false,
      halted: router.isHalted(),
      alreadyHalted: false,
      teardownInProgress: router.isTeardownInProgress(),
      error: err?.message || String(err),
    };
  }
}

/**
 * Clear the canonical ALL HALT (#1013) via `router.resume("all")`. Refuses
 * while a fleet teardown is mid-flight so resume cannot race archiving.
 */
export async function handleFleetResume(
  _input: FleetResumeInput,
  _context?: PluginHandlerContext
): Promise<FleetResumeOutput> {
  const router = getActiveHookRouter();
  if (!router) {
    return {
      ok: false,
      halted: false,
      teardownInProgress: false,
      error: "Hook router is not running; cannot resume halt",
    };
  }

  if (router.isTeardownInProgress()) {
    return {
      ok: false,
      halted: router.isHalted(),
      teardownInProgress: true,
      error: "Fleet teardown in progress; halt cannot be resumed until it completes",
    };
  }

  if (!router.isHalted()) {
    return {
      ok: true,
      halted: false,
      teardownInProgress: false,
      message: "Fleet is not halted",
    };
  }

  const result = router.resumeAll();
  return {
    ok: result.ok,
    halted: router.isHalted(),
    teardownInProgress: router.isTeardownInProgress(),
    message: result.resumed ? "Canonical ALL HALT cleared — ingress and auto-provisioning resumed" : undefined,
    error: result.error,
  };
}

/**
 * Reset fleet state (Issue #764):
 * Purge persisted/stale cache and status in ~/.cache and plugin storage directory
 * (board-state, queues), clear in-memory queues if active, and notify registered
 * orchestrators via paseo send --steer so they do not rely on stale context.
 */
export async function handleFleetResetState(
  input: FleetResetStateInput,
  context: PluginHandlerContext
): Promise<FleetResetStateOutput> {
  const errors: string[] = [];
  let cacheFiles = 0;
  let boardStateFiles = 0;
  let queueFiles = 0;
  let notifiedOrchestrators = 0;

  try {
    const home = process.env.HOME ?? os.homedir();

    // 1. Purge ~/.cache/forgejo-board-state*.json and ~/.cache/forgejo-issues/
    const cacheDir = join(home, ".cache");
    if (fs.existsSync(cacheDir)) {
      try {
        const files = fs.readdirSync(cacheDir);
        for (const file of files) {
          if (file.startsWith("forgejo-board-state") && file.endsWith(".json")) {
            try {
              fs.unlinkSync(join(cacheDir, file));
              cacheFiles++;
            } catch (err: any) {
              errors.push(`Failed to delete cache file ${file}: ${err?.message || String(err)}`);
            }
          }
        }
      } catch (err: any) {
        errors.push(`Failed to read cache dir ${cacheDir}: ${err?.message || String(err)}`);
      }

      const issuesCacheDir = join(cacheDir, "forgejo-issues");
      if (fs.existsSync(issuesCacheDir)) {
        try {
          const issueFiles = fs.readdirSync(issuesCacheDir);
          for (const file of issueFiles) {
            try {
              fs.unlinkSync(join(issuesCacheDir, file));
              cacheFiles++;
            } catch (err: any) {
              errors.push(`Failed to delete issue cache file ${file}: ${err?.message || String(err)}`);
            }
          }
        } catch (err: any) {
          errors.push(`Failed to read issue cache dir ${issuesCacheDir}: ${err?.message || String(err)}`);
        }
      }
    }

    // 2. Purge plugin storage directory: board-state and queues
    const pluginDataDir = join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet");
    const boardStateDir = join(pluginDataDir, "board-state");
    if (fs.existsSync(boardStateDir)) {
      try {
        const files = fs.readdirSync(boardStateDir);
        for (const file of files) {
          if (file.endsWith(".json")) {
            try {
              fs.unlinkSync(join(boardStateDir, file));
              boardStateFiles++;
            } catch (err: any) {
              errors.push(`Failed to delete board-state file ${file}: ${err?.message || String(err)}`);
            }
          }
        }
      } catch (err: any) {
        errors.push(`Failed to read board-state dir ${boardStateDir}: ${err?.message || String(err)}`);
      }
    }

    // Also check legacy ~/.paseo/forgejo-hook/ if any
    const legacyBoardStateDir = join(home, ".paseo", "forgejo-hook", "board-state");
    if (fs.existsSync(legacyBoardStateDir)) {
      try {
        const files = fs.readdirSync(legacyBoardStateDir);
        for (const file of files) {
          if (file.endsWith(".json")) {
            try {
              fs.unlinkSync(join(legacyBoardStateDir, file));
              boardStateFiles++;
            } catch (err) {
              console.warn(`[uppidi-fleet:agents] file delete failed:`, err);
            }
          }
        }
      } catch (err) {
        console.warn(`[uppidi-fleet:agents] file delete failed:`, err);
      }
    }

    // 3. Clear queues on router and on disk
    const router = getActiveHookRouter();
    if (router && typeof (router as any).clearAllQueues === "function") {
      try {
        queueFiles += router.clearAllQueues();
      } catch (err: any) {
        errors.push(`Failed to clear router queues: ${err?.message || String(err)}`);
      }
    } else {
      const queueDir = process.env.HOOK_QUEUE_DIR ?? join(pluginDataDir, "queues");
      if (fs.existsSync(queueDir)) {
        try {
          const files = fs.readdirSync(queueDir);
          for (const file of files) {
            if (file.endsWith(".json")) {
              try {
                fs.unlinkSync(join(queueDir, file));
                queueFiles++;
              } catch (err: any) {
                errors.push(`Failed to delete queue file ${file}: ${err?.message || String(err)}`);
              }
            }
          }
        } catch (err: any) {
          errors.push(`Failed to read queue dir ${queueDir}: ${err?.message || String(err)}`);
        }
      }
    }

    // 4. Notify registered orchestrators via paseo send --steer
    if (input.notifyOrchestrators !== false) {
      const orchestratorIds = new Set<string>();

      // From router if active
      if (router && typeof (router as any).listOrchestratorAgentIds === "function") {
        for (const id of router.listOrchestratorAgentIds()) {
          if (id) orchestratorIds.add(id);
        }
      }

      // From plugin data orchestrator registration directory
      const orchestratorDir = process.env.HOOK_STATE_DIR ?? join(pluginDataDir, "orchestrators");
      if (fs.existsSync(orchestratorDir)) {
        try {
          const files = fs.readdirSync(orchestratorDir);
          for (const file of files) {
            if (file.endsWith(".json") && file !== "frontdesk.json") {
              try {
                const raw = fs.readFileSync(join(orchestratorDir, file), "utf8");
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.agentId === "string" && parsed.agentId.trim()) {
                  orchestratorIds.add(parsed.agentId.trim());
                }
              } catch (err) {
                console.warn(`[uppidi-fleet:agents] state read/parse failed:`, err);
              }
            }
          }
        } catch (err) {
          console.warn(`[uppidi-fleet:agents] state read/parse failed:`, err);
        }
      }

      // Also check active Paseo agents to catch any running orchestrator
      try {
        const liveAgents = await fetchPaseoAgents(context);
        for (const a of liveAgents) {
          if (a.category === "orchestrator" && (a.status === "running" || a.status === "idle")) {
            orchestratorIds.add(a.id);
          }
        }
      } catch (err) {
        console.warn(`[uppidi-fleet:agents] live agent fetch failed:`, err);
      }

      const resetNotice =
        "[uppidi-fleet] Fleet state reset: cache, board-state, and event queues have been purged by operator. " +
        "Stale status has been cleared; please refresh your context and do not rely on previous cached state.";

      for (const orchId of orchestratorIds) {
        let sent = false;
        if (router && typeof (router as any).deliverMessage === "function") {
          try {
            sent = await router.deliverMessage(orchId, resetNotice, { noWait: true, steer: true });
          } catch (err) {
            console.warn(`[uppidi-fleet:agents] message delivery failed:`, err);
          }
        }
        if (!sent) {
          try {
            if (context?.paseo?.agents?.ref) {
              const agentRef = context.paseo.agents.ref(orchId);
              await agentRef.send(resetNotice, { steer: true } as any);
              sent = true;
            } else {
              await execFileAsync("paseo", ["send", "--no-wait", "--steer", orchId, resetNotice], { timeout: 5000 });
              sent = true;
            }
          } catch (err: any) {
            errors.push(`Failed to notify orchestrator ${orchId}: ${err?.message || String(err)}`);
          }
        }
        if (sent) {
          notifiedOrchestrators++;
        }
      }
    }

    appendHookLog(`[info] [fleet-reset] State reset completed: ${cacheFiles} cache, ${boardStateFiles} board-state, ${queueFiles} queues purged; ${notifiedOrchestrators} orchestrator(s) notified.`);

    return {
      ok: errors.length === 0,
      cleared: {
        cacheFiles,
        boardStateFiles,
        queueFiles,
      },
      notifiedOrchestrators,
      errors,
      message: `Reset fleet state: purged ${cacheFiles} cache file(s), ${boardStateFiles} board-state file(s), ${queueFiles} queue file(s); notified ${notifiedOrchestrators} orchestrator(s).`,
    };
  } catch (err: any) {
    return {
      ok: false,
      cleared: {
        cacheFiles,
        boardStateFiles,
        queueFiles,
      },
      notifiedOrchestrators,
      errors: [err?.message || String(err)],
      error: err?.message || String(err),
    };
  }
}

// --- Front Desk & Orchestrator Lifecycle + Muting Handlers (#426) ---

/**
 * Declarative capabilities a spawner may grant a child at creation time (#537).
 *
 * The daemon has no pre-grant surface today (see README §13.6), so this is
 * best-effort: `mode` is forwarded only for providers that accept it, and
 * `allowPaths` triggers a bounded, post-spawn auto-allow of the first pending
 * permission whose scope falls under a declared prefix.
 */
export interface SpawnCapabilities {
  /** Provider mode to request at spawn (e.g. "yolo", "bypass"). */
  mode?: string;
  /** Providers that accept `mode`; defaults to `["antigravity-acp"]`. */
  modeProviders?: string[];
  /**
   * Explicit override for the provider `auto_accept` feature toggle (#574).
   * When omitted, providers in `DEFAULT_AUTO_ACCEPT_PROVIDERS` default to `true`.
   */
  autoAccept?: boolean;
  /** Directory scope prefixes the child is expected to use. */
  allowPaths?: string[];
  /** Auto-allow the first scope-matching pending permission (default: true when allowPaths is set). */
  autoAllow?: boolean;
}

export interface SpawnCapabilityResult {
  /** Whether a requested spawn mode was actually forwarded to the provider. */
  modeApplied?: boolean;
  /** Whether `auto_accept: true` was forwarded to the provider at creation (#574). */
  autoAcceptApplied?: boolean;
  /** Result of the best-effort post-spawn auto-allow. */
  autoAllow?: { allowed: boolean; permissionId?: string; scope?: string; reason?: string };
}

export interface RawPendingPermissionLike {
  id?: string;
  requestId?: string;
  name?: string;
  title?: string;
  tool?: string;
  kind?: string;
  description?: string;
  input?: Record<string, unknown>;
}

/** Default providers that accept an explicit spawn `mode`. */
export const DEFAULT_SPAWN_MODE_PROVIDERS = ["antigravity-acp"];

/**
 * Providers whose unattendedness is carried by the `auto_accept` feature toggle
 * rather than a mode (#574). opencode approves tool permissions automatically
 * when `featureValues.auto_accept` is `true`; setting it at creation gives
 * workers parity with antigravity's `yolo` default.
 */
export const DEFAULT_AUTO_ACCEPT_PROVIDERS = ["opencode"];

const AUTO_ALLOW_POLL_MS_DEFAULT = 500;
const AUTO_ALLOW_TIMEOUT_MS_DEFAULT = 15_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves the provider-specific spawn mode from declared capabilities. */
export function resolveSpawnMode(
  provider: string,
  capabilities?: SpawnCapabilities,
): string | undefined {
  const modeProviders = capabilities?.modeProviders ?? DEFAULT_SPAWN_MODE_PROVIDERS;
  const requested = capabilities?.mode ?? (provider === "antigravity-acp" ? "yolo" : undefined);
  if (!requested || !modeProviders.includes(provider)) return undefined;
  return requested;
}

/**
 * Resolves whether the provider's `auto_accept` feature toggle should be set at
 * spawn (#574). Defaults to `true` for `DEFAULT_AUTO_ACCEPT_PROVIDERS`; an
 * explicit `capabilities.autoAccept` overrides in either direction. Antigravity
 * carries unattendedness via `mode: "yolo"` (see {@link resolveSpawnMode}) and is
 * not in the default list, so its path is untouched.
 */
export function resolveAutoAccept(
  provider: string,
  capabilities?: SpawnCapabilities,
): boolean {
  if (capabilities?.autoAccept !== undefined) return capabilities.autoAccept;
  return DEFAULT_AUTO_ACCEPT_PROVIDERS.includes(provider);
}

/**
 * Lists pending permission requests per agent id, preferring the live SDK
 * snapshot and falling back to `paseo permit ls --json`. Best-effort: returns
 * an empty map when neither source answers.
 */
export async function listPendingPermissionsByAgent(
  context?: PluginHandlerContext,
): Promise<Map<string, RawPendingPermissionLike[]>> {
  const byAgent = new Map<string, RawPendingPermissionLike[]>();
  if (typeof (context?.paseo?.agents as any)?.list === "function") {
    try {
      const list = await (context!.paseo.agents as any).list();
      const entries = list?.entries ?? list;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const a: any = entry?.agent ?? entry;
          if (a?.id && Array.isArray(a.pendingPermissions) && a.pendingPermissions.length > 0) {
            byAgent.set(a.id, a.pendingPermissions);
          }
        }
        if (byAgent.size > 0) return byAgent;
      }
    } catch {
      // fall through to CLI
    }
  }
  try {
    const { stdout } = await execFileAsync("paseo", ["permit", "ls", "--json"], {
      timeout: 5000,
      encoding: "utf-8",
    });
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const agentId = item?.agentId;
        if (!agentId) continue;
        const list = byAgent.get(agentId) ?? [];
        list.push(item);
        byAgent.set(agentId, list);
      }
    }
  } catch {
    // best-effort: no CLI available
  }
  return byAgent;
}

/** Fetches the live pending permissions for one agent, SDK first, CLI fallback. */
export async function fetchAgentPendingPermissions(
  agentId: string,
  context?: PluginHandlerContext,
): Promise<RawPendingPermissionLike[]> {
  if (typeof (context?.paseo?.agents as any)?.ref === "function") {
    try {
      const ref: any = context!.paseo.agents.ref(agentId);
      let snapshot: any = typeof ref?.current === "function" ? ref.current() : null;
      if (!snapshot && typeof ref?.refresh === "function") {
        const refreshed = await ref.refresh();
        snapshot = refreshed?.agent ?? refreshed;
      }
      const perms = snapshot?.pendingPermissions;
      if (Array.isArray(perms)) return perms;
    } catch {
      // fall through to CLI
    }
  }
  const byAgent = await listPendingPermissionsByAgent(undefined);
  return byAgent.get(agentId) ?? [];
}

/** Returns the first pending permission whose scope falls under a prefix. */
export function findScopeMatchingPermission(
  permissions: RawPendingPermissionLike[],
  scopePrefixes: readonly string[],
): { permission: RawPendingPermissionLike; scope: string; prefix: string } | undefined {
  const prefixes = scopePrefixes
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  if (prefixes.length === 0) return undefined;
  for (const permission of permissions) {
    const scope = extractPermissionScope(permission as PendingPermission);
    if (!scope) continue;
    for (const prefix of prefixes) {
      const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
      if (scope === prefix || scope.startsWith(normalized)) {
        return { permission, scope, prefix };
      }
    }
  }
  return undefined;
}

/**
 * Best-effort post-spawn auto-allow: polls for a pending permission whose scope
 * falls under a declared prefix and allows exactly one. Logs the outcome; never
 * throws. Bounded by `timeoutMs` (default 15s) with `pollMs` cadence.
 */
export async function autoAllowScopedPermission(
  agentId: string,
  scopePrefixes: readonly string[],
  context?: PluginHandlerContext,
  opts: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ allowed: boolean; permissionId?: string; scope?: string; reason?: string }> {
  if (!agentId || scopePrefixes.length === 0) return { allowed: false, reason: "no scope prefixes" };
  const timeoutMs = opts.timeoutMs ?? AUTO_ALLOW_TIMEOUT_MS_DEFAULT;
  const pollMs = opts.pollMs ?? AUTO_ALLOW_POLL_MS_DEFAULT;
  const sleep = opts.sleep ?? defaultSleep;
  const deadline = Date.now() + Math.max(0, timeoutMs);

  do {
    const permissions = await fetchAgentPendingPermissions(agentId, context).catch(() => []);
    const match = findScopeMatchingPermission(permissions, scopePrefixes);
    if (match) {
      const requestId = match.permission.id || match.permission.requestId;
      if (!requestId) break;
      const allowed = await allowPermission(agentId, requestId, context);
      if (allowed) {
        console.info(
          `[uppidi-fleet:agents] capability auto-allow: ${agentId} ${requestId} scope=${match.scope}`,
        );
        return { allowed: true, permissionId: requestId, scope: match.scope };
      }
      console.warn(`[uppidi-fleet:agents] capability auto-allow failed for ${agentId} ${requestId}`);
      return { allowed: false, permissionId: requestId, scope: match.scope, reason: "allow failed" };
    }
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  } while (Date.now() <= deadline);

  return { allowed: false, reason: "no scope-matching pending permission" };
}

/** Allows one permission request via SDK, falling back to the CLI. */
export async function allowPermission(
  agentId: string,
  requestId: string,
  context?: PluginHandlerContext,
): Promise<boolean> {
  if (typeof (context?.paseo?.agents as any)?.ref === "function") {
    try {
      const ref: any = context!.paseo.agents.ref(agentId);
      if (typeof ref?.respondToPermission === "function") {
        await ref.respondToPermission({ requestId, response: { behavior: "allow" } });
        return true;
      }
    } catch (err: any) {
      console.warn(
        `[uppidi-fleet:agents] SDK respondToPermission failed for ${agentId} ${requestId}, falling back to CLI:`,
        err?.message || err,
      );
    }
  }
  try {
    await execFileAsync("paseo", ["permit", "allow", agentId, requestId], {
      timeout: 10000,
      encoding: "utf-8",
    });
    return true;
  } catch (err: any) {
    console.warn(
      `[uppidi-fleet:agents] CLI permit allow failed for ${agentId} ${requestId}:`,
      err?.message || err,
    );
    return false;
  }
}

/**
 * Remediation text shared by the two-tier spawn authority rejections (#573).
 * Quoted verbatim so operators and agents see the exact dispatch paths.
 */
const SPAWN_AUTHORITY_REMEDIATION =
  "steer the registered orchestrator: paseo send --steer --no-wait <orchId>, or self-register via POST <hook-host>:<port>/orchestrator";

/** The front desk may never spawn subagents (workers). */
export const SPAWN_AUTHORITY_WORKER_ERROR =
  `two-tier spawn authority: the front-desk agent must not spawn workers; ${SPAWN_AUTHORITY_REMEDIATION}`;

/** Desk-spawned orchestrators must bind to an explicit repo workspace, not inherit the desk cwd. */
export const SPAWN_AUTHORITY_WORKSPACE_ERROR =
  `two-tier spawn authority: a front-desk-spawned orchestrator needs an explicit repo workspace (workspaceId or repo-local cwd, never the desk working directory); ${SPAWN_AUTHORITY_REMEDIATION}`;

export interface SpawnAuthorityDecision {
  allowed: boolean;
  /** Present only when `allowed` is false; names the remediation paths verbatim. */
  error?: string;
  /** Deterministic, human-readable reason for logging (never an LLM judgement). */
  reason: string;
}

/**
 * Resolves the caller agent id for a spawn request (#573).
 *
 * paseo 0.9.x `PluginHandlerContext` is `{ paseo }` and carries no caller id,
 * so attribution comes from the explicit `callerAgentId` on the request, or a
 * host-provided `context.callerAgentId` (forward-compatible). Returns undefined
 * when the caller is genuinely unattributed — the guard then abstains rather
 * than guess, because ambient process env belongs to the daemon, not the RPC
 * caller.
 */
export function resolveSpawnCallerAgentId(
  options: { callerAgentId?: string },
  context?: PluginHandlerContext,
): string | undefined {
  const fromOptions = options.callerAgentId?.trim();
  if (fromOptions) return fromOptions;
  const fromContext = (context as any)?.callerAgentId;
  if (typeof fromContext === "string" && fromContext.trim()) return fromContext.trim();
  return undefined;
}

/**
 * Reads the registered front-desk agent id from the live router, falling back
 * to the persisted `frontdesk.json` (mirroring `HookRouter.readFrontDesk`).
 */
export function resolveRegisteredFrontDeskAgentId(): string | null {
  const router = getActiveHookRouter();
  const fromRouter = router?.readFrontDesk()?.agentId;
  if (fromRouter) return fromRouter;

  const dir = getPersistedStateDir();
  const candidates = [join(dir, "frontdesk.json"), join(path.dirname(dir), "frontdesk.json")];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed.agentId === "string" && parsed.agentId.trim()) {
        return parsed.agentId.trim();
      }
    } catch {
      // ignore corrupted/missing state
    }
  }
  return null;
}

/** Normalizes a directory for equality comparison (absolute, no trailing sep). */
function normalizeSpawnDir(dir: string | undefined): string | undefined {
  if (!dir || !dir.trim()) return undefined;
  const normalized = path.resolve(dir.trim()).replace(/[\\/]+$/, "");
  return normalized || undefined;
}

/**
 * Deterministic set of directories an orchestrator must never inherit as its
 * root: the desk's conventional `~/code/meta` checkout plus the desk agent's
 * recorded cwd (#573, same bug class as #530).
 */
export function resolveDeskWorkingDirs(deskAgentId: string | null): Set<string> {
  const dirs = new Set<string>();
  const home = process.env.HOME ?? os.homedir();
  if (home) {
    const meta = normalizeSpawnDir(join(home, "code", "meta"));
    if (meta) dirs.add(meta);
  }
  if (deskAgentId) {
    const disk = getAgentDiskMetadataMap().get(deskAgentId);
    const recorded = normalizeSpawnDir(disk?.cwd);
    if (recorded) dirs.add(recorded);
  }
  return dirs;
}

/**
 * Pure, deterministic two-tier spawn authority check (#573, platform#172).
 *
 * - A front-desk caller may not spawn `category: "worker"`.
 * - A front-desk caller spawning `category: "orchestrator"` must supply an
 *   explicit `workspaceId` or a repo-local `cwd` that is not one of the desk's
 *   own working directories.
 *
 * Enforcement is by positive attribution: when no caller id resolves, or the
 * registered desk is unknown, the spawn is allowed so legitimate orchestrator
 * self-registration and worker spawning never regress.
 */
export function evaluateSpawnAuthority(
  options: { category?: "front-desk" | "orchestrator" | "worker"; cwd?: string; workspaceId?: string; callerAgentId?: string },
  context?: PluginHandlerContext,
  deps: { frontDeskAgentId?: () => string | null; deskWorkingDirs?: (id: string | null) => Set<string> } = {},
): SpawnAuthorityDecision {
  const callerAgentId = resolveSpawnCallerAgentId(options, context);
  const frontDeskAgentId = (deps.frontDeskAgentId ?? resolveRegisteredFrontDeskAgentId)();
  const isDeskCaller = Boolean(callerAgentId && frontDeskAgentId && callerAgentId === frontDeskAgentId);

  if (!isDeskCaller) {
    return {
      allowed: true,
      reason: callerAgentId
        ? `caller ${callerAgentId} is not the registered front desk`
        : "unattributed caller; spawn authority guard not applicable",
    };
  }

  if (options.category === "worker") {
    return {
      allowed: false,
      error: SPAWN_AUTHORITY_WORKER_ERROR,
      reason: `front desk ${callerAgentId} attempted to spawn a worker`,
    };
  }

  if (options.category === "orchestrator") {
    const workspaceId = options.workspaceId?.trim();
    const cwd = normalizeSpawnDir(options.cwd);
    const deskDirs = (deps.deskWorkingDirs ?? resolveDeskWorkingDirs)(frontDeskAgentId);

    if (!workspaceId && !cwd) {
      return {
        allowed: false,
        error: SPAWN_AUTHORITY_WORKSPACE_ERROR,
        reason: `front desk ${callerAgentId} spawned an orchestrator without workspaceId or cwd`,
      };
    }
    if (!workspaceId && cwd && deskDirs.has(cwd)) {
      return {
        allowed: false,
        error: SPAWN_AUTHORITY_WORKSPACE_ERROR,
        reason: `front desk ${callerAgentId} spawned an orchestrator inheriting the desk cwd ${cwd}`,
      };
    }
  }

  return { allowed: true, reason: `front desk ${callerAgentId} spawn permitted` };
}

export async function spawnPaseoAgent(
  options: {
    title: string;
    prompt: string;
    category?: "front-desk" | "orchestrator" | "worker";
    model?: string;
    cwd?: string;
    workspaceId?: string;
    labels?: Record<string, string>;
    /** Declarative capability grant applied at/after spawn (#537). */
    capabilities?: SpawnCapabilities;
    /** Caller agent id for the two-tier spawn authority guard (#573). */
    callerAgentId?: string;
  },
  context: PluginHandlerContext
): Promise<{ ok: boolean; agentId?: string; error?: string } & SpawnCapabilityResult> {
  const authority = evaluateSpawnAuthority(options, context);
  if (!authority.allowed) {
    appendHookLog(`[warn] spawn-authority: rejected: ${authority.reason}`);
    console.warn(`[uppidi-fleet:agents] spawn-authority rejected: ${authority.reason}`);
    return { ok: false, error: authority.error || SPAWN_AUTHORITY_WORKER_ERROR };
  }
  appendHookLog(`[info] spawn-authority: allowed: ${authority.reason}`);

  // Worktree-only dispatch (#918): a worker must never be handed the primary
  // checkout. Refuse before any SDK/CLI call so the invalid spawn cannot start.
  const workspaceGuard = await evaluateWorkerSpawnWorkspace({
    category: options.category,
    cwd: options.cwd,
    workspaceId: options.workspaceId,
  });
  if (!workspaceGuard.allowed) {
    appendHookLog(`[warn] worktree-only-dispatch: rejected: ${workspaceGuard.reason}`);
    console.warn(`[uppidi-fleet:agents] worktree-only-dispatch rejected: ${workspaceGuard.reason}`);
    return { ok: false, error: workspaceGuard.error || WORKER_PRIMARY_CHECKOUT_ERROR };
  }
  appendHookLog(`[info] worktree-only-dispatch: allowed: ${workspaceGuard.reason}`);

  const categoryKey = options.category === "front-desk" ? "front-desk" : "orchestrator";
  let resolvedModel = options.model?.trim();
  if (!resolvedModel) {
    try {
      const savedRoles = loadSavedRoleModels();
      resolvedModel =
        savedRoles[categoryKey]?.primaryModel ||
        DEFAULT_ROLE_MODELS[categoryKey]?.primaryModel ||
        "antigravity-acp/gemini-3.8-flash-low";
    } catch {
      resolvedModel =
        DEFAULT_ROLE_MODELS[categoryKey]?.primaryModel ||
        "antigravity-acp/gemini-3.8-flash-low";
    }
  }

  let targetProvider = resolvedModel;
  let targetModelName: string | undefined;

  const slashIndex = resolvedModel.indexOf("/");
  if (slashIndex !== -1) {
    targetProvider = resolvedModel.slice(0, slashIndex).trim();
    targetModelName = resolvedModel.slice(slashIndex + 1).trim() || undefined;
  }

  const spawnMode = resolveSpawnMode(targetProvider, options.capabilities);
  const autoAccept = resolveAutoAccept(targetProvider, options.capabilities);
  const allowPaths = options.capabilities?.allowPaths ?? [];
  const shouldAutoAllow = options.capabilities?.autoAllow ?? allowPaths.length > 0;
  const applyAutoAllow = async (id: string): Promise<SpawnCapabilityResult> => {
    if (!shouldAutoAllow || allowPaths.length === 0) return {};
    const autoAllow = await autoAllowScopedPermission(id, allowPaths, context);
    return { autoAllow };
  };

  // 1. Try SDK context.paseo.agents.create if available
  if (typeof (context?.paseo?.agents as any)?.create === "function") {
    try {
      const createPayload: Record<string, any> = {
        title: options.title,
        prompt: options.prompt,
        provider: targetProvider,
        model: targetModelName,
        cwd: options.cwd,
        labels: options.labels,
        role: options.category,
      };
      // The SDK transports provider settings through `config`; a slash-less
      // provider cannot be expressed there, so those spawns fall through to CLI.
      const sdkProvider = targetModelName
        ? `${targetProvider}/${targetModelName}`
        : targetProvider;
      const sdkConfig: Record<string, any> = { provider: sdkProvider };
      if (options.cwd) sdkConfig.cwd = options.cwd;
      if (spawnMode) sdkConfig.modeId = spawnMode;
      if (autoAccept) sdkConfig.featureValues = { auto_accept: true };
      createPayload.config = sdkConfig;
      if (options.workspaceId) {
        createPayload.workspaceId = options.workspaceId;
        createPayload.workspace = options.workspaceId;
      }
      if (spawnMode) {
        createPayload.mode = spawnMode;
      }

      const created = await (context.paseo.agents as any).create(createPayload);
      const id = created?.id || created?.agent?.id;
      if (id) {
        return {
          ok: true,
          agentId: id,
          modeApplied: Boolean(spawnMode),
          autoAcceptApplied: autoAccept,
          ...(await applyAutoAllow(id)),
        };
      }
    } catch (err: any) {
      console.warn("[uppidi-fleet:agents] context.paseo.agents.create failed, falling back to CLI:", err?.message || err);
    }
  }

  // 2. Fall back to CLI `paseo run -d ...`
  // `paseo run` exposes no feature/auto_accept flag, so auto_accept cannot be
  // set on this path (#574) — the SDK create payload is the only pre-grant
  // surface. Spawns lacking a `provider/model` pair (SDK requires the slash
  // form) therefore cannot receive the toggle.
  try {
    const args = ["run", "-d", "--title", options.title];
    if (targetProvider) {
      args.push("--provider", targetProvider);
    }
    if (targetModelName) {
      args.push("--model", targetModelName);
    }
    if (spawnMode) {
      args.push("--mode", spawnMode);
    }
    if (options.workspaceId) {
      args.push("--workspace", options.workspaceId);
    } else if (options.cwd) {
      args.push("--cwd", options.cwd);
    }
    if (options.labels) {
      for (const [k, v] of Object.entries(options.labels)) {
        args.push("--label", `${k}=${v}`);
      }
    }
    args.push("--json", options.prompt);

    const { stdout } = await execFileAsync("paseo", args, {
      timeout: 15000,
      encoding: "utf-8",
    });

    let agentId: string | undefined;
    try {
      const parsed = JSON.parse(stdout);
      agentId = parsed?.id || parsed?.agentId;
    } catch {
      const uuidMatch = stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (uuidMatch) {
        agentId = uuidMatch[0];
      }
    }

    const resolvedId = agentId || `spawned-${Date.now()}`;
    return {
      ok: true,
      agentId: resolvedId,
      modeApplied: Boolean(spawnMode),
      autoAcceptApplied: false,
      ...(await applyAutoAllow(resolvedId)),
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export function getPersistedStateDir(): string {
  const custom = process.env.HOOK_STATE_DIR;
  if (custom && custom.trim().length > 0) {
    return custom.trim();
  }
  if (process.env.NODE_ENV === "test") {
    return join(tmpdir(), `paseo-uppidi-fleet-state-${process.pid}`);
  }
  const home = process.env.HOME ?? os.homedir();
  return join(home, ".paseo", "forgejo-hook");
}

function writePersistedFrontDesk(agentId: string): void {
  const dir = getPersistedStateDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "frontdesk.json");
  const record = {
    version: 1,
    agentId,
    updatedAt: new Date().toISOString(),
    by: "frontdesk",
  };
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
  renameSync(tmp, file);
}

function writePersistedOrchestrator(repo: string, agentId: string): void {
  const dir = join(getPersistedStateDir(), "orchestrators");
  mkdirSync(dir, { recursive: true });
  const sanitized = repo.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const file = join(dir, `${sanitized}.json`);
  const record = {
    version: 1,
    key: repo,
    agentId,
    updatedAt: new Date().toISOString(),
    by: "orchestrator",
  };
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
  renameSync(tmp, file);
}

function enrollPersistedRepo(repo: string): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  const config = loadRouterConfig();
  const enrolled = new Set(config.enrolledRepos ?? []);
  enrolled.add(repo);
  saveRouterConfig({ enrolledRepos: Array.from(enrolled) });
}

/**
 * Builds the Front Desk introduction prompt, appending the resolved hook router
 * endpoint and auth posture (#903). The endpoint comes from the same chain as
 * `scripts/frontdesk-info`; the shared secret's value is never included, only
 * where it lives.
 */
export function buildFrontDeskIntroPrompt(basePrompt?: string): string {
  const base =
    basePrompt?.trim() ||
    `You are the Fleet Front Desk liaison. Follow the front desk skill at ${getEffectiveSkillPath("front-desk")}. Monitor incoming events, coordinate with project orchestrators, and triage requests across the workspace.`;
  const endpoint = resolveHookEndpoint();
  const auth = resolveHookAuthPosture();
  const authLine = auth.available
    ? `auth: shared webhook secret available at ${auth.location} (value withheld; never print it)`
    : `auth: no shared webhook secret at ${auth.location}${auth.note ? ` (${auth.note})` : ""}`;
  return [
    base,
    "",
    "Active hook router (resolved at spawn; use these values, do not hardcode):",
    `- host: ${endpoint.host}`,
    `- port: ${endpoint.port}`,
    `- baseUrl: ${endpoint.baseUrl}`,
    `- resolution source: ${endpoint.source}`,
    `- ${authLine}`,
  ].join("\n");
}

export async function handleUppidiCreateFrontDesk(
  input: UppidiCreateFrontDeskInput,
  context: PluginHandlerContext
): Promise<UppidiCreateFrontDeskOutput> {
  try {
    const router = getActiveHookRouter();
    if (router?.isHalted()) {
      return {
        ok: false,
        error: "Fleet teardown / halt in progress: Front Desk provisioning is disabled",
      };
    }

    const title = input.title?.trim() || "Front Desk";
    const prompt = buildFrontDeskIntroPrompt(input.prompt);

    const spawnRes = await spawnPaseoAgent(
      {
        title,
        prompt,
        category: "front-desk",
        model: input.model,
        labels: {
          role: "front-desk",
          category: "front-desk",
        },
      },
      context
    );

    if (!spawnRes.ok || !spawnRes.agentId) {
      return {
        ok: false,
        error: spawnRes.error || "Failed to spawn Front Desk session",
      };
    }

    if (router) {
      router.writeFrontDesk(spawnRes.agentId, "frontdesk");
    } else {
      writePersistedFrontDesk(spawnRes.agentId);
    }

    return {
      ok: true,
      agentId: spawnRes.agentId,
      message: "Front Desk session created successfully",
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
}

export async function handleUppidiReplaceFrontDesk(
  input: UppidiReplaceFrontDeskInput,
  context: PluginHandlerContext
): Promise<UppidiReplaceFrontDeskOutput> {
  try {
    let oldAgentId = input.existingAgentId?.trim();

    if (!oldAgentId) {
      const agents = await fetchPaseoAgents(context).catch(() => []);
      const existingFd = agents.find((a) => a.category === "front-desk");
      if (existingFd) {
        oldAgentId = existingFd.id;
      }
    }

    if (oldAgentId) {
      await handleUppidiArchiveAgent({ agentId: oldAgentId }, context).catch(() => {});
    }

    const createRes = await handleUppidiCreateFrontDesk(
      {
        model: input.model,
        prompt: input.prompt,
        title: input.title,
      },
      context
    );

    if (!createRes.ok || !createRes.agentId) {
      return {
        ok: false,
        oldAgentId,
        error: createRes.error || "Failed to spawn replacement Front Desk session",
      };
    }

    return {
      ok: true,
      oldAgentId,
      agentId: createRes.agentId,
      message: "Front Desk session replaced successfully",
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
}

export async function resolveRepoWorkspace(
  repo: string,
  context?: PluginHandlerContext
): Promise<{ cwd?: string; workspaceId?: string }> {
  // 0. Deterministically match repository against daemon workspaces.json (#793)
  // When execFileAsync is mocked in tests, prefer the mock to preserve test isolation.
  if (execFileAsync === defaultExecFileAsync) {
    const deterministicMatch = resolveWorkspaceForRepo(repo);
    if (deterministicMatch?.cwd || deterministicMatch?.workspaceId) {
      return {
        cwd: deterministicMatch.cwd,
        workspaceId: deterministicMatch.workspaceId,
      };
    }
  }

  const parts = repo.split("/");
  const repoBasename = parts[parts.length - 1] || repo;

  // 1. Try querying Paseo workspaces via CLI
  try {
    const { stdout } = await execFileAsync("paseo", ["workspace", "ls", "--json"], { timeout: 5000 });
    const list = JSON.parse(stdout);
    if (Array.isArray(list)) {
      const matches = list.filter((w: any) => {
        const proj = String(w.project || "").toLowerCase();
        const name = String(w.name || "").toLowerCase();
        const base = repoBasename.toLowerCase();
        return isRepoMatching(proj, repo) || proj === base || name === base;
      });
      // Prefer local workspace over ephemeral worktree
      const match = matches.find((w: any) => w.isolation === "local") || matches[0];
      const resolvedWorkspaceId = match?.workspaceId || match?.id;
      if (resolvedWorkspaceId) {
        return { cwd: match.cwd || match.path, workspaceId: resolvedWorkspaceId };
      }
    }
  } catch (err) {
    console.warn(`[uppidi-fleet:agents] workspace resolution failed:`, err);
  }

  // 2. Try matching against existing agents
  if (context) {
    try {
      const agents = await fetchPaseoAgents(context).catch(() => []);
      const matching = agents.find(
        (a) => a.cwd && isRepoMatching(a.project || extractAgentProject(a, undefined, getWorkspaceProjectMap()), repo)
      );
      if (matching?.cwd && fs.existsSync(matching.cwd)) {
        return { cwd: matching.cwd, workspaceId: (matching as any).workspaceId };
      }
    } catch (err) {
      console.warn(`[uppidi-fleet:agents] live agent fetch failed:`, err);
    }
  }

  // 3. Fall back to standard ~/code/<repoBasename> path if it exists
  const home = resolveHostHome();
  if (home) {
    const candidate = join(home, "code", repoBasename);
    if (fs.existsSync(candidate)) {
      return { cwd: candidate };
    }
  }

  return {};
}

export async function resolveRepoWorkspacePath(
  repo: string,
  context?: PluginHandlerContext
): Promise<string | undefined> {
  const resolved = await resolveRepoWorkspace(repo, context);
  return resolved.cwd;
}

export async function handleUppidiAddOrchestrator(
  input: UppidiAddOrchestratorInput,
  context: PluginHandlerContext
): Promise<UppidiAddOrchestratorOutput> {
  const repo = input.repo?.trim();
  if (!repo) {
    return { ok: false, repo: "", error: "repo is required" };
  }

  try {
    const title = input.title?.trim() || `Orchestrator · ${repo}`;
    const defaultPrompt =
      `You are the project orchestrator for ${repo}.\n` +
      `Follow the orchestrator skill at ${getEffectiveSkillPath("orchestrator")}.\n` +
      `Dispatch workers with the coding-agent skill at ${getEffectiveSkillPath("coding-agent")}.\n` +
      `Coordinate tasks, supervise worker agents, and manage pull requests and issues for this repository using the forge CLI (teax) and Paseo conventions.`;
    const prompt = input.prompt?.trim() || defaultPrompt;

    let cwd = input.workspacePath?.trim();
    let workspaceId: string | undefined;
    const resolved = await resolveRepoWorkspace(repo, context);
    if (!cwd) {
      cwd = resolved.cwd;
    }
    workspaceId = resolved.workspaceId;

    const spawnRes = await spawnPaseoAgent(
      {
        title,
        prompt,
        category: "orchestrator",
        model: input.model,
        cwd,
        workspaceId,
        callerAgentId: input.callerAgentId,
        labels: {
          role: "orchestrator",
          category: "orchestrator",
          repo,
        },
      },
      context
    );

    if (!spawnRes.ok || !spawnRes.agentId) {
      return {
        ok: false,
        repo,
        error: spawnRes.error || `Failed to spawn orchestrator for ${repo}`,
      };
    }

    const router = getActiveHookRouter();
    if (router) {
      router.writeOrchestrator(repo, spawnRes.agentId, "orchestrator");
      router.enrollRepo(repo);
    } else {
      writePersistedOrchestrator(repo, spawnRes.agentId);
      enrollPersistedRepo(repo);
    }

    return {
      ok: true,
      repo,
      agentId: spawnRes.agentId,
      message: `Orchestrator spawned for ${repo}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      repo,
      error: err?.message || String(err),
    };
  }
}

export async function handleUppidiReplaceOrchestrator(
  input: UppidiReplaceOrchestratorInput,
  context: PluginHandlerContext
): Promise<UppidiReplaceOrchestratorOutput> {
  const repo = input.repo?.trim();
  if (!repo) {
    return { ok: false, repo: "", error: "repo is required" };
  }

  try {
    let oldAgentId = input.existingAgentId?.trim();

    if (!oldAgentId) {
      const agents = await fetchPaseoAgents(context).catch(() => []);
      const existing = agents.find(
        (a) =>
          a.category === "orchestrator" &&
          isRepoMatching(a.project || extractAgentProject(a, undefined, getWorkspaceProjectMap()), repo)
      );
      if (existing) {
        oldAgentId = existing.id;
      }
    }

    if (oldAgentId) {
      await handleUppidiArchiveAgent({ agentId: oldAgentId }, context).catch(() => {});
    }

    const addRes = await handleUppidiAddOrchestrator(
      {
        repo,
        workspacePath: input.workspacePath,
        model: input.model,
        prompt: input.prompt,
        title: input.title,
        callerAgentId: input.callerAgentId,
      },
      context
    );

    if (!addRes.ok || !addRes.agentId) {
      return {
        ok: false,
        repo,
        oldAgentId,
        error: addRes.error || `Failed to replace orchestrator for ${repo}`,
      };
    }

    return {
      ok: true,
      repo,
      oldAgentId,
      agentId: addRes.agentId,
      message: `Orchestrator replaced for ${repo}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      repo,
      error: err?.message || String(err),
    };
  }
}

export async function handleUppidiToggleRepoPause(
  input: UppidiToggleRepoPauseInput,
  context: PluginHandlerContext
): Promise<UppidiToggleRepoPauseOutput> {
  const repo = input.repo?.trim();
  if (!repo) {
    return { ok: false, repo: "", isPaused: false, pausedRepos: [], error: "repo is required" };
  }

  try {
    const router = getActiveHookRouter();
    if (router) {
      const res = router.toggleRepoPause(repo, input.paused);
      return {
        ok: true,
        repo,
        isPaused: res.isPaused,
        pausedRepos: res.pausedRepos,
        message: res.isPaused ? `Paused repository ${repo}` : `Unpaused repository ${repo}`,
      };
    }

    const config = loadRouterConfig();
    const currentPaused = config.pausedRepos ?? [];
    const isCurrentlyPaused = currentPaused.some((m) => isRepoMatching(m, repo));
    const shouldPause = input.paused !== undefined ? input.paused : !isCurrentlyPaused;

    let updatedPaused: string[];
    if (shouldPause) {
      updatedPaused = Array.from(new Set([...currentPaused, repo]));
    } else {
      updatedPaused = currentPaused.filter((m) => !isRepoMatching(m, repo));
    }

    saveRouterConfig({ pausedRepos: updatedPaused });

    return {
      ok: true,
      repo,
      isPaused: shouldPause,
      pausedRepos: updatedPaused,
      message: shouldPause ? `Paused repository ${repo}` : `Unpaused repository ${repo}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      repo,
      isPaused: false,
      pausedRepos: [],
      error: err?.message || String(err),
    };
  }
}

// --- Front Desk Watch Surface & Direct Operator Prompt Handlers (Issue #710) ---

/**
 * Fetches recent activity/timeline items for the active Front Desk agent,
 * supporting signal-only filtering and full transcript recovery.
 */
export async function handleUppidiFrontDeskActivity(
  input: UppidiFrontDeskActivityInput,
  context?: PluginHandlerContext
): Promise<UppidiFrontDeskActivityOutput> {
  try {
    let targetAgentId = input.agentId?.trim() || resolveRegisteredFrontDeskAgentId();
    if (!targetAgentId) {
      try {
        const live = await fetchPaseoAgents(context);
        const fd = live.find((a) => a.category === "front-desk" && a.status !== "closed" && a.status !== "failed");
        if (fd) targetAgentId = fd.id;
      } catch (err) {
        console.warn(`[uppidi-fleet:agents] live agent fetch failed:`, err);
      }
    }

    if (!targetAgentId) {
      return {
        ok: false,
        agentId: null,
        items: [],
        totalCount: 0,
        signalCount: 0,
        error: "No active Front Desk agent found",
      };
    }

    let rawTranscript = "";
    let items: UppidiFrontDeskActivityItem[] = [];
    let agentTitle: string | undefined;
    let agentStatus: string | undefined;
    let agentMode: string | undefined;
    let fetchedFromSdk = false;

    // 1. Try fetching structured timeline through Paseo API
    try {
      if (context?.paseo?.agents?.ref) {
        const agentRef = context.paseo.agents.ref(targetAgentId);
        const result = await agentRef.timeline.refetch({
          direction: "tail",
          limit: input.limit ?? 50,
        });
        if (result && Array.isArray(result.entries)) {
          fetchedFromSdk = true;
          if (result.agent) {
            agentTitle = result.agent.title ?? undefined;
            agentStatus = (result.agent as any).status ?? undefined;
            agentMode = (result.agent as any).modeId ?? undefined;
          }
          items = result.entries.map((entry, idx) => {
            const item = entry.item;
            const ts = entry.timestamp || new Date().toISOString();
            const id = `tl-${entry.seqStart ?? idx}`;

            if (item.type === "user_message") {
              const isWatchdog = item.text.startsWith("[Fleet ");
              return {
                id,
                timestamp: ts,
                type: "user" as const,
                role: isWatchdog ? "watchdog" : "operator",
                title: isWatchdog ? "Fleet Watchdog / Sweep" : "Operator",
                text: item.text,
                isSignal: true,
              };
            } else if (item.type === "assistant_message") {
              return {
                id,
                timestamp: ts,
                type: "assistant" as const,
                role: "front-desk",
                title: "Front Desk",
                text: item.text,
                isSignal: true,
              };
            } else if (item.type === "reasoning") {
              return {
                id,
                timestamp: ts,
                type: "thought" as const,
                role: "front-desk",
                title: "Reasoning",
                text: item.text,
                isSignal: false,
              };
            } else if (item.type === "tool_call") {
              const toolName = (item as any).name || (item as any).toolName || "tool";
              const toolInput = (item as any).arguments || (item as any).input || {};
              const toolText = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput);
              const isHeartbeat = toolName.toLowerCase().includes("heartbeat");
              const isDispatch =
                toolName.toLowerCase().includes("send") ||
                toolName.toLowerCase().includes("dispatch") ||
                toolName.toLowerCase().includes("permit") ||
                toolName.toLowerCase().includes("spawn") ||
                toolName.toLowerCase().includes("create_agent") ||
                toolName.toLowerCase().includes("kill_agent") ||
                toolName.toLowerCase().includes("archive");
              return {
                id,
                timestamp: ts,
                type: isHeartbeat ? ("heartbeat" as const) : isDispatch ? ("dispatch" as const) : ("tool" as const),
                role: isHeartbeat ? "heartbeat" : isDispatch ? "dispatch" : "tool",
                title: isDispatch ? `Dispatch (${toolName})` : toolName,
                text: `[${toolName}] ${toolText}`,
                detail: toolText,
                toolName,
                status: (item as any).status,
                isSignal: isDispatch,
              };
            } else {
              return {
                id,
                timestamp: ts,
                type: "system" as const,
                role: "system",
                text: (item as any).text || (item as any).message || JSON.stringify(item),
                isSignal: true,
              };
            }
          });
        }
      }
    } catch {
      // Paseo SDK timeline refetch failed; fall back to CLI logs below
    }

    // 2. Fall back to CLI logs if SDK didn't provide entries
    if (!fetchedFromSdk || items.length === 0) {
      try {
        const limit = input.limit ?? 50;
        const { stdout } = await execFileAsync("paseo", ["logs", targetAgentId, "--tail", String(limit)], {
          timeout: 8000,
        });
        rawTranscript = stdout;
        items = parseTranscriptToActivityItems(stdout);
      } catch (cliErr: any) {
        if (items.length === 0) {
          return {
            ok: false,
            agentId: targetAgentId,
            items: [],
            totalCount: 0,
            signalCount: 0,
            error: `Failed to fetch activity: ${cliErr?.message || String(cliErr)}`,
          };
        }
      }
    }

    // Resolve agent metadata if not yet populated
    if (!agentTitle || !agentStatus) {
      try {
        const live = await fetchPaseoAgents(context);
        const match = live.find((a) => a.id === targetAgentId);
        if (match) {
          agentTitle = agentTitle || match.name || "Front Desk";
          agentStatus = agentStatus || match.status;
          agentMode = agentMode || match.deterministicState;
        }
      } catch (err) {
        console.warn(`[uppidi-fleet:agents] live agent fetch failed:`, err);
      }
    }

    const signalCount = items.filter(isSignalActivityItem).length;

    return {
      ok: true,
      agentId: targetAgentId,
      agentTitle,
      status: agentStatus,
      mode: agentMode,
      items,
      totalCount: items.length,
      signalCount,
      rawTranscript: rawTranscript || undefined,
    };
  } catch (err: any) {
    return {
      ok: false,
      agentId: input.agentId || null,
      items: [],
      totalCount: 0,
      signalCount: 0,
      error: `Failed to query Front Desk activity: ${err?.message || String(err)}`,
    };
  }
}

/**
 * Sends a direct operator prompt to the active Front Desk agent.
 */
export async function handleUppidiFrontDeskPrompt(
  input: UppidiFrontDeskPromptInput,
  context?: PluginHandlerContext
): Promise<UppidiFrontDeskPromptOutput> {
  try {
    const prompt = input.prompt?.trim();
    if (!prompt) {
      return { ok: false, error: "Prompt cannot be empty" };
    }

    let targetAgentId = input.agentId?.trim() || resolveRegisteredFrontDeskAgentId();
    if (!targetAgentId) {
      try {
        const live = await fetchPaseoAgents(context);
        const fd = live.find((a) => a.category === "front-desk" && a.status !== "closed" && a.status !== "failed");
        if (fd) targetAgentId = fd.id;
      } catch (err) {
        console.warn(`[uppidi-fleet:agents] live agent fetch failed:`, err);
      }
    }

    if (!targetAgentId) {
      return { ok: false, error: "No active Front Desk agent found to receive prompt" };
    }

    const router = getActiveHookRouter();
    let sent = false;

    if (router && typeof (router as any).deliverMessage === "function") {
      try {
        sent = await router.deliverMessage(targetAgentId, prompt, { steer: true, noWait: true });
      } catch (err) {
        console.warn(`[uppidi-fleet:agents] message delivery failed:`, err);
      }
    }

    if (!sent) {
      if (context?.paseo?.agents?.ref) {
        const agentRef = context.paseo.agents.ref(targetAgentId);
        await agentRef.send(prompt, { steer: true } as any);
        sent = true;
      } else {
        await execFileAsync("paseo", ["send", "--no-wait", "--steer", targetAgentId, prompt], { timeout: 8000 });
        sent = true;
      }
    }

    appendHookLog(`[info] [front-desk-prompt] Sent prompt to Front Desk (${targetAgentId}): "${prompt.slice(0, 80)}"`);

    return {
      ok: true,
      agentId: targetAgentId,
      message: `Prompt sent to Front Desk (${targetAgentId.slice(0, 8)})`,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to send prompt to Front Desk: ${err?.message || String(err)}`,
    };
  }
}

