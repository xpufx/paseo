import type {
  UppidiIssue,
  HookQueueItem,
  UppidiAgent,
  UppidiAgentTreeNode,
  UppidiRunner,
  CandidateModelMetrics,
  TaskProfileMetrics,
  DeterministicAgentState,
} from "./contracts.js";
import { extractAgentProject, extractAgentWorktree } from "./contracts.js";

// --- Agent Status Lights (#410) ---

export const STATUS_LIGHT_GREEN = "#10b981";
export const STATUS_LIGHT_ORANGE = "#f59e0b";
export const STATUS_LIGHT_RED = "#ef4444";

export const STATUS_LIGHT_COLORS = {
  GREEN: STATUS_LIGHT_GREEN,
  ORANGE: STATUS_LIGHT_ORANGE,
  RED: STATUS_LIGHT_RED,
} as const;

/**
 * Resolves status light color for an agent according to taxonomy:
 * - Green (#10b981): working / running / executing
 * - Orange / Amber (#f59e0b): idle / waiting / paused / ready / non-failure mode
 * - Red (#ef4444): error / failed / timeout / failure mode
 */
export function getStatusLightColor(agent?: {
  status?: string | null;
  deterministicState?: DeterministicAgentState | string | null;
} | null): string {
  if (!agent) return STATUS_LIGHT_ORANGE;

  // Partial/legacy payloads can carry non-string state or status; coerce rather
  // than calling `.toLowerCase()` on whatever arrived (#510).
  const detState = String(agent.deterministicState ?? "").toLowerCase().trim();
  const status = String(agent.status ?? "").toLowerCase().trim();

  // 1. Red: error / failed / timeout / failure mode
  if (
    detState.startsWith("failed") ||
    status === "error" ||
    status === "failed" ||
    status === "failure" ||
    status === "timeout" ||
    status.includes("error") ||
    status.includes("fail")
  ) {
    return STATUS_LIGHT_RED;
  }

  // 2. Orange / Amber: idle / waiting / paused / ready / sleeping / non-failure mode
  if (
    detState.startsWith("idle") ||
    detState === "sleeping" ||
    status === "idle" ||
    status === "waiting" ||
    status === "paused" ||
    status === "ready" ||
    status === "standby"
  ) {
    return STATUS_LIGHT_ORANGE;
  }

  // 3. Green: working / running / executing
  if (
    detState === "working" ||
    detState === "running" ||
    status === "running" ||
    status === "busy" ||
    status === "working" ||
    status === "executing"
  ) {
    return STATUS_LIGHT_GREEN;
  }

  // Fallback: non-failure mode defaults to Orange
  return STATUS_LIGHT_ORANGE;
}

// --- Issues & PRs ---

export type IssuePreset =
  | "all"
  | "needs-you"
  | "needs-attention"
  | "triage-review"
  | "in-progress"
  | "verify";

export type IssueSortField =
  | "number"
  | "title"
  | "status"
  | "comments"
  | "repo";

export type SortDirection = "asc" | "desc";

