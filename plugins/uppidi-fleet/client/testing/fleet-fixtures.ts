/**
 * Deliberately hostile RPC payloads for the fleet mobile-layout guard.
 *
 * Every unbounded string the fleet surface can display is present at its real
 * worst-case length: a full worktree path, a long agent display name, a
 * multi-word model id, a `via <parent>` lineage pill, and a stack of attention
 * labels. Real operator data looks like this — the paths alone are ~60 chars —
 * so a layout that only survives a 6-character stub is not a layout that
 * survives a phone.
 */

/** A real-length absolute worktree path, the longest chip the fleet renders. */
export const WIDE_WORKTREE =
  "/home/xpufx/.paseo/worktrees/2h0dw6vb/fix-621-fleet-mobile-overlap";

const frontDeskAgent = {
  id: "agent-abcdef0123456789",
  shortId: "a1b2c3d",
  name: "Fleet Front Desk",
  status: "running",
  deterministicState: "running:implementing",
  stateDetail: "implementing",
  category: "front-desk",
  project: "paseo",
  worktree: WIDE_WORKTREE,
  model: "claude-opus-5-thinking-extended",
  lastActivityAt: "2026-09-25T10:00:00.000Z",
  attentionTimestamp: "2026-09-25T10:05:00.000Z",
  labels: { attention: "true", priority: "high", area: "client-ui" },
  pendingPermissions: [{ id: "perm-1", kind: "bash", createdAt: "2026-09-25T10:00:00.000Z" }],
  isMainDirty: true,
  metrics: {
    contextUtilizationPct: 87,
    cacheHitRatioPct: 64,
    costUsd: 12.34,
    turnsCompleted: 42,
    errorCount: 0,
    lastTurnDurationMs: 184000,
    sessionLifetimeMs: 7200000,
    pendingSince: "2026-09-25T09:58:00.000Z",
  },
};

const deepWorkerAgent = {
  id: "agent-child-1122334455",
  shortId: "9f8e7d6",
  name: "Deep Worker With A Really Long Display Name Here",
  status: "running",
  deterministicState: "running",
  category: "worker",
  project: "paseo",
  worktree: WIDE_WORKTREE,
  model: "claude-opus-5-thinking-extended",
  lastActivityAt: "2026-09-25T10:00:00.000Z",
  labels: { priority: "normal", area: "shared-primitives" },
  attributedWork: { issue: 621 },
  pendingPermissions: [],
  parentId: "agent-abcdef0123456789",
  parentName: "Fleet Front Desk",
  metrics: {
    contextUtilizationPct: 42,
    cacheHitRatioPct: 81,
    costUsd: 3.21,
    turnsCompleted: 7,
    errorCount: 1,
  },
};

const orchestratorAgent = {
  id: "agent-orch-5566778899",
  shortId: "or9c8d7",
  name: "Orchestrator Session For The Fleet",
  status: "idle",
  deterministicState: "idle:waiting",
  stateDetail: "waiting",
  category: "orchestrator",
  project: "paseo",
  worktree: WIDE_WORKTREE,
  model: "claude-opus-5-thinking-extended",
  lastActivityAt: "2026-09-25T09:00:00.000Z",
  labels: {},
  pendingPermissions: [],
  isMainDirty: true,
};

export function agentsPayload(): Record<string, unknown> {
  return {
    ok: true,
    tree: [
      { agent: frontDeskAgent, depth: 0, children: [{ agent: deepWorkerAgent, depth: 1, children: [] }] },
      { agent: orchestratorAgent, depth: 0, children: [] },
    ],
    totalCount: 3,
    runningCount: 2,
    idleCount: 1,
    errorCount: 0,
    enrolledRepos: ["paseo"],
    mutedRepos: [],
    repoQueuedHooks: {},
  };
}

export function issuesPayload(): Record<string, unknown> {
  return {
    ok: true,
    repo: "paseo",
    openCount: 42,
    inFlightCount: 7,
    reviewCount: 3,
    needsYouCount: 2,
    issues: [
      {
        number: 621,
        title: "uppidi fleet mobile view has overlapping fields and similar visual issues",
        state: "open",
        status: "In progress",
        attention: "attention/1-agent",
        labels: ["attention/1-agent", "state/1-wip", "priority/1-high"],
        branch: "fix/621-fleet-mobile-overlap",
        comments: 4,
        repo: "paseo",
        updatedAt: "2026-09-25T10:00:00.000Z",
        url: "https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/621",
      },
      {
        number: 296,
        title: "install smoke leg fails on plugins/top requiring >=0.9.0",
        state: "open",
        status: "Review",
        attention: "attention/0-orchestrator",
        labels: ["state/2-review", "priority/2-normal"],
        branch: "fix/296-install-smoke-top-version-gate",
        comments: 12,
        repo: "paseo",
        updatedAt: "2026-09-24T10:00:00.000Z",
        url: "https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/296",
      },
    ],
  };
}

export function metricsPayload(): Record<string, unknown> {
  return {
    ok: true,
    candidates: [
      {
        provider: "anthropic",
        model: "claude-opus-5-thinking-extended",
        turnsCompleted: 128,
        agentCount: 9,
        medianContextUtilizationPct: 71,
        cacheHitRatioPct: 68,
        costUsd: 412.55,
        errorCount: 3,
        medianTurnDurationMs: 184000,
        passRate: 94,
        reworkRate: 12,
        confidence: "high",
        profiles: [
          {
            taskProfile: "client-ui",
            taskProfileLabel: "Client UI Refactor",
            passRate: 96,
            reworkRate: 8,
            confidence: "high",
            failureBreakdown: { quota: 0, timeout: 1, toolFailure: 0, checkFailure: 1 },
          },
        ],
      },
    ],
    taskProfiles: ["client-ui", "release-engineering"],
    totalEvaluatedTrials: 512,
    privacyNotice: "Aggregated locally; no prompt content leaves the machine.",
    dataSource: "empirical",
    modelCount: 1,
  };
}

export function runnersPayload(): Record<string, unknown> {
  return {
    ok: true,
    runners: [
      {
        id: "runner-1",
        name: "local-docker-pool-with-a-long-name",
        status: "online",
        jobs: 2,
        capacity: 8,
        lastSeen: "2026-09-25T10:00:00.000Z",
      },
    ],
  };
}

export function hookQueuesPayload(): Record<string, unknown> {
  return {
    ok: true,
    queues: [
      {
        key: "forgejo:xpufx-org/paseo",
        depth: 3,
        paused: false,
        messages: [
          { id: "m1", preview: "forgejo:webhook delivery attempt 2 of 5 for issue 621" },
        ],
      },
    ],
  };
}

/** Populates every read contract so each surface tab renders real content. */
export function installPayloads(
  payloads: Record<string, unknown>,
): Record<string, unknown> {
  Object.assign(payloads, {
    "uppidi-fleet.agents": agentsPayload(),
    "uppidi-fleet.issues": issuesPayload(),
    "uppidi-fleet.metrics": metricsPayload(),
    "uppidi-fleet.runners": runnersPayload(),
    "uppidi-fleet.hook-queues": hookQueuesPayload(),
    "uppidi-fleet.hook-status": { ok: true, state: "watching", installed: true },
    "uppidi-fleet.hook-service-status": { ok: true, state: "running", pid: 4242 },
    "uppidi-fleet.hook-log-tail": { ok: true, lines: [] },
    "uppidi-fleet.role-models": { ok: true, roles: {} },
    "plugin-settings": { host: "forge.mrs.uppidi.com", port: "8099" },
  });
  return payloads;
}
