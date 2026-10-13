/**
 * agent-health.test.ts — Unit tests for the deterministic health-canary taxonomy
 * and dead-predicate verdicts ported from platform `scripts/agent-health-check`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectTurnConcurrencyLock,
  detectCancellationTimeout,
  detectPendingPermissionBlocked,
  detectIdlePostErrorAmnesia,
  detectZombieHungTurn,
  detectStaleErrorGhosting,
  detectProviderQuotaExhaustion,
  detectDeadOrphanedDiskRecord,
  detectDeadTerminalFatalError,
  detectDeadWedgedRunningTurn,
  detectDeadRegistryWithoutProcess,
  detectDeadSupersededByRetry,
  extractTaskName,
  matchTaskName,
  getAgentScope,
  matchAgentScope,
  findSuccessorRetry,
  normalizeAgentCwd,
  getAgentCreatedAtMs,
  killGuardReasons,
  planRecovery,
  planPrune,
} from "./agent-health.js";
import type { AgentCandidate } from "./agent-health.js";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15T12:00:00Z

describe("agent-health taxonomy rules", () => {
  describe("TURN_CONCURRENCY_LOCK", () => {
    it("fires only for errored lifecycles with turn-concurrency markers", () => {
      assert.equal(detectTurnConcurrencyLock("error", "foreground turn is already active"), true);
      assert.equal(detectTurnConcurrencyLock("error", "a turn is already active"), true);
      assert.equal(detectTurnConcurrencyLock("error", "concurrent turn detected"), true);
      assert.equal(detectTurnConcurrencyLock("error", "turn concurrency failure"), true);
      assert.equal(detectTurnConcurrencyLock("idle", "foreground turn is already active"), false);
      assert.equal(detectTurnConcurrencyLock("running", "foreground turn is already active"), false);
      assert.equal(detectTurnConcurrencyLock("error", "spawn ENOENT"), false);
    });
  });

  describe("TURN_CANCELLATION_TIMEOUT", () => {
    it("fires when a cancellation is recent and the agent hasn't recovered", () => {
      const cancellations = new Map([["agent-1", NOW - 60_000]]);
      assert.equal(detectCancellationTimeout("agent-1", cancellations, "idle", NOW, 86400), true);
      assert.equal(detectCancellationTimeout("agent-1", cancellations, "error", NOW, 86400), true);
    });

    it("suppresses when status is running or cancellation is too old", () => {
      const cancellations = new Map([["agent-1", NOW - 60_000]]);
      assert.equal(detectCancellationTimeout("agent-1", cancellations, "running", NOW, 86400), false);
      assert.equal(detectCancellationTimeout("agent-1", cancellations, "idle", NOW, 30), false);
    });

    it("suppresses when activity occurred after cancellation (recovered)", () => {
      const cancellations = new Map([["agent-1", NOW - 120_000]]);
      assert.equal(
        detectCancellationTimeout("agent-1", cancellations, "idle", NOW, 86400, "", NOW - 30_000),
        false,
      );
    });

    it("suppresses when handled marker matches or exceeds cancellation", () => {
      const cancellations = new Map([["agent-1", NOW - 120_000]]);
      assert.equal(
        detectCancellationTimeout("agent-1", cancellations, "idle", NOW, 86400, "", null, NOW - 60_000),
        false,
      );
    });
  });

  describe("PENDING_PERMISSION_BLOCKED", () => {
    it("fires when there are pending permissions", () => {
      assert.equal(detectPendingPermissionBlocked([{ id: "p1" }]), true);
      assert.equal(detectPendingPermissionBlocked([]), false);
      assert.equal(detectPendingPermissionBlocked(null), false);
      assert.equal(detectPendingPermissionBlocked(undefined), false);
    });
  });

  describe("IDLE_POST_ERROR_AMNESIA", () => {
    it("fires for idle agents with stalled attention and no workers", () => {
      assert.equal(detectIdlePostErrorAmnesia("idle", "boom", false, null, 0), true);
      assert.equal(detectIdlePostErrorAmnesia("idle", "", true, "stalled", 0), true);
      assert.equal(detectIdlePostErrorAmnesia("idle", "", true, "interrupted", 0), true);
      assert.equal(detectIdlePostErrorAmnesia("idle", "", true, "failed", 0), true);
    });

    it("does not fire for normal completion or when workers exist", () => {
      assert.equal(detectIdlePostErrorAmnesia("idle", "", true, "finished", 0), false);
      assert.equal(detectIdlePostErrorAmnesia("idle", "boom", false, null, 2), false);
      assert.equal(detectIdlePostErrorAmnesia("running", "boom", false, null, 0), false);
    });

    it("supports assumePendingWork opt-in", () => {
      assert.equal(detectIdlePostErrorAmnesia("idle", "", true, "finished", 0, true), true);
    });
  });

  describe("ZOMBIE_HUNG_TURN", () => {
    it("fires for running agents past the stale window", () => {
      const stale = new Date(NOW - 1900 * 1000).toISOString();
      const fresh = new Date(NOW - 60 * 1000).toISOString();
      assert.equal(detectZombieHungTurn("running", stale, NOW, 1800), true);
      assert.equal(detectZombieHungTurn("running", fresh, NOW, 1800), false);
      assert.equal(detectZombieHungTurn("idle", stale, NOW, 1800), false);
      assert.equal(detectZombieHungTurn("running", null, NOW, 1800), false);
    });
  });

  describe("STALE_ERROR_GHOSTING", () => {
    it("fires for healthy/idle lifecycles carrying lastError", () => {
      assert.equal(detectStaleErrorGhosting("idle", "boom"), true);
      assert.equal(detectStaleErrorGhosting("running", "boom"), true);
      assert.equal(detectStaleErrorGhosting("idle", "   "), false);
      assert.equal(detectStaleErrorGhosting("error", "boom"), false);
    });
  });

  describe("PROVIDER_QUOTA_EXHAUSTION", () => {
    it("fires for fatal provider/quota errors but not transients", () => {
      assert.equal(detectProviderQuotaExhaustion("You've hit your usage limit"), true);
      assert.equal(detectProviderQuotaExhaustion("Rate limit exceeded (429): Quota exhausted"), true);
      assert.equal(detectProviderQuotaExhaustion("model unavailable"), true);
      assert.equal(detectProviderQuotaExhaustion("out of credits"), true);
      assert.equal(detectProviderQuotaExhaustion("fetch failed: ECONNRESET"), false);
      assert.equal(detectProviderQuotaExhaustion("etimedout"), false);
      assert.equal(detectProviderQuotaExhaustion("connection refused"), false);
      assert.equal(detectProviderQuotaExhaustion(""), false);
    });
  });
});

describe("dead predicates", () => {
  describe("DEAD_ORPHANED_DISK_RECORD", () => {
    it("fires when absent from daemon but present on disk", () => {
      assert.equal(detectDeadOrphanedDiskRecord(false, true), true);
      assert.equal(detectDeadOrphanedDiskRecord(true, true), false);
      assert.equal(detectDeadOrphanedDiskRecord(false, false), false);
      assert.equal(detectDeadOrphanedDiskRecord(true, false), false);
    });
  });

  describe("DEAD_TERMINAL_FATAL_ERROR", () => {
    it("fires for error/closed with non-transient lastError", () => {
      assert.equal(detectDeadTerminalFatalError("error", "quota exceeded"), true);
      assert.equal(detectDeadTerminalFatalError("closed", "fatal crash"), true);
      assert.equal(detectDeadTerminalFatalError("error", "fetch failed"), false);
      assert.equal(detectDeadTerminalFatalError("error", "econnreset"), false);
      assert.equal(detectDeadTerminalFatalError("idle", "boom"), false);
      assert.equal(detectDeadTerminalFatalError("running", ""), false);
    });
  });

  describe("DEAD_WEDGED_RUNNING_TURN", () => {
    it("fires for running turns with no activity in stale window", () => {
      const stale = new Date(NOW - 1900 * 1000).toISOString();
      const fresh = new Date(NOW - 60 * 1000).toISOString();
      assert.equal(detectDeadWedgedRunningTurn("running", stale, NOW, 1800), true);
      assert.equal(detectDeadWedgedRunningTurn("running", fresh, NOW, 1800), false);
      assert.equal(detectDeadWedgedRunningTurn("idle", stale, NOW, 1800), false);
    });
  });

  describe("DEAD_REGISTRY_WITHOUT_PROCESS", () => {
    it("fires when registry references id but daemon does not", () => {
      assert.equal(detectDeadRegistryWithoutProcess(["orch-1"], false), true);
      assert.equal(detectDeadRegistryWithoutProcess(["orch-1"], true), false);
      assert.equal(detectDeadRegistryWithoutProcess([], false), false);
      assert.equal(detectDeadRegistryWithoutProcess(null, false), false);
    });
  });

  describe("DEAD_SUPERSEDED_BY_RETRY", () => {
    it("fires for terminal sessions superseded by newer retry with matching scope/task", () => {
      const base = { id: "old-agent", name: "Worker · repo#42 fix bug", cwd: "/tmp/worktree-a" };
      const successor: AgentCandidate = {
        id: "new-agent",
        name: "Worker · repo#42 fix bug",
        cwd: "/tmp/worktree-b",
        createdAt: NOW + 1000,
      };
      const oldAgent: AgentCandidate & { liveStatus: string; lastError: string; activeWorkers: number; registrations: string[] } = {
        ...base,
        liveStatus: "error",
        lastError: "quota exceeded",
        activeWorkers: 0,
        registrations: [],
        createdAt: NOW,
      };
      assert.equal(detectDeadSupersededByRetry(oldAgent, [successor]), true);
    });

    it("suppresses when no successor exists", () => {
      const agent: AgentCandidate & { liveStatus: string; lastError: string; activeWorkers: number; registrations: string[] } = {
        id: "old-agent",
        name: "Worker · repo#42 fix bug",
        liveStatus: "error",
        lastError: "quota exceeded",
        activeWorkers: 0,
        registrations: [],
        createdAt: NOW,
      };
      assert.equal(detectDeadSupersededByRetry(agent, []), false);
    });

    it("suppresses when active workers exist", () => {
      const agent: AgentCandidate & { liveStatus: string; lastError: string; activeWorkers: number; registrations: string[] } = {
        id: "old-agent",
        name: "Worker · repo#42 fix bug",
        liveStatus: "error",
        lastError: "quota exceeded",
        activeWorkers: 2,
        registrations: [],
        createdAt: NOW,
      };
      const successor: AgentCandidate = { id: "new-agent", name: "Worker · repo#42 fix bug", createdAt: NOW + 1000 };
      assert.equal(detectDeadSupersededByRetry(agent, [successor]), false);
    });

    it("suppresses when registry references exist", () => {
      const agent: AgentCandidate & { liveStatus: string; lastError: string; activeWorkers: number; registrations: string[] } = {
        id: "old-agent",
        name: "Worker · repo#42 fix bug",
        liveStatus: "error",
        lastError: "quota exceeded",
        activeWorkers: 0,
        registrations: ["repo"],
        createdAt: NOW,
      };
      const successor: AgentCandidate = { id: "new-agent", name: "Worker · repo#42 fix bug", createdAt: NOW + 1000 };
      assert.equal(detectDeadSupersededByRetry(agent, [successor]), false);
    });
  });
});

describe("task name matching utilities", () => {
  describe("extractTaskName", () => {
    it("strips Worker prefix", () => {
      assert.equal(extractTaskName("Worker · repo#42 fix bug"), "repo#42 fix bug");
      assert.equal(extractTaskName("Worker- repo#42 fix bug"), "repo#42 fix bug");
      assert.equal(extractTaskName("Orchestrator · my-repo"), "Orchestrator · my-repo");
      assert.equal(extractTaskName(null), "");
      assert.equal(extractTaskName(""), "");
    });
  });

  describe("matchTaskName", () => {
    it("matches exact task names case-insensitively", () => {
      assert.equal(matchTaskName("repo#42 fix bug", "REPO#42 FIX BUG"), true);
      assert.equal(matchTaskName("repo#42 fix bug", "other task"), false);
    });

    it("matches issue prefixes", () => {
      assert.equal(matchTaskName("xpufx/paseo#42 fix", "xpufx/paseo#42 refactor"), true);
      assert.equal(matchTaskName("repo#42 fix", "repo#43 fix"), false);
    });
  });

  describe("getAgentScope", () => {
    it("extracts parent agent ID from labels", () => {
      const [parent] = getAgentScope({
        id: "child",
        labels: { "paseo.parent-agent-id": "parent-123" },
      });
      assert.equal(parent, "parent-123");
    });

    it("extracts repo from labels or name", () => {
      const [, repo] = getAgentScope({
        id: "worker",
        name: "Worker · my-repo#42 do stuff",
      });
      assert.equal(repo, "my-repo");
    });
  });

  describe("matchAgentScope", () => {
    it("matches by parent agent ID", () => {
      const a = { id: "a", labels: { "paseo.parent-agent-id": "p1" } };
      const b = { id: "b", labels: { "paseo.parent-agent-id": "p1" } };
      assert.equal(matchAgentScope(a, b), true);
    });

    it("matches by repo slug", () => {
      const a = { id: "a", name: "Worker · org/repo#1" };
      const b = { id: "b", name: "Worker · org/repo#2" };
      assert.equal(matchAgentScope(a, b), true);
    });
  });

  describe("normalizeAgentCwd", () => {
    it("normalizes paths", () => {
      assert.equal(normalizeAgentCwd("/tmp/worktree"), "/tmp/worktree");
      assert.equal(normalizeAgentCwd(null), null);
      assert.equal(normalizeAgentCwd(""), null);
    });
  });

  describe("getAgentCreatedAtMs", () => {
    it("coerces various timestamp shapes", () => {
      assert.equal(getAgentCreatedAtMs({ id: "x", createdAt: NOW }), NOW);
      assert.equal(getAgentCreatedAtMs({ id: "x", createdAt: Math.floor(NOW / 1000) }), NOW);
      assert.equal(getAgentCreatedAtMs({ id: "x", createdAt: new Date(NOW).toISOString() }), NOW);
      assert.equal(getAgentCreatedAtMs({ id: "x", createdAt: null }), null);
      assert.equal(getAgentCreatedAtMs({ id: "x" }), null);
    });
  });
});

describe("findSuccessorRetry", () => {
  it("finds strictly newer candidate with matching scope and distinct cwd", () => {
    const a: AgentCandidate = { id: "a", name: "Worker · repo#42 fix", cwd: "/tmp/a", createdAt: NOW };
    const b: AgentCandidate = { id: "b", name: "Worker · repo#42 fix", cwd: "/tmp/b", createdAt: NOW + 1000 };
    const c: AgentCandidate = { id: "c", name: "Worker · repo#42 fix", cwd: "/tmp/a", createdAt: NOW + 2000 }; // same cwd as a
    const result = findSuccessorRetry(a, [b, c]);
    assert.equal(result?.id, "b");
  });

  it("returns null when no valid successor", () => {
    const a: AgentCandidate = { id: "a", name: "Worker · repo#42 fix", createdAt: NOW };
    const older: AgentCandidate = { id: "older", name: "Worker · repo#42 fix", createdAt: NOW - 1000 };
    assert.equal(findSuccessorRetry(a, [older]), null);
  });
});

describe("kill safety guards", () => {
  describe("killGuardReasons", () => {
    it("allows killing when dead and no guards trigger", () => {
      const guard = killGuardReasons({
        agentId: "dead-1",
        liveStatus: "error",
        taxonomy: [],
        deadPredicates: ["DEAD_ORPHANED_DISK_RECORD"],
        activeWorkers: 0,
      }, { frontDeskId: "fd-1" });
      assert.equal(guard.allowed, true);
      assert.equal(guard.reasons.length, 0);
    });

    it("blocks when not dead", () => {
      const guard = killGuardReasons({
        agentId: "alive-1",
        liveStatus: "running",
        taxonomy: [],
        deadPredicates: [],
        activeWorkers: 0,
      });
      assert.equal(guard.allowed, false);
      assert.ok(guard.reasons.some((r) => r.includes("not classified as dead")));
    });

    it("blocks healthy running agents", () => {
      const guard = killGuardReasons({
        agentId: "run-1",
        liveStatus: "running",
        taxonomy: [],
        deadPredicates: [],
        activeWorkers: 0,
      });
      assert.ok(guard.reasons.some((r) => r.includes("healthy running")));
    });

    it("blocks agents with child workers", () => {
      const guard = killGuardReasons({
        agentId: "parent-1",
        liveStatus: "error",
        taxonomy: [],
        deadPredicates: ["DEAD_TERMINAL_FATAL_ERROR"],
        activeWorkers: 3,
      });
      assert.ok(guard.reasons.some((r) => r.includes("child worker")));
    });

    it("blocks the front desk", () => {
      const guard = killGuardReasons({
        agentId: "fd-1",
        liveStatus: "idle",
        taxonomy: [],
        deadPredicates: ["DEAD_ORPHANED_DISK_RECORD"],
        activeWorkers: 0,
      }, { frontDeskId: "fd-1" });
      assert.ok(guard.reasons.some((r) => r.includes("front desk")));
    });

    it("blocks self/dispatching agent", () => {
      const guard = killGuardReasons({
        agentId: "self-1",
        liveStatus: "error",
        taxonomy: [],
        deadPredicates: ["DEAD_ORPHANED_DISK_RECORD"],
        activeWorkers: 0,
      }, { selfId: "self-1" });
      assert.ok(guard.reasons.some((r) => r.includes("self")));
    });
  });
});

describe("recovery plan", () => {
  it("plans stop/clear for high-severity taxonomy", () => {
    const plan = planRecovery(["TURN_CONCURRENCY_LOCK"]);
    assert.equal(plan.stop, true);
    assert.equal(plan.clearError, true);
    assert.equal(plan.steer, true);
    assert.equal(plan.blockedReason, null);
  });

  it("blocks steer for quota exhaustion without stop triggers", () => {
    const plan = planRecovery(["PROVIDER_QUOTA_EXHAUSTION"]);
    assert.equal(plan.steer, false);
    assert.equal(plan.blockedReason, "provider/quota exhaustion requires operator circuit-break");
  });

  it("clears attention for amnesia", () => {
    const plan = planRecovery(["IDLE_POST_ERROR_AMNESIA"]);
    assert.equal(plan.clearAttention, true);
    assert.equal(plan.steer, true);
  });
});

describe("prune plan", () => {
  it("plans kill when all guards pass", () => {
    const assessment = {
      agentId: "dead-1",
      name: "Test Agent",
      liveStatus: "error",
      taxonomy: [],
      deadPredicates: ["DEAD_ORPHANED_DISK_RECORD"],
      activeWorkers: 0,
      livePresent: false,
      registrations: [],
      supersededBy: null,
      dead: true,
      deadReasons: [],
      healthy: false,
      requiresAttention: false,
      attentionReason: null,
      lastActivityAt: null,
      diskPath: "/tmp/disk.json",
      severities: {},
      details: {},
      archived: false,
      lastError: "boom",
      pendingPermissions: [],
    };
    const plan = planPrune(assessment, { selfId: "self-1", frontDeskId: "fd-1" });
    assert.equal(plan.kill, true);
    assert.equal(plan.registry, false);
  });

  it("blocks kill for front desk", () => {
    const assessment = {
      agentId: "fd-1",
      name: "Front Desk",
      liveStatus: "error",
      taxonomy: [],
      deadPredicates: ["DEAD_ORPHANED_DISK_RECORD"],
      activeWorkers: 0,
      livePresent: false,
      registrations: [],
      supersededBy: null,
      dead: true,
      deadReasons: [],
      healthy: false,
      requiresAttention: false,
      attentionReason: null,
      lastActivityAt: null,
      diskPath: null,
      severities: {},
      details: {},
      archived: false,
      lastError: "boom",
      pendingPermissions: [],
    };
    const plan = planPrune(assessment, { frontDeskId: "fd-1" });
    assert.equal(plan.kill, false);
  });
});

// Note: hasMarker, coerceEpochMs, and parseIsoTimestamp are tested in
// hook-router.test.ts; this file focuses on taxonomy + dead predicates.
