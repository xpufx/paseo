import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RawAgentRecord, WorkspaceProjectMap } from "../shared/classify.js";
import { normalizeRepoKey } from "../client/types.js";
import type { WorkspaceRecord } from "./workspace.js";

export function resolvePaseoHome(overrideHome?: string): string {
  if (overrideHome && overrideHome.trim()) {
    return overrideHome.trim();
  }
  if (process.env.PASEO_HOME && process.env.PASEO_HOME.trim()) {
    return process.env.PASEO_HOME.trim();
  }
  return join(homedir(), ".paseo");
}

let workspaceProjectCache: { map: WorkspaceProjectMap; cachedAt: number } | null = null;

export function resetWorkspaceProjectCache(): void {
  workspaceProjectCache = null;
}

export function readWorkspaceProjectMap(options?: {
  home?: string;
  forceRefresh?: boolean;
}): WorkspaceProjectMap {
  const now = Date.now();
  if (!options?.forceRefresh && workspaceProjectCache && now - workspaceProjectCache.cachedAt < 5000) {
    return workspaceProjectCache.map;
  }

  const map: WorkspaceProjectMap = {};
  const baseDir = resolvePaseoHome(options?.home);

  try {
    const projectsById = new Map<string, any>();
    const projectsPath = join(baseDir, "projects.json");
    if (existsSync(projectsPath)) {
      const parsed = JSON.parse(readFileSync(projectsPath, "utf-8"));
      if (Array.isArray(parsed)) {
        for (const project of parsed) {
          if (project?.projectId) projectsById.set(project.projectId, project);
        }
      }
    }

    const workspacesPath = join(baseDir, "workspaces.json");
    if (existsSync(workspacesPath)) {
      const parsed = JSON.parse(readFileSync(workspacesPath, "utf-8"));
      if (Array.isArray(parsed)) {
        for (const workspace of parsed as WorkspaceRecord[]) {
          if (!workspace?.workspaceId) continue;
          const project = workspace.projectId ? projectsById.get(workspace.projectId) : undefined;
          const repo =
            normalizeRepoKey(project?.projectKey) ||
            project?.displayName?.trim() ||
            workspace.displayName?.trim() ||
            (workspace.mainRepoRoot || project?.rootPath || workspace.worktreeRoot || workspace.cwd)?.split("/").filter(Boolean).pop();
          if (repo) map[workspace.workspaceId] = repo;
        }
      }
    }
  } catch {
    // Registry unavailable
  }

  workspaceProjectCache = { map, cachedAt: now };
  return map;
}

export function readQuotaAlertAgentIds(options?: { home?: string }): Set<string> {
  const ids = new Set<string>();
  const baseDir = resolvePaseoHome(options?.home);
  try {
    const path = join(baseDir, "limit-alerts.json");
    if (!existsSync(path)) return ids;
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (Array.isArray(parsed?.alerts)) {
      for (const alert of parsed.alerts) {
        if (alert?.agentId && alert.status === "open") ids.add(alert.agentId);
      }
    }
  } catch {
    // Best effort
  }
  return ids;
}

export function readOnDiskAgentMetadata(options?: { home?: string }): Map<string, Partial<RawAgentRecord>> {
  const out = new Map<string, Partial<RawAgentRecord>>();
  const baseDir = resolvePaseoHome(options?.home);
  try {
    const dir = join(baseDir, "agents");
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
          // Ignore individual unreadable files
        }
      }
    }
  } catch {
    // Best effort
  }
  return out;
}
