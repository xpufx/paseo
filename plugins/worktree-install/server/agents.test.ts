import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { categorize, deriveState, inheritProjectFromParents, normalizeAgent, normalizeMetrics, resetWorkspaceProjectCache, workspaceProjectMap } from "./agents.js";
import { DEFAULT_PROJECT } from "../shared/derive.js";

/**
 * The roster projection. Everything here is pure so the daemon's messy,
 * partially-populated payloads can be pinned without a live daemon.
 */

describe("categorize", () => {
  it("routes names to the three fleet roles", () => {
    assert.equal(categorize("Fleet Front Desk"), "front-desk");
    assert.equal(categorize("frontdesk"), "front-desk");
    assert.equal(categorize("Repo Orchestrator"), "orchestrator");
    assert.equal(categorize("worker one"), "worker");
    assert.equal(categorize(""), "worker");
  });
});

describe("deriveState", () => {
  const none = new Set<string>();

  it("puts a pending permission first and names the action and scope", () => {
    const result = deriveState(
      { id: "a", status: "running", pendingPermissions: [{ id: "r", title: "write file", input: { path: "/srv/app" } }] },
      none,
    );
    assert.equal(result.state, "permission-prompt");
    assert.equal(result.detail, "write file (/srv/app)");
  });

  it("treats a permission attention reason as blocked even with no queue", () => {
    assert.equal(deriveState({ id: "a", status: "idle", attentionReason: "permission" }, none).state, "permission-prompt");
  });

  it("classifies errors by their message", () => {
    const cases: Array<[string, string]> = [
      ["rate limit reached", "failed:quota-exhausted"],
      ["connection refused", "failed:spawn"],
      ["execution timed out", "failed:timeout"],
      ["something exploded", "failed:error"],
    ];
    for (const [message, expected] of cases) {
      assert.equal(deriveState({ id: "a", status: "error", lastError: message }, none).state, expected, message);
    }
  });

  it("keeps an open quota alert in the cooldown lane rather than failing", () => {
    assert.equal(
      deriveState({ id: "a", status: "idle" }, new Set(["a"])).state,
      "idle:quota-exhausted",
    );
  });

  it("does not let a stale error string override a live agent", () => {
    assert.equal(deriveState({ id: "a", status: "running", lastError: "boom" }, none).state, "running");
    assert.equal(deriveState({ id: "a", status: "idle", lastError: "boom" }, none).state, "idle:waiting");
  });

  it("marks attributed running work as working, plain running as running", () => {
    assert.equal(
      deriveState({ id: "a", status: "running", labels: { "forgejo.issue": "629" } }, none).state,
      "working",
    );
    assert.equal(deriveState({ id: "a", status: "running" }, none).state, "running");
  });

  it("puts a non-error attention flag ahead of running", () => {
    assert.equal(
      deriveState({ id: "a", status: "running", requiresAttention: true, attentionReason: "input" }, none).state,
      "attention-required",
    );
  });

  it("puts a standby liaison or orchestrator to sleep after fifteen minutes", () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    assert.equal(deriveState({ id: "a", name: "Front Desk", status: "idle", lastActivityAt: stale }, none).state, "sleeping");
    assert.equal(deriveState({ id: "a", name: "worker", status: "idle", lastActivityAt: stale }, none).state, "idle:waiting");
  });

  it("falls back to unknown for an unrecognised status", () => {
    assert.equal(deriveState({ id: "a", status: "weird" }, none).state, "unknown");
  });
});

describe("normalizeMetrics", () => {
  it("returns null when the daemon sent no usage or turn signals", () => {
    assert.equal(normalizeMetrics({ id: "a" }), null);
  });

  it("projects usage, active turn, and attention timestamps", () => {
    const metrics = normalizeMetrics({
      id: "a",
      lastUsage: {
        inputTokens: 10,
        outputTokens: 20,
        cachedInputTokens: 30,
        totalCostUsd: 0.5,
        contextWindowUsedTokens: 40,
        contextWindowMaxTokens: 100,
      },
      activeTurn: { startedAt: "2026-01-01T00:00:00.000Z" },
      attentionTimestamp: "2026-01-01T00:01:00.000Z",
    });
    assert.deepEqual(metrics, {
      contextUsedTokens: 40,
      contextMaxTokens: 100,
      cachedTokens: 30,
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0.5,
      activeTurnStartedAt: "2026-01-01T00:00:00.000Z",
      attentionTimestamp: "2026-01-01T00:01:00.000Z",
    });
  });

  it("drops non-finite numbers rather than rendering NaN", () => {
    const metrics = normalizeMetrics({ id: "a", lastUsage: { inputTokens: Number.NaN, outputTokens: 5 } });
    assert.equal(metrics?.inputTokens, undefined);
    assert.equal(metrics?.outputTokens, 5);
  });
});

