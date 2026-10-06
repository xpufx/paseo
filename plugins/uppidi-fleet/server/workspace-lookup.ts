import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import os from "node:os";
import { candidateRepoKeys, canonicalRepoKey, normalizeRepoKey } from "./hook-router.js";
import { isRepoMatching } from "../shared/sort-filter.js";
import { resolveHostHome } from "./role-models.js";

export interface WorkspaceRecord {
  workspaceId: string;
  projectId?: string;
  cwd: string;
  mainRepoRoot?: string | null;
  worktreeRoot?: string | null;
  displayName?: string | null;
  archivedAt?: string | null;
  kind?: string;
  isPaseoOwnedWorktree?: boolean;
  createdAt?: string | number;
  updatedAt?: string | number;
  isolation?: string;
  [key: string]: any;
}

export interface ProjectRecord {
  projectId: string;
  displayName?: string;
  projectKey?: string | null;
  rootPath?: string;
  archivedAt?: string | null;
  createdAt?: string | number;
  updatedAt?: string | number;
  [key: string]: any;
}

export interface ResolvedWorkspace {
  workspaceId?: string;
  cwd: string;
  projectId?: string;
  displayName?: string;
  repo?: string;
  score?: number;
}

export interface WorkspaceLookupOptions {
  workspacesPath?: string;
  projectsPath?: string;
  paseoDir?: string;
  workspacesData?: WorkspaceRecord[];
  projectsData?: ProjectRecord[];
}

/**
 * The Paseo data directory the lookup reads from. Under an agent-mux profile
 * `HOME` is the profile directory, so this must resolve against the host home
 * (`REAL_HOME`) to find the live `~/.paseo` (#973).
 */
export function resolvePaseoDir(options?: WorkspaceLookupOptions): string {
  if (options?.paseoDir) return options.paseoDir;
  if (process.env.PASEO_DIR) return process.env.PASEO_DIR;
  if (process.env.NODE_ENV === "test") {
    return join(os.tmpdir(), `paseo-test-isolated-workspace-${process.pid}`);
  }
  return join(resolveHostHome(), ".paseo");
}

/** Ordered workspace-registry paths probed by the lookup, exposed for diagnostics (#973). */
export function workspaceRegistryPaths(options?: WorkspaceLookupOptions): string[] {
  const paseoDir = resolvePaseoDir(options);
  return [
    options?.workspacesPath,
    process.env.PASEO_WORKSPACES_PATH,
    join(paseoDir, "projects", "workspaces.json"),
    join(paseoDir, "workspaces.json"),
  ].filter(Boolean) as string[];
}

/** Ordered project-registry paths probed by the lookup, exposed for diagnostics (#973). */
export function projectRegistryPaths(options?: WorkspaceLookupOptions): string[] {
  const paseoDir = resolvePaseoDir(options);
  return [
    options?.projectsPath,
    process.env.PASEO_PROJECTS_PATH,
    join(paseoDir, "projects", "projects.json"),
    join(paseoDir, "projects.json"),
  ].filter(Boolean) as string[];
}

/**
 * Deterministically resolves a repository slug to a daemon workspace.
 *
 * Inspects `~/.paseo/projects/workspaces.json` and `projects.json`, ranking
 * candidates by slug match accuracy, unarchived status, and root workspace role
 * (prioritizing primary repository checkouts over ephemeral issue worktrees).
 */
