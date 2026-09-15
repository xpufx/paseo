import assert from "node:assert/strict";
import test from "node:test";
import type { PaseoPluginInfo, SafeSpawnResult } from "paseo-plugin-helper/server";
import { testing } from "./updates";

function result(stdout = "", code = 0, stderr = ""): SafeSpawnResult {
  return { stdout, stderr, code, signal: null, durationMs: 1 };
}

const LOCAL = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REMOTE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function plugin(id = "demo", pluginPath = "/plugins/demo"): PaseoPluginInfo {
  return { id, path: pluginPath, enabled: true, status: "running" };
}

type Runner = Parameters<typeof testing.probePlugin>[1];

interface Call {
  command: string;
  args: string[];
  timeoutMs: number;
  cwd?: string;
}

interface RunnerOptions {
  toplevel?: string | null | ((cwd?: string) => string | null);
  head?: string;
  currentBranch?: string;
  upstream?: string | null;
  remoteRef?: string;
  lsRemoteCode?: number;
  lsRemoteStderr?: string;
  lsRemoteThrows?: Error;
  statusPorcelain?: string;
  pullCode?: number;
  pullOutput?: string;
  pullStderr?: string;
  reloadCode?: number;
  paseoUpdateCode?: number;
  calls?: Call[];
}

function makeRunner(opts: RunnerOptions): Runner {
  return async (command, args, options) => {
    opts.calls?.push({ command, args, timeoutMs: options.timeoutMs, cwd: options.cwd });

    if (command === "paseo" && args[0] === "plugin" && args[1] === "reload") {
      return result("reloaded", opts.reloadCode ?? 0, opts.reloadCode ? "reload failed" : "");
    }
    if (command === "paseo" && args[0] === "plugin" && args[1] === "update") {
      return result("updated", opts.paseoUpdateCode ?? 0, opts.paseoUpdateCode ? "update failed" : "");
    }

    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      const top = typeof opts.toplevel === "function" ? opts.toplevel(options.cwd) : opts.toplevel;
      if (top === null) return result("", 128, "fatal: not a git repository");
      return result(`${top ?? "/plugins/demo"}\n`);
    }
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "--symbolic-full-name") {
      if (opts.upstream === null) return result("", 128, "fatal: no upstream configured for branch 'main'");
      return result(`${opts.upstream ?? "origin/main"}\n`);
    }
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
      return result(`${opts.currentBranch ?? "main"}\n`);
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") return result(`${opts.head ?? LOCAL}\n`);
    if (args[0] === "ls-remote") {
      if (opts.lsRemoteThrows) throw opts.lsRemoteThrows;
      if ((opts.lsRemoteCode ?? 0) !== 0) {
        return result("", opts.lsRemoteCode ?? 128, opts.lsRemoteStderr ?? "fatal: unable to access remote");
      }
      return result(`${opts.remoteRef ?? REMOTE}\trefs/heads/main`);
    }
    if (args[0] === "status") return result(opts.statusPorcelain ?? "");
    if (args[0] === "pull") {
      if ((opts.pullCode ?? 0) !== 0) {
        return result("", opts.pullCode ?? 1, opts.pullStderr ?? "fatal: not possible to fast-forward");
      }
      return result(opts.pullOutput ?? "Already up to date", 0);
    }
    return result("", 1, "unexpected command");
  };
}

test("reports not-a-repo when the toplevel cannot be resolved", async () => {
  const probe = await testing.probePlugin(plugin(), makeRunner({ toplevel: null }));

  assert.equal(probe.status, "not-a-repo");
  assert.equal(probe.error, null);
  assert.match(probe.detail ?? "", /not a git repository/i);
});

test("reports unpinned on detached HEAD and never probes a remote", async () => {
  const calls: Call[] = [];
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({ toplevel: "/plugins/demo", currentBranch: "HEAD", calls }),
  );

  assert.equal(probe.status, "unpinned");
  assert.equal(calls.some((call) => call.args[0] === "ls-remote"), false);
});