describe("normalizeAgent", () => {
  it("fills every field the inventory requires from a bare record", () => {
    const agent = normalizeAgent({ id: "0123456789abcdef" }, new Set(), {});
    assert.equal(agent.shortId, "0123456");
    assert.equal(agent.name, "Agent 0123456");
    assert.equal(agent.status, "idle");
    assert.equal(agent.deterministicState, "idle:waiting");
    assert.equal(agent.lifecycleState, "idle");
    assert.equal(agent.url, "paseo://agent/0123456789abcdef");
    assert.equal(agent.project, DEFAULT_PROJECT);
    assert.equal(agent.requiresAttention, false);
    assert.deepEqual(agent.pendingPermissions, []);
    assert.equal(agent.blockDetail, null);
  });

  it("resolves the workspace registry ahead of labels", () => {
    const agent = normalizeAgent(
      { id: "a", workspaceId: "w1", labels: { repo: "org/label-repo" } },
      new Set(),
      { w1: "org/map-repo" },
    );
    assert.equal(agent.project, "org/map-repo");
  });

  it("builds a block detail only when the agent is actually blocked", () => {
    const blocked = normalizeAgent(
      { id: "a", status: "idle", pendingPermissions: [{ id: "r1", tool: "bash", input: { cwd: "/srv" } }] },
      new Set(),
      {},
    );
    assert.equal(blocked.lifecycleState, "waiting_for_input");
    assert.equal(blocked.blockDetail?.command, "paseo permit allow a r1");
    assert.equal(blocked.blockDetail?.scope, "/srv");
    assert.equal(blocked.blockDetail?.action, "bash");
    assert.equal(blocked.requiresAttention, true);

    const healthy = normalizeAgent({ id: "b", status: "running" }, new Set(), {});
    assert.equal(healthy.blockDetail, null);
  });

  it("does not raise an attention flag for a benign finished agent", () => {
    const finished = normalizeAgent({ id: "a", status: "idle", requiresAttention: true, attentionReason: "finished" }, new Set(), {});
    assert.equal(finished.requiresAttention, false);
  });

  it("reads the parent from a label when the record has no explicit parent", () => {
    const agent = normalizeAgent({ id: "a", labels: { "paseo.parent-agent-id": "p1" } }, new Set(), {});
    assert.equal(agent.parentId, "p1");
  });
});

describe("inheritProjectFromParents", () => {
  it("propagates a resolved project down the whole subtree", () => {
    const agents = [
      normalizeAgent({ id: "o", name: "Repo Orchestrator", project: "org/repo" }, new Set(), {}),
      normalizeAgent({ id: "w", parentId: "o" }, new Set(), {}),
      normalizeAgent({ id: "g", parentId: "w" }, new Set(), {}),
    ];
    inheritProjectFromParents(agents);
    assert.equal(agents[1]!.project, "org/repo");
    assert.equal(agents[2]!.project, "org/repo");
  });

  it("leaves agents with no authoritative ancestor on the default", () => {
    const agents = [normalizeAgent({ id: "a" }, new Set(), {})];
    inheritProjectFromParents(agents);
    assert.equal(agents[0]!.project, DEFAULT_PROJECT);
  });
});

describe("workspaceProjectMap", () => {
  it("degrades to an empty map when the daemon registries are unreadable", () => {
    resetWorkspaceProjectCache();
    const map = workspaceProjectMap({ forceRefresh: true });
    assert.equal(typeof map, "object");
    resetWorkspaceProjectCache();
  });
});
