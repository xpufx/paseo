import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

import {
  handleFleetResetState,
  setExecFileAsyncForTest,
} from "./agents.js";
import {
  startHookRouter,
  getActiveHookRouter,
} from "./hook-router.js";

describe("fleet reset state handler (#764)", { concurrency: false }, () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-reset-test-"));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    setExecFileAsyncForTest(null);
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
  });

  it("purges stale cache, board-state, and queue files from disk", async () => {
    // 1. Setup mock ~/.cache
    const cacheDir = path.join(tmpHome, ".cache");
    const issuesDir = path.join(cacheDir, "forgejo-issues");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "forgejo-board-state-repo1.json"), JSON.stringify({ issues: [] }));
    fs.writeFileSync(path.join(cacheDir, "forgejo-board-state-repo2.json"), JSON.stringify({ issues: [] }));
    fs.writeFileSync(path.join(cacheDir, "other-unrelated.json"), "{}");
    fs.writeFileSync(path.join(issuesDir, "issue-1.json"), JSON.stringify({ id: 1 }));
    fs.writeFileSync(path.join(issuesDir, "issue-2.json"), JSON.stringify({ id: 2 }));

    // 2. Setup mock plugin-data board-state and queues
    const pluginDataDir = path.join(tmpHome, ".paseo", "plugin-data", "xpufx", "uppidi-fleet");
    const boardStateDir = path.join(pluginDataDir, "board-state");
    const queueDir = path.join(pluginDataDir, "queues");
    fs.mkdirSync(boardStateDir, { recursive: true });
    fs.mkdirSync(queueDir, { recursive: true });

    fs.writeFileSync(path.join(boardStateDir, "xpufx-org__paseo.json"), JSON.stringify({ lastCheck: 1 }));
    fs.writeFileSync(path.join(boardStateDir, "xpufx-org__platform.json"), JSON.stringify({ lastCheck: 2 }));
    fs.writeFileSync(path.join(queueDir, "queue-repo1.json"), JSON.stringify([{ id: "q1" }]));
    fs.writeFileSync(path.join(queueDir, "queue-repo2.json"), JSON.stringify([{ id: "q2" }]));
    fs.writeFileSync(path.join(queueDir, "queue-repo3.json"), JSON.stringify([{ id: "q3" }]));

    // 3. Setup registered orchestrator
    const orchDir = path.join(pluginDataDir, "orchestrators");
    fs.mkdirSync(orchDir, { recursive: true });
    fs.writeFileSync(
      path.join(orchDir, "xpufx-org__paseo.json"),
      JSON.stringify({ agentId: "agent-orch-42", repo: "xpufx-org/paseo" })
    );

    const execCommands: Array<{ file: string; args: readonly string[] }> = [];
    setExecFileAsyncForTest(async (file, args) => {
      execCommands.push({ file, args });
      return { stdout: "ok" };
    });

    const mockContext: any = {
      paseo: {
        agents: {
          list: async () => [],
        },
      },
    };

    const res = await handleFleetResetState(
      { confirm: true, notifyOrchestrators: true },
      mockContext
    );

    assert.equal(res.ok, true);
    assert.equal(res.cleared.cacheFiles, 4); // 2 board-state + 2 issues
    assert.equal(res.cleared.boardStateFiles, 2);
    assert.equal(res.cleared.queueFiles, 3);
    assert.equal(res.notifiedOrchestrators, 1);
    assert.equal(res.errors.length, 0);

    // Verify unrelated cache file was not touched
    assert.ok(fs.existsSync(path.join(cacheDir, "other-unrelated.json")));

    // Verify target files are deleted
    assert.ok(!fs.existsSync(path.join(cacheDir, "forgejo-board-state-repo1.json")));
    assert.ok(!fs.existsSync(path.join(issuesDir, "issue-1.json")));
    assert.ok(!fs.existsSync(path.join(boardStateDir, "xpufx-org__paseo.json")));
    assert.ok(!fs.existsSync(path.join(queueDir, "queue-repo1.json")));

    // Verify reset notification was dispatched to orchestrator
    const steerCmd = execCommands.find((c) => c.args.includes("send"));
    assert.ok(steerCmd, "send command dispatched");
    assert.equal(steerCmd.file, "paseo");
    assert.deepEqual(steerCmd.args.slice(0, 3), ["send", "--no-wait", "agent-orch-42"]);
    assert.ok(steerCmd.args[3].includes("Fleet state reset"));
  });

  it("skips orchestrator notification when notifyOrchestrators is false", async () => {
    const pluginDataDir = path.join(tmpHome, ".paseo", "plugin-data", "xpufx", "uppidi-fleet");
    const orchDir = path.join(pluginDataDir, "orchestrators");
    fs.mkdirSync(orchDir, { recursive: true });
    fs.writeFileSync(
      path.join(orchDir, "test.json"),
      JSON.stringify({ agentId: "agent-orch-99", repo: "test/repo" })
    );

    const execCommands: any[] = [];
    setExecFileAsyncForTest(async (file, args) => {
      execCommands.push({ file, args });
      return { stdout: "ok" };
    });

    const mockContext: any = {
      paseo: {
        agents: {
          list: async () => [],
        },
      },
    };

    const res = await handleFleetResetState(
      { confirm: true, notifyOrchestrators: false },
      mockContext
    );

    assert.equal(res.ok, true);
    assert.equal(res.notifiedOrchestrators, 0);
    assert.equal(execCommands.length, 0);
  });

  it("handles missing directories gracefully without erroring", async () => {
    setExecFileAsyncForTest(async () => ({ stdout: "[]" }));
    const mockContext: any = {
      paseo: {
        agents: {
          list: async () => [],
        },
      },
    };

    const res = await handleFleetResetState(
      { confirm: true, notifyOrchestrators: true },
      mockContext
    );

    assert.equal(res.ok, true);
    assert.equal(res.cleared.cacheFiles, 0);
    assert.equal(res.cleared.boardStateFiles, 0);
    assert.equal(res.cleared.queueFiles, 0);
    assert.equal(res.notifiedOrchestrators, 0);
    assert.equal(res.errors.length, 0);
  });
});
