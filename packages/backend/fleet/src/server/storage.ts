import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RawAgentRecord, WorkspaceProjectMap } from "../shared/classify.js";
import { normalizeRepoKey, normalizeProjectName } from "../client/types.js";
import type { WorkspaceRecord, ProjectRecord } from "./workspace.js";

export function resolvePaseoHome(overrideHome?: string): string {
  if (overrideHome && overrideHome.trim()) {
    const trimmed = overrideHome.trim();
    if (trimmed.endsWith(".paseo")) return trimmed;
    return join(trimmed, ".paseo");
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

export function parseProjectKey(key?: string | null): string | undefined {
  const cleaned = key?.trim().replace(/\.git$/, "");
  if (!cleaned) return undefined;
  let body = cleaned;
  if (body.startsWith("remote:")) {
    body = body.slice("remote:".length);
  }
  const slash = body.indexOf("/");
  if (slash === -1) return undefined;
  const segments = body.slice(slash + 1).split("/").filter(Boolean);
  if (segments.length >= 2) return segments.slice(-2).join("/");
  return segments[0];
}

/**
 * Builds a WorkspaceProjectMap purely from in-memory workspace and project records
 * without touching the filesystem.
 */
export function buildWorkspaceProjectMapFromRegistry(
  workspaces: readonly WorkspaceRecord[] | null | undefined,
  projects: readonly ProjectRecord[] | null | undefined,
): WorkspaceProjectMap {
  const map: WorkspaceProjectMap = {};
  if (!workspaces || !Array.isArray(workspaces)) return map;

  const projectsById = new Map<string, ProjectRecord>();
  if (projects && Array.isArray(projects)) {
    for (const project of projects) {
      if (project?.projectId) projectsById.set(project.projectId, project);
    }
  }

  for (const workspace of workspaces) {
    if (!workspace?.workspaceId) continue;
    const project = workspace.projectId ? projectsById.get(workspace.projectId) : undefined;
    const repo =
      parseProjectKey(project?.projectKey) ||
      normalizeRepoKey(project?.projectKey) ||
      project?.displayName?.trim() ||
      workspace.displayName?.trim() ||
      (workspace.mainRepoRoot || project?.rootPath || workspace.worktreeRoot || workspace.cwd)?.split("/").filter(Boolean).pop();
    if (repo) map[workspace.workspaceId] = normalizeProjectName(repo);
  }

  return map;
}

export function readWorkspaceProjectMap(options?: {
  home?: string;
  forceRefresh?: boolean;
  workspacesData?: readonly WorkspaceRecord[];
  projectsData?: readonly ProjectRecord[];
}): WorkspaceProjectMap {
  if (options?.workspacesData) {
    return buildWorkspaceProjectMapFromRegistry(options.workspacesData, options.projectsData);
  }

  const now = Date.now();
  if (!options?.forceRefresh && workspaceProjectCache && now - workspaceProjectCache.cachedAt < 5000) {
    return workspaceProjectCache.map;
  }

  const map: WorkspaceProjectMap = {};
  const baseDir = resolvePaseoHome(options?.home);

  try {
    const projectsById = new Map<string, any>();
    const projectsPath = existsSync(join(baseDir, "projects", "projects.json"))
      ? join(baseDir, "projects", "projects.json")
      : join(baseDir, "projects.json");
    if (existsSync(projectsPath)) {
      const parsed = JSON.parse(readFileSync(projectsPath, "utf-8"));
      if (Array.isArray(parsed)) {
        for (const project of parsed) {
          if (project?.projectId) projectsById.set(project.projectId, project);
        }
      }
    }

    const workspacesPath = existsSync(join(baseDir, "projects", "workspaces.json"))
      ? join(baseDir, "projects", "workspaces.json")
      : join(baseDir, "workspaces.json");
    if (existsSync(workspacesPath)) {
      const parsed = JSON.parse(readFileSync(workspacesPath, "utf-8"));
      if (Array.isArray(parsed)) {
        for (const workspace of parsed as WorkspaceRecord[]) {
          if (!workspace?.workspaceId) continue;
          const project = workspace.projectId ? projectsById.get(workspace.projectId) : undefined;
          const repo =
            parseProjectKey(project?.projectKey) ||
            normalizeRepoKey(project?.projectKey) ||
            project?.displayName?.trim() ||
            workspace.displayName?.trim() ||
            (workspace.mainRepoRoot || project?.rootPath || workspace.worktreeRoot || workspace.cwd)?.split("/").filter(Boolean).pop();
          if (repo) map[workspace.workspaceId] = normalizeProjectName(repo);
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

