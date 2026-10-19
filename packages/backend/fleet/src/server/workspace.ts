import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { candidateRepoKeys, canonicalRepoKey, normalizeRepoKey } from "../client/types.js";

const execFileAsync = promisify(execFile);

/**
 * Resolves the root commit SHA of a git repository using deterministic sorting:
 * `git rev-list --max-parents=0 HEAD | sort | head -n 1`.
 */
export async function resolveGitRootCommit(cwd: string): Promise<string | null> {
  if (!cwd || typeof cwd !== "string") return null;
  try {
    const { stdout } = await execFileAsync("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd,
      encoding: "utf8",
    });
    const lines = stdout.trim().split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    lines.sort();
    return lines[0];
  } catch {
    return null;
  }
}

/** Synchronous variant of resolveGitRootCommit. */
export function resolveGitRootCommitSync(cwd: string): string | null {
  if (!cwd || typeof cwd !== "string") return null;
  try {
    const stdout = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = stdout.trim().split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    lines.sort();
    return lines[0];
  } catch {
    return null;
  }
}

/**
 * Derives canonical universal project identity:
 * - Git repository: `git-root:<rootCommitSha>`
 * - Non-git directory: explicit sentinel `non-git:<pathHash>`
 */
export function canonicalProjectKey(cwd: string): string {
  if (!cwd || typeof cwd !== "string") return "";
  const trimmed = cwd.trim();
  if (trimmed.startsWith("git-root:") || trimmed.startsWith("non-git:")) {
    return trimmed;
  }
  const rootCommit = resolveGitRootCommitSync(trimmed);
  if (rootCommit) {
    return `git-root:${rootCommit}`;
  }
  const resolvedPath = resolve(trimmed);
  const hash = createHash("sha256").update(resolvedPath).digest("hex").slice(0, 16);
  return `non-git:${hash}`;
}

/** Async variant of canonicalProjectKey. */
export async function resolveCanonicalProjectKey(cwd: string): Promise<string> {
  if (!cwd || typeof cwd !== "string") return "";
  const trimmed = cwd.trim();
  if (trimmed.startsWith("git-root:") || trimmed.startsWith("non-git:")) {
    return trimmed;
  }
  const rootCommit = await resolveGitRootCommit(trimmed);
  if (rootCommit) {
    return `git-root:${rootCommit}`;
  }
  const resolvedPath = resolve(trimmed);
  const hash = createHash("sha256").update(resolvedPath).digest("hex").slice(0, 16);
  return `non-git:${hash}`;
}

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
  workspacesData?: WorkspaceRecord[];
  projectsData?: ProjectRecord[];
  paseo?: any;
}

export interface CanonicalWorkspaceDescriptor {
  id?: string;
  workspaceId?: string;
  projectId?: string | null;
  projectDisplayName?: string | null;
  projectRootPath?: string | null;
  workspaceDirectory?: string | null;
  cwd?: string | null;
  workspaceKind?: string | null;
  kind?: string | null;
  name?: string | null;
  title?: string | null;
  archivingAt?: string | null;
  archivedAt?: string | null;
  gitRuntime?: { isPaseoOwnedWorktree?: boolean | null; remoteUrl?: string | null } | null;
  project?: {
    projectKey?: string | null;
    projectName?: string | null;
    workspaceName?: string | null;
  } | null;
  [key: string]: any;
}

export class WorkspaceResolutionError extends Error {
  readonly repo: string;
  constructor(repo: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorkspaceResolutionError";
    this.repo = repo;
  }
}

export const WORKSPACE_NOT_FOUND_REMEDIATION =
  "open/register the repository in Paseo (e.g. `paseo workspace create` for an isolated worktree, or `paseo workspace open --cwd <repo_dir>`), then retry";

export function workspaceNotFoundError(repo: string): WorkspaceResolutionError {
  return new WorkspaceResolutionError(
    repo,
    `No workspace found for repository "${repo}": the daemon has no matching workspace. ` +
      `${WORKSPACE_NOT_FOUND_REMEDIATION}.`,
  );
}

