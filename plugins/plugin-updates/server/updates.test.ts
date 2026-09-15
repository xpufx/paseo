import assert from "node:assert/strict";
import test from "node:test";
import type { PaseoPluginInfo, SafeSpawnResult } from "paseo-plugin-helper/server";
import { testing } from "./updates";

function result(stdout = "", code = 0, stderr = ""): SafeSpawnResult {
  return { stdout, stderr, code, signal: null, durationMs: 1 };
}

test("probes the origin branch with git ls-remote and reports stale", async () => {
  const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  const plugin: PaseoPluginInfo = {
    id: "demo",
    path: "/plugins/demo",
    enabled: true,
    status: "running",
  };
  const probe = await testing.probePlugin(plugin, async (command, args, options) => {
    calls.push({ command, args, timeoutMs: options.timeoutMs });
    if (args[0] === "rev-parse" && args[1] === "--git-dir") return result(".git");
    if (args[0] === "remote") return result("https://example.test/demo.git");
    if (args[0] === "symbolic-ref") return result("main");
    if (args[0] === "rev-parse") return result("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    if (args[0] === "ls-remote") {
      return result("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/heads/main");
    }
    return result("", 1, "unexpected command");
  });

  assert.equal(probe.status, "stale");
  assert.equal(probe.branch, "main");
  assert.equal(probe.remoteCommit, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(calls.at(-1)?.args[0], "ls-remote");
  assert.equal(calls.at(-1)?.timeoutMs, 10_000);
});

test("surfaces git ls-remote failures instead of treating them as fresh", async () => {
  const plugin: PaseoPluginInfo = {
    id: "broken",
    path: "/plugins/broken",
    enabled: true,
    status: "failed",
  };
  const probe = await testing.probePlugin(plugin, async (_command, args) => {
    if (args[0] === "rev-parse" && args[1] === "--git-dir") return result(".git");
    if (args[0] === "remote") return result("https://example.test/broken.git");
    if (args[0] === "symbolic-ref") return result("main");
    if (args[0] === "rev-parse") return result("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    return result("", 128, "fatal: unable to access remote");
  });

  assert.equal(probe.status, "error");
  assert.match(probe.error ?? "", /unable to access remote/);
});