export function filterIssues(
  issues: UppidiIssue[],
  preset: IssuePreset,
  query: string
): UppidiIssue[] {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return (issues ?? []).filter((issue) => {
    if (!issue) return false;
    // Partial RPC payloads may omit fields the client relies on. Normalize once
    // here so the presets and search below never dereference undefined (#510).
    const attention = typeof issue.attention === "string" ? issue.attention : "";
    const labels = Array.isArray(issue.labels) ? issue.labels : [];
    let matchesPreset = true;
    switch (preset) {
      case "needs-you":
        matchesPreset = attention === "attention/2-user";
        break;
      case "needs-attention":
        matchesPreset =
          attention.startsWith("attention/0-") ||
          attention.startsWith("attention/1-") ||
          attention.startsWith("attention/2-");
        break;
      case "triage-review":
        matchesPreset =
          issue.status === "Review" ||
          labels.some((l) => l.includes("state/0-triage") || l.includes("state/2-review"));
        break;
      case "in-progress":
        matchesPreset =
          (issue.status === "In progress" && !labels.some((l) => l.includes("state/3-verify") || l.includes("state/4-done"))) ||
          labels.some((l) => l.includes("state/1-wip"));
        break;
      case "verify":
        matchesPreset =
          labels.some((l) => l.includes("state/3-verify"));
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }

    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;

    const searchTarget = [
      String(issue.number),
      issue.title,
      issue.repo,
      issue.branch ?? "",
      labels.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortIssues(
  issues: UppidiIssue[],
  field: IssueSortField,
  direction: SortDirection
): UppidiIssue[] {
  const sorted = [...(Array.isArray(issues) ? issues : [])];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    if (!a || !b) return 0;
    switch (field) {
      case "number":
        return ((a.number ?? 0) - (b.number ?? 0)) * mul;
      case "title":
        return String(a.title ?? "").localeCompare(String(b.title ?? "")) * mul;
      case "status":
        return String(a.status ?? "").localeCompare(String(b.status ?? "")) * mul;
      case "comments":
        return ((a.comments ?? 0) - (b.comments ?? 0)) * mul;
      case "repo":
        return String(a.repo ?? "").localeCompare(String(b.repo ?? "")) * mul;
      default:
        return 0;
    }
  });

  return sorted;
}

// --- Hook Queues ---

export type QueuePreset = "all" | "pending-processing" | "dead-failed";

export type QueueSortField = "repo" | "depth" | "status";

export function filterQueues(
  queues: HookQueueItem[],
  preset: QueuePreset,
  query: string
): HookQueueItem[] {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return (Array.isArray(queues) ? queues : []).filter((q) => {
    if (!q) return false;
    let matchesPreset = true;
    switch (preset) {
      case "pending-processing":
        matchesPreset = (q.depth ?? 0) > 0 || q.isBusy;
        break;
      case "dead-failed":
        matchesPreset = q.paused;
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }

    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;

    const searchTarget = [
      q.key,
      q.orchestrator?.agentId ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortQueues(
  queues: HookQueueItem[],
  field: QueueSortField,
  direction: SortDirection
): HookQueueItem[] {
  const sorted = [...(Array.isArray(queues) ? queues : [])];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    if (!a || !b) return 0;
    switch (field) {
      case "repo":
        return String(a.key ?? "").localeCompare(String(b.key ?? "")) * mul;
      case "depth":
        return ((a.depth ?? 0) - (b.depth ?? 0)) * mul;
      case "status": {
        const statusA = a.paused ? "paused" : a.isBusy ? "busy" : "ready";
        const statusB = b.paused ? "paused" : b.isBusy ? "busy" : "ready";
        return statusA.localeCompare(statusB) * mul;
      }
      default:
        return 0;
    }
  });

  return sorted;
}

// --- Fleet & Agents ---

export type AgentPreset = "all" | "active" | "idle" | "blocked";

export type AgentSortField = "name" | "status" | "category" | "provider";

export function filterAgents(
  agents: UppidiAgent[],
  preset: AgentPreset,
  query: string
): UppidiAgent[] {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return (Array.isArray(agents) ? agents : []).filter((a) => {
    if (!a) return false;
    let matchesPreset = true;
    switch (preset) {
      case "blocked":
        matchesPreset =
          a.status === "error" ||
          a.deterministicState === "failed:error" ||
          a.deterministicState === "failed:quota-exhausted" ||
          a.deterministicState === "failed:spawn" ||
          a.deterministicState === "failed:timeout";
        break;
      case "active":
        matchesPreset =
          a.deterministicState === "working" ||
          a.deterministicState === "running" ||
          (a.status === "running" && a.deterministicState !== "sleeping" && a.deterministicState !== "idle:waiting");
        break;
      case "idle":
        matchesPreset =
          a.status === "idle" ||
          a.deterministicState === "idle:waiting" ||
          a.deterministicState === "sleeping" ||
          a.deterministicState === "idle:quota-exhausted";
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }

    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;

    const searchTarget = [
      a.id,
      a.shortId,
      a.name,
      a.category,
      a.provider ?? "",
      a.model ?? "",
      a.cwd ?? "",
      a.worktree ?? "",
      a.project ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortAgents(
  agents: UppidiAgent[],
  field: AgentSortField,
  direction: SortDirection
): UppidiAgent[] {
  const sorted = [...(Array.isArray(agents) ? agents : [])];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    if (!a || !b) return 0;
    switch (field) {
      case "name":
        return String(a.name ?? "").localeCompare(String(b.name ?? "")) * mul;
      case "status":
        return String(a.status ?? "").localeCompare(String(b.status ?? "")) * mul;
      case "category":
        return String(a.category ?? "").localeCompare(String(b.category ?? "")) * mul;
      case "provider":
        return (a.provider ?? "").localeCompare(b.provider ?? "") * mul;
      default:
        return 0;
    }
  });

  return sorted;
}

/**
 * Determines if an agent is safe and eligible for bulk archival.
 *
 * Requirements (Issue #402, #409):
 * - Never bulk-archive orchestrator or front-desk agents.
 * - Never bulk-archive active/running/working agents.
 * - Never bulk-archive idle agents (status == 'idle' or deterministicState == 'idle:waiting').
 *   Idle agents are live, healthy agents waiting for turns and MUST NOT be bulk archived.
 * - Bulk archive should ONLY target genuinely terminal states:
 *   - failed deterministic states: failed:quota-exhausted, failed:spawn, failed:timeout, failed:error
 *   - terminal statuses: closed, completed, terminated, done, failed, error
 */
export function isAgentEligibleForBulkArchive(agent: UppidiAgent): boolean {
  if (!agent) return false;
  // 1. Safety rule: Never bulk-archive orchestrator or front-desk agents
  if (agent.category === "front-desk" || agent.category === "orchestrator") {
    return false;
  }

  const normalizedStatus = String(agent.status ?? "").toLowerCase();

  // 2. Safety rule: Never bulk-archive active/running/working agents
  if (
    normalizedStatus === "running" ||
    agent.deterministicState === "running" ||
    agent.deterministicState === "working"
  ) {
    return false;
  }

  // 3. Safety rule (#409): Idle agents are live, healthy agents waiting for turns and MUST NOT be bulk archived
  if (
    normalizedStatus === "idle" ||
    agent.deterministicState === "idle:waiting" ||
    agent.deterministicState === "idle:quota-exhausted"
  ) {
    return false;
  }

  // 4. Failed deterministic states: failed:quota-exhausted, failed:spawn, failed:timeout, failed:error
  if (
    agent.deterministicState === "failed:quota-exhausted" ||
    agent.deterministicState === "failed:spawn" ||
    agent.deterministicState === "failed:timeout" ||
    agent.deterministicState === "failed:error"
  ) {
    return true;
  }

  // 5. Terminal statuses: closed, completed, terminated, done, failed, error
  if (
    normalizedStatus === "closed" ||
    normalizedStatus === "completed" ||
    normalizedStatus === "terminated" ||
    normalizedStatus === "done" ||
    normalizedStatus === "failed" ||
    normalizedStatus === "error"
  ) {
    return true;
  }

  return false;
}

export function filterBulkArchiveCandidates(agents: UppidiAgent[]): UppidiAgent[] {
  return (agents ?? []).filter(isAgentEligibleForBulkArchive);
}

// --- CI Runners ---

export type RunnerPreset = "all" | "online" | "offline";

export type RunnerSortField = "name" | "status" | "lastSeen";

export function filterRunners(
  runners: UppidiRunner[],
  preset: RunnerPreset,
  query: string
): UppidiRunner[] {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return (Array.isArray(runners) ? runners : []).filter((r) => {
    if (!r) return false;
    let matchesPreset = true;
    switch (preset) {
      case "online":
        matchesPreset = r.status === "online";
        break;
      case "offline":
        matchesPreset = r.status === "offline";
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }

    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;

    const searchTarget = [
      r.id,
      r.name,
      (Array.isArray(r.labels) ? r.labels : []).join(" "),
      r.lastJob ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortRunners(
  runners: UppidiRunner[],
  field: RunnerSortField,
  direction: SortDirection
): UppidiRunner[] {
  const sorted = [...(Array.isArray(runners) ? runners : [])];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    if (!a || !b) return 0;
    switch (field) {
      case "name":
        return String(a.name ?? "").localeCompare(String(b.name ?? "")) * mul;
      case "status":
        return String(a.status ?? "").localeCompare(String(b.status ?? "")) * mul;
      case "lastSeen":
        return String(a.lastSeen ?? "").localeCompare(String(b.lastSeen ?? "")) * mul;
      default:
        return 0;
    }
  });

  return sorted;
}

// --- Benchmark Candidate Models Matrix ---

export type MetricPreset =
  | "all"
  | "high-pass"
  | "bugfix-suitable"
  | "liaison-suitable";

export type MetricSortField =
  | "passRate"
  | "latency"
  | "trials"
  | "model";

export function filterMetricCandidates(
  candidates: CandidateModelMetrics[],
  preset: MetricPreset,
  query: string
): CandidateModelMetrics[] {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return (Array.isArray(candidates) ? candidates : []).filter((c) => {
    if (!c) return false;
    const roles = Array.isArray(c.recommendedRoles) ? c.recommendedRoles : [];
    const profiles = Array.isArray(c.profiles) ? c.profiles : [];
    let matchesPreset = true;
    switch (preset) {
      case "high-pass":
        matchesPreset = (c.overallPassRate ?? 0) >= 85;
        break;
      case "bugfix-suitable":
        matchesPreset =
          roles.includes("Worker/Coder") ||
          roles.includes("Code") ||
          profiles.some((p: TaskProfileMetrics) => p?.taskProfile === "code-modification" && (p?.passRate ?? 0) >= 80);
        break;
      case "liaison-suitable":
        matchesPreset =
          roles.includes("Front Desk") ||
          roles.includes("Liaison") ||
          profiles.some((p: TaskProfileMetrics) => p?.taskProfile === "chat-conversation" && (p?.passRate ?? 0) >= 85);
        break;
      case "all":
      default:
        matchesPreset = true;
        break;
    }

    if (!matchesPreset) return false;
    if (!normalizedQuery) return true;

    const searchTarget = [
      c.model,
      roles.join(" "),
      profiles.map((p: TaskProfileMetrics) => `${p?.taskProfile} ${p?.advisory}`).join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return searchTarget.includes(normalizedQuery);
  });
}

export function sortMetricCandidates(
  candidates: CandidateModelMetrics[],
  field: MetricSortField,
  direction: SortDirection
): CandidateModelMetrics[] {
  const sorted = [...(Array.isArray(candidates) ? candidates : [])];
  const mul = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    if (!a || !b) return 0;
    switch (field) {
      case "passRate":
        return ((a.overallPassRate ?? 0) - (b.overallPassRate ?? 0)) * mul;
      case "latency":
        return ((a.medianWallMs ?? 0) - (b.medianWallMs ?? 0)) * mul;
      case "trials":
        return ((a.totalTrials ?? 0) - (b.totalTrials ?? 0)) * mul;
      case "model":
        return String(a.model ?? "").localeCompare(String(b.model ?? "")) * mul;
      default:
        return 0;
    }
  });

  return sorted;
}

// --- Project Groups & High-Density Fleet Hierarchy (#403) ---

export interface ProjectAgentGroup {
  projectName: string;
  orchestrators: UppidiAgentTreeNode[];
  unparentedWorkers: UppidiAgentTreeNode[];
  allAgents: UppidiAgent[];
  runningCount: number;
  totalCount: number;
  isEnrolled?: boolean;
  isMuted?: boolean;
  hasOrchestrator?: boolean;
  queuedHooksCount?: number;
  isDetached?: boolean;
}

export interface BuildProjectGroupsOptions {
  enrolledRepos?: string[];
  mutedRepos?: string[];
  repoQueuedHooks?: Record<string, number>;
  /**
   * Agent id of the Front Desk currently registered with the hook daemon
   * (``hookStatus.frontDesk.agentId``). Front Desk is a singleton; only this
   * session is elevated as the authoritative primary Front Desk.
   */
  registeredFrontDeskAgentId?: string | null;
}

export interface BuildProjectGroupsResult {
  /** At most one node: the singleton, registered Front Desk session. */
  frontDeskNodes: UppidiAgentTreeNode[];
  /** Duplicate/orphaned front-desk sessions, excluded from the primary card. */
  staleFrontDeskNodes: UppidiAgentTreeNode[];
  projectGroups: ProjectAgentGroup[];
  enrolledGroups: ProjectAgentGroup[];
  detachedGroups: ProjectAgentGroup[];
}

/**
 * Checks if two repository names or keys match (normalizing protocol/host/git suffixes).
 */
export function isRepoMatching(repoA?: string, repoB?: string): boolean {
  if (!repoA || !repoB) return false;
  if (repoA.toLowerCase() === repoB.toLowerCase()) return true;
  const cleanA = repoA.toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/^git@[^:]+:/, "");
  const cleanB = repoB.toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/^git@[^:]+:/, "");
  if (cleanA === cleanB) return true;
  if (cleanA.endsWith(`/${cleanB}`) || cleanB.endsWith(`/${cleanA}`)) return true;
  return false;
}

/**
 * Filters a tree of UppidiAgentTreeNodes recursively.
 * A node is included if itself matches the predicate OR any of its descendants match.
 * If a descendant matches, only the matching descendant branches are kept.
 */
export function filterAgentTree(
  nodes: UppidiAgentTreeNode[],
  predicate: (agent: UppidiAgent) => boolean
): UppidiAgentTreeNode[] {
  // Defense-in-depth for partial RPC payloads: a tree node may arrive without a
  // `children` array, or `tree` itself may be a non-array. Iterating undefined
  // throws "nodes is not iterable" and blanks the whole fleet page (#510).
  if (!Array.isArray(nodes)) return [];
  const result: UppidiAgentTreeNode[] = [];

  for (const node of nodes) {
    if (!node || !node.agent) continue;
    const matchingChildren = filterAgentTree(node.children, predicate);
    const selfMatches = predicate(node.agent);

    if (selfMatches || matchingChildren.length > 0) {
      result.push({
        agent: node.agent,
        depth: node.depth,
        children: matchingChildren,
      });
    }
  }

  return result;
}

function isFrontDeskAgentActive(agent: UppidiAgent): boolean {
  const state = String(agent.deterministicState ?? "").toLowerCase();
  const status = String(agent.status ?? "").toLowerCase();
  return (
    state === "working" ||
    state === "running" ||
    status === "running" ||
    status === "busy"
  );
}

/**
 * Front Desk is strictly a singleton registered with the hook daemon (#470).
 * Selects the one authoritative primary session from a list of front-desk nodes:
 * 1. The session whose id matches the hook-daemon registration (`registeredAgentId`).
 * 2. Otherwise, the single active front desk (running/working, most recent first).
 * 3. Otherwise, the most recently active session.
 *
 * Returns `{ primary, stale }`. `primary` is null only when no front-desk nodes exist.
 */
export function selectPrimaryFrontDeskNode(
  frontDeskNodes: UppidiAgentTreeNode[],
  registeredAgentId?: string | null
): { primary: UppidiAgentTreeNode | null; stale: UppidiAgentTreeNode[] } {
  const nodes = (Array.isArray(frontDeskNodes) ? frontDeskNodes : []).filter((n) => n?.agent);
  if (nodes.length === 0) {
    return { primary: null, stale: [] };
  }

  if (registeredAgentId) {
    const registered = nodes.find((n) => n.agent.id === registeredAgentId);
    if (registered) {
      return {
        primary: registered,
        stale: nodes.filter((n) => n !== registered),
      };
    }
  }

  if (nodes.length === 1) {
    return { primary: nodes[0], stale: [] };
  }

  const active = nodes.filter((n) => isFrontDeskAgentActive(n.agent));
  const pool = active.length > 0 ? active : nodes;
  const primary = [...pool].sort((a, b) => {
    const aTime = a.agent.lastActivityAt ? Date.parse(a.agent.lastActivityAt) : 0;
    const bTime = b.agent.lastActivityAt ? Date.parse(b.agent.lastActivityAt) : 0;
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  })[0];

  return {
    primary,
    stale: nodes.filter((n) => n !== primary),
  };
}

/**
 * Builds project groups from the fleet tree.
 * - Elevates the singleton primary Front Desk into frontDeskNodes and routes
 *   duplicate/orphaned front-desk sessions to staleFrontDeskNodes (#470).
 * - Permanently includes enrolled repositories (even when unstaffed with 0 agents).
 * - Under each project, separates Orchestrators (with their children) and unparented workers.
 * - Labels enrolled repos vs detached / local workspaces.
 * - Resolves muting state and queued hook counts per project.
 */
export function buildProjectGroups(
  tree: UppidiAgentTreeNode[],
  options?: BuildProjectGroupsOptions
): BuildProjectGroupsResult {
  // A partial RPC payload may hand us a non-array `tree`; fail soft to an empty
  // fleet instead of iterating undefined and crashing the render (#510).
  if (!Array.isArray(tree)) {
    return {
      frontDeskNodes: [],
      staleFrontDeskNodes: [],
      projectGroups: [],
      enrolledGroups: [],
      detachedGroups: [],
    };
  }
  const frontDeskCandidates: UppidiAgentTreeNode[] = [];
  const projectMap = new Map<
    string,
    {
      orchestrators: UppidiAgentTreeNode[];
      unparentedWorkers: UppidiAgentTreeNode[];
      allAgents: UppidiAgent[];
    }
  >();

  function collectAllAgents(node: UppidiAgentTreeNode, list: UppidiAgent[]) {
    if (!node || !node.agent) return;
    list.push(node.agent);
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      collectAllAgents(child, list);
    }
  }

  function adjustDepths(node: UppidiAgentTreeNode, depth: number = 0): UppidiAgentTreeNode {
    const children = Array.isArray(node?.children) ? node.children : [];
    return {
      ...node,
      depth,
      children: children.map((child) => adjustDepths(child, depth + 1)),
    };
  }

  function getOrCreateGroup(projectName: string) {
    let group = projectMap.get(projectName);
    if (!group) {
      group = {
        orchestrators: [],
        unparentedWorkers: [],
        allAgents: [],
      };
      projectMap.set(projectName, group);
    }
    return group;
  }

  // First, populate from active tree nodes
  for (const node of tree) {
    if (!node || !node.agent) continue;
    const nodeChildren = Array.isArray(node.children) ? node.children : [];
    if (node.agent.category === "front-desk") {
      const remainingChildren: UppidiAgentTreeNode[] = [];
      for (const child of nodeChildren) {
        if (!child || !child.agent) continue;
        if (child.agent.category === "orchestrator") {
          const orchNode = adjustDepths(child, 0);
          const project =
            orchNode.agent.project || extractAgentProject(orchNode.agent) || "Default Project";
          const group = getOrCreateGroup(project);
          group.orchestrators.push(orchNode);
          collectAllAgents(orchNode, group.allAgents);
        } else {
          remainingChildren.push(child);
        }
      }
      frontDeskCandidates.push({
        ...node,
        children: remainingChildren,
      });
      continue;
    }

    const project =
      node.agent.project || extractAgentProject(node.agent) || "Default Project";

    const group = getOrCreateGroup(project);
    collectAllAgents(node, group.allAgents);

    if (node.agent.category === "orchestrator") {
      group.orchestrators.push(node);
    } else {
      group.unparentedWorkers.push(node);
    }
  }

  // If enrolled repos provided, ensure all enrolled repos exist in projectMap (Fleet Roster)
  const enrolledRepos = Array.isArray(options?.enrolledRepos) ? options!.enrolledRepos : [];
  const mutedRepos = Array.isArray(options?.mutedRepos) ? options!.mutedRepos : [];
  if (enrolledRepos.length > 0) {
    for (const repo of enrolledRepos) {
      const existingKey = Array.from(projectMap.keys()).find((k) => isRepoMatching(k, repo));
      if (!existingKey) {
        getOrCreateGroup(repo);
      }
    }
  }

  const projectGroups: ProjectAgentGroup[] = Array.from(
    projectMap.entries()
  ).map(([projectName, data]) => {
    const runningCount = data.allAgents.filter(
      (a) =>
        a?.deterministicState === "working" ||
        a?.deterministicState === "running" ||
        (a?.status === "running" &&
          a.deterministicState !== "sleeping" &&
          a.deterministicState !== "idle:waiting")
    ).length;

    const hasExplicitEnrolled = enrolledRepos.length > 0;

    const isEnrolled = hasExplicitEnrolled
      ? enrolledRepos.some((r) => isRepoMatching(r, projectName))
      : projectName !== "Default Project";

    const isDetached = !isEnrolled;
    const hasOrchestrator = data.orchestrators.length > 0;

    const isMuted = Boolean(
      mutedRepos.some((r) => isRepoMatching(r, projectName))
    );

    let queuedHooksCount = 0;
    if (options?.repoQueuedHooks && typeof options.repoQueuedHooks === "object") {
      for (const [k, count] of Object.entries(options.repoQueuedHooks)) {
        if (isRepoMatching(k, projectName)) {
          queuedHooksCount += typeof count === "number" ? count : 0;
        }
      }
    }

    return {
      projectName,
      orchestrators: data.orchestrators,
      unparentedWorkers: data.unparentedWorkers,
      allAgents: data.allAgents,
      runningCount,
      totalCount: data.allAgents.length,
      isEnrolled,
      isMuted,
      hasOrchestrator,
      queuedHooksCount,
      isDetached,
    };
  });

  // Sort projects:
  // 1. Enrolled before detached
  // 2. Running active projects first
  // 3. Projects with queued hooks
  // 4. Default Project always last
  // 5. Alphabetical tie-breaker
  projectGroups.sort((a, b) => {
    // Detached always placed after enrolled
    if (a.isDetached !== b.isDetached) {
      return a.isDetached ? 1 : -1;
    }
    if (a.runningCount > 0 && b.runningCount === 0) return -1;
    if (b.runningCount > 0 && a.runningCount === 0) return 1;

    const aQueued = a.queuedHooksCount ?? 0;
    const bQueued = b.queuedHooksCount ?? 0;
    if (aQueued > 0 && bQueued === 0) return -1;
    if (bQueued > 0 && aQueued === 0) return 1;

    if (a.projectName === "Default Project" && b.projectName !== "Default Project") return 1;
    if (b.projectName === "Default Project" && a.projectName !== "Default Project") return -1;
    return a.projectName.localeCompare(b.projectName);
  });

  const enrolledGroups = projectGroups.filter((g) => !g.isDetached);
  const detachedGroups = projectGroups.filter((g) => g.isDetached);

  const { primary, stale } = selectPrimaryFrontDeskNode(
    frontDeskCandidates,
    options?.registeredFrontDeskAgentId
  );

  return {
    frontDeskNodes: primary ? [primary] : [],
    staleFrontDeskNodes: stale,
    projectGroups,
    enrolledGroups,
    detachedGroups,
  };
}
