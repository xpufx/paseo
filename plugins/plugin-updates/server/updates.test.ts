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

function makeRunner(opts: {
  toplevel?: string;
  revList?: string;
  revListCode?: number;
  local?: string;
  remoteRef?: string;
  lsRemoteCode?: number;
  lsRemoteStderr?: string;
  calls?: Array<{ command: string; args: string[]; timeoutMs: number }>;
}): Runner {
  return async (command, args, options) => {
    opts.calls?.push({ command, args, timeoutMs: options.timeoutMs });
    if (args[0] === "rev-parse" && args[1] === "--git-dir") return result(".git");
    if (args[0] === "remote") return result("https://example.test/demo.git");
    if (args[0] === "symbolic-ref") return result("main");
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return result(opts.toplevel ?? "/plugins/demo");
    }
    if (args[0] === "rev-parse") return result(opts.local ?? LOCAL);
    if (args[0] === "rev-list") {
      if ((opts.revListCode ?? 0) !== 0) return result("", opts.revListCode ?? 128, "fatal: bad revision");
      return result(opts.revList ?? "0\t1");
    }
    if (args[0] === "ls-remote") {
      if ((opts.lsRemoteCode ?? 0) !== 0) return result("", opts.lsRemoteCode ?? 128, opts.lsRemoteStderr ?? "fatal: unable to access remote");
      return result(`${opts.remoteRef ?? REMOTE}\trefs/heads/main`);
    }
    return result("", 1, "unexpected command");
  };
}

test("reports stale only when behind (genuine remote update)", async () => {
  const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({ revList: "0\t1", calls }),
  );

  assert.equal(probe.status, "stale");
  assert.equal(probe.branch, "main");
  assert.equal(probe.remoteCommit, REMOTE);
  assert.equal(probe.ahead, 0);
  assert.equal(probe.behind, 1);
  assert.match(probe.detail ?? "", /Update available/);
  assert.match(probe.detail ?? "", /1 behind/);
  const revListCall = calls.find((call) => call.args[0] === "rev-list");
  assert.ok(revListCall, "expected git rev-list --left-right --count probe");
  assert.deepEqual(revListCall?.args.slice(0, 3), ["rev-list", "--left-right", "--count"]);
  assert.equal(revListCall?.timeoutMs, 10_000);
});

test("reports ahead (not stale) when local has unpushed commits", async () => {
  const probe = await testing.probePlugin(plugin(), makeRunner({ revList: "2\t0" }));

  assert.equal(probe.status, "ahead");
  assert.equal(probe.ahead, 2);
  assert.equal(probe.behind, 0);
  assert.match(probe.detail ?? "", /Local ahead/);
  assert.match(probe.detail ?? "", /2 unpushed|2 ahead/);
  assert.match(probe.detail ?? "", /no update available/i);
});

test("reports diverged when both ahead and behind", async () => {
  const probe = await testing.probePlugin(plugin(), makeRunner({ revList: "1\t2" }));

  assert.equal(probe.status, "diverged");
  assert.equal(probe.ahead, 1);
  assert.equal(probe.behind, 2);
  assert.match(probe.detail ?? "", /Diverged/);
  assert.match(probe.detail ?? "", /1 ahead/);
  assert.match(probe.detail ?? "", /2 behind/);
});

test("reports fresh with zero counts when commits match", async () => {
  const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  const probe = await testing.probePlugin(
    plugin(),
    makeRunner({ local: LOCAL, remoteRef: LOCAL, calls }),
  );

  assert.equal(probe.status, "fresh");
  assert.equal(probe.ahead, 0);
  assert.equal(probe.behind, 0);
  assert.match(probe.detail ?? "", /Up to date/);
  assert.equal(
    calls.some((call) => call.args[0] === "rev-list"),
    false,
  );
});

test("flags shared-repo subdirectories such as plugins/demo in the monorepo", async () => {
  const probe = await testing.probePlugin(
    plugin("demo", "/repo/plugins/demo"),
    makeRunner({ toplevel: "/repo", revList: "3\t0" }),
  );

  assert.equal(probe.status, "ahead");
  assert.equal(probe.sharedRepo, true);
  assert.match(probe.detail ?? "", /shared repo/i);
});

test("flags standalone repos as not shared", async () => {
  const probe = await testing.probePlugin(
    plugin("demo", "/plugins/demo"),
    makeRunner({ toplevel: "/plugins/demo", revList: "0\t1" }),
  );

  assert.equal(probe.status, "stale");
  assert.equal(probe.sharedRepo, false);
});

test("falls back to stale when rev-list cannot resolve the remote commit", async () => {
  const probe = await testing.probePlugin(plugin(), makeRunner({ revListCode: 128 }));

  assert.equal(probe.status, "stale");
  assert.equal(probe.ahead, null);
  assert.equal(probe.behind, null);
  assert.match(probe.detail ?? "", /relationship unknown/i);
});

test("surfaces git ls-remote failures instead of treating them as fresh", async () => {
  const broken: PaseoPluginInfo = {
    id: "broken",
    path: "/plugins/broken",
    enabled: true,
    status: "failed",
  };
  const probe = await testing.probePlugin(
    broken,
    makeRunner({ lsRemoteCode: 128, lsRemoteStderr: "fatal: unable to access remote" }),
  );

  assert.equal(probe.status, "error");
  assert.match(probe.error ?? "", /unable to access remote/);
});
