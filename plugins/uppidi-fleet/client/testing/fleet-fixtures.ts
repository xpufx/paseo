/**
 * Realistic RPC payloads for the fleet mobile-layout guard (#621).
 *
 * These mirror the shape and depth of a *live* fleet — ten agents with real
 * display-name lengths, real provider/model ids, real worktree-path lengths,
 * real orchestrator→worker nesting, and real running/idle/failed counts — so the
 * guard is measured against the content an operator actually sees.
 *
 * The previous fixture set was hostile only in isolation: a 60-char worktree
 * path on a three-agent tree. It passed at every phone width while the operator's
 * own fleet produced nine overflow findings per width, because a three-agent tree
 * with three short count badges never builds the rows that carry the defect. A
 * guard whose payload cannot express the bug it exists to catch is decoration, so
 * every unbounded string here is at its real length and the tree is built at the
 * real fleet's cardinality and nesting.
 *
 * Paths carry a sanitised home prefix (`/home/dev-user`) at a realistic length.
 * Real daemon paths contain the operator's home directory, which the PII
 * preflight rejects outright; the prefix is replaced, the length is not.
 */

/** Real-length absolute worktree path, the longest chip the fleet renders. */
export const WIDE_WORKTREE =
  "/home/dev-user/.paseo/worktrees/2h0dw6vb/fix-621-lineage-tree-row-overflow";

/**
 * Representative provider/model id at the live fleet's longest real length (38
 * chars, three segments). Sized to the real thing rather than copied from it:
 * a real provider id names a real operator and trips the PII preflight, and a
 * short placeholder would stop the fixture from carrying realistic chip width.
 */
const LONG_MODEL = "northwind/fabrikam-rt/streaming-expert";

/** The fleet's second provider shape, at its real length (36 chars). */
const SHORT_MODEL = "northwind-proxy/gemini-flash-4.5-low";

const metrics = (over: Record<string, unknown> = {}) => ({
  contextUtilizationPct: 71,
  cacheHitRatioPct: 68,
  costUsd: 18.42,
  turnsCompleted: 64,
  errorCount: 0,
  lastTurnDurationMs: 184000,
  sessionLifetimeMs: 7200000,
  pendingSince: "2026-09-25T09:58:00.000Z",
  ...over,
});

const orchestrator = (
  id: string,
  name: string,
  project: string,
  worktree: string,
  status: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  shortId: id.slice(-7),
  name,
  status,
  deterministicState: status === "running" ? "running:implementing" : "idle:waiting",
  stateDetail: status === "running" ? "implementing" : "waiting",
  category: "orchestrator",
  project,
  worktree,
  model: LONG_MODEL,
  lastActivityAt: "2026-09-25T09:00:00.000Z",
  labels: { priority: "normal", area: "release-engineering" },
  pendingPermissions: [],
  isMainDirty: true,
  ...extra,
});

const worker = (
  id: string,
  name: string,
  project: string,
  worktree: string,
  status: string,
  parent: { id: string; name: string },
  extra: Record<string, unknown> = {},
) => ({
  id,
  shortId: id.slice(-7),
  name,
  status,
  deterministicState: status === "running" ? "running:implementing" : "idle:waiting",
  stateDetail: status === "running" ? "implementing" : "waiting",
  category: "worker",
  project,
  worktree,
  model: LONG_MODEL,
  lastActivityAt: "2026-09-25T10:00:00.000Z",
  parentId: parent.id,
  parentName: parent.name,
  attributedWork: { issue: 621 },
  pendingPermissions: [],
  metrics: metrics(),
  ...extra,
});

/** Front desk of the live fleet: present, idle, on a short path. */
const frontDeskAgent = {
  id: "agent-front-desk-0001",
  shortId: "d7d20e0",
  name: "Front Desk",
  status: "idle",
  deterministicState: "idle:waiting",
  stateDetail: "waiting",
  category: "front-desk",
  project: "meta",
  worktree: "/home/dev-user/code/meta",
  model: SHORT_MODEL,
  lastActivityAt: "2026-09-25T09:00:00.000Z",
  labels: { priority: "normal", area: "triage" },
  pendingPermissions: [],
  isMainDirty: false,
  metrics: metrics({ contextUtilizationPct: 22 }),
};

