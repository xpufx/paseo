import path from "node:path";
import { listPlugins, safeSpawn, type PaseoPluginInfo, type SafeSpawnResult } from "paseo-plugin-helper/server";
import type { PluginUpdate, PluginUpdateActionResult, PluginUpdateStatus } from "../shared/updates";

const PROBE_TIMEOUT_MS = 10_000;
const UPDATE_TIMEOUT_MS = 120_000;

type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
) => Promise<SafeSpawnResult>;

const runCommand: CommandRunner = (command, args, options) =>
  safeSpawn(command, args, { cwd: options.cwd, timeoutMs: options.timeoutMs });

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

function parseAheadBehind(output: string): { ahead: number; behind: number } | null {
  const match = output.trim().split(/\s+/);
  if (match.length < 2) return null;
  const ahead = Number.parseInt(match[0] ?? "", 10);
  const behind = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind) || ahead < 0 || behind < 0) return null;
  return { ahead, behind };
}

function normalizeDir(value: string): string {
  return path.resolve(value.trim().replace(/\/+$/, ""));
}

function detectSharedRepo(pluginPath: string, toplevelOutput: string | null): boolean | null {
  if (toplevelOutput == null) return null;
  const toplevel = toplevelOutput.trim();
  if (!toplevel) return null;
  try {
    return normalizeDir(toplevel) !== normalizeDir(pluginPath);
  } catch {
    return null;
  }
}

function sharedSuffix(sharedRepo: boolean | null): string {
  return sharedRepo ? " (shared repo; compares monorepo HEAD)" : "";
}

function detailFor(
  status: PluginUpdateStatus,
  ahead: number | null,
  behind: number | null,
  sharedRepo: boolean | null,
): string {
  const suffix = sharedSuffix(sharedRepo);
  if (status === "fresh") return `Up to date${suffix}`;
  if (status === "stale") {
    return behind != null ? `Update available · ${behind} behind${suffix}` : `Update available${suffix}`;
  }
  if (status === "ahead") {
    return ahead != null
      ? `Local ahead · ${ahead} unpushed, no update available${suffix}`
      : `Local ahead, no update available${suffix}`;
  }
  if (status === "diverged") {
    return ahead != null && behind != null
      ? `Diverged · ${ahead} ahead, ${behind} behind${suffix}`
      : `Diverged${suffix}`;
  }
  return status;
}

interface GroupProbe {
  remote: string | null;
  branch: string | null;
  localCommit: string | null;
  remoteCommit: string | null;
  ahead: number | null;
  behind: number | null;
  status: PluginUpdateStatus;
  error: string | null;
  detail: string | null;
}

