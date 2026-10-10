import { execFile } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { canonicalDescriptorsToRegistry } from "./workspace-lookup.js";
import { isCodingAgentCategory } from "../shared/contracts.js";

type PaseoApi = PluginHandlerContext["paseo"];

/**
 * Worktree-only dispatch guard (#918).
 *
 * Fleet workers must run in an isolated Paseo worktree, never the repository's
 * primary checkout. The incident this guards against was the primary checkout
 * being parked on a feature branch and served stale code (#867); a linked
 * worktree is the only workspace whose `--git-dir` differs from the shared
 * `--git-common-dir`, so that inequality is the authoritative "isolated from
 * the primary checkout" test.
 */

export type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number; encoding?: BufferEncoding }
) => Promise<{ stdout: string; stderr?: string }>;

const execFileAsync = promisify(execFile) as unknown as ExecFileAsyncFn;
let readGitExec: ExecFileAsyncFn = execFileAsync;

/** Test seam for the git subprocess used by the primary-checkout probe. */
export function setWorkspaceGuardExecFileAsyncForTest(fn: ExecFileAsyncFn | null): void {
  readGitExec = fn || execFileAsync;
}

export interface PrimaryCheckoutInspection {
  /** True when the path is the repository primary checkout, not a linked worktree. */
  isPrimaryCheckout: boolean;
  /** Absolute path that was inspected. */
  path: string;
  /** Primary checkout root when the inspected path is a linked worktree. */
  repoRoot?: string;
  /** Deterministic basis for the verdict (never an LLM judgement). */
  detail: string;
}

async function readGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await readGitExec("git", args, {
      cwd,
      timeout: 3000,
      encoding: "utf-8",
    });
    return String(stdout).trim();
  } catch {
    return undefined;
  }
}

/**
 * Inspects a candidate workspace path and reports whether it is the repository
 * primary checkout. A non-git directory abstains (`isPrimaryCheckout: false`),
 * matching `evaluateSpawnAuthority`'s positive-attribution posture: the guard
 * refuses only on evidence, never on a failed probe.
 */