export function resolveWorkspaceForRepo(
  rawRepo: string,
  options?: WorkspaceLookupOptions,
): ResolvedWorkspace | null {
  if (!rawRepo || typeof rawRepo !== "string" || !rawRepo.trim()) {
    return null;
  }

  const repo = rawRepo.trim();
  const repoCandidates = candidateRepoKeys(repo).map((s) => s.toLowerCase());
  const norm = (normalizeRepoKey(repo) ?? repo).toLowerCase();
  const repoBasename = basename(repo).replace(/\.git$/, "").toLowerCase();

  let workspaces: WorkspaceRecord[] = [];
  if (Array.isArray(options?.workspacesData)) {
    workspaces = options.workspacesData;
  } else {
    const candidatePaths = workspaceRegistryPaths(options);

    for (const p of candidatePaths) {
      if (existsSync(p)) {
        try {
          const raw = readFileSync(p, "utf-8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            workspaces = parsed;
            break;
          }
        } catch {
          // ignore corrupted or unreadable workspace files
        }
      }
    }
  }

  let projects: ProjectRecord[] = [];
  if (Array.isArray(options?.projectsData)) {
    projects = options.projectsData;
  } else {
    const candidatePaths = projectRegistryPaths(options);

    for (const p of candidatePaths) {
      if (existsSync(p)) {
        try {
          const raw = readFileSync(p, "utf-8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            projects = parsed;
            break;
          }
        } catch {
          // ignore corrupted or unreadable project files
        }
      }
    }
  }

  const projectsById = new Map<string, ProjectRecord>();
  for (const proj of projects) {
    if (proj?.projectId) {
      projectsById.set(proj.projectId, proj);
    }
  }

  interface ScoredCandidate {
    workspace: WorkspaceRecord;
    project?: ProjectRecord;
    score: number;
  }

  const scoredCandidates: ScoredCandidate[] = [];

  for (const w of workspaces) {
    if (!w || !w.workspaceId || !w.cwd) continue;
    const project = w.projectId ? projectsById.get(w.projectId) : undefined;

    let score = 0;

    // 1. Match against projectKey if available
    if (project?.projectKey) {
      const rawPk = project.projectKey.trim();
      const cleanPk = rawPk
        .replace(/^remote:/, "")
        .replace(/:\d+\//, "/")
        .replace(/\.git$/, "")
        .toLowerCase();
      const pkSlug = cleanPk.includes("/")
        ? cleanPk.split("/").slice(1).join("/") || cleanPk
        : cleanPk;

      if (cleanPk === norm || cleanPk === repo.toLowerCase()) {
        score = Math.max(score, 1000);
      } else if (pkSlug === norm || pkSlug === repo.toLowerCase()) {
        score = Math.max(score, 950);
      } else if (repoCandidates.includes(cleanPk) || repoCandidates.includes(pkSlug)) {
        score = Math.max(score, 850);
      } else if (isRepoMatching(repo, rawPk) || isRepoMatching(repo, cleanPk)) {
        score = Math.max(score, 750);
      }
    }

    // 2. Match against w.projectId if remote URL string
    if (typeof w.projectId === "string" && w.projectId.startsWith("remote:")) {
      const cleanWp = w.projectId
        .replace(/^remote:/, "")
        .replace(/:\d+\//, "/")
        .replace(/\.git$/, "")
        .toLowerCase();
      if (cleanWp === norm || cleanWp.includes(norm)) {
        score = Math.max(score, 700);
      } else if (isRepoMatching(repo, w.projectId)) {
        score = Math.max(score, 650);
      }
    }

    // 3. Match against project displayName
    if (project?.displayName) {
      const projName = project.displayName.trim().toLowerCase();
      if (projName === repo.toLowerCase() || projName === norm) {
        score = Math.max(score, 600);
      } else if (projName === repoBasename) {
        score = Math.max(score, 450);
      }
    }

    // 4. Match against rootPath or mainRepoRoot basename
    const rootBase = basename(w.mainRepoRoot || project?.rootPath || "").toLowerCase();
    if (rootBase && (rootBase === repoBasename || rootBase === norm)) {
      score = Math.max(score, 400);
    }

    // 5. Match against workspace cwd basename
    const cwdBase = basename(w.cwd).toLowerCase();
    if (cwdBase === repoBasename) {
      score = Math.max(score, 300);
    }

    // 6. Match against workspace displayName
    if (w.displayName) {
      const wName = w.displayName.trim().toLowerCase();
      if (wName === repoBasename || wName === norm) {
        score = Math.max(score, 200);
      }
    }

    if (score === 0) {
      continue;
    }

    // Modifiers:
    // Non-archived preference
    const isArchived = Boolean(w.archivedAt || project?.archivedAt);
    if (isArchived) {
      score -= 500;
    } else {
      score += 100;
    }

    // Prefer main repository workspace over ephemeral worktree
    const isWorktree = Boolean(
      w.isPaseoOwnedWorktree ||
      w.mainRepoRoot ||
      w.isolation === "worktree" ||
      w.cwd.includes("/.paseo/worktrees/") ||
      (w.displayName &&
        (w.displayName.startsWith("feat-") ||
          w.displayName.startsWith("fix-") ||
          w.displayName.startsWith("worktree-")))
    );

    if (isWorktree) {
      score -= 100;
    } else {
      score += 50;
      if (w.displayName === "main" || w.displayName === "master") {
        score += 25;
      }
    }

    // Disk existence
    try {
      if (existsSync(w.cwd)) {
        score += 10;
      }
    } catch (err) {
      console.warn(`[uppidi-fleet:workspace-lookup] disk existence check failed:`, err);
    }

    scoredCandidates.push({
      workspace: w,
      project,
      score,
    });
  }

  if (scoredCandidates.length > 0) {
    scoredCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const timeA = String(a.workspace.updatedAt || a.workspace.createdAt || "");
      const timeB = String(b.workspace.updatedAt || b.workspace.createdAt || "");
      if (timeB !== timeA) return timeB.localeCompare(timeA);
      return a.workspace.workspaceId.localeCompare(b.workspace.workspaceId);
    });

    const best = scoredCandidates[0];
    return {
      workspaceId: best.workspace.workspaceId,
      cwd: best.workspace.cwd,
      projectId: best.workspace.projectId,
      displayName: best.workspace.displayName ?? best.project?.displayName ?? undefined,
      repo: canonicalRepoKey(repo) ?? repo,
      score: best.score,
    };
  }

  // Fallback: Check local filesystem ~/code/<repoBasename>, resolved against
  // the host home so an agent-mux profile HOME does not miss the checkout (#973).
  const codeHome = join(resolveHostHome(), "code", repoBasename);
  if (existsSync(codeHome)) {
    return {
      cwd: codeHome,
      repo: canonicalRepoKey(repo) ?? repo,
      score: 50,
    };
  }

  return null;
}