test("reports no-upstream and stays report-only", async () => {
  const calls: Call[] = [];
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({ toplevel: "/plugins/demo", upstream: null, calls }),
  );

  assert.equal(probe.status, "no-upstream");
  assert.equal(probe.branch, "main");
  assert.equal(calls.some((call) => call.args[0] === "ls-remote"), false);
});

test("compares ls-remote to local HEAD as a boolean without fetching", async () => {
  const calls: Call[] = [];
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({ toplevel: "/plugins/demo", head: LOCAL, remoteRef: LOCAL, calls }),
  );

  assert.equal(probe.status, "current");
  assert.equal(probe.localCommit, LOCAL);
  assert.equal(probe.remoteCommit, LOCAL);
  assert.match(probe.detail ?? "", /Up to date/);

  const lsRemote = calls.find((call) => call.args[0] === "ls-remote");
  assert.deepEqual(lsRemote?.args, ["ls-remote", "origin", "main"]);
  assert.equal(lsRemote?.timeoutMs, testing.PROBE_TIMEOUT_MS);
  assert.equal(calls.some((call) => call.args[0] === "fetch"), false);
  assert.equal(calls.some((call) => call.args[0] === "rev-list"), false);
});

test("reports behind when the remote tip differs from local HEAD", async () => {
  const calls: Call[] = [];
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({ toplevel: "/plugins/demo", head: LOCAL, remoteRef: REMOTE, calls }),
  );

  assert.equal(probe.status, "behind");
  assert.equal(probe.localCommit, LOCAL);
  assert.equal(probe.remoteCommit, REMOTE);
  assert.match(probe.detail ?? "", /update available/i);
  assert.equal(calls.some((call) => call.args[0] === "rev-list"), false);
});

test("honors a pinned install remote and ref for git-source plugins", async () => {
  const calls: Call[] = [];
  const pinned: PaseoPluginInfo = {
    id: "thirdparty",
    path: "/plugins/thirdparty",
    enabled: true,
    status: "running",
    source: "git",
    remote: "https://example.test/thirdparty.git",
    ref: "release",
  };
  const probe = await testing.probePlugin(
    pinned,
    makeRunner({ toplevel: "/plugins/thirdparty", head: LOCAL, remoteRef: REMOTE, calls }),
  );

  assert.equal(probe.status, "behind");
  assert.equal(probe.remote, "https://example.test/thirdparty.git");
  assert.equal(probe.branch, "release");
  const lsRemote = calls.find((call) => call.args[0] === "ls-remote");
  assert.deepEqual(lsRemote?.args, [
    "ls-remote",
    "https://example.test/thirdparty.git",
    "release",
  ]);
});

test("surfaces git ls-remote failures instead of treating them as current", async () => {
  const probe = await testing.probePlugin(
    plugin("broken", "/plugins/broken"),
    makeRunner({
      toplevel: "/plugins/broken",
      lsRemoteCode: 128,
      lsRemoteStderr: "fatal: unable to access remote",
    }),
  );

  assert.equal(probe.status, "error");
  assert.match(probe.error ?? "", /unable to access remote/);
});

test("surfaces a ls-remote timeout as an error rather than hanging", async () => {
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({
      toplevel: "/plugins/demo",
      lsRemoteThrows: new Error(`Command 'git' timed out after ${testing.PROBE_TIMEOUT_MS}ms`),
    }),
  );

  assert.equal(probe.status, "error");
  assert.match(probe.error ?? "", /timed out/);
});

test("probes a shared repo root once and fans out grouped rows", async () => {
  const calls: Call[] = [];
  const runner = makeRunner({
    toplevel: () => "/repo",
    head: LOCAL,
    remoteRef: REMOTE,
    calls,
  });
  const checked = await testing.checkInstalledPlugins(
    undefined,
    runner,
    [plugin("demo", "/repo/plugins/demo"), plugin("slash", "/repo/plugins/slash")],
    { scanOrphans: false },
  );

  assert.equal(checked.plugins.length, 2);
  assert.equal(calls.filter((call) => call.args[0] === "ls-remote").length, 1);
  for (const row of checked.plugins) {
    assert.equal(row.status, "behind");
    assert.equal(row.repoRoot, "/repo");
    assert.deepEqual(row.repoPlugins, ["demo", "slash"]);
    assert.equal(row.sharedRepo, true);
  }
});

