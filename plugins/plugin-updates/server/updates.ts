import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { listPlugins, safeSpawn, type PaseoPluginInfo, type SafeSpawnResult } from "paseo-plugin-helper/server";
import type { PluginUpdate, PluginUpdateActionResult, PluginUpdateStatus } from "../shared/updates";

const PROBE_TIMEOUT_MS = 10_000;
const UPDATE_TIMEOUT_MS = 120_000;
const RELOAD_TIMEOUT_MS = 60_000;

type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
) => Promise<SafeSpawnResult>;

type ReadDir = (dir: string) => Promise<Array<{ name: string; isDirectory(): boolean }>>;

const runCommand: CommandRunner = (command, args, options) =>
  safeSpawn(command, args, { cwd: options.cwd, timeoutMs: options.timeoutMs });

const defaultReadDir: ReadDir = (dir) => fs.promises.readdir(dir, { withFileTypes: true });

export interface ProbeDeps {
  pluginsRoot?: string;
  readDir?: ReadDir;
  scanOrphans?: boolean;
}

function defaultPluginsRoot(): string {
  return path.join(homedir(), ".paseo", "plugins");
}

function outputOf(result: SafeSpawnResult): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function errorOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRef(output: string): string | null {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  if (!line) return null;
  const commit = line.split(/\s+/)[0];
  return /^[0-9a-f]{40}$/i.test(commit) ? commit : null;
}

function normalizeDir(value: string): string {
  return path.resolve(value.trim().replace(/\/+$/, ""));
}

interface RepoProbe {
  remote: string | null;
  branch: string | null;
  localCommit: string | null;
  remoteCommit: string | null;
  status: PluginUpdateStatus;
  error: string | null;
  detail: string | null;
}

function probeError(
  partial: Partial<RepoProbe>,
  error: string,
): RepoProbe {
  return {
    remote: partial.remote ?? null,
    branch: partial.branch ?? null,
    localCommit: partial.localCommit ?? null,
    remoteCommit: null,
    status: "error",
    error,
    detail: null,
  };
}

