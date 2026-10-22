import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RawAgentRecord, WorkspaceProjectMap } from "../shared/classify.js";
import { normalizeRepoKey, normalizeProjectName } from "../client/types.js";
import {
  type WorkspaceRecord,
  type ProjectRecord,
  canonicalProjectKey,
  resolveGitRootCommitSync,
} from "./workspace.js";

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
 * Builds a WorkspaceProjectMap purely from workspace and project records.
 * Adheres strictly to the single-key doctrine: project identity is `git-root:<sha>`.
 * Zero fallbacks to workspace display names, project display names, or path basenames.
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
    if (!workspace?.workspaceId || workspace.archivedAt) continue;
    const project = workspace.projectId ? projectsById.get(workspace.projectId) : undefined;

    // 1. Direct canonical key if already git-root:<sha> or non-git:<hash>
    let key: string | null = null;
    const candidateKeys = [project?.projectKey, project?.projectId, workspace.projectId];
    for (const cand of candidateKeys) {
      if (typeof cand === "string" && (cand.startsWith("git-root:") || cand.startsWith("non-git:"))) {
        key = cand.trim();
        break;
      }
    }

    // 2. Otherwise derive canonical git-root SHA from the checkout or worktree directory
    if (!key) {
      const targetDir =
        workspace.mainRepoRoot ||
        workspace.worktreeRoot ||
        project?.rootPath ||
        workspace.cwd;
      if (targetDir && typeof targetDir === "string") {
        const rootCommit = resolveGitRootCommitSync(targetDir.trim());
        if (rootCommit) {
          key = `git-root:${rootCommit}`;
        }
      }
    }

    // Strict: only canonical keys are mapped; zero fallbacks to display names or path basenames
    if (key) {
      map[workspace.workspaceId] = key;
    }
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

  let map: WorkspaceProjectMap = {};
  const baseDir = resolvePaseoHome(options?.home);

  try {
    const projectsPath = existsSync(join(baseDir, "projects", "projects.json"))
      ? join(baseDir, "projects", "projects.json")
      : join(baseDir, "projects.json");
    let parsedProjects: ProjectRecord[] = [];
    if (existsSync(projectsPath)) {
      const parsed = JSON.parse(readFileSync(projectsPath, "utf-8"));
      if (Array.isArray(parsed)) {
        parsedProjects = parsed;
      }
    }

    const workspacesPath = existsSync(join(baseDir, "projects", "workspaces.json"))
      ? join(baseDir, "projects", "workspaces.json")
      : join(baseDir, "workspaces.json");
    if (existsSync(workspacesPath)) {
      const parsed = JSON.parse(readFileSync(workspacesPath, "utf-8"));
      if (Array.isArray(parsed)) {
        map = buildWorkspaceProjectMapFromRegistry(parsed, parsedProjects);
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