test("refuses to pull a dirty tree and surfaces the refusal", async () => {
  const calls: Call[] = [];
  const runner = makeRunner({
    toplevel: "/plugins/demo",
    statusPorcelain: " M server/updates.ts",
    calls,
  });
  const action = await testing.updatePlugin("demo", undefined, {
    runner,
    installedOverride: [plugin()],
  });

  assert.equal(action.status, "error");
  assert.equal(action.requiresForce, true);
  assert.match(action.error ?? "", /dirty/i);
  assert.equal(calls.some((call) => call.args[0] === "pull"), false);
  assert.equal(calls.some((call) => call.command === "paseo"), false);
});

test("force pulls a dirty tree then reloads every plugin sharing the root", async () => {
  const calls: Call[] = [];
  const runner = makeRunner({
    toplevel: () => "/repo",
    statusPorcelain: " M server/updates.ts",
    pullOutput: "Updating aaaaaaa..bbbbbbb",
    calls,
  });
  const action = await testing.updatePlugin("demo", undefined, {
    runner,
    force: true,
    installedOverride: [plugin("demo", "/repo/plugins/demo"), plugin("slash", "/repo/plugins/slash")],
  });

  assert.equal(action.status, "updated");
  const pull = calls.find((call) => call.args[0] === "pull");
  assert.deepEqual(pull?.args, ["pull", "--ff-only"]);
  assert.equal(pull?.timeoutMs, testing.UPDATE_TIMEOUT_MS);
  const reloads = calls.filter((call) => call.command === "paseo" && call.args[1] === "reload");
  assert.deepEqual(reloads.map((call) => call.args[2]).sort(), ["demo", "slash"]);
});

test("pulls a clean tree with the update timeout and reloads the plugin", async () => {
  const calls: Call[] = [];
  const runner = makeRunner({ toplevel: "/plugins/demo", statusPorcelain: "", calls });
  const action = await testing.updatePlugin("demo", undefined, {
    runner,
    installedOverride: [plugin()],
  });

  assert.equal(action.status, "updated");
  const pull = calls.find((call) => call.args[0] === "pull");
  assert.equal(pull?.timeoutMs, testing.UPDATE_TIMEOUT_MS);
  const reload = calls.find((call) => call.command === "paseo");
  assert.deepEqual(reload?.args, ["plugin", "reload", "demo"]);
});

test("routes git-managed installs through paseo plugin update", async () => {
  const calls: Call[] = [];
  const runner = makeRunner({ toplevel: "/plugins/gitty", calls });
  const action = await testing.updatePlugin("gitty", undefined, {
    runner,
    installedOverride: [
      { id: "gitty", path: "/plugins/gitty", enabled: true, status: "running", source: "git" },
    ],
  });

  assert.equal(action.status, "updated");
  const update = calls.find((call) => call.command === "paseo");
  assert.deepEqual(update?.args, ["plugin", "update", "gitty"]);
  assert.equal(calls.some((call) => call.args[0] === "pull"), false);
});

test("flags leftover managed directories instead of probing them", async () => {
  const checked = await testing.checkInstalledPlugins(
    undefined,
    makeRunner({ toplevel: () => "/repo" }),
    [plugin("demo", "/repo/plugins/demo")],
    {
      scanOrphans: true,
      pluginsRoot: "/managed",
      readDir: async () => [
        { name: "history", isDirectory: () => true },
        { name: ".staging", isDirectory: () => true },
        { name: "sources.json", isDirectory: () => false },
      ],
    },
  );

  const orphaned = checked.plugins.filter((row) => row.status === "orphaned");
  assert.deepEqual(orphaned.map((row) => row.id), ["orphaned:history"]);
  assert.equal(orphaned[0]?.path, "/managed/history");
});

test("does not flag a managed directory that holds a live install", async () => {
  const rows = await testing.scanOrphanedDirs([plugin("live", "/managed/live")], {
    pluginsRoot: "/managed",
    readDir: async () => [{ name: "live", isDirectory: () => true }],
  });

  assert.deepEqual(rows, []);
});
