import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROTATION_POLICY,
  DEFAULT_ROTATION_ROLE_POLICY,
  RotationLock,
  buildRotationBrief,
  evaluateRotationTrigger,
  resolveRotationPolicy,
  type RotationObservation,
} from "./rotation.js";
import type { RotationPolicy } from "../shared/contracts.js";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const ISO = "2026-10-06T12:00:00.000Z";

function observation(over: Partial<RotationObservation> = {}): RotationObservation {
  return { role: "orchestrator", repo: "xpufx-org/paseo", ...over };
}

describe("rotation policy resolution (#1019)", () => {
  it("returns the approved built-in defaults", () => {
    const orch = resolveRotationPolicy(DEFAULT_ROTATION_POLICY, "orchestrator", "xpufx-org/paseo");
    assert.deepEqual(orch, DEFAULT_ROTATION_ROLE_POLICY.orchestrator);
    assert.equal(orch.enabled, true);
    assert.equal(orch.maxAgeMs, 2 * HOUR);
    assert.equal(orch.maxTurns, 50);
    assert.equal(orch.tokenPressure, 0.85);
    assert.equal(orch.failureWindowMs, 15 * MINUTE);
    assert.equal(orch.failureThreshold, 3);
    assert.equal(orch.cooldownMs, 30 * MINUTE);

    const fd = resolveRotationPolicy(DEFAULT_ROTATION_POLICY, "front-desk");
    assert.equal(fd.enabled, true);
    assert.equal(fd.maxAgeMs, 3 * HOUR);
    assert.equal(fd.maxTurns, 75);

    assert.equal(resolveRotationPolicy(DEFAULT_ROTATION_POLICY, "auditor").enabled, false);
    assert.equal(resolveRotationPolicy(DEFAULT_ROTATION_POLICY, "coding-agent").enabled, false);
  });

  it("layers a global role override over the defaults", () => {
    const policy: RotationPolicy = { roles: { orchestrator: { maxTurns: 5 } }, byRepo: {} };
    const resolved = resolveRotationPolicy(policy, "orchestrator", "xpufx-org/paseo");
    assert.equal(resolved.maxTurns, 5);
    assert.equal(resolved.maxAgeMs, 2 * HOUR, "unspecified fields keep the default");
  });

  it("layers a per-repo override over the global role override", () => {
    const policy: RotationPolicy = {
      roles: { orchestrator: { maxTurns: 5, maxAgeMs: HOUR } },
      byRepo: { "xpufx-org/paseo": { orchestrator: { maxTurns: 2 } } },
    };
    const scoped = resolveRotationPolicy(policy, "orchestrator", "xpufx-org/paseo");
    assert.equal(scoped.maxTurns, 2);
    assert.equal(scoped.maxAgeMs, HOUR);
    const other = resolveRotationPolicy(policy, "orchestrator", "xpufx-org/other");
    assert.equal(other.maxTurns, 5);
  });
});