async function resolveToplevel(pluginPath: string, runner: CommandRunner): Promise<string | null> {
  try {
    const toplevelResult = await runner("git", ["rev-parse", "--show-toplevel"], {
      cwd: pluginPath,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (toplevelResult.code === 0 && toplevelResult.stdout.trim()) {
      return normalizeDir(toplevelResult.stdout);
    }
  } catch {
    // Fall through to null below.
  }
  return null;
}

async function probeRoot(
  cwd: string,
  remoteOverride: string | null,
  refOverride: string | null,
  runner: CommandRunner,
): Promise<GroupProbe> {
  const gitCheck = await runner("git", ["rev-parse", "--git-dir"], {
    cwd,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (gitCheck.code !== 0) {
    return {
      remote: remoteOverride,
      branch: refOverride,
      localCommit: null,
      remoteCommit: null,
      ahead: null,
      behind: null,
      status: "error",
      error: outputOf(gitCheck) || "Directory is not a git repository",
      detail: null,
    };
  }

  const [remoteResult, branchResult, localResult] = await Promise.all([
    remoteOverride != null
      ? null
      : runner("git", ["remote", "get-url", "origin"], { cwd, timeoutMs: PROBE_TIMEOUT_MS }),
    refOverride != null
      ? null
      : runner("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
          cwd,
          timeoutMs: PROBE_TIMEOUT_MS,
        }),
    runner("git", ["rev-parse", "HEAD"], { cwd, timeoutMs: PROBE_TIMEOUT_MS }),
  ]);
  if (remoteResult != null && remoteResult.code !== 0) {
    return {
      remote: null,
      branch: refOverride,
      localCommit: localResult.code === 0 ? localResult.stdout.trim() : null,
      remoteCommit: null,
      ahead: null,
      behind: null,
      status: "error",
      error: outputOf(remoteResult) || "No origin remote configured",
      detail: null,
    };
  }
  const remote = remoteOverride ?? remoteResult!.stdout.trim();
  const branch = refOverride ?? (branchResult != null && branchResult.code === 0 ? branchResult.stdout.trim() : null);
  const localCommit = localResult.code === 0 ? localResult.stdout.trim() : null;
  const remoteArgs = branch ? ["ls-remote", "--heads", remote, branch] : ["ls-remote", remote, "HEAD"];
  const remoteResultProbe = await runner("git", remoteArgs, {
    cwd,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (remoteResultProbe.code !== 0) {
    return {
      remote,
      branch,
      localCommit,
      remoteCommit: null,
      ahead: null,
      behind: null,
      status: "error",
      error: outputOf(remoteResultProbe) || "git ls-remote failed",
      detail: null,
    };
  }
  const remoteCommit = parseRef(remoteResultProbe.stdout);
  if (!remoteCommit) {
    return {
      remote,
      branch,
      localCommit,
      remoteCommit: null,
      ahead: null,
      behind: null,
      status: "error",
      error: "git ls-remote returned no commit for the current branch",
      detail: null,
    };
  }
  if (!localCommit) {
    return {
      remote,
      branch,
      localCommit,
      remoteCommit,
      ahead: null,
      behind: null,
      status: "error",
      error: "Unable to determine local commit",
      detail: null,
    };
  }
  if (localCommit === remoteCommit) {
    return {
      remote,
      branch,
      localCommit,
      remoteCommit,
      ahead: 0,
      behind: 0,
      status: "fresh",
      error: null,
      detail: detailFor("fresh", 0, 0, null),
    };
  }
  const countsResult = await runner(
    "git",
    ["rev-list", "--left-right", "--count", `${localCommit}...${remoteCommit}`],
    { cwd, timeoutMs: PROBE_TIMEOUT_MS },
  );
  if (countsResult.code !== 0) {
    return {
      remote,
      branch,
      localCommit,
      remoteCommit,
      ahead: null,
      behind: null,
      status: "stale",
      error: null,
      detail: "Remote differs; relationship unknown (remote commit not present locally)",
    };
  }
  const counts = parseAheadBehind(countsResult.stdout);
  if (!counts) {
    return {
      remote,
      branch,
      localCommit,
      remoteCommit,
      ahead: null,
      behind: null,
      status: "stale",
      error: null,
      detail: "Remote differs",
    };
  }
  const { ahead, behind } = counts;
  const status: PluginUpdateStatus =
    ahead === 0 && behind === 0
      ? "fresh"
      : behind > 0 && ahead === 0
        ? "stale"
        : ahead > 0 && behind === 0
          ? "ahead"
          : "diverged";
  return {
    remote,
    branch,
    localCommit,
    remoteCommit,
    ahead,
    behind,
    status,
    error: null,
    detail: detailFor(status, ahead, behind, null),
  };
}

function pinnedRemote(plugin: PaseoPluginInfo): string | null {
  const remote = plugin.remote?.trim();
  return remote ? remote : null;
}

function pinnedRef(plugin: PaseoPluginInfo): string | null {
  const ref = plugin.ref?.trim();
  return ref ? ref : null;
}

async function probeGroup(plugins: PaseoPluginInfo[], runner: CommandRunner): Promise<PluginUpdate[]> {
  const [first, ...rest] = plugins;
  if (!first) return [];
  if (!first.path) {
    return plugins.map((plugin) => ({
      id: plugin.id,
      path: plugin.path,
      remote: pinnedRemote(plugin),
      branch: pinnedRef(plugin),
      localCommit: null,
      remoteCommit: null,
      ahead: null,
      behind: null,
      detail: null,
      sharedRepo: null,
      repoRoot: null,
      repoPlugins: null,
      status: "error" as const,
      error: "Installed plugin has no directory path",
    }));
  }
  const toplevel = (await resolveToplevel(first.path, runner)) ?? normalizeDir(first.path);
  for (const plugin of rest) {
    if (!plugin.path) continue;
    const siblingTop = (await resolveToplevel(plugin.path, runner)) ?? normalizeDir(plugin.path);
    if (siblingTop !== toplevel) {
      return (await Promise.all(plugins.map((single) => probeGroup([single], runner)))).flat();
    }
  }
  const remoteOverride = pinnedRemote(first) ?? rest.map(pinnedRemote).find(Boolean) ?? null;
  const refOverride = pinnedRef(first) ?? rest.map(pinnedRef).find(Boolean) ?? null;
  const probe = await probeRoot(toplevel, remoteOverride, refOverride, runner);
  const ids = plugins.map((plugin) => plugin.id);
  return plugins.map((plugin) => {
    const sharedRepo = detectSharedRepo(plugin.path, toplevel);
    const suffix = sharedSuffix(sharedRepo);
    const detail =
      probe.detail != null && sharedRepo && !probe.detail.includes("shared repo")
        ? `${probe.detail}${suffix}`
        : probe.detail;
    return {
      id: plugin.id,
      path: plugin.path,
      remote: probe.remote,
      branch: probe.branch,
      localCommit: probe.localCommit,
      remoteCommit: probe.remoteCommit,
      ahead: probe.ahead,
      behind: probe.behind,
      detail,
      sharedRepo,
      repoRoot: toplevel,
      repoPlugins: ids.length > 1 ? ids : null,
      source: plugin.source ?? null,
      status: probe.status,
      error: probe.error,
    };
  });
}

async function probePlugin(
  plugin: PaseoPluginInfo,
  runner: CommandRunner = runCommand,
): Promise<PluginUpdate> {
  const rows = await probeGroup([plugin], runner);
  return rows[0]!;
}

export async function checkInstalledPlugins(
  _workspaceId?: string,
  runner: CommandRunner = runCommand,
  installedOverride?: PaseoPluginInfo[],
): Promise<{ checkedAt: string; plugins: PluginUpdate[] }> {
  try {
    const installed = installedOverride ?? (await listPlugins({ forceRefresh: true }));
    const toplevels = await Promise.all(
      installed.map(async (plugin) =>
        plugin.path ? ((await resolveToplevel(plugin.path, runner)) ?? normalizeDir(plugin.path)) : "",
      ),
    );
    const groups = new Map<string, PaseoPluginInfo[]>();
    installed.forEach((plugin, index) => {
      const key = toplevels[index] ?? "";
      const group = groups.get(key);
      if (group) group.push(plugin);
      else groups.set(key, [plugin]);
    });
    const grouped = await Promise.all([...groups.values()].map((group) => probeGroup(group, runner)));
    return { checkedAt: new Date().toISOString(), plugins: grouped.flat() };
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
          ahead: null,
          behind: null,
          detail: null,
          sharedRepo: null,
          repoRoot: null,
          repoPlugins: null,
          source: null,
          status: "error",
          error: `Unable to list installed plugins: ${errorOf(error)}`,
        },
      ],
    };
  }
}

async function invokeUpdate(
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

export async function updatePlugin(
  pluginId: string,
  _workspaceId?: string,
  runner: CommandRunner = runCommand,
): Promise<PluginUpdateActionResult> {
  try {
    const installed = await listPlugins({ forceRefresh: true });
    const info = installed.find((plugin) => plugin.id === pluginId);
    if (!info) {
      return {
        pluginId,
        status: "error",
        output: null,
        error: `Plugin '${pluginId}' is not installed`,
      };
    }
    if (info.source != null && info.source !== "git") {
      return {
        pluginId,
        status: "error",
        output: null,
        error: `Plugin '${pluginId}' is a directory install, not managed by Git — update it via the workspace checkout`,
      };
    }
  } catch (error) {
    return { pluginId, status: "error", output: null, error: `Unable to verify plugin: ${errorOf(error)}` };
  }
  return { pluginId, ...(await invokeUpdate([pluginId], runner)) };
}

export async function updateAllPlugins(
  _workspaceId?: string,
  runner: CommandRunner = runCommand,
): Promise<{ results: PluginUpdateActionResult[] }> {
  let installed: PaseoPluginInfo[];
  try {
    installed = await listPlugins({ forceRefresh: true });
  } catch (error) {
    return {
      results: [
        {
          pluginId: "all",
          status: "error",
          output: null,
          error: `Unable to list installed plugins: ${errorOf(error)}`,
        },
      ],
    };
  }
  const result = await invokeUpdate(["--all"], runner);
  return {
    results: installed.map((plugin) => ({
      pluginId: plugin.id,
      ...result,
    })),
  };
}

export const testing = { probePlugin, probeGroup, checkInstalledPlugins };
