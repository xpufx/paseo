import type {
  AgentCategory,
  AgentMetrics,
  AgentNode,
  AgentState,
  AttentionLabel,
  AttentionReason,
  FleetAgent,
  LifecycleState,
  PendingPermission,
  QueuePreset,
  RepoQueue,
  Ticket,
  TicketStatus,
} from "./contracts.js";

/**
 * Every projection, predicate, and label the surface needs, kept pure and
 * dependency-free so it can be unit-tested without a renderer.
 *
 * The inventory in `docs/INVENTORY.md` cites this module by symbol name; adding
 * or removing a row there means changing this file, not the views.
 */

// --- State presentation ---------------------------------------------------

/** Signal severity. Narrower than the theme's `Tone`, which also carries presentation roles. */
export type SignalTone = "ok" | "warn" | "critical";

export interface StatePresentation {
  state: AgentState;
  /** Human label. Carried verbatim from the legacy state table (INVENTORY §B.10). */
  label: string;
  tone: SignalTone;
  /** Whether the state should read as an active signal rather than a resting one. */
  active: boolean;
  icon: string;
}

/**
 * The 12 deterministic states with their labels and tones. `ok` covers working,
 * running, sleeping and waiting; `warn` covers the quota/permission/attention
 * family; `critical` covers the failure family.
 */
export const STATE_TABLE: Record<AgentState, StatePresentation> = {
  working: { state: "working", label: "Working", tone: "ok", active: true, icon: "Play" },
  running: { state: "running", label: "Running", tone: "ok", active: true, icon: "Activity" },
  sleeping: { state: "sleeping", label: "Sleeping", tone: "ok", active: false, icon: "Moon" },
  "idle:waiting": { state: "idle:waiting", label: "Waiting", tone: "ok", active: false, icon: "Clock" },
  "idle:quota-exhausted": {
    state: "idle:quota-exhausted",
    label: "Quota Cooldown",
    tone: "warn",
    active: false,
    icon: "Hourglass",
  },
  "attention-required": {
    state: "attention-required",
    label: "Awaiting Input",
    tone: "warn",
    active: true,
    icon: "BellRing",
  },
  "permission-prompt": {
    state: "permission-prompt",
    label: "Permission Needed",
    tone: "warn",
    active: true,
    icon: "ShieldAlert",
  },
  "failed:quota-exhausted": {
    state: "failed:quota-exhausted",
    label: "Quota Exhausted",
    tone: "warn",
    active: false,
    icon: "AlertTriangle",
  },
  "failed:spawn": { state: "failed:spawn", label: "Failed", tone: "critical", active: false, icon: "OctagonAlert" },
  "failed:timeout": { state: "failed:timeout", label: "Failed", tone: "critical", active: false, icon: "OctagonAlert" },
  "failed:error": { state: "failed:error", label: "Failed", tone: "critical", active: false, icon: "OctagonAlert" },
  unknown: { state: "unknown", label: "Unknown", tone: "warn", active: false, icon: "HelpCircle" },
};

export function statePresentation(state?: string | null): StatePresentation {
  const key = (state ?? "unknown") as AgentState;
  return STATE_TABLE[key] ?? STATE_TABLE.unknown;
}

export function lifecycleState(state?: string | null): LifecycleState {
  switch (state) {
    case "permission-prompt":
    case "attention-required":
      return "waiting_for_input";
    case "working":
    case "running":
      return "running";
    case "failed:quota-exhausted":
    case "failed:spawn":
    case "failed:timeout":
    case "failed:error":
      return "errored";
    default:
      return "idle";
  }
}

export function isBlocked(agent: Pick<FleetAgent, "pendingPermissions" | "requiresAttention" | "attentionReason">): boolean {
  if ((agent.pendingPermissions?.length ?? 0) > 0) return true;
  if (agent.requiresAttention !== true) return false;
  return agent.attentionReason !== "finished";
}

// --- Permissions ----------------------------------------------------------

const SCOPE_INPUT_KEYS = [
  "path",
  "paths",
  "directory",
  "directories",
  "dir",
  "cwd",
  "target",
  "scope",
  "file_path",
  "filePath",
  "file",
] as const;

const SCOPE_DESCRIPTION_PREFIX = /^\s*scope\s*:\s*/i;

function coerceScope(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    const parts = value.map(coerceScope).filter((v): v is string => Boolean(v));
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  return undefined;
}

