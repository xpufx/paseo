import test from "node:test";
import assert from "node:assert/strict";
import {
  HookStatusOutputSchema,
  HookQueuesOutputSchema,
  HookPauseInputSchema,
  HookPauseOutputSchema,
  HookResumeInputSchema,
  HookResumeOutputSchema,
  HookDrainInputSchema,
  HookDrainOutputSchema,
} from "./hook-queue.js";

test("HookStatusOutputSchema validation", async (t) => {
  await t.test("validates complete status output", () => {
    const raw = {
      ok: true,
      service: "forgejo-hook",
      version: 1,
      uptime: 120,
      frontDesk: {
        version: 1,
        agentId: "agent-123",
        updatedAt: "2026-09-18T12:00:00.000Z",
      },
      paused: ["repo-1"],
      totalQueued: 5,
      repoCount: 3,
    };
    const parsed = HookStatusOutputSchema.parse(raw);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.service, "forgejo-hook");
    assert.equal(parsed.frontDesk?.agentId, "agent-123");
    assert.equal(parsed.totalQueued, 5);
  });

  await t.test("handles minimal status output with defaults", () => {
    const parsed = HookStatusOutputSchema.parse({ ok: false, error: "offline" });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "offline");
    assert.deepEqual(parsed.paused, []);
    assert.equal(parsed.totalQueued, 0);
  });
});

test("HookQueuesOutputSchema validation", async (t) => {
  await t.test("validates per-repo queues", () => {
    const raw = {
      ok: true,
      service: "forgejo-hook",
      queues: [
        {
          key: "forge.mrs.uppidi.com/xpufx-org/paseo",
          depth: 2,
          dropped: 0,
          paused: false,
          isBusy: true,
          busyAttempts: 1,
          orchestrator: { agentId: "orch-1" },
          messages: [
            { id: "m1", ts: 1789738000000, preview: "Issue 123" }
          ],
        },
      ],
    };
    const parsed = HookQueuesOutputSchema.parse(raw);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.queues.length, 1);
    assert.equal(parsed.queues[0].depth, 2);
    assert.equal(parsed.queues[0].isBusy, true);
    assert.equal(parsed.queues[0].orchestrator?.agentId, "orch-1");
    assert.equal(parsed.queues[0].messages[0].preview, "Issue 123");
  });
});

test("HookPause/Resume/Drain Schemas", async (t) => {
  await t.test("parses pause input & output", () => {
    const input = HookPauseInputSchema.parse({ repo: "test-repo" });
    assert.equal(input.repo, "test-repo");
    const output = HookPauseOutputSchema.parse({ ok: true, paused: "test-repo", allPaused: ["test-repo"] });
    assert.equal(output.ok, true);
    assert.deepEqual(output.allPaused, ["test-repo"]);
  });

  await t.test("parses resume input & output", () => {
    const output = HookResumeOutputSchema.parse({ ok: true, resumed: "all", allPaused: [] });
    assert.equal(output.ok, true);
    assert.deepEqual(output.allPaused, []);
  });

  await t.test("parses drain input & output", () => {
    const output = HookDrainOutputSchema.parse({ ok: true, draining: "repo-1" });
    assert.equal(output.ok, true);
    assert.equal(output.draining, "repo-1");
  });
});
