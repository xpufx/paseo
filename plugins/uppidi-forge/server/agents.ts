import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  UppidiAgent,
  UppidiAgentsOutput,
  UppidiAgentTreeNode,
  UppidiAgentWork,
  DeterministicAgentState,
  UppidiArchiveAgentInput,
  UppidiArchiveAgentOutput,
  UppidiArchiveInactiveAgentsInput,
  UppidiArchiveInactiveAgentsOutput,
} from "../shared/contracts.js";
import { extractAgentWorktree, extractAgentProject } from "../shared/contracts.js";
import { isAgentEligibleForBulkArchive } from "../shared/sort-filter.js";


const execFileAsync = promisify(execFile);

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
  lastUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    totalCostUsd?: number;
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

  // Check repo from cwd if available (e.g. /home/xpufx/code/paseo -> xpufx-org/paseo)
  if (!repoName && raw.cwd) {
    const match = raw.cwd.match(/\/code\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      repoName = `xpufx-org/${match[1]}`;
    }
  }

  if (issueNum || repoName || slugName || branchName) {
    return {
      repo: repoName,
      issue: issueNum,
      slug: slugName,
      branch: branchName,
    };
  }

  return null;
}

export function deriveDeterministicState(
  raw: RawAgentRecord,
  attributedWork: UppidiAgentWork | null,
  quotaAlertAgentIds: Set<string> = new Set()
): { state: DeterministicAgentState; detail?: string } {
  const status = (raw.status || "idle").toLowerCase();
  const errorMsg = (raw.lastError || "").toLowerCase();
  const hasQuotaAlert = raw.id ? quotaAlertAgentIds.has(raw.id) : false;

  // 1. Error / Failed states
  if (status === "error" || (raw.requiresAttention && raw.attentionReason === "error") || errorMsg.length > 0) {
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

  // 2. Running states
  if (status === "running") {
    if (attributedWork?.issue) {
      const detail = `#${attributedWork.issue}${attributedWork.slug ? ` (${attributedWork.slug})` : ""}`;
      return { state: "working", detail };
    }
    return { state: "running", detail: "Active turn" };
  }

  // 3. Idle states
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
  quotaAlertAgentIds: Set<string> = new Set()
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
  const { state: deterministicState, detail: stateDetail } = deriveDeterministicState(
    raw,
    attributedWork,
    quotaAlertAgentIds
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
    attributedWork,
    usage: raw.lastUsage || null,
    url: raw.url || (id ? `paseo://agent/${id}` : undefined),
    worktree: extractAgentWorktree(raw),
    project: extractAgentProject(raw),
  };
}

export function buildAgentTree(agents: UppidiAgent[]): UppidiAgentTreeNode[] {
  const agentMap = new Map<string, UppidiAgent>();
  const childrenMap = new Map<string, UppidiAgent[]>();

  for (const agent of agents) {
    agentMap.set(agent.id, agent);
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

// Read quota alerts from ~/.paseo/limit-alerts.json
export function getQuotaAlertAgentIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const alertPath = path.join(os.homedir(), ".paseo", "limit-alerts.json");
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
    const agentsDir = path.join(os.homedir(), ".paseo", "agents");
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
      const { stdout } = await execFileAsync("paseo", ["ls", "--json"], {
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
            lastUsage: disk.lastUsage,
          });
        }
      }
    } catch {
      // If CLI unavailable, return empty array
    }
  }

  return Array.from(mergedAgents.values()).map((raw) => normalizeRawAgent(raw, quotaAlerts));
}

export async function handleUppidiAgents(
  _input: Record<string, never>,
  context: PluginHandlerContext
): Promise<UppidiAgentsOutput> {
  try {
    const agents = await fetchPaseoAgents(context);

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

    // Propagate project from parent orchestrator to child agents if needed
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    for (const a of agents) {
      if ((!a.project || a.project === "Default Project") && a.parentId) {
        const parent = agentMap.get(a.parentId);
        if (parent?.project && parent.project !== "Default Project") {
          a.project = parent.project;
        }
      }
    }

    const tree = buildAgentTree(agents);

    return {
      ok: true,
      frontDesk,
      orchestrators,
      workers,
      tree,
      totalCount: agents.length,
      runningCount,
      idleCount,
      errorCount,
    };
  } catch (err: any) {
    return {
      ok: false,
      frontDesk: [],
      orchestrators: [],
      workers: [],
      tree: [],
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