async function resolveRepoRoot(pluginPath: string, runner: CommandRunner): Promise<string | null> {
  try {
    const toplevel = await runner("git", ["rev-parse", "--show-toplevel"], {
      cwd: pluginPath,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (toplevel.code === 0 && toplevel.stdout.trim()) {
      return normalizeDir(toplevel.stdout);
    }
  } catch {
    // Fall through to null below.
  }
  return null;
}

/**
 * Probes a repo root without fetching: resolves the upstream ref, then compares
 * `git ls-remote <remote> <branch>` to local HEAD. Equal => current, otherwise
 * behind. No ahead/behind counts are computed.
 */
async function probeRepoRoot(
  root: string,
  pinnedRemote: string | null,
  pinnedRef: string | null,
  runner: CommandRunner,
): Promise<RepoProbe> {
  try {
    const headResult = await runner("git", ["rev-parse", "HEAD"], {
      cwd: root,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const localCommit =
      headResult.code === 0 && /^[0-9a-f]{40}$/i.test(headResult.stdout.trim())
        ? headResult.stdout.trim()
        : null;

    let remote = pinnedRemote;
    let branch = pinnedRef;

    if (!remote || !branch) {
      const branchResult = await runner("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: root,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      const current = branchResult.code === 0 ? branchResult.stdout.trim() : "";
      if (!branch) {
        if (!current || current === "HEAD") {
          return {
            remote,
            branch: null,
            localCommit,
            remoteCommit: null,
            status: "unpinned",
            error: null,
            detail: "Detached HEAD — no upstream to compare; report only",
          };
        }
        branch = current;
      }
      if (!remote) {
        const upstreamResult = await runner(
          "git",
          ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
          { cwd: root, timeoutMs: PROBE_TIMEOUT_MS },
        );
        const upstream = upstreamResult.code === 0 ? upstreamResult.stdout.trim() : "";
        if (!upstream) {
          return {
            remote: null,
            branch,
            localCommit,
            remoteCommit: null,
            status: "no-upstream",
            error: null,
            detail: "Branch has no upstream remote; report only",
          };
        }
        const separator = upstream.indexOf("/");
        remote = separator > 0 ? upstream.slice(0, separator) : upstream;
        if (!pinnedRef && separator > 0) branch = upstream.slice(separator + 1);
      }
    }

    if (!localCommit || !remote || !branch) {
      return probeError({ remote, branch, localCommit }, "Unable to determine local HEAD or comparison ref");
    }

    const lsRemote = await runner("git", ["ls-remote", remote, branch], {
      cwd: root,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (lsRemote.code !== 0) {
      return probeError({ remote, branch, localCommit }, outputOf(lsRemote) || "git ls-remote failed");
    }
    const remoteCommit = parseRef(lsRemote.stdout);
    if (!remoteCommit) {
      return probeError(
        { remote, branch, localCommit },
        `Remote ${remote}/${branch} has no matching ref`,
      );
    }
    if (remoteCommit === localCommit) {
      return {
        remote,
        branch,
        localCommit,
        remoteCommit,
        status: "current",
        error: null,
        detail: `Up to date with ${remote}/${branch}`,
      };
    }
    return {
      remote,
      branch,
      localCommit,
      remoteCommit,
      status: "behind",
      error: null,
      detail: `Remote ${remote}/${branch} is ahead of local HEAD — update available`,
    };
  } catch (error) {
    return probeError({ remote: pinnedRemote, branch: pinnedRef }, errorOf(error));
  }
}

function firstPinned(plugins: PaseoPluginInfo[], field: "remote" | "ref"): string | null {
  for (const plugin of plugins) {
    const value = plugin[field]?.trim();
    if (value) return value;
  }
  return null;
}

function baseRow(plugin: PaseoPluginInfo): Omit<PluginUpdate, "status" | "error" | "detail"> {
  return {
    id: plugin.id,
    path: plugin.path,
    remote: null,
    branch: null,
    localCommit: null,
    remoteCommit: null,
    sharedRepo: null,
    repoRoot: null,
    repoPlugins: null,
    source: plugin.source ?? null,
  };
}

function notARepoRow(plugin: PaseoPluginInfo): PluginUpdate {
  return {
    ...baseRow(plugin),
    status: "not-a-repo",
    error: null,
    detail: "Not a git repository — no git update possible",
  };
}

function rowFromProbe(
  plugin: PaseoPluginInfo,
  root: string,
  probe: RepoProbe,
  sharedRepo: boolean | null,
  ids: string[],
): PluginUpdate {
  const detail =
    sharedRepo && probe.detail
      ? `${probe.detail} (shared repo; compares monorepo HEAD)`
      : probe.detail;
  return {
    id: plugin.id,
    path: plugin.path,
    remote: probe.remote,
    branch: probe.branch,
    localCommit: probe.localCommit,
    remoteCommit: probe.remoteCommit,
    status: probe.status,
    error: probe.error,
    detail,
    sharedRepo,
    repoRoot: root,
    repoPlugins: ids.length > 1 ? ids : null,
    source: plugin.source ?? null,
  };
}

async function scanOrphanedDirs(
  installed: PaseoPluginInfo[],
  deps: ProbeDeps,
): Promise<PluginUpdate[]> {
  const pluginsRoot = deps.pluginsRoot ?? defaultPluginsRoot();
  const readDir = deps.readDir ?? defaultReadDir;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readDir(pluginsRoot);
  } catch {
    return [];
  }
  const livePaths = installed
    .map((plugin) => plugin.path)
    .filter((value): value is string => Boolean(value))
    .map(normalizeDir);
  const rows: PluginUpdate[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = normalizeDir(path.join(pluginsRoot, entry.name));
    const live = livePaths.some((livePath) => livePath === dir || livePath.startsWith(`${dir}${path.sep}`));
    if (live) continue;
    rows.push({
      id: `orphaned:${entry.name}`,
      path: dir,
      remote: null,
      branch: null,
      localCommit: null,
      remoteCommit: null,
      status: "orphaned",
      error: null,
      detail: "Leftover managed directory from an uninstalled or failed install — not probed",
      sharedRepo: null,
      repoRoot: null,
      repoPlugins: null,
      source: null,
    });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

async function probeInstalled(
  installed: PaseoPluginInfo[],
  runner: CommandRunner,
  deps: ProbeDeps = {},
): Promise<PluginUpdate[]> {
  const resolved = await Promise.all(
    installed.map(async (plugin) => ({
      plugin,
      root: plugin.path ? await resolveRepoRoot(plugin.path, runner) : null,
    })),
  );

  const order: string[] = [];
  const groups = new Map<string, { root: string | null; plugins: PaseoPluginInfo[] }>();
  for (const item of resolved) {
    const key = item.root ?? `\0${item.plugin.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { root: item.root, plugins: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.plugins.push(item.plugin);
  }

  const rows: PluginUpdate[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    if (!group.root) {
      for (const plugin of group.plugins) rows.push(notARepoRow(plugin));
      continue;
    }
    const probe = await probeRepoRoot(
      group.root,
      firstPinned(group.plugins, "remote"),
      firstPinned(group.plugins, "ref"),
      runner,
    );
    const ids = group.plugins.map((plugin) => plugin.id);
    for (const plugin of group.plugins) {
      const sharedRepo = plugin.path ? normalizeDir(plugin.path) !== group.root : null;
      rows.push(rowFromProbe(plugin, group.root, probe, sharedRepo, ids));
    }
  }

  if (deps.scanOrphans !== false) {
    rows.push(...(await scanOrphanedDirs(installed, deps)));
  }
  return rows;
}

async function probePlugin(
  plugin: PaseoPluginInfo,
  runner: CommandRunner = runCommand,
  deps: ProbeDeps = { scanOrphans: false },
): Promise<PluginUpdate> {
  const rows = await probeInstalled([plugin], runner, deps);
  return rows[0]!;
}

export async function checkInstalledPlugins(
  _workspaceId?: string,
  runner: CommandRunner = runCommand,
  installedOverride?: PaseoPluginInfo[],
  deps: ProbeDeps = {},
): Promise<{ checkedAt: string; plugins: PluginUpdate[] }> {
  try {
    const installed = installedOverride ?? (await listPlugins({ forceRefresh: true }));
    const plugins = await probeInstalled(installed, runner, deps);
    return { checkedAt: new Date().toISOString(), plugins };
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      plugins: [
        {
          id: "plugin-manager",
          path: "",
          remote: null,
          branch: null,
          localCommit: null,
          remoteCommit: null,
          status: "error",
          error: `Unable to list installed plugins: ${errorOf(error)}`,
          detail: null,
          sharedRepo: null,
          repoRoot: null,
          repoPlugins: null,
          source: null,
        },
      ],
    };
  }
}

function actionResult(
  pluginId: string,
  status: "updated" | "error",
  error: string | null = null,
  output: string | null = null,
  requiresForce = false,
): PluginUpdateActionResult {
  return {
    pluginId,
    status,
    output: output ?? null,
    error: error ?? null,
    ...(requiresForce ? { requiresForce: true } : {}),
  };
}

async function invokePaseoUpdate(
  args: string[],
  runner: CommandRunner,
): Promise<{ status: "updated" | "error"; output: string | null; error: string | null }> {
  try {
    const result = await runner("paseo", ["plugin", "update", ...args], {
      timeoutMs: UPDATE_TIMEOUT_MS,
    });
    const output = outputOf(result) || null;
    if (result.code === 0) return { status: "updated", output, error: null };
    return { status: "error", output, error: output || `paseo plugin update exited with code ${result.code}` };
  } catch (error) {
    return { status: "error", output: null, error: errorOf(error) };
  }
}

async function reloadPlugin(
  pluginId: string,
  runner: CommandRunner,
): Promise<{ ok: boolean; output: string | null; error: string | null }> {
  try {
    const result = await runner("paseo", ["plugin", "reload", pluginId], {
      timeoutMs: RELOAD_TIMEOUT_MS,
    });
    const output = outputOf(result) || null;
    if (result.code === 0) return { ok: true, output, error: null };
    return { ok: false, output, error: output || `paseo plugin reload exited with code ${result.code}` };
  } catch (error) {
    return { ok: false, output: null, error: errorOf(error) };
  }
}

interface PullOutcome {
  ok: boolean;
  requiresForce: boolean;
  output: string | null;
  error: string | null;
}

async function pullRoot(root: string, force: boolean, runner: CommandRunner): Promise<PullOutcome> {
  try {
    if (!force) {
      const statusResult = await runner("git", ["status", "--porcelain"], {
        cwd: root,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (statusResult.code !== 0) {
        const message = outputOf(statusResult) || "git status failed";
        return { ok: false, requiresForce: false, output: outputOf(statusResult) || null, error: message };
      }
      if (statusResult.stdout.trim()) {
        return {
          ok: false,
          requiresForce: true,
          output: null,
          error: "Working tree is dirty — refusing to pull. Re-run with force to override.",
        };
      }
    }
    const pull = await runner("git", ["pull", "--ff-only"], {
      cwd: root,
      timeoutMs: UPDATE_TIMEOUT_MS,
    });
    const output = outputOf(pull) || null;
    if (pull.code !== 0) {
      return { ok: false, requiresForce: false, output, error: output || `git pull --ff-only exited with code ${pull.code}` };
    }
    return { ok: true, requiresForce: false, output, error: null };
  } catch (error) {
    return { ok: false, requiresForce: false, output: null, error: errorOf(error) };
  }
}

async function idsSharingRoot(
  installed: PaseoPluginInfo[],
  root: string,
  runner: CommandRunner,
): Promise<string[]> {
  const roots = await Promise.all(
    installed.map(async (plugin) => ({
      id: plugin.id,
      root: plugin.path ? await resolveRepoRoot(plugin.path, runner) : null,
    })),
  );
  return roots.filter((entry) => entry.root === root).map((entry) => entry.id);
}

export interface UpdateOptions {
  force?: boolean;
  runner?: CommandRunner;
  installedOverride?: PaseoPluginInfo[];
  deps?: ProbeDeps;
}

export async function updatePlugin(
  pluginId: string,
  _workspaceId?: string,
  options: UpdateOptions = {},
): Promise<PluginUpdateActionResult> {
  const runner = options.runner ?? runCommand;
  let installed: PaseoPluginInfo[];
  try {
    installed = options.installedOverride ?? (await listPlugins({ forceRefresh: true }));
  } catch (error) {
    return actionResult(pluginId, "error", `Unable to list installed plugins: ${errorOf(error)}`);
  }
  const info = installed.find((plugin) => plugin.id === pluginId);
  if (!info) return actionResult(pluginId, "error", `Plugin '${pluginId}' is not installed`);
  if (!info.path) return actionResult(pluginId, "error", `Plugin '${pluginId}' has no directory path`);

  if (info.source === "git") {
    const result = await invokePaseoUpdate([pluginId], runner);
    return actionResult(pluginId, result.status, result.error, result.output);
  }

  const root = await resolveRepoRoot(info.path, runner);
  if (!root) {
    return actionResult(pluginId, "error", `Plugin '${pluginId}' is not a git repository — no git update possible`);
  }
  const pull = await pullRoot(root, options.force ?? false, runner);
  if (!pull.ok) {
    return actionResult(pluginId, "error", pull.error, pull.output, pull.requiresForce);
  }

  const ids = await idsSharingRoot(installed, root, runner);
  const reloadFailures: string[] = [];
  for (const id of ids) {
    const reload = await reloadPlugin(id, runner);
    if (!reload.ok) reloadFailures.push(`${id}: ${reload.error}`);
  }
  const output = pull.output ?? `Pulled ${root}`;
  if (reloadFailures.length > 0) {
    return actionResult(pluginId, "error", `Pulled but failed to reload: ${reloadFailures.join("; ")}`, output);
  }
  return actionResult(pluginId, "updated", null, output);
}

export async function updateAllPlugins(
  _workspaceId?: string,
  options: UpdateOptions = {},
): Promise<{ results: PluginUpdateActionResult[] }> {
  const runner = options.runner ?? runCommand;
  let installed: PaseoPluginInfo[];
  try {
    installed = options.installedOverride ?? (await listPlugins({ forceRefresh: true }));
  } catch (error) {
    return {
      results: [actionResult("all", "error", `Unable to list installed plugins: ${errorOf(error)}`)],
    };
  }

  const rows = await probeInstalled(installed, runner, options.deps ?? { scanOrphans: false });
  const groups = new Map<string, PluginUpdate[]>();
  for (const row of rows) {
    if (row.status !== "behind" || !row.repoRoot) continue;
    const group = groups.get(row.repoRoot) ?? [];
    group.push(row);
    groups.set(row.repoRoot, group);
  }

  const results: PluginUpdateActionResult[] = [];
  for (const [root, group] of groups) {
    const ids = group.map((row) => row.id);
    if (group[0]?.source === "git") {
      for (const id of ids) {
        const result = await invokePaseoUpdate([id], runner);
        results.push(actionResult(id, result.status, result.error, result.output));
      }
      continue;
    }
    const pull = await pullRoot(root, options.force ?? false, runner);
    if (!pull.ok) {
      for (const id of ids) {
        results.push(actionResult(id, "error", pull.error, pull.output, pull.requiresForce));
      }
      continue;
    }
    for (const id of ids) {
      const reload = await reloadPlugin(id, runner);
      results.push(
        reload.ok
          ? actionResult(id, "updated", null, pull.output ?? `Pulled ${root}`)
          : actionResult(id, "error", reload.error, pull.output),
      );
    }
  }

  if (results.length === 0) {
    results.push(actionResult("all", "updated", null, "No plugins with remote updates"));
  }
  return { results };
}

export const testing = {
  probePlugin,
  probeInstalled,
  probeRepoRoot,
  resolveRepoRoot,
  pullRoot,
  scanOrphanedDirs,
  checkInstalledPlugins,
  updatePlugin,
  updateAllPlugins,
  PROBE_TIMEOUT_MS,
  UPDATE_TIMEOUT_MS,
};