/** Target path/scope a permission request applies to, if the daemon exposes one. */
export function permissionScope(
  permission: Pick<PendingPermission, "input" | "description" | "scope">,
): string | undefined {
  const explicit = permission.scope?.trim();
  if (explicit) return explicit;
  const input = permission.input;
  if (input && typeof input === "object") {
    for (const key of SCOPE_INPUT_KEYS) {
      const found = coerceScope((input as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }
  const description = permission.description?.trim();
  if (!description) return undefined;
  const scoped = description.replace(SCOPE_DESCRIPTION_PREFIX, "").trim();
  return scoped || undefined;
}

export function permissionAction(permission: PendingPermission | undefined): string {
  if (!permission) return "tool permission";
  return (
    permission.title?.trim() ||
    permission.tool?.trim() ||
    permission.name?.trim() ||
    permission.kind?.trim() ||
    "tool permission"
  );
}

/** The `paseo permit allow …` line an operator runs to clear a prompt. */
export function adjudicationCommand(agentId: string, permission?: PendingPermission | null): string {
  const requestId = permission?.id || permission?.requestId;
  return requestId ? `paseo permit allow ${agentId} ${requestId}` : `paseo permit allow ${agentId}`;
}

export function attentionReasonLabel(reason?: AttentionReason | string | null): string | undefined {
  switch (reason) {
    case "permission":
      return "permission request";
    case "input":
      return "operator input";
    case "error":
      return "error";
    case "finished":
      return "finished";
    default:
      return reason ? String(reason) : undefined;
  }
}

export interface BlockDetail {
  requiredPermissionId?: string;
  scope?: string;
  action?: string;
  command: string;
}

export function blockDetailFor(
  agentId: string,
  permissions: PendingPermission[] | null | undefined,
): BlockDetail | undefined {
  if (!Array.isArray(permissions) || permissions.length === 0) return undefined;
  const permission = permissions[0]!;
  const requestId = permission.id || permission.requestId;
  const detail: BlockDetail = { command: adjudicationCommand(agentId, permission) };
  if (requestId) detail.requiredPermissionId = requestId;
  const scope = permissionScope(permission);
  if (scope) detail.scope = scope;
  const action = permissionAction(permission);
  if (action) detail.action = action;
  return detail;
}

// --- Identity resolution --------------------------------------------------

export const DEFAULT_PROJECT = "Default Project";

/**
 * Concise worktree/branch slug for an agent. Resolution order is authoritative
 * first (explicit field, then labels), then cwd shape, then attributed work,
 * then the workspace id. Never throws on partial payloads.
 */
export function worktreeSlug(agent: {
  worktree?: string | null;
  cwd?: string | null;
  workspaceId?: string | null;
  labels?: Record<string, string> | null;
  attributedWork?: { slug?: string; branch?: string } | null;
}): string | undefined {
  if (agent.worktree?.trim()) return agent.worktree.trim();
  if (agent.labels?.["worktree"]?.trim()) return agent.labels["worktree"]!.trim();
  if (agent.labels?.["branch"]?.trim()) return agent.labels["branch"]!.trim();

  if (agent.cwd) {
    const cwd = agent.cwd.trim();
    const worktreeMatch = cwd.match(/worktrees\/[^/]+\/([^/]+)/);
    if (worktreeMatch?.[1]) return worktreeMatch[1];
    const codeMatch = cwd.match(/\/code\/([^/]+)/);
    if (codeMatch?.[1]) return codeMatch[1];
    const parts = cwd.split("/").filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  if (agent.attributedWork?.slug) return agent.attributedWork.slug;
  if (agent.attributedWork?.branch) return agent.attributedWork.branch;
  if (agent.workspaceId) {
    return agent.workspaceId.length > 12 ? agent.workspaceId.slice(0, 12) : agent.workspaceId;
  }
  return undefined;
}

/**
 * Canonical repository for an agent. Authoritative sources only — an explicit
 * `project`, the workspace→repo map, repo/project labels, then parent
 * inheritance. Title and cwd heuristics are deliberately not used: they
 * misassign worktree workers into phantom detached projects.
 */
export function projectKey(
  agent: {
    project?: string | null;
    labels?: Record<string, string> | null;
    workspaceId?: string | null;
  },
  parentProject?: string,
  workspaceProjectMap?: Record<string, string> | null,
): string {
  if (agent.project?.trim() && agent.project.trim() !== DEFAULT_PROJECT) return agent.project.trim();
  if (agent.workspaceId && workspaceProjectMap) {
    const mapped = workspaceProjectMap[agent.workspaceId];
    if (mapped?.trim()) return mapped.trim();
  }
  if (agent.labels?.["repo"]?.trim()) return agent.labels["repo"]!.trim();
  if (agent.labels?.["project"]?.trim()) return agent.labels["project"]!.trim();
  if (parentProject?.trim() && parentProject.trim() !== DEFAULT_PROJECT) return parentProject.trim();
  return DEFAULT_PROJECT;
}

/** Repo identity comparison tolerant of protocol, host, `.git` and `git@` noise. */
export function repoMatches(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "")
      .replace(/^git@[^:]+:/, "");
  const cleanA = clean(a);
  const cleanB = clean(b);
  if (cleanA === cleanB) return true;
  return cleanA.endsWith(`/${cleanB}`) || cleanB.endsWith(`/${cleanA}`);
}

export function categoryIcon(category?: AgentCategory | string | null): string {
  switch (category) {
    case "front-desk":
      return "Inbox";
    case "orchestrator":
      return "Network";
    case "worker":
      return "Terminal";
    default:
      return "Bot";
  }
}

export interface AttributedWork {
  repo?: string;
  issue?: number;
  slug?: string;
  branch?: string;
}

const ISSUE_PATTERN = /(?:([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+))?#(\d+)/;
const BRANCH_PATTERN = /(?:(?:feat|fix|chore|docs|audit|refactor)[/-](\d+)(?:[/-]([a-zA-Z0-9_-]+))?)/i;

/**
 * Best-effort ticket attribution for an agent: an issue number, a repo, a
 * branch slug, or nothing. Reads labels first, then free text, then the cwd
 * shape.
 */
export function attributedWork(raw: {
  name?: string | null;
  title?: string | null;
  cwd?: string | null;
  labels?: Record<string, string> | null;
}): AttributedWork | null {
  let issue: number | undefined;
  let repo: string | undefined;
  let slug: string | undefined;
  let branch: string | undefined;

  if (raw.labels?.["forgejo.issue"]) {
    const parsed = Number.parseInt(raw.labels["forgejo.issue"], 10);
    if (!Number.isNaN(parsed)) issue = parsed;
  }
  if (raw.labels?.["repo"]) repo = raw.labels["repo"];

  const sources = [
    raw.name,
    raw.title,
    raw.cwd,
    raw.labels?.["branch"],
    raw.labels?.["worktree"],
    raw.labels?.["issue"],
    raw.labels?.["slug"],
  ].filter((v): v is string => Boolean(v));

  for (const source of sources) {
    const issueMatch = source.match(ISSUE_PATTERN);
    if (issueMatch?.[3]) {
      if (issue === undefined) issue = Number.parseInt(issueMatch[3], 10);
      if (!repo && issueMatch[1] && issueMatch[2]) repo = `${issueMatch[1]}/${issueMatch[2]}`;
    }
    const branchMatch = source.match(BRANCH_PATTERN);
    if (branchMatch) {
      if (issue === undefined && branchMatch[1]) issue = Number.parseInt(branchMatch[1], 10);
      if (!slug) slug = branchMatch[0];
      if (!branch) branch = branchMatch[0];
    }
  }

  if (!repo && raw.cwd) {
    const match = raw.cwd.match(/\/code\/([a-zA-Z0-9_-]+)/);
    if (match?.[1]) repo = match[1];
  }

  if (issue === undefined && !repo && !slug && !branch) return null;
  const work: AttributedWork = {};
  if (repo) work.repo = repo;
  if (issue !== undefined) work.issue = issue;
  if (slug) work.slug = slug;
  if (branch) work.branch = branch;
  return work;
}

/**
 * Agent labels worth showing. Drops internal routing/tab keys and the two keys
 * already rendered as their own affordance.
 */
export function displayableLabels(
  labels: Record<string, string> | null | undefined,
): Array<{ key: string; display: string }> {
  if (!labels || typeof labels !== "object") return [];
  const entries: Array<{ key: string; display: string }> = [];
  for (const [key, raw] of Object.entries(labels)) {
    if (!key || raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    if (key.startsWith("paseo.open-agent-tab.") || key === "paseo.parent-agent-id") continue;
    if (key === "role" || key === "category") continue;
    entries.push({ key, display: `${key}=${value}` });
  }
  return entries;
}

export function parentPillLabel(agent: {
  parentId?: string | null;
  parentName?: string | null;
  parentCategory?: AgentCategory | null;
}): string | null {
  if (!agent.parentId && !agent.parentName) return null;
  if (agent.parentCategory === "front-desk" || agent.parentName?.toLowerCase().includes("front desk")) {
    return "via Front Desk";
  }
  if (agent.parentName) return `via ${agent.parentName}`;
  if (agent.parentId) return `via ${agent.parentId.slice(0, 7)}`;
  return null;
}

export function agentHref(agent: { id: string; url?: string | null }): string {
  return agent.url || `paseo://agent/${agent.id}`;
}

// --- Health gauge ---------------------------------------------------------

export type GaugeSegmentKind = "context" | "turn" | "error";

export interface GaugeSegment {
  kind: GaugeSegmentKind;
  ratio: number;
  tone: SignalTone;
}

export interface HealthGauge {
  segments: GaugeSegment[];
  overall: SignalTone;
  /** True when the agent has a live turn, which the gauge renders as a clock arc. */
  runningTurn: boolean;
  /** 0..1 progress of the running turn against the stall threshold. */
  sweep: number;
}

export interface GaugeThresholds {
  contextWarn: number;
  contextCritical: number;
  turnWarnMs: number;
}

export const DEFAULT_GAUGE_THRESHOLDS: GaugeThresholds = {
  contextWarn: 0.75,
  contextCritical: 0.9,
  turnWarnMs: 5 * 60 * 1000,
};

const TONE_RANK: Record<SignalTone, number> = { ok: 0, warn: 1, critical: 2 };

function worstTone(tones: SignalTone[]): SignalTone {
  return tones.reduce<SignalTone>((worst, tone) => (TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst), "ok");
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Three fixed segments — context utilisation, active-turn duration, error state
 * — each with a fill ratio and a tone. `overall` is the worst tone. A metric
 * that is absent contributes a zero `ok` segment rather than throwing, and the
 * caller decides whether to render anything by checking `metrics` first.
 */
export function healthGauge(
  agent: { metrics?: AgentMetrics | null; lastError?: string | null; deterministicState?: string | null } | null,
  thresholds: GaugeThresholds = DEFAULT_GAUGE_THRESHOLDS,
  now: number = Date.now(),
): HealthGauge {
  const metrics = agent?.metrics ?? null;

  const used = metrics?.contextUsedTokens;
  const max = metrics?.contextMaxTokens;
  const hasContext =
    typeof used === "number" && Number.isFinite(used) && typeof max === "number" && max > 0;
  const contextRatio = hasContext ? clampRatio(used! / max!) : 0;
  const contextTone: SignalTone = !hasContext
    ? "ok"
    : contextRatio >= thresholds.contextCritical
      ? "critical"
      : contextRatio >= thresholds.contextWarn
        ? "warn"
        : "ok";

  const startedAt = metrics?.activeTurnStartedAt;
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  const elapsedMs = Number.isFinite(startedMs) ? now - startedMs : NaN;
  const hasTurn = Number.isFinite(elapsedMs) && elapsedMs >= 0;
  const turnRatio = hasTurn ? clampRatio(elapsedMs / thresholds.turnWarnMs) : 0;
  const turnTone: SignalTone = hasTurn && elapsedMs >= thresholds.turnWarnMs ? "warn" : "ok";

  const failed = String(agent?.deterministicState ?? "").toLowerCase().startsWith("failed");
  const hasError = failed || String(agent?.lastError ?? "").trim().length > 0;
  const errorTone: SignalTone = hasError ? "critical" : "ok";

  return {
    segments: [
      { kind: "context", ratio: contextRatio, tone: contextTone },
      { kind: "turn", ratio: turnRatio, tone: turnTone },
      { kind: "error", ratio: hasError ? 1 : 0, tone: errorTone },
    ],
    overall: worstTone([contextTone, turnTone, errorTone]),
    runningTurn: String(agent?.deterministicState ?? "") === "working" && hasTurn,
    sweep: turnRatio,
  };
}

// --- Formatting -----------------------------------------------------------

export function relativeTime(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function durationText(ms?: number | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) return remainderMinutes ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return remainderHours ? `${days}d ${remainderHours}h` : `${days}d`;
}

export function elapsedSince(iso?: string | null, now: number = Date.now()): number | undefined {
  if (!iso) return undefined;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return undefined;
  return Math.max(0, now - then);
}

// --- Bulk archive ---------------------------------------------------------

const TERMINAL_STATUSES = new Set(["closed", "completed", "terminated", "done", "failed", "error"]);

const FAILED_STATES = new Set([
  "failed:quota-exhausted",
  "failed:spawn",
  "failed:timeout",
  "failed:error",
]);

/**
 * Bulk-archive safety rules, in order: never a liaison or orchestrator, never
 * blocked on a human, never actively running, never idle-but-healthy, and only
 * then a genuinely terminal state.
 */
export function isBulkArchiveEligible(agent: FleetAgent): boolean {
  if (!agent) return false;
  if (agent.category === "front-desk" || agent.category === "orchestrator") return false;
  if (isBlocked(agent)) return false;

  const status = String(agent.status ?? "").toLowerCase();
  const state = agent.deterministicState;
  if (status === "running" || state === "running" || state === "working") return false;
  if (status === "idle" || state === "idle:waiting" || state === "idle:quota-exhausted") return false;
  if (FAILED_STATES.has(state)) return true;
  return TERMINAL_STATUSES.has(status);
}

export function bulkArchiveCandidates(agents: FleetAgent[]): FleetAgent[] {
  return (agents ?? []).filter(isBulkArchiveEligible);
}

export function blockedAgents(agents: FleetAgent[]): FleetAgent[] {
  return (agents ?? []).filter((a) => Boolean(a) && isBlocked(a));
}

export function permissionBlockedCount(agents: FleetAgent[]): number {
  return (agents ?? []).filter((a) => Boolean(a) && (a.pendingPermissions?.length ?? 0) > 0).length;
}

export interface BlockedSummary {
  total: number;
  permissions: number;
  awaitingInput: number;
}

export function blockedSummary(agents: FleetAgent[]): BlockedSummary {
  const blocked = blockedAgents(agents);
  const permissions = permissionBlockedCount(agents);
  return { total: blocked.length, permissions, awaitingInput: blocked.length - permissions };
}

// --- Tree -----------------------------------------------------------------

/** Builds a parent/child node tree; orphans (unknown or self parent) are roots. */
export function buildTree(agents: FleetAgent[]): AgentNode[] {
  const byId = new Map<string, FleetAgent>();
  const childrenOf = new Map<string, FleetAgent[]>();
  for (const agent of agents) byId.set(agent.id, agent);

  for (const agent of agents) {
    if (agent.parentId && byId.has(agent.parentId)) {
      const parent = byId.get(agent.parentId)!;
      agent.parentName = parent.name;
      agent.parentCategory = parent.category;
    }
  }

  const roots: FleetAgent[] = [];
  for (const agent of agents) {
    const parentId = agent.parentId;
    if (parentId && byId.has(parentId) && parentId !== agent.id) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(agent);
      childrenOf.set(parentId, list);
    } else {
      roots.push(agent);
    }
  }

  const visited = new Set<string>();
  const visit = (agent: FleetAgent, depth: number): AgentNode => {
    visited.add(agent.id);
    const children: AgentNode[] = [];
    for (const child of childrenOf.get(agent.id) ?? []) {
      if (!visited.has(child.id)) children.push(visit(child, depth + 1));
    }
    return { agent, depth, children };
  };

  const tree: AgentNode[] = [];
  for (const root of roots) {
    if (!visited.has(root.id)) tree.push(visit(root, 0));
  }
  return tree;
}

/**
 * Keeps nodes whose agent matches, plus the ancestor path to any match, and
 * prunes branches with no match. A non-array tree degrades to empty rather than
 * throwing.
 */
export function filterTree(nodes: AgentNode[], predicate: (agent: FleetAgent) => boolean): AgentNode[] {
  if (!Array.isArray(nodes)) return [];
  const out: AgentNode[] = [];
  for (const node of nodes) {
    if (!node?.agent) continue;
    const children = filterTree(node.children, predicate);
    if (predicate(node.agent) || children.length > 0) {
      out.push({ agent: node.agent, depth: node.depth, children });
    }
  }
  return out;
}

export function flattenTree(nodes: AgentNode[]): FleetAgent[] {
  const out: FleetAgent[] = [];
  const walk = (list: AgentNode[]) => {
    for (const node of list) {
      if (!node?.agent) continue;
      out.push(node.agent);
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(Array.isArray(nodes) ? nodes : []);
  return out;
}

// --- Front desk singleton -------------------------------------------------

function isFrontDeskActive(agent: FleetAgent): boolean {
  const state = String(agent.deterministicState ?? "").toLowerCase();
  const status = String(agent.status ?? "").toLowerCase();
  return state === "working" || state === "running" || status === "running" || status === "busy";
}

/**
 * Front Desk is a singleton registered with the router. Prefers the registered
 * session, then the single active one, then the most recently active.
 */
export function selectPrimaryFrontDesk(
  nodes: AgentNode[],
  registeredAgentId?: string | null,
): { primary: AgentNode | null; stale: AgentNode[] } {
  const candidates = (Array.isArray(nodes) ? nodes : []).filter((n) => n?.agent);
  if (candidates.length === 0) return { primary: null, stale: [] };

  if (registeredAgentId) {
    const registered = candidates.find((n) => n.agent.id === registeredAgentId);
    if (registered) {
      return { primary: registered, stale: candidates.filter((n) => n !== registered) };
    }
  }
  if (candidates.length === 1) return { primary: candidates[0], stale: [] };

  const active = candidates.filter((n) => isFrontDeskActive(n.agent));
  const pool = active.length > 0 ? active : candidates;
  const primary = [...pool].sort((a, b) => {
    const aTime = a.agent.lastActivityAt ? Date.parse(a.agent.lastActivityAt) : 0;
    const bTime = b.agent.lastActivityAt ? Date.parse(b.agent.lastActivityAt) : 0;
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  })[0]!;
  return { primary, stale: candidates.filter((n) => n !== primary) };
}

// --- Project groups -------------------------------------------------------

export interface ProjectGroup {
  projectName: string;
  orchestrators: AgentNode[];
  unparentedWorkers: AgentNode[];
  agents: FleetAgent[];
  runningCount: number;
  totalCount: number;
  isEnrolled: boolean;
  isMuted: boolean;
  hasOrchestrator: boolean;
  queuedHooksCount: number;
  isDetached: boolean;
}

export interface ProjectGroups {
  frontDesk: AgentNode[];
  staleFrontDesk: AgentNode[];
  enrolled: ProjectGroup[];
  detached: ProjectGroup[];
}

export interface ProjectGroupOptions {
  enrolledRepos?: string[];
  mutedRepos?: string[];
  repoQueuedHooks?: Record<string, number>;
  registeredFrontDeskAgentId?: string | null;
}

/**
 * Groups the tree by repository: elevates the singleton front desk, keeps every
 * enrolled repository listed even when unstaffed, separates orchestrators from
 * unparented workers, and annotates enrolled/muted/queued-hook state.
 */
export function buildProjectGroups(tree: AgentNode[], options: ProjectGroupOptions = {}): ProjectGroups {
  const enrolledRepos = options.enrolledRepos ?? [];
  const mutedRepos = options.mutedRepos ?? [];
  const repoQueuedHooks = options.repoQueuedHooks ?? {};

  if (!Array.isArray(tree)) {
    return { frontDesk: [], staleFrontDesk: [], enrolled: [], detached: [] };
  }

  const frontDeskCandidates: AgentNode[] = [];
  const groups = new Map<
    string,
    { orchestrators: AgentNode[]; unparentedWorkers: AgentNode[]; agents: FleetAgent[] }
  >();

  const ensure = (projectName: string) => {
    let group = groups.get(projectName);
    if (!group) {
      group = { orchestrators: [], unparentedWorkers: [], agents: [] };
      groups.set(projectName, group);
    }
    return group;
  };

  const walk = (node: AgentNode, isTopLevel: boolean) => {
    if (!node?.agent) return;
    const agent = node.agent;
    if (agent.category === "front-desk") {
      frontDeskCandidates.push(node);
    } else {
      const group = ensure(agent.project || DEFAULT_PROJECT);
      group.agents.push(agent);
      if (isTopLevel && agent.category === "orchestrator") {
        group.orchestrators.push(node);
      } else if (isTopLevel) {
        group.unparentedWorkers.push(node);
      }
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      walk(child, false);
    }
  };
  for (const node of tree) walk(node, true);

  for (const repo of enrolledRepos) {
    if (repo) ensure(repo);
  }

  const { primary, stale } = selectPrimaryFrontDesk(frontDeskCandidates, options.registeredFrontDeskAgentId);

  const annotate = (projectName: string, bucket: { orchestrators: AgentNode[]; unparentedWorkers: AgentNode[]; agents: FleetAgent[] }): ProjectGroup => {
    const isEnrolled = enrolledRepos.some((r) => repoMatches(r, projectName));
    let queued = 0;
    for (const [key, count] of Object.entries(repoQueuedHooks)) {
      if (repoMatches(key, projectName)) queued += count;
    }
    const runningCount = bucket.agents.filter((a) => a.status === "running").length;
    return {
      projectName,
      orchestrators: bucket.orchestrators,
      unparentedWorkers: bucket.unparentedWorkers,
      agents: bucket.agents,
      runningCount,
      totalCount: bucket.agents.length,
      isEnrolled,
      isMuted: mutedRepos.some((m) => repoMatches(m, projectName)),
      hasOrchestrator: bucket.orchestrators.length > 0,
      queuedHooksCount: queued,
      isDetached: !isEnrolled,
    };
  };

  const all = Array.from(groups.entries()).map(([name, bucket]) => annotate(name, bucket));
  return {
    frontDesk: primary ? [primary] : [],
    staleFrontDesk: stale,
    enrolled: all.filter((g) => g.isEnrolled),
    detached: all.filter((g) => !g.isEnrolled),
  };
}

// --- Fleet filtering ------------------------------------------------------

export type StateFilter = "all" | "working" | "idle" | "failed";

export const STATE_FILTERS: Array<{ id: StateFilter; label: string }> = [
  { id: "all", label: "All states" },
  { id: "working", label: "Working" },
  { id: "idle", label: "Idle / sleeping" },
  { id: "failed", label: "Failed" },
];

export function matchesStateFilter(agent: FleetAgent, filter: StateFilter): boolean {
  if (filter === "all") return true;
  const state = String(agent.deterministicState ?? "");
  if (filter === "working") return state === "working";
  if (filter === "idle") return state.startsWith("idle") || state === "sleeping";
  return state.startsWith("failed");
}

/** Free-text match across every field the roster advertises. */
export function agentMatchesQuery(agent: FleetAgent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    agent.name.toLowerCase().includes(needle) ||
    agent.shortId.toLowerCase().includes(needle) ||
    agent.deterministicState.toLowerCase().includes(needle) ||
    (agent.stateDetail?.toLowerCase().includes(needle) ?? false) ||
    (agent.model?.toLowerCase().includes(needle) ?? false) ||
    (agent.provider?.toLowerCase().includes(needle) ?? false) ||
    (agent.worktree?.toLowerCase().includes(needle) ?? false) ||
    (agent.project?.toLowerCase().includes(needle) ?? false) ||
    (agent.parentName?.toLowerCase().includes(needle) ?? false) ||
    (agent.attributedWork?.issue !== undefined && String(agent.attributedWork.issue).includes(needle)) ||
    (agent.attributedWork?.slug?.toLowerCase().includes(needle) ?? false)
  );
}

// --- Tickets --------------------------------------------------------------

export type TicketFilter =
  | "all"
  | "needs-you"
  | "needs-attention"
  | "triage-review"
  | "in-progress"
  | "verify";

export const TICKET_FILTERS: Array<{ id: TicketFilter; label: string }> = [
  { id: "all", label: "All work" },
  { id: "needs-you", label: "Needs you" },
  { id: "needs-attention", label: "Needs attention" },
  { id: "triage-review", label: "Triage / review" },
  { id: "in-progress", label: "In progress" },
  { id: "verify", label: "Verify" },
];

export function ticketCountFor(tickets: Ticket[], filter: TicketFilter): number {
  const list = Array.isArray(tickets) ? tickets : [];
  switch (filter) {
    case "all":
      return list.length;
    case "needs-you":
      return list.filter((t) => t.attention === "attention/2-user").length;
    case "needs-attention":
      return list.filter((t) => t.attention.startsWith("attention/")).length;
    case "triage-review":
      return list.filter(
        (t) =>
          t.status === "Review" ||
          t.labels.some((l) => l.includes("state/0-triage") || l.includes("state/2-review")),
      ).length;
    case "in-progress":
      return list.filter(
        (t) => t.status === "In progress" || t.labels.some((l) => l.includes("state/1-wip")),
      ).length;
    case "verify":
      return list.filter((t) => t.labels.some((l) => l.includes("state/3-verify"))).length;
  }
}

export function ticketMatchesFilter(ticket: Ticket, filter: TicketFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs-you":
      return ticket.attention === "attention/2-user";
    case "needs-attention":
      return ticket.attention.startsWith("attention/");
    case "triage-review":
      return (
        ticket.status === "Review" ||
        ticket.labels.some((l) => l.includes("state/0-triage") || l.includes("state/2-review"))
      );
    case "in-progress":
      return ticket.status === "In progress" || ticket.labels.some((l) => l.includes("state/1-wip"));
    case "verify":
      return ticket.labels.some((l) => l.includes("state/3-verify"));
  }
}

export function ticketMatchesQuery(ticket: Ticket, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    ticket.title.toLowerCase().includes(needle) ||
    String(ticket.number).includes(needle) ||
    ticket.labels.some((l) => l.toLowerCase().includes(needle)) ||
    (ticket.branch?.toLowerCase().includes(needle) ?? false)
  );
}

export type TicketSortField = "number" | "title" | "status" | "comments" | "repo";
export type SortDirection = "asc" | "desc";

export const TICKET_SORT_FIELDS: Array<{ id: TicketSortField; label: string }> = [
  { id: "number", label: "#" },
  { id: "title", label: "Title" },
  { id: "status", label: "Status" },
  { id: "comments", label: "Comments" },
  { id: "repo", label: "Repo" },
];

const STATUS_ORDER: Record<TicketStatus, number> = {
  Backlog: 0,
  "In progress": 1,
  Review: 2,
  Done: 3,
};

export function sortTickets(
  tickets: Ticket[],
  field: TicketSortField = "number",
  direction: SortDirection = "desc",
): Ticket[] {
  const mul = direction === "asc" ? 1 : -1;
  return [...(tickets ?? [])].sort((a, b) => {
    switch (field) {
      case "number":
        return (a.number - b.number) * mul;
      case "title":
        return a.title.localeCompare(b.title) * mul;
      case "status":
        return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * mul;
      case "comments":
        return (a.comments - b.comments) * mul;
      case "repo":
        return a.repo.localeCompare(b.repo) * mul;
    }
  });
}

export const ATTENTION_OWNER: Record<AttentionLabel, string> = {
  "attention/0-orchestrator": "Orchestrator",
  "attention/1-agent": "Agent",
  "attention/2-user": "You",
};

export function ownerLabel(attention: AttentionLabel): string {
  return ATTENTION_OWNER[attention] ?? ATTENTION_OWNER["attention/1-agent"];
}

// --- Queue ----------------------------------------------------------------

export const QUEUE_FILTERS: Array<{ id: QueuePreset; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending-processing", label: "Pending / busy" },
  { id: "dead-failed", label: "Paused / dead" },
];

export type QueueSortField = "repo" | "depth" | "status";

export const QUEUE_SORT_FIELDS: Array<{ id: QueueSortField; label: string }> = [
  { id: "repo", label: "Repo" },
  { id: "depth", label: "Depth" },
  { id: "status", label: "Status" },
];

export function queueState(queue: Pick<RepoQueue, "paused" | "isBusy">): "paused" | "busy" | "ready" {
  if (queue.paused) return "paused";
  if (queue.isBusy) return "busy";
  return "ready";
}

export function queueMatchesFilter(queue: RepoQueue, filter: QueuePreset): boolean {
  if (filter === "all") return true;
  const state = queueState(queue);
  if (filter === "pending-processing") return state === "busy" || state === "ready";
  return state === "paused";
}

export function queueMatchesQuery(queue: RepoQueue, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    queue.key.toLowerCase().includes(needle) ||
    (queue.orchestrator?.agentId?.toLowerCase().includes(needle) ?? false)
  );
}

export function sortQueues(
  queues: RepoQueue[],
  field: QueueSortField = "repo",
  direction: SortDirection = "asc",
): RepoQueue[] {
  const rank: Record<ReturnType<typeof queueState>, number> = { ready: 0, busy: 1, paused: 2 };
  const mul = direction === "asc" ? 1 : -1;
  return [...(queues ?? [])].sort((a, b) => {
    switch (field) {
      case "repo":
        return a.key.localeCompare(b.key) * mul;
      case "depth":
        return (a.depth - b.depth) * mul;
      case "status":
        return (rank[queueState(a)] - rank[queueState(b)]) * mul;
    }
  });
}

export interface RouterBadge {
  label: string;
  tone: SignalTone;
  pulse: boolean;
}

/**
 * One authoritative router verdict. `connected` (the `/status` endpoint
 * answered) beats `serviceUp` (the configured endpoint is listening) so the
 * header can never show two contradictory badges at once.
 */
export function routerBadge(connected: boolean, serviceUp: boolean): RouterBadge {
  if (connected) return { label: "Router active", tone: "ok", pulse: true };
  if (serviceUp) return { label: "Router starting", tone: "warn", pulse: false };
  return { label: "Router disconnected", tone: "critical", pulse: false };
}
