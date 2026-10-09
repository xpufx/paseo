import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { candidateRepoKeys, canonicalRepoKey, normalizeRepoKey } from "../shared/repo-identity.js";
import { isRepoMatching } from "../shared/sort-filter.js";
import { resolveHostHome } from "./role-models.js";

type PaseoApi = PluginHandlerContext["paseo"];

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
  /** Canonical daemon client; used by the async daemon-backed resolver. */
  paseo?: PaseoApi;
}

/** Shape of a daemon `workspaces.list()` entry (canonical authority). */
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

/**
 * Raised when workspace resolution goes through the daemon and no usable
 * workspace exists. Callers must surface this to the operator instead of
 * silently degrading to a speculative path.
 */
export class WorkspaceResolutionError extends Error {
  readonly repo: string;
  constructor(repo: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorkspaceResolutionError";
    this.repo = repo;
  }
}

/** Remediation text shared by every fail-fast workspace error. */
export const WORKSPACE_NOT_FOUND_REMEDIATION =
  "open/register the repository in Paseo (e.g. `paseo workspace create` for an isolated worktree, or `paseo workspace open --cwd <repo_dir>`), then retry";

export function workspaceNotFoundError(repo: string): WorkspaceResolutionError {
  return new WorkspaceResolutionError(
    repo,
    `No workspace found for repository "${repo}": the daemon has no matching workspace and no host checkout ` +
      `at ~/code/<repo>. ${WORKSPACE_NOT_FOUND_REMEDIATION}.`,
  );
}

/**
 * Normalizes canonical daemon workspace descriptors into the record shape used
 * by the pure matcher. This is the only translation between RPC payloads and
 * the resolver, so it is the single place a daemon schema change lands.
 */
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
    const normalized = normalizeRepoKey(value);
    if (normalized) keys.add(normalized.toLowerCase());
    const canonical = canonicalRepoKey(value);
    if (canonical) keys.add(canonical.toLowerCase());
  };

  add(project?.projectKey ?? undefined);
  if (typeof workspace.projectId === "string" && workspace.projectId.startsWith("remote:")) {
    add(workspace.projectId);
  }
  add(workspace.mainRepoRoot);
  add(project?.rootPath);
  add(workspace.cwd);
  add(workspace.displayName);
  add(project?.displayName);

  return [...keys];
}

/**
 * Deterministic matcher over already-resolved daemon records. There is no
 * point scoring and no tombstone guessing: candidates are ordered by explicit
 * precedence (live before archived, root checkout before worktree, newest
 * first) and the first match wins.
 */
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
  for (const candidate of candidateRepoKeys(repo)) {
    const normalized = normalizeRepoKey(candidate);
    if (normalized) targetKeys.add(normalized.toLowerCase());
    const canonical = canonicalRepoKey(candidate);
    if (canonical) targetKeys.add(canonical.toLowerCase());
  }
  const repoBasename = basename(repo.replace(/\.git$/, "")).toLowerCase();

  const matches: Array<{ workspace: WorkspaceRecord; project?: ProjectRecord }> = [];
  for (const workspace of workspaces) {
    if (!workspace?.workspaceId || !workspace.cwd) continue;
    const project = workspace.projectId ? projectsById.get(workspace.projectId) : undefined;
    const keys = workspaceCandidateKeys(workspace, project);
    const hit = keys.some(
      (key) =>
        targetKeys.has(key) ||
        key === repoBasename ||
        key.endsWith(`/${repoBasename}`) ||
        isRepoMatching(repo, key),
    );
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

/** Deterministic host checkout path for a repo slug, if a host home is known. */
export function candidateHostCheckoutDir(repo: string): string | undefined {
  const repoBasename = basename(repo.replace(/\.git$/, "")).trim();
  if (!repoBasename) return undefined;
  const home = resolveHostHome();
  if (!home) return undefined;
  return join(home, "code", repoBasename);
}

/**
 * Canonical resolution path. The daemon is the sole authority:
 *   1. read the daemon's workspace list through RPC and match deterministically;
 *   2. otherwise ask the daemon to attach/create the ambient workspace for the
 *      host checkout (`workspaces.open`), which is exactly what `--cwd` does on
 *      the CLI.
 *
 * Returns `null` when neither finds a workspace; callers must fail fast with
 * {@link workspaceNotFoundError} rather than fall through a speculative ladder.
 */
export async function resolveWorkspaceForRepoViaDaemon(
  rawRepo: string,
  paseo: PaseoApi,
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

  const dir = (options?.candidateDir ?? candidateHostCheckoutDir)(repo);
  if (!dir || !existsSync(dir)) {
    return null;
  }

  const open = paseo.workspaces.open;
  if (typeof open !== "function") {
    return null;
  }

  const handle = await open.call(paseo.workspaces, { cwd: dir });
  const workspaceId = handle?.id ?? (handle as any)?.workspaceId;
  if (!workspaceId) {
    throw new WorkspaceResolutionError(
      repo,
      `The Paseo daemon opened ${dir} but returned no workspace id for "${repo}".`,
    );
  }

  return {
    workspaceId,
    cwd: handle.directory ?? dir,
    projectId: handle.projectId ?? undefined,
    repo: canonicalRepoKey(repo) ?? repo,
  };
}