describe("rotation trigger evaluation (#1019)", () => {
  it("fires on age when the session is older than maxAge", () => {
    const decision = evaluateRotationTrigger(
      observation({ spawnedAtMs: NOW - 3 * HOUR }),
      { nowMs: NOW },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(decision.shouldRotate, true);
    assert.equal(decision.reason, "age");
    assert.deepEqual(decision.triggers, ["age"]);
  });

  it("fires on turns when the turn count reaches maxTurns", () => {
    const decision = evaluateRotationTrigger(
      observation({ turns: 50 }),
      { nowMs: NOW },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(decision.shouldRotate, true);
    assert.equal(decision.reason, "turns");
  });

  it("prefers age over turns when both fire", () => {
    const decision = evaluateRotationTrigger(
      observation({ spawnedAtMs: NOW - 3 * HOUR, turns: 99 }),
      { nowMs: NOW },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(decision.reason, "age");
    assert.deepEqual(decision.triggers, ["age", "turns"]);
  });

  it("fires on token pressure at the configured fraction", () => {
    const decision = evaluateRotationTrigger(
      observation({ contextWindowUsedTokens: 85_000, contextWindowMaxTokens: 100_000 }),
      { nowMs: NOW },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(decision.shouldRotate, true);
    assert.equal(decision.reason, "token-pressure");
  });

  it("fires on repeated failures inside the window", () => {
    const decision = evaluateRotationTrigger(
      observation({ failureTimestampsMs: [NOW - MINUTE, NOW - 2 * MINUTE, NOW - 3 * MINUTE] }),
      { nowMs: NOW },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(decision.shouldRotate, true);
    assert.equal(decision.reason, "failures");

    const staleFailures = evaluateRotationTrigger(
      observation({ failureTimestampsMs: [NOW - 30 * MINUTE, NOW - 40 * MINUTE, NOW - 50 * MINUTE] }),
      { nowMs: NOW },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(staleFailures.shouldRotate, false, "failures outside the window do not count");
  });

  it("does not fire when nothing crosses a threshold", () => {
    const decision = evaluateRotationTrigger(
      observation({ spawnedAtMs: NOW - MINUTE, turns: 2 }),
      { nowMs: NOW },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(decision.shouldRotate, false);
    assert.equal(decision.blocked, null);
  });

  it("blocks automatic rotation during cooldown and reports the remainder", () => {
    const decision = evaluateRotationTrigger(
      observation({ spawnedAtMs: NOW - 3 * HOUR }),
      { nowMs: NOW, lastRotationAtMs: NOW - 5 * MINUTE },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(decision.shouldRotate, false);
    assert.equal(decision.blocked, "cooldown");
    assert.equal(decision.cooldownRemainingMs, 25 * MINUTE);
  });

  it("blocks automatic rotation mid-turn but lets manual force through", () => {
    const automatic = evaluateRotationTrigger(
      observation({ spawnedAtMs: NOW - 3 * HOUR }),
      { nowMs: NOW, midTurn: true },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(automatic.blocked, "mid-turn");

    const manual = evaluateRotationTrigger(
      observation({ spawnedAtMs: NOW - 3 * HOUR }),
      { nowMs: NOW, midTurn: true, forced: true },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(manual.shouldRotate, true);
    assert.equal(manual.reason, "manual");
  });

  it("always allows manual rotation even when the role is disabled or cooling down", () => {
    const policy: RotationPolicy = {
      roles: { orchestrator: { enabled: false, cooldownMs: HOUR } },
      byRepo: {},
    };
    const manual = evaluateRotationTrigger(
      observation(),
      { nowMs: NOW, lastRotationAtMs: NOW - MINUTE, forced: true },
      policy,
    );
    assert.equal(manual.shouldRotate, true);
    assert.equal(manual.reason, "manual");
  });

  it("blocks even manual rotation while one is already in flight", () => {
    const decision = evaluateRotationTrigger(
      observation(),
      { nowMs: NOW, forced: true, inFlight: true },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(decision.shouldRotate, false);
    assert.equal(decision.blocked, "in-flight");
  });

  it("never fires for a disabled role", () => {
    const decision = evaluateRotationTrigger(
      observation({ spawnedAtMs: NOW - 10 * HOUR }),
      { nowMs: NOW },
      DEFAULT_ROTATION_POLICY,
    );
    // Orchestrator is enabled; use auditor to assert disabled.
    const auditor = evaluateRotationTrigger(
      { role: "auditor", spawnedAtMs: NOW - 10 * HOUR },
      { nowMs: NOW },
      DEFAULT_ROTATION_POLICY,
    );
    assert.equal(decision.shouldRotate, true);
    assert.equal(auditor.shouldRotate, false);
    assert.equal(auditor.blocked, "disabled");
  });
});

describe("rotation brief contents (#1019)", () => {
  it("includes role, reason, board state, queue depth and digests", () => {
    const brief = buildRotationBrief({
      role: "orchestrator",
      repo: "xpufx-org/paseo",
      reason: "age, turns",
      previousAgentId: "agent-old",
      generatedAt: ISO,
      skillPath: "/skills/orchestrator/SKILL.md",
      activeTickets: [{ number: 42, title: "Fix the thing" }],
      pendingAttention: [{ number: 7, title: "Blocked", reason: "dep/blocked" }],
      queueDepth: 3,
      lastHookDigest: "hook digest",
      lastSweepDigest: "sweep digest",
    });
    assert.match(brief, /Rotation Brief — orchestrator · xpufx-org\/paseo/);
    assert.match(brief, /- Reason: age, turns/);
    assert.match(brief, /`agent-old`/);
    assert.match(brief, /#42: Fix the thing/);
    assert.match(brief, /#7: Blocked \(dep\/blocked\)/);
    assert.match(brief, /Queue depth: 3/);
    assert.match(brief, /Last hook digest: hook digest/);
    assert.match(brief, /Last sweep digest: sweep digest/);
    assert.match(brief, /\/skills\/orchestrator\/SKILL\.md/);
  });

  it("degrades cleanly with no tickets and no digests", () => {
    const brief = buildRotationBrief({ role: "front-desk", generatedAt: ISO });
    assert.match(brief, /_none registered_/);
    assert.match(brief, /Active tickets\*\*: 0/);
    assert.match(brief, /Queue depth: 0/);
  });
});

describe("RotationLock one-at-a-time guardrail (#1019)", () => {
  it("serialises per role and per repo", () => {
    const lock = new RotationLock();
    assert.equal(lock.acquire("orchestrator", "xpufx-org/paseo"), true);
    assert.equal(lock.acquire("orchestrator", "xpufx-org/paseo"), false, "same role+repo is locked");
    assert.equal(lock.acquire("orchestrator", "xpufx-org/other"), true, "other repo is independent");
    assert.equal(lock.acquire("front-desk"), true, "a different role is independent");
    lock.release("orchestrator", "xpufx-org/paseo");
    assert.equal(lock.acquire("orchestrator", "xpufx-org/paseo"), true);
  });
});