export async function inspectPrimaryCheckout(cwd: string): Promise<PrimaryCheckoutInspection> {
  const abs = resolve(cwd);
  const [gitDir, commonDir] = await Promise.all([
    readGit(abs, ["rev-parse", "--path-format=absolute", "--git-dir"]),
    readGit(abs, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ]);
  if (!gitDir || !commonDir) {
    return { isPrimaryCheckout: false, path: abs, detail: "not a git checkout" };
  }
  if (resolve(gitDir) === resolve(commonDir)) {
    return {
      isPrimaryCheckout: true,
      path: abs,
      repoRoot: abs,
      detail: "git-dir equals git-common-dir (primary checkout)",
    };
  }
  const repoRoot = basename(commonDir) === ".git" ? dirname(commonDir) : undefined;
  return {
    isPrimaryCheckout: false,
    path: abs,
    repoRoot,
    detail: "linked worktree (git-dir differs from git-common-dir)",
  };
}

/** The subset of a daemon workspace record the guard reasons over. */
export interface WorkspaceGuardRecord {
  workspaceId?: string;
  cwd?: string;
  projectId?: string;
  /** Daemon workspace kind: `worktree`, `local_checkout`, or `directory`. */
  kind?: string;
  /** True only for Paseo-owned worktrees; false for a local checkout. */
  isPaseoOwnedWorktree?: boolean;
  /** Primary checkout root for a worktree; null for a local checkout. */
  mainRepoRoot?: string | null;
  isolation?: string;
}

export interface WorkerWorkspaceGuardOptions {
  category?: "front-desk" | "orchestrator" | "coding-agent" | "worker";
  /** Absolute workspace path requested for the worker, if any. */
  cwd?: string;
  /** Paseo workspace id requested for the worker, if any. */
  workspaceId?: string;
  /** Result of inspecting the effective cwd, when a path is known. */
  inspection?: PrimaryCheckoutInspection;
  /** Daemon project `rootPath` for the target repo, when known. */
  projectRootPath?: string;
  /** Daemon registry record for `workspaceId`, when resolved. */
  workspaceRecord?: WorkspaceGuardRecord;
}

export interface WorkerWorkspaceGuardDecision {
  allowed: boolean;
  /** Present only when `allowed` is false; names the corrective action. */
  error?: string;
  /** Deterministic, human-readable reason for logging. */
  reason: string;
}

const WORKSPACE_REMEDIATION =
  'provision an isolated workspace first: `paseo workspace create --isolation worktree --mode branch-off --new-branch <type>/<issue#>-<slug> --title "<repo>#<issue#> <slug>" --json`, then dispatch with `paseo agent run --workspace <workspace_id>` (or MCP create_agent with `workspaceId`)';

/** A worker may never be launched in the repository primary checkout. */
export const WORKER_PRIMARY_CHECKOUT_ERROR =
  `worktree-only dispatch: refused to launch a worker in the repository primary checkout; ${WORKSPACE_REMEDIATION}; never pass the primary checkout as --cwd/workspace_path`;

/** A local (`isolation: local`, non-worktree) Paseo workspace resolves to the primary checkout. */
export const WORKER_LOCAL_ISOLATION_ERROR =
  `worktree-only dispatch: refused to launch a worker in a local (non-worktree) Paseo workspace because it resolves to the repository primary checkout; ${WORKSPACE_REMEDIATION}`;

function normalizeDir(dir: string | undefined | null): string | undefined {
  if (!dir || !dir.trim()) return undefined;
  const normalized = resolve(dir.trim()).replace(/[\\/]+$/, "");
  return normalized || undefined;
}

/**
 * Pure, deterministic worktree-only dispatch policy (#918).
 *
 * Applies to `category: "coding-agent"` (legacy `worker`) only: the orchestrator
 * is expected to run from the primary checkout on `main`, so its own spawn is
 * not refused. The guard abstains when no path/record evidence exists, because
 * attribution must be positive — a missing probe is not proof of a primary
 * checkout.
 */
export function evaluateWorkerWorkspaceGuard(
  options: WorkerWorkspaceGuardOptions
): WorkerWorkspaceGuardDecision {
  if (!isCodingAgentCategory(options.category)) {
    return {
      allowed: true,
      reason: "worktree-only dispatch guard applies to coding-agent spawns only",
    };
  }

  if (options.inspection?.isPrimaryCheckout) {
    return {
      allowed: false,
      error: WORKER_PRIMARY_CHECKOUT_ERROR,
      reason: `worker workspace ${options.inspection.path} is the primary checkout (${options.inspection.detail})`,
    };
  }

  const cwd = normalizeDir(options.cwd);
  const recordCwd = normalizeDir(options.workspaceRecord?.cwd);
  const projectRoot = normalizeDir(options.projectRootPath);

  if (cwd && projectRoot && cwd === projectRoot) {
    return {
      allowed: false,
      error: WORKER_PRIMARY_CHECKOUT_ERROR,
      reason: `worker cwd ${cwd} equals the project root ${projectRoot}`,
    };
  }
  if (recordCwd && projectRoot && recordCwd === projectRoot) {
    return {
      allowed: false,
      error: WORKER_PRIMARY_CHECKOUT_ERROR,
      reason: `workspace ${options.workspaceId ?? recordCwd} cwd equals the project root ${projectRoot}`,
    };
  }

  const record = options.workspaceRecord;
  if (record && record.isolation === "local") {
    return {
      allowed: false,
      error: WORKER_LOCAL_ISOLATION_ERROR,
      reason: `workspace ${options.workspaceId ?? recordCwd} is isolation: local`,
    };
  }
  if (
    record &&
    record.isPaseoOwnedWorktree !== true &&
    (record.kind === "local_checkout" || record.kind === "directory")
  ) {
    return {
      allowed: false,
      error: WORKER_LOCAL_ISOLATION_ERROR,
      reason: `workspace ${options.workspaceId ?? recordCwd} is a ${record.kind}, not a Paseo-owned worktree`,
    };
  }
  if (record && record.isPaseoOwnedWorktree === false && !record.mainRepoRoot) {
    return {
      allowed: false,
      error: WORKER_LOCAL_ISOLATION_ERROR,
      reason: `workspace ${options.workspaceId ?? recordCwd} is not a Paseo-owned worktree`,
    };
  }

  return {
    allowed: true,
    reason: cwd
      ? `worker workspace ${cwd} is not the primary checkout`
      : options.workspaceId
        ? `workspace ${options.workspaceId} is an isolated Paseo worktree`
        : "no workspace path/record evidence; guard abstains",
  };
}

export interface DaemonWorkspaceRegistry {
  workspaces: WorkspaceGuardRecord[];
  projects: Array<{ projectId?: string; rootPath?: string }>;
}

/**
 * Loads the workspace/project records the guard reasons over. Production reads
 * them from the daemon RPC (canonical authority); tests may inject records
 * directly. There is no fallback to scraping the on-disk registry.
 */
async function loadDaemonWorkspaceRegistry(
  paseo: PaseoApi | undefined,
  override?: Partial<DaemonWorkspaceRegistry>,
): Promise<DaemonWorkspaceRegistry> {
  if (override?.workspaces || override?.projects) {
    return {
      workspaces: override.workspaces ?? [],
      projects: override.projects ?? [],
    };
  }
  if (typeof paseo?.workspaces?.list === "function") {
    try {
      const listed = await paseo.workspaces.list({});
      return canonicalDescriptorsToRegistry(listed?.entries);
    } catch {
      // Abstain rather than crash the spawn: the guard refuses only on
      // positive evidence, and a failed probe is not evidence.
      return { workspaces: [], projects: [] };
    }
  }
  return { workspaces: [], projects: [] };
}

/**
 * Resolves the effective worker workspace path, the daemon registry record,
 * and the project `rootPath` for a spawn request. `cwd` wins over the registry
 * record when both are present, because an explicit path is what the daemon
 * will actually use.
 */
export async function resolveWorkerWorkspaceContext(
  options: { cwd?: string; workspaceId?: string },
  registryOverride?: Partial<DaemonWorkspaceRegistry>,
  paseo?: PaseoApi,
): Promise<{
  cwd?: string;
  workspaceId?: string;
  inspection?: PrimaryCheckoutInspection;
  projectRootPath?: string;
  workspaceRecord?: WorkspaceGuardRecord;
}> {
  const explicitCwd = normalizeDir(options.cwd);
  let workspaceRecord: WorkspaceGuardRecord | undefined;
  let projectRootPath: string | undefined;

  if (options.workspaceId) {
    const registry = await loadDaemonWorkspaceRegistry(paseo, registryOverride);
    workspaceRecord = registry.workspaces.find(
      (w) => w.workspaceId === options.workspaceId
    );
    if (workspaceRecord?.projectId) {
      const project = registry.projects.find((p) => p.projectId === workspaceRecord?.projectId);
      projectRootPath = normalizeDir(project?.rootPath);
    }
  }

  const effectiveCwd = explicitCwd ?? normalizeDir(workspaceRecord?.cwd);
  const inspection = effectiveCwd ? await inspectPrimaryCheckout(effectiveCwd) : undefined;

  return {
    cwd: effectiveCwd,
    workspaceId: options.workspaceId?.trim() || undefined,
    inspection,
    projectRootPath,
    workspaceRecord,
  };
}

/**
 * Async wrapper used by `spawnPaseoAgent`: resolves the daemon context and
 * applies the pure guard. Returns `allowed: true` for non-coding-agent
 * categories without touching the filesystem.
 */
export async function evaluateWorkerSpawnWorkspace(
  options: { category?: "front-desk" | "orchestrator" | "coding-agent" | "worker"; cwd?: string; workspaceId?: string },
  registryOverride?: Partial<DaemonWorkspaceRegistry>,
  paseo?: PaseoApi,
): Promise<WorkerWorkspaceGuardDecision> {
  if (!isCodingAgentCategory(options.category)) {
    return { allowed: true, reason: "worktree-only dispatch guard applies to coding-agent spawns only" };
  }
  const context = await resolveWorkerWorkspaceContext(
    { cwd: options.cwd, workspaceId: options.workspaceId },
    registryOverride,
    paseo,
  );
  return evaluateWorkerWorkspaceGuard({ ...options, ...context });
}
