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

async function probePlugin(
  plugin: PaseoPluginInfo,
  runner: CommandRunner = runCommand,
): Promise<PluginUpdate> {
  const base = {
    id: plugin.id,
    path: plugin.path,
    remote: null as string | null,
    branch: null as string | null,
    localCommit: null as string | null,
    remoteCommit: null as string | null,
    ahead: null as number | null,
    behind: null as number | null,
    detail: null as string | null,
    sharedRepo: null as boolean | null,
  };
  if (!plugin.path) {
    return { ...base, status: "error", error: "Installed plugin has no directory path" };
  }

  try {
    const gitCheck = await runner("git", ["rev-parse", "--git-dir"], {
      cwd: plugin.path,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (gitCheck.code !== 0) {
      return { ...base, status: "error", error: outputOf(gitCheck) || "Directory is not a git repository" };
    }

    const [remoteResult, branchResult, localResult, toplevelResult] = await Promise.all([
      runner("git", ["remote", "get-url", "origin"], { cwd: plugin.path, timeoutMs: PROBE_TIMEOUT_MS }),
      runner("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
        cwd: plugin.path,
        timeoutMs: PROBE_TIMEOUT_MS,
      }),
      runner("git", ["rev-parse", "HEAD"], { cwd: plugin.path, timeoutMs: PROBE_TIMEOUT_MS }),
      runner("git", ["rev-parse", "--show-toplevel"], { cwd: plugin.path, timeoutMs: PROBE_TIMEOUT_MS }),
    ]);
    if (remoteResult.code !== 0) {
      return {
        ...base,
        localCommit: localResult.code === 0 ? localResult.stdout.trim() : null,
        sharedRepo:
          toplevelResult.code === 0 ? detectSharedRepo(plugin.path, toplevelResult.stdout) : null,
        status: "error",
        error: outputOf(remoteResult) || "No origin remote configured",
      };
    }
    const remote = remoteResult.stdout.trim();
    const branch = branchResult.code === 0 ? branchResult.stdout.trim() : null;
    const localCommit = localResult.code === 0 ? localResult.stdout.trim() : null;
    const sharedRepo =
      toplevelResult.code === 0 ? detectSharedRepo(plugin.path, toplevelResult.stdout) : null;
    const remoteArgs = branch
      ? ["ls-remote", "--heads", remote, branch]
      : ["ls-remote", remote, "HEAD"];
    const remoteResultProbe = await runner("git", remoteArgs, {
      cwd: plugin.path,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (remoteResultProbe.code !== 0) {
      return {
        ...base,
        remote,
        branch,
        localCommit,
        sharedRepo,
        status: "error",
        error: outputOf(remoteResultProbe) || "git ls-remote failed",
      };
    }
    const remoteCommit = parseRef(remoteResultProbe.stdout);
    if (!remoteCommit) {
      return {
        ...base,
        remote,
        branch,
        localCommit,
        sharedRepo,
        status: "error",
        error: "git ls-remote returned no commit for the current branch",
      };
    }
    if (!localCommit) {
      return {
        ...base,
        remote,
        branch,
        localCommit,
        remoteCommit,
        sharedRepo,
        status: "error",
        error: "Unable to determine local commit",
      };
    }
    if (localCommit === remoteCommit) {
      return {
        ...base,
        remote,
        branch,
        localCommit,
        remoteCommit,
        ahead: 0,
        behind: 0,
        sharedRepo,
        detail: detailFor("fresh", 0, 0, sharedRepo),
        status: "fresh",
        error: null,
      };
    }
    const countsResult = await runner(
      "git",
      ["rev-list", "--left-right", "--count", `${localCommit}...${remoteCommit}`],
      { cwd: plugin.path, timeoutMs: PROBE_TIMEOUT_MS },
    );
    if (countsResult.code !== 0) {
      const detail = `Remote differs; relationship unknown (remote commit not present locally)${sharedSuffix(sharedRepo)}`;
      return {
        ...base,
        remote,
        branch,
        localCommit,
        remoteCommit,
        sharedRepo,
        detail,
        status: "stale",
        error: null,
      };
    }
    const counts = parseAheadBehind(countsResult.stdout);
    if (!counts) {
      return {
        ...base,
        remote,
        branch,
        localCommit,
        remoteCommit,
        sharedRepo,
        detail: `Remote differs${sharedSuffix(sharedRepo)}`,
        status: "stale",
        error: null,
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
      ...base,
      remote,
      branch,
      localCommit,
      remoteCommit,
      ahead,
      behind,
      sharedRepo,
      detail: detailFor(status, ahead, behind, sharedRepo),
      status,
      error: null,
    };
  } catch (error) {
    return { ...base, status: "error", error: errorOf(error) };
  }
}

export async function checkInstalledPlugins(
  _workspaceId?: string,
  runner: CommandRunner = runCommand,
): Promise<{ checkedAt: string; plugins: PluginUpdate[] }> {
  try {
    const installed = await listPlugins({ forceRefresh: true });
    const plugins = await Promise.all(installed.map((plugin) => probePlugin(plugin, runner)));
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
          ahead: null,
          behind: null,
          detail: null,
          sharedRepo: null,
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
    if (!installed.some((plugin) => plugin.id === pluginId)) {
      return {
        pluginId,
        status: "error",
        output: null,
        error: `Plugin '${pluginId}' is not installed`,
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

export const testing = { probePlugin };