export function canonicalDescriptorsToRegistry(
  entries: readonly CanonicalWorkspaceDescriptor[] | null | undefined,
): { workspaces: WorkspaceRecord[]; projects: ProjectRecord[] } {
  const workspaces: WorkspaceRecord[] = [];
  const projectsById = new Map<string, ProjectRecord>();

  for (const entry of entries ?? []) {
    if (!entry) continue;
    const workspaceId = entry.id ?? entry.workspaceId;
    const cwd = entry.workspaceDirectory ?? entry.cwd ?? entry.projectRootPath;
    if (!workspaceId || !cwd) continue;

    const projectId = entry.projectId ?? undefined;
    const isWorktree = entry.gitRuntime?.isPaseoOwnedWorktree === true;

    workspaces.push({
      workspaceId,
      projectId,
      cwd,
      mainRepoRoot: isWorktree ? entry.projectRootPath ?? null : null,
      worktreeRoot: isWorktree ? cwd : null,
      displayName: entry.title ?? entry.name ?? entry.project?.workspaceName ?? null,
      archivedAt: entry.archivingAt ?? entry.archivedAt ?? null,
      kind: entry.workspaceKind ?? entry.kind ?? undefined,
      isPaseoOwnedWorktree: entry.gitRuntime?.isPaseoOwnedWorktree ?? undefined,
    });

    if (projectId && !projectsById.has(projectId)) {
      projectsById.set(projectId, {
        projectId,
        displayName: entry.projectDisplayName ?? entry.project?.projectName ?? undefined,
        projectKey: entry.project?.projectKey ?? undefined,
        rootPath: entry.projectRootPath ?? undefined,
        archivedAt: null,
      });
    }
  }

  return { workspaces, projects: [...projectsById.values()] };
}

function isWorktreeRecord(workspace: WorkspaceRecord): boolean {
  return Boolean(
    workspace.isPaseoOwnedWorktree ||
      workspace.mainRepoRoot ||
      workspace.isolation === "worktree" ||
      workspace.kind === "worktree" ||
      workspace.cwd.includes("/.paseo/worktrees/"),
  );
}

function workspaceCandidateKeys(workspace: WorkspaceRecord, project?: ProjectRecord): string[] {
  const keys = new Set<string>();
  const add = (value?: string | null): void => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    keys.add(trimmed.toLowerCase());
    const normalized = normalizeRepoKey(trimmed);
    if (normalized) keys.add(normalized.toLowerCase());
    const canonical = canonicalRepoKey(trimmed);
    if (canonical) keys.add(canonical.toLowerCase());
  };

  add(workspace.projectId);
  add((workspace as any).projectKey);
  add((workspace as any).repo);
  add(project?.projectId);
  add(project?.projectKey);
  add(workspace.mainRepoRoot);
  add(project?.rootPath);
  add(workspace.cwd);
  add(workspace.displayName);
  add(project?.displayName);
  if (workspace.cwd) add(basename(workspace.cwd));
  if (workspace.mainRepoRoot) add(basename(workspace.mainRepoRoot));
  if (project?.rootPath) add(basename(project.rootPath));

  return [...keys];
}