/** The live fleet's orchestrators, at real name lengths. */
const orchestrators = [
  orchestrator(
    "agent-orch-paseo-0001",
    "Orchestrator · xpufx-org/paseo",
    "paseo",
    "/home/dev-user/code/paseo",
    "running",
    { attributedWork: { issue: 621 }, metrics: metrics() },
  ),
  orchestrator(
    "agent-orch-aur-auto01",
    "Orchestrator · xpufx-org/aur-automation",
    "aur-automation",
    "/home/dev-user/code/aur-automation",
    "idle",
  ),
  orchestrator(
    "agent-orch-runner-co1",
    "Orchestrator · tundra/runner-containers",
    "runner-containers",
    "/home/dev-user/code/runner-containers",
    "idle",
  ),
  orchestrator(
    "agent-orch-2fado-0001",
    "Orchestrator · xpufx-org/2fado",
    "2fado",
    "/home/dev-user/code/2fado",
    "idle",
  ),
  orchestrator(
    "agent-orch-platfm-001",
    "Orchestrator · xpufx-org/platform",
    "platform",
    "/home/dev-user/code/platform",
    "idle",
  ),
];

/** The live fleet's workers, nested under the orchestrator that spawned them. */
const workers = [
  worker(
    "agent-wkr-621-overflow",
    "#621 fix Lineage Tree row overflow",
    "paseo",
    WIDE_WORKTREE,
    "running",
    { id: orchestrators[0].id, name: orchestrators[0].name },
    { attentionTimestamp: "2026-09-25T10:05:00.000Z", labels: { attention: "true", priority: "high" } },
  ),
  worker(
    "agent-wkr-629-fleet-alt",
    "#629 alternative fleet plugin",
    "paseo",
    "/home/dev-user/.paseo/worktrees/2h0dw6vb/feat-629-fleet-alternative",
    "running",
    { id: orchestrators[0].id, name: orchestrators[0].name },
  ),
  worker(
    "agent-wkr-helper-dirty",
    "Why is main dirty?",
    "paseo-plugin-helper",
    "/home/dev-user/code/paseo-plugin-helper",
    "idle",
    { id: orchestrators[0].id, name: orchestrators[0].name },
  ),
  worker(
    "agent-wkr-site-plugins",
    "We need to update the plugins",
    "xpufx.github.io",
    "/home/dev-user/code/xpufx.github.io",
    "idle",
    { id: orchestrators[1].id, name: orchestrators[1].name },
  ),
];

function node(agent: any, depth: number, children: any[] = []): any {
  return { agent, depth, children };
}

/** Depth-first worker nesting, matching how the fleet groups work under a parent. */
function nestUnder(orch: any): any[] {
  return workers
    .filter((w) => w.parentId === orch.id)
    .map((w) => node(w, 1));
}

/**
 * The live fleet, with its front desk seated. Ten agents, five orchestrators,
 * four workers, real counts.
 */
export function agentsPayload(): Record<string, unknown> {
  const tree = [
    node(frontDeskAgent, 0),
    ...orchestrators.map((o) => node(o, 0, nestUnder(o))),
  ];
  return {
    ok: true,
    frontDesk: [frontDeskAgent],
    orchestrators,
    workers,
    tree,
    totalCount: 10,
    runningCount: 3,
    idleCount: 6,
    // A real fleet carries failed sessions; this is the state that puts the
    // fourth count badge on the header row.
    errorCount: 1,
    enrolledRepos: ["paseo", "2fado", "aur-automation", "platform"],
    mutedRepos: [],
    repoQueuedHooks: { "forgejo:xpufx-org/paseo": 3 },
  };
}

/**
 * The same fleet after its front desk session ends. The hero then renders the
 * liaison placeholder — two hardcoded strings (98px and 357px at the estimator's
 * scale) in rows that have no shrink budget, which is the operator's line. This
 * is a routine state, not a contrived one: the front desk is an ordinary agent,
 * and it is gone whenever it is archived, closed, or restarted.
 */
export function agentsPayloadNoFrontDesk(): Record<string, unknown> {
  const base = agentsPayload() as any;
  return {
    ...base,
    frontDesk: [],
    tree: base.tree.filter((n: any) => n.agent.category !== "front-desk"),
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
        branch: "fix/621-lineage-tree-row-overflow",
        comments: 5,
        repo: "paseo",
        updatedAt: "2026-09-25T23:11:00.000Z",
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
        model: LONG_MODEL,
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
  fleet: Record<string, unknown> = agentsPayload(),
): Record<string, unknown> {
  Object.assign(payloads, {
    "uppidi-fleet.agents": fleet,
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
