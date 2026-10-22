import type {
  AgentCategory,
  DeterministicAgentState,
  FleetAgent,
  FleetAgentWork,
  PendingPermission,
} from "../client/types.js";
import {
  CODING_AGENT_CATEGORY,
  DEFAULT_PROJECT,
  extractPermissionScope,
  normalizeProjectName,
} from "../client/types.js";

export type WorkspaceProjectMap = Record<string, string>;

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
  project?: string;
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
  category?: AgentCategory;
  role?: string;
}

export function categorizeAgent(name: string): AgentCategory {
  const lower = (name || "").toLowerCase();
  if (lower.includes("front desk") || lower === "frontdesk") {
    return "front-desk";
  }
  if (lower.includes("orchestrator")) {
    return "orchestrator";
  }
  return CODING_AGENT_CATEGORY;
}

export const categorize = categorizeAgent;

export function extractAttributedWork(raw: RawAgentRecord): FleetAgentWork | null {
  const textSources = [
    raw.name || "",
    raw.title || "",
    raw.cwd || "",
    raw.labels?.["work"] || "",
    raw.labels?.["task"] || "",
    raw.labels?.["issue"] || "",
    raw.labels?.["branch"] || "",
    raw.labels?.["worktree"] || "",
  ];

  let issueNum: number | undefined;
  let slug: string | undefined;
  let branch: string | undefined;

  for (const text of textSources) {
    if (!text) continue;

    if (!issueNum) {
      const issueMatch = text.match(/(?:issue|task|pr)[/ -]?#?(\d+)/i) || text.match(/#(\d+)/);
      if (issueMatch && issueMatch[1]) {
        issueNum = parseInt(issueMatch[1], 10);
      }
    }

    if (!slug) {
      const slugMatch = text.match(/refactor-(\d+-[a-z0-9-]+)/i) || text.match(/issue-(\d+-[a-z0-9-]+)/i);
      if (slugMatch && slugMatch[1]) {
        slug = slugMatch[1];
      }
    }

    if (!branch) {
      const branchMatch = text.match(/(?:feat|fix|refactor|chore)\/[a-z0-9._-]+/i);
      if (branchMatch) {
        branch = branchMatch[0];
      }
    }
  }

  if (issueNum !== undefined || slug !== undefined || branch !== undefined) {
    return {
      issue: issueNum,
      slug,
      branch,
    };
  }

  return null;
}

export const attributedWork = extractAttributedWork;

export function extractAgentWorktree(agent: {
  worktree?: string;
  cwd?: string;
  workspaceId?: string;
  labels?: Record<string, string>;
  attributedWork?: { slug?: string; branch?: string } | null;
  name?: string;
  title?: string;
}): string | undefined {
  if (agent.worktree && agent.worktree.trim()) return agent.worktree.trim();
  if (agent.labels?.["worktree"] && agent.labels["worktree"].trim()) return agent.labels["worktree"].trim();
  if (agent.labels?.["branch"] && agent.labels["branch"].trim()) return agent.labels["branch"].trim();

  if (agent.cwd) {
    const cwd = agent.cwd.trim();
    const wtMatch = cwd.match(/worktrees\/[^/]+\/([^/]+)/);
    if (wtMatch && wtMatch[1]) {
      return wtMatch[1];
    }
    const codeMatch = cwd.match(/\/code\/([^/]+)/);
    if (codeMatch && codeMatch[1]) {
      return codeMatch[1];
    }
    const parts = cwd.split("/").filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  if (agent.attributedWork?.slug) return agent.attributedWork.slug;
  if (agent.attributedWork?.branch) return agent.attributedWork.branch;

  if (agent.workspaceId) {
    return agent.workspaceId.length > 12 ? agent.workspaceId.slice(0, 12) : agent.workspaceId;
  }

  return undefined;
}

export function extractAgentProject(
  agent: {
    project?: string;
    labels?: Record<string, string>;
    workspaceId?: string;
    attributedWork?: { repo?: string } | null;
    name?: string;
    title?: string;
    cwd?: string;
  },
  parentProject?: string,
  workspaceProjectMap?: WorkspaceProjectMap,
): string {
  if (agent.project && agent.project.trim() && agent.project.trim() !== DEFAULT_PROJECT) {
    return normalizeProjectName(agent.project);
  }

  // Explicit spawn labels / attributed work take precedence over generic
  // workspace -> project map lookups (#1505).
  if (agent.labels?.["repo"] && agent.labels["repo"].trim()) return normalizeProjectName(agent.labels["repo"]);
  if (agent.labels?.["project"] && agent.labels["project"].trim()) return normalizeProjectName(agent.labels["project"]);
  if (agent.attributedWork?.repo && String(agent.attributedWork.repo).trim()) {
    return normalizeProjectName(String(agent.attributedWork.repo));
  }

  if (agent.workspaceId && workspaceProjectMap) {
    const mapped = workspaceProjectMap[agent.workspaceId];
    if (mapped && mapped.trim()) return normalizeProjectName(mapped);
  }

  if (parentProject && parentProject.trim() && parentProject.trim() !== DEFAULT_PROJECT) {
    return normalizeProjectName(parentProject);
  }

  return DEFAULT_PROJECT;
}

export interface DerivedStateResult {
  state: DeterministicAgentState;
  detail?: string;
}

export function deriveDeterministicState(
  raw: RawAgentRecord,
  attributedWork: FleetAgentWork | null,
  quotaAlertAgentIds: Set<string> = new Set(),
): DerivedStateResult {
  const status = (raw.status || "idle").toLowerCase();
  const error = (raw.lastError || "").toLowerCase();
  const quotaAlert = raw.id ? quotaAlertAgentIds.has(raw.id) : false;
  const permissions = raw.pendingPermissions || [];
  const reason = raw.attentionReason;

  if (permissions.length > 0 || reason === "permission") {
    const first = permissions[0] as PendingPermission | undefined;
    const action = first
      ? first.title?.trim() || first.tool?.trim() || first.name?.trim() || first.kind?.trim() || "tool permission"
      : "tool permission";
    const scope = first ? extractPermissionScope(first) : undefined;
    return {
      state: "permission-prompt",
      detail: scope ? `${action} (${scope})` : action,
    };
  }

  const explicitError =
    status === "error" ||
    Boolean(raw.requiresAttention && reason === "error") ||
    (status !== "running" && status !== "idle" && error.length > 0);

  if (explicitError) {
    if (
      quotaAlert ||
      /quota|rate limit|429|credit|exhausted|usage limit/.test(error)
    ) {
      return {
        state: "failed:quota-exhausted",
        detail: raw.lastError || "Usage limit reached",
      };
    }
    if (/spawn|enoent|failed to start|connection refused/.test(error)) {
      return {
        state: "failed:spawn",
        detail: raw.lastError || "Spawn error",
      };
    }
    if (/timeout|timed out|etimedout/.test(error)) {
      return {
        state: "failed:timeout",
        detail: raw.lastError || "Execution timeout",
      };
    }
    return {
      state: "failed:error",
      detail: raw.lastError || "Agent error",
    };
  }

  if (raw.requiresAttention === true && reason && reason !== "finished" && reason !== "error") {
    return {
      state: "attention-required",
      detail: reason,
    };
  }

  if (status === "running") {
    if (attributedWork && attributedWork.issue !== undefined) {
      const issueStr = `#${attributedWork.issue}`;
      const slugStr = attributedWork.slug ? ` (${attributedWork.slug})` : "";
      return {
        state: "working",
        detail: `${issueStr}${slugStr}`,
      };
    }
    return {
      state: "running",
      detail: "Active turn",
    };
  }

  if (status === "idle") {
    if (quotaAlert) {
      return {
        state: "idle:quota-exhausted",
        detail: "Quota cooldown",
      };
    }

    const category = categorizeAgent(raw.name || raw.title || "");
    const lastActivity = raw.lastActivityAt || raw.updatedAt;
    if ((category === "orchestrator" || category === "front-desk") && lastActivity) {
      const idleMs = Date.now() - Date.parse(lastActivity);
      if (!Number.isNaN(idleMs) && idleMs > 15 * 60 * 1000) {
        return {
          state: "sleeping",
          detail: "Standby",
        };
      }
    }

    return {
      state: "idle:waiting",
      detail: "Waiting for turn",
    };
  }

  return {
    state: "unknown",
    detail: raw.status || undefined,
  };
}

export const deriveState = deriveDeterministicState;

export function inheritProjectFromParents(agents: FleetAgent[]): void {
  const byId = new Map<string, FleetAgent>();
  for (const agent of agents) byId.set(agent.id, agent);

  for (const agent of agents) {
    if (agent.project && agent.project !== DEFAULT_PROJECT) continue;
    let current = agent;
    const visited = new Set<string>();
    while (current.parentId && byId.has(current.parentId) && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      const parent = byId.get(current.parentId)!;
      if (parent.project && parent.project !== DEFAULT_PROJECT) {
        agent.project = parent.project;
        break;
      }
      current = parent;
    }
  }
}