export function resolveWorkspaceForRepo(
  rawRepo: string,
  options?: WorkspaceLookupOptions,
): ResolvedWorkspace | null {
  if (!rawRepo || typeof rawRepo !== "string" || !rawRepo.trim()) {
    return null;
  }

  const repo = rawRepo.trim();
  const workspaces = Array.isArray(options?.workspacesData) ? options.workspacesData : [];
  if (workspaces.length === 0) {
    return null;
  }
  const projects = Array.isArray(options?.projectsData) ? options.projectsData : [];
  const projectsById = new Map<string, ProjectRecord>();
  for (const project of projects) {
    if (project?.projectId) projectsById.set(project.projectId, project);
  }

  const targetKeys = new Set<string>();
  targetKeys.add(repo.toLowerCase());

  if (repo.startsWith("git-root:") || repo.startsWith("non-git:")) {
    // Direct canonical key match
  } else {
    for (const candidate of candidateRepoKeys(repo)) {
      const normalized = normalizeRepoKey(candidate);
      if (normalized) targetKeys.add(normalized.toLowerCase());
      const canonical = canonicalRepoKey(candidate);
      if (canonical) targetKeys.add(canonical.toLowerCase());
    }
    if (existsSync(repo)) {
      const pKey = canonicalProjectKey(repo);
      if (pKey) targetKeys.add(pKey.toLowerCase());
    }
  }

  const matches: Array<{ workspace: WorkspaceRecord; project?: ProjectRecord }> = [];
  for (const workspace of workspaces) {
    if (!workspace?.workspaceId || !workspace.cwd) continue;
    const project = workspace.projectId ? projectsById.get(workspace.projectId) : undefined;
    const keys = workspaceCandidateKeys(workspace, project);
    const hit = keys.some((key) => targetKeys.has(key));
    if (hit) matches.push({ workspace, project });
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    const archivedDelta = Number(Boolean(a.workspace.archivedAt)) - Number(Boolean(b.workspace.archivedAt));
    if (archivedDelta !== 0) return archivedDelta;
    const worktreeDelta = Number(isWorktreeRecord(a.workspace)) - Number(isWorktreeRecord(b.workspace));
    if (worktreeDelta !== 0) return worktreeDelta;
    const timeA = String(a.workspace.updatedAt ?? a.workspace.createdAt ?? "");
    const timeB = String(b.workspace.updatedAt ?? b.workspace.createdAt ?? "");
    if (timeA !== timeB) return timeB.localeCompare(timeA);
    return a.workspace.workspaceId.localeCompare(b.workspace.workspaceId);
  });

  const best = matches[0];
  return {
    workspaceId: best.workspace.workspaceId,
    cwd: best.workspace.cwd,
    projectId: best.workspace.projectId,
    displayName: best.workspace.displayName ?? best.project?.displayName ?? undefined,
    repo: canonicalRepoKey(repo) ?? repo,
  };
}

export function candidateHostCheckoutDir(repo: string, hostHome?: string): string | undefined {
  const repoBasename = basename(repo.replace(/\.git$/, "")).trim();
  if (!repoBasename) return undefined;
  const home = hostHome || process.env.HOME;
  if (!home) return undefined;
  return join(home, "code", repoBasename);
}

export async function resolveWorkspaceForRepoViaDaemon(
  rawRepo: string,
  paseo: any,
  options?: { candidateDir?: (repo: string) => string | undefined },
): Promise<ResolvedWorkspace | null> {
  if (!rawRepo || typeof rawRepo !== "string" || !rawRepo.trim()) {
    return null;
  }
  const repo = rawRepo.trim();

  const list = paseo?.workspaces?.list;
  if (typeof list !== "function") {
    return null;
  }

  let entries: CanonicalWorkspaceDescriptor[] = [];
  try {
    const listed = await list.call(paseo.workspaces, {});
    entries = Array.isArray(listed?.entries) ? listed.entries : [];
  } catch (err) {
    throw new WorkspaceResolutionError(
      repo,
      `Failed to read workspaces from the Paseo daemon for "${repo}": ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const { workspaces, projects } = canonicalDescriptorsToRegistry(entries);
  const matched = resolveWorkspaceForRepo(repo, { workspacesData: workspaces, projectsData: projects });
  if (matched) return matched;

  const candidateDir = options?.candidateDir?.(repo);
  if (!candidateDir || !existsSync(candidateDir)) {
    return null;
  }

  const open = paseo.workspaces.open;
  if (typeof open !== "function") {
    return null;
  }

  const handle = await open.call(paseo.workspaces, { cwd: candidateDir });
  const workspaceId = handle?.id ?? (handle as any)?.workspaceId;
  if (!workspaceId) {
    throw new WorkspaceResolutionError(
      repo,
      `The Paseo daemon opened ${candidateDir} but returned no workspace id for "${repo}".`,
    );
  }

  return {
    workspaceId,
    cwd: handle.directory ?? candidateDir,
    projectId: handle.projectId ?? undefined,
    repo: canonicalRepoKey(repo) ?? repo,
  };
}
