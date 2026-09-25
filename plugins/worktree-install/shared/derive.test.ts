import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROJECT,
  STATE_TABLE,
  adjudicationCommand,
  agentMatchesQuery,
  attentionReasonLabel,
  attributedWork,
  blockedSummary,
  buildProjectGroups,
  buildTree,
  bulkArchiveCandidates,
  categoryIcon,
  displayableLabels,
  durationText,
  filterTree,
  flattenTree,
  healthGauge,
  isBlocked,
  isBulkArchiveEligible,
  lifecycleState,
  matchesStateFilter,
  parentPillLabel,
  permissionAction,
  permissionScope,
  projectKey,
  queueMatchesFilter,
  queueState,
  relativeTime,
  repoMatches,
  routerBadge,
  selectPrimaryFrontDesk,
  sortQueues,
  sortTickets,
  ticketCountFor,
  ticketMatchesFilter,
  worktreeSlug,
  type TicketFilter,
  type TicketSortField,
  type QueueSortField,
  type SortDirection,
} from "./derive.js";
import type {
  AgentState,
  AttentionLabel,
  FleetAgent,
  QueuePreset,
  RepoQueue,
  Ticket,
  TicketStatus,
} from "./contracts.js";

function agent(overrides: Partial<FleetAgent> = {}): FleetAgent {
  return {
    id: "a1",
    shortId: "a1",
    name: "agent one",
    category: "worker",
    status: "idle",
    deterministicState: "idle:waiting",
    pendingPermissions: [],
    ...overrides,
  };
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    number: 1,
    title: "a ticket",
    state: "open",
    repo: "org/repo",
    status: "Backlog",
    attention: "attention/1-agent",
    comments: 0,
    labels: [],
    ...overrides,
  };
}

function queue(overrides: Partial<RepoQueue> = {}): RepoQueue {
  return { key: "org/repo", depth: 0, dropped: 0, paused: false, isBusy: false, busyAttempts: 0, messages: [], ...overrides };
}

// --- State table: every state carries a label and a tone -------------------

describe("state table", () => {
  const states: AgentState[] = [
    "working",
    "running",
    "sleeping",
    "idle:waiting",
    "idle:quota-exhausted",
    "attention-required",
    "permission-prompt",
    "failed:quota-exhausted",
    "failed:spawn",
    "failed:timeout",
    "failed:error",
    "unknown",
  ];

  it("covers all twelve states with a non-empty label, icon, and tone", () => {
    for (const state of states) {
      const entry = STATE_TABLE[state];
      assert.ok(entry, `missing ${state}`);
      assert.equal(entry.state, state);
      assert.ok(entry.label.length > 0, `${state} has no label`);
      assert.ok(entry.icon.length > 0, `${state} has no icon`);
      assert.ok(["ok", "warn", "critical"].includes(entry.tone), `${state} has no tone`);
    }
  });

  it("projects every state onto a canonical lifecycle state", () => {
    assert.equal(lifecycleState("working"), "running");
    assert.equal(lifecycleState("permission-prompt"), "waiting_for_input");
    assert.equal(lifecycleState("attention-required"), "waiting_for_input");
    assert.equal(lifecycleState("failed:timeout"), "errored");
    assert.equal(lifecycleState("idle:waiting"), "idle");
    assert.equal(lifecycleState("sleeping"), "idle");
    assert.equal(lifecycleState("unknown"), "idle");
  });

  it("matches the state filters the legacy surface exposed", () => {
    const working = agent({ deterministicState: "working" });
    const sleeping = agent({ deterministicState: "sleeping" });
    const quota = agent({ deterministicState: "idle:quota-exhausted" });
    const failed = agent({ deterministicState: "failed:spawn" });

    assert.equal(matchesStateFilter(working, "working"), true);
    assert.equal(matchesStateFilter(sleeping, "working"), false);
    assert.equal(matchesStateFilter(sleeping, "idle"), true);
    assert.equal(matchesStateFilter(quota, "idle"), true);
    assert.equal(matchesStateFilter(failed, "failed"), true);
    assert.equal(matchesStateFilter(failed, "idle"), false);
    assert.equal(matchesStateFilter(failed, "all"), true);
  });
});

// --- Attention ------------------------------------------------------------

describe("attention", () => {
  it("treats a pending permission as blocked regardless of the reason flag", () => {
    assert.equal(
      isBlocked({ pendingPermissions: [{ id: "r1" }], requiresAttention: false, attentionReason: null }),
      true,
    );
  });

  it("does not raise a benign finished signal", () => {
    assert.equal(
      isBlocked({ pendingPermissions: [], requiresAttention: true, attentionReason: "finished" }),
      false,
    );
    assert.equal(
      isBlocked({ pendingPermissions: [], requiresAttention: true, attentionReason: "input" }),
      true,
    );
  });

  it("labels every attention reason", () => {
    assert.equal(attentionReasonLabel("permission"), "permission request");
    assert.equal(attentionReasonLabel("input"), "operator input");
    assert.equal(attentionReasonLabel("error"), "error");
    assert.equal(attentionReasonLabel("finished"), "finished");
    assert.equal(attentionReasonLabel(null), undefined);
  });

  it("picks the most specific permission action available", () => {
    assert.equal(permissionAction({ id: "1", title: "write file" }), "write file");
    assert.equal(permissionAction({ id: "1", tool: "bash" }), "bash");
    assert.equal(permissionAction({ id: "1", name: "n" }), "n");
    assert.equal(permissionAction({ id: "1", kind: "k" }), "k");
    assert.equal(permissionAction({ id: "1" }), "tool permission");
    assert.equal(permissionAction(undefined), "tool permission");
  });

  it("builds the permit command, with and without a request id", () => {
    assert.equal(adjudicationCommand("agent-1", { id: "req-9" }), "paseo permit allow agent-1 req-9");
    assert.equal(adjudicationCommand("agent-1", { id: "", requestId: "req-8" }), "paseo permit allow agent-1 req-8");
    assert.equal(adjudicationCommand("agent-1", undefined), "paseo permit allow agent-1");
  });

  it("extracts a permission scope from input keys and from a Scope: description", () => {
    assert.equal(permissionScope({ input: { path: "/srv/app" } }), "/srv/app");
    assert.equal(permissionScope({ input: { file_path: "/srv/b.ts" } }), "/srv/b.ts");
    assert.equal(permissionScope({ description: "Scope: /srv/c" }), "/srv/c");
    assert.equal(permissionScope({ description: "just a description" }), "just a description");
    assert.equal(permissionScope({ scope: "/explicit" }), "/explicit");
    assert.equal(permissionScope({}), undefined);
  });
});

// --- Identity -------------------------------------------------------------

describe("identity resolution", () => {
  it("prefers explicit worktree, then labels, then cwd shape, then work", () => {
    assert.equal(worktreeSlug({ worktree: "wt" }), "wt");
    assert.equal(worktreeSlug({ labels: { worktree: "from-label" } }), "from-label");
    assert.equal(worktreeSlug({ labels: { branch: "feat/1-x" } }), "feat/1-x");
    assert.equal(worktreeSlug({ cwd: "/srv/paseo/.paseo/worktrees/abc/feat-9-tree" }), "feat-9-tree");
    assert.equal(worktreeSlug({ cwd: "/srv/code/paseo" }), "paseo");
    assert.equal(worktreeSlug({ cwd: "/srv/code/paseo" }), "paseo");
    assert.equal(worktreeSlug({ attributedWork: { slug: "feat/2-y" } }), "feat/2-y");
    assert.equal(
      worktreeSlug({ workspaceId: "0123456789abcdefgh" }),
      "0123456789ab",
    );
    assert.equal(worktreeSlug({}), undefined);
  });

  it("never invents a repository from a title or cwd", () => {
    assert.equal(projectKey({}), DEFAULT_PROJECT);
    assert.equal(projectKey({ project: "org/repo" }), "org/repo");
    assert.equal(projectKey({ workspaceId: "w1" }, undefined, { w1: "org/from-map" }), "org/from-map");
    assert.equal(projectKey({ labels: { repo: "org/from-label" } }), "org/from-label");
    assert.equal(projectKey({}, "org/from-parent"), "org/from-parent");
    // A cwd is not authoritative for the repository.
    assert.equal(
      projectKey({ cwd: "/srv/code/other" } as Parameters<typeof projectKey>[0]),
      DEFAULT_PROJECT,
    );
  });

  it("matches repository names across protocol, host, and .git noise", () => {
    assert.equal(repoMatches("org/repo", "org/repo"), true);
    assert.equal(repoMatches("org/repo", "ORG/REPO"), true);
    assert.equal(repoMatches("https://forge.example.com/org/repo.git", "org/repo"), true);
    assert.equal(repoMatches("git@forge.example.com:org/repo", "repo"), true);
    assert.equal(repoMatches("org/repo", "org/other"), false);
    assert.equal(repoMatches(undefined, "org/repo"), false);
  });

  it("maps categories to icons and parents to pills", () => {
    assert.equal(categoryIcon("front-desk"), "Inbox");
    assert.equal(categoryIcon("orchestrator"), "Network");
    assert.equal(categoryIcon("worker"), "Terminal");
    assert.equal(categoryIcon("other"), "Bot");
    assert.equal(parentPillLabel({ parentId: "d1", parentCategory: "front-desk" }), "via Front Desk");
    assert.equal(parentPillLabel({ parentCategory: "front-desk" }), null, "no parent, no pill");
    assert.equal(parentPillLabel({ parentName: "orch one" }), "via orch one");
    assert.equal(parentPillLabel({ parentId: "0123456789" }), "via 0123456");
    assert.equal(parentPillLabel({}), null);
  });

  it("drops internal routing labels and keeps the rest", () => {
    const labels = displayableLabels({
      role: "worker",
      category: "worker",
      "paseo.parent-agent-id": "x",
      "paseo.open-agent-tab.1": "y",
      branch: "feat/1-x",
      repo: "org/repo",
      blank: "  ",
    });
    assert.deepEqual(
      labels.map((l) => l.key),
      ["branch", "repo"],
    );
    assert.deepEqual(labels[0], { key: "branch", display: "branch=feat/1-x" });
  });

  it("attributes work from labels, free text, and branch names", () => {
    assert.deepEqual(attributedWork({ labels: { "forgejo.issue": "629", repo: "org/repo" } }), {
      repo: "org/repo",
      issue: 629,
    });
    assert.equal(attributedWork({ title: "paseo#385 tree" })?.issue, 385);
    assert.equal(attributedWork({ cwd: "/srv/code/paseo" })?.repo, "paseo");
    assert.equal(attributedWork({ name: "feat-629-alternative" })?.issue, 629);
    assert.equal(attributedWork({ name: "nothing here" }), null);
    assert.equal(attributedWork({}), null);
  });
});

// --- Health gauge ---------------------------------------------------------

describe("health gauge", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");

  it("returns no fill for absent metrics rather than throwing", () => {
    const gauge = healthGauge({ deterministicState: "working" }, undefined, now);
    assert.equal(gauge.overall, "ok");
    assert.deepEqual(gauge.segments.map((s) => s.ratio), [0, 0, 0]);
  });

  it("grades context utilisation at 75% and 90%", () => {
    const at = (used: number) => healthGauge({ metrics: { contextUsedTokens: used, contextMaxTokens: 100 } }, undefined, now);
    assert.equal(at(50).segments[0]!.tone, "ok");
    assert.equal(at(80).segments[0]!.tone, "warn");
    assert.equal(at(95).segments[0]!.tone, "critical");
  });

  it("turns the turn segment amber at the five-minute stall threshold", () => {
    const started = new Date(now - 6 * 60 * 1000).toISOString();
    const gauge = healthGauge({ metrics: { activeTurnStartedAt: started } }, undefined, now);
    assert.equal(gauge.segments[1]!.tone, "warn");
    assert.equal(gauge.sweep, 1);
  });

  it("lights the error segment on a failed state or a last error", () => {
    assert.equal(healthGauge({ deterministicState: "failed:error" }, undefined, now).segments[2]!.tone, "critical");
    assert.equal(healthGauge({ lastError: "boom" }, undefined, now).segments[2]!.tone, "critical");
    assert.equal(healthGauge({ lastError: "   " }, undefined, now).segments[2]!.tone, "ok");
  });

  it("reports the worst tone as the overall verdict", () => {
    const gauge = healthGauge(
      { metrics: { contextUsedTokens: 99, contextMaxTokens: 100 }, lastError: "boom" },
      undefined,
      now,
    );
    assert.equal(gauge.overall, "critical");
  });
});

// --- Bulk archive ---------------------------------------------------------

describe("bulk archive eligibility", () => {
  it("refuses liaisons, orchestrators, and blocked agents", () => {
    assert.equal(
      isBulkArchiveEligible(agent({ category: "front-desk", status: "closed", deterministicState: "failed:error" })),
      false,
    );
    assert.equal(
      isBulkArchiveEligible(agent({ category: "orchestrator", status: "closed", deterministicState: "failed:error" })),
      false,
    );
    assert.equal(
      isBulkArchiveEligible(agent({ status: "closed", pendingPermissions: [{ id: "r" }] })),
      false,
    );
  });

  it("refuses running, working, and healthy idle agents", () => {
    assert.equal(isBulkArchiveEligible(agent({ status: "running" })), false);
    assert.equal(isBulkArchiveEligible(agent({ status: "idle", deterministicState: "working" })), false);
    assert.equal(isBulkArchiveEligible(agent({ status: "idle", deterministicState: "idle:quota-exhausted" })), false);
  });

  it("accepts failed states and terminal statuses", () => {
    assert.equal(isBulkArchiveEligible(agent({ status: "error", deterministicState: "failed:timeout" })), true);
    assert.equal(isBulkArchiveEligible(agent({ status: "error", deterministicState: "failed:spawn" })), true);
    assert.equal(
      isBulkArchiveEligible(agent({ status: "closed", deterministicState: "failed:error" })),
      true,
    );
    assert.equal(
      isBulkArchiveEligible(agent({ status: "terminated", deterministicState: "failed:error" })),
      true,
    );
    assert.equal(
      bulkArchiveCandidates([
        agent({ status: "closed", deterministicState: "failed:error" }),
        agent({ status: "running" }),
      ]).length,
      1,
    );
  });

  it("keeps an agent whose status is idle but whose state says failed", () => {
    // Rule order is deliberate: idle is live, so it is never swept up in a bulk
    // archive just because a stale error string is attached to it.
    assert.equal(isBulkArchiveEligible(agent({ status: "idle", deterministicState: "failed:timeout" })), false);
  });
});

// --- Tree and grouping ----------------------------------------------------

describe("tree", () => {
  const parent = agent({ id: "p", name: "orch", category: "orchestrator" });
  const child = agent({ id: "c", parentId: "p" });
  const orphan = agent({ id: "o", parentId: "missing" });

  it("nests children and hoists orphans to roots", () => {
    const tree = buildTree([parent, child, orphan]);
    assert.equal(tree.length, 2);
    assert.equal(tree[0]!.children.length, 1);
    assert.equal(tree[0]!.children[0]!.agent.id, "c");
    // Parent denormalisation is what the pill reads.
    assert.equal(child.parentName, "orch");
    assert.equal(child.parentCategory, "orchestrator");
  });

  it("keeps matching ancestors and prunes dead branches", () => {
    const tree = buildTree([parent, child]);
    const onlyChild = filterTree(tree, (a) => a.id === "c");
    assert.equal(onlyChild.length, 1);
    assert.equal(onlyChild[0]!.children.length, 1);

    const onlyParent = filterTree(tree, (a) => a.id === "p");
    assert.equal(onlyParent[0]!.children.length, 0);

    assert.deepEqual(filterTree(tree, () => false), []);
    // A non-array tree degrades to empty rather than throwing.
    assert.deepEqual(filterTree(undefined as never, () => true), []);
  });

  it("flattens back to the roster", () => {
    assert.deepEqual(buildTree([parent, child]).flatMap((n) => flattenTree([n])).map((a) => a.id), ["p", "c"]);
  });

  it("searches every advertised field", () => {
    const rich = agent({
      name: "orch one",
      shortId: "abc1234",
      model: "gpt-x",
      provider: "openai",
      worktree: "feat-9-tree",
      project: "org/repo",
      parentName: "liaison",
      deterministicState: "working",
      stateDetail: "active turn",
      attributedWork: { issue: 385, slug: "feat-385-x" },
    });
    for (const needle of ["orch", "abc1234", "gpt-x", "openai", "feat-9-tree", "org/repo", "liaison", "active turn", "385", "working"]) {
      assert.equal(agentMatchesQuery(rich, needle), true, `expected ${needle} to match`);
    }
    assert.equal(agentMatchesQuery(rich, "nope"), false);
    assert.equal(agentMatchesQuery(rich, "  "), true);
  });
});

describe("front desk singleton", () => {
  const node = (id: string, extra: Partial<FleetAgent> = {}) => ({
    agent: agent({ id, category: "front-desk", ...extra }),
    depth: 0,
    children: [],
  });

  it("prefers the session the router registered", () => {
    const result = selectPrimaryFrontDesk([node("a"), node("b", { lastActivityAt: "2026-01-01T00:00:00.000Z" })], "b");
    assert.equal(result.primary?.agent.id, "b");
    assert.equal(result.stale.length, 1);
  });

  it("falls back to the single active session, then the most recent", () => {
    const single = selectPrimaryFrontDesk([node("a")], null);
    assert.equal(single.primary?.agent.id, "a");
    assert.equal(single.stale.length, 0);

    const two = selectPrimaryFrontDesk(
      [node("a", { status: "running" }), node("b", { status: "idle" })],
      null,
    );
    assert.equal(two.primary?.agent.id, "a");
  });

  it("returns nothing when there are no candidates", () => {
    assert.deepEqual(selectPrimaryFrontDesk([], "a"), { primary: null, stale: [] });
  });
});

describe("project groups", () => {
  const orch = agent({ id: "o", category: "orchestrator", project: "org/repo" });
  const worker = agent({ id: "w", category: "worker", project: "org/repo", parentId: "o" });
  const loose = agent({ id: "l", category: "worker", project: "org/repo" });

  it("separates orchestrators from unparented workers and keeps unstaffed repos", () => {
    const groups = buildProjectGroups(buildTree([orch, worker, loose]), {
      enrolledRepos: ["org/repo", "org/empty"],
      mutedRepos: ["org/repo"],
      repoQueuedHooks: { "org/repo": 3 },
    });
    const repo = groups.enrolled.find((g) => g.projectName === "org/repo")!;
    assert.equal(repo.orchestrators.length, 1);
    assert.equal(repo.unparentedWorkers.length, 1);
    // totalCount is the whole subtree: the orchestrator, its nested worker, and
    // the loose one. Only orchestrators and loose workers are listed as rows,
    // because the nested worker renders under its parent.
    assert.equal(repo.totalCount, 3);
    assert.equal(repo.agents.length, 3);
    assert.equal(repo.orchestrators[0]!.children.length, 1);
    assert.equal(repo.isMuted, true);
    assert.equal(repo.hasOrchestrator, true);
    assert.equal(repo.queuedHooksCount, 3);
    assert.equal(repo.isDetached, false);

    const empty = groups.enrolled.find((g) => g.projectName === "org/empty")!;
    assert.equal(empty.totalCount, 0);
    assert.equal(empty.hasOrchestrator, false);
  });

  it("routes unrecognised repositories to the detached bucket", () => {
    const groups = buildProjectGroups(buildTree([orch]), { enrolledRepos: [] });
    assert.equal(groups.detached.length, 1);
    assert.equal(groups.detached[0]!.isDetached, true);
  });

  it("degrades to empty on a non-array tree", () => {
    assert.deepEqual(buildProjectGroups(undefined as never), {
      frontDesk: [],
      staleFrontDesk: [],
      enrolled: [],
      detached: [],
    });
  });
});

// --- Tickets --------------------------------------------------------------

describe("tickets", () => {
  it("counts each preset the legacy surface showed", () => {
    const list: Ticket[] = [
      ticket({ number: 1, status: "Backlog", attention: "attention/1-agent" }),
      ticket({ number: 2, status: "In progress", labels: ["state/1-wip"] }),
      ticket({ number: 3, status: "Review", attention: "attention/2-user", labels: ["state/2-review"] }),
      ticket({ number: 4, status: "Backlog", labels: ["state/3-verify"] }),
    ];
    const expected: Record<TicketFilter, number> = {
      all: 4,
      "needs-you": 1,
      "needs-attention": 4,
      "triage-review": 1,
      "in-progress": 1,
      verify: 1,
    };
    for (const [id, count] of Object.entries(expected)) {
      assert.equal(ticketCountFor(list, id as TicketFilter), count, `count for ${id}`);
    }
    for (const [id] of Object.entries(expected)) {
      const visible = list.filter((t) => ticketMatchesFilter(t, id as TicketFilter));
      assert.equal(visible.length, expected[id as TicketFilter], `filter for ${id}`);
    }
  });

  it("sorts by every exposed field in both directions", () => {
    const list: Ticket[] = [
      ticket({ number: 3, title: "c", status: "Review", comments: 5, repo: "b/repo" }),
      ticket({ number: 1, title: "a", status: "Backlog", comments: 9, repo: "a/repo" }),
      ticket({ number: 2, title: "b", status: "In progress", comments: 1, repo: "c/repo" }),
    ];
    const fields: TicketSortField[] = ["number", "title", "status", "comments", "repo"];
    const dirs: SortDirection[] = ["asc", "desc"];
    for (const field of fields) {
      for (const direction of dirs) {
        const sorted = sortTickets(list, field, direction);
        assert.equal(sorted.length, 3);
        assert.equal(new Set(sorted.map((t) => t.number)).size, 3, `sort ${field} ${direction} lost a ticket`);
      }
    }
    assert.deepEqual(sortTickets(list, "number", "asc").map((t) => t.number), [1, 2, 3]);
    assert.deepEqual(sortTickets(list, "number", "desc").map((t) => t.number), [3, 2, 1]);
    // Input order is never mutated.
    assert.deepEqual(list.map((t) => t.number), [3, 1, 2]);
  });
});

// --- Queue ----------------------------------------------------------------

describe("queue", () => {
  it("classifies ready, busy, and paused with paused winning", () => {
    assert.equal(queueState({ paused: false, isBusy: true }), "busy");
    assert.equal(queueState({ paused: true, isBusy: true }), "paused");
    assert.equal(queueState({ paused: false, isBusy: false }), "ready");
  });

  it("filters by preset", () => {
    // Pool order: ready, busy, paused.
    const cases: Array<[QueuePreset, boolean[]]> = [
      ["all", [true, true, true]],
      ["pending-processing", [true, true, false]],
      ["dead-failed", [false, false, true]],
    ];
    for (const [preset, expected] of cases) {
      const pools = [queue(), queue({ isBusy: true }), queue({ paused: true })];
      const actual = pools.map((q) => queueMatchesFilter(q, preset));
      assert.deepEqual(actual, expected, `preset ${preset}`);
    }
  });

  it("sorts by every exposed field", () => {
    const list = [queue({ key: "b", depth: 1 }), queue({ key: "a", depth: 3, paused: true })];
    const fields: QueueSortField[] = ["repo", "depth", "status"];
    for (const field of fields) {
      const sorted = sortQueues(list, field, "asc");
      assert.equal(sorted.length, 2, `sort ${field}`);
    }
    assert.deepEqual(sortQueues(list, "repo", "asc").map((q) => q.key), ["a", "b"]);
  });
});

// --- Router ---------------------------------------------------------------

describe("router badge", () => {
  it("never reports two contradictory states", () => {
    assert.deepEqual(routerBadge(true, true), { label: "Router active", tone: "ok", pulse: true });
    assert.deepEqual(routerBadge(false, true), { label: "Router starting", tone: "warn", pulse: false });
    assert.deepEqual(routerBadge(false, false), { label: "Router disconnected", tone: "critical", pulse: false });
    // Connected wins even if the service flag disagrees.
    assert.equal(routerBadge(true, false).label, "Router active");
  });
});

// --- Formatting -----------------------------------------------------------

describe("formatting", () => {
  it("renders relative time across every bucket", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    assert.equal(relativeTime("2026-01-01T23:59:30.000Z", now), "30s ago");
    assert.equal(relativeTime("2026-01-01T23:30:00.000Z", now), "30m ago");
    assert.equal(relativeTime("2026-01-01T12:00:00.000Z", now), "12h ago");
    assert.equal(relativeTime("2025-12-30T00:00:00.000Z", now), "3d ago");
    assert.equal(relativeTime("nonsense", now), "");
    assert.equal(relativeTime(null, now), "");
  });

  it("renders durations compactly at every scale", () => {
    assert.equal(durationText(undefined), "—");
    assert.equal(durationText(null), "—");
    assert.equal(durationText(-1), "—");
    assert.equal(durationText(Number.NaN), "—");
    assert.equal(durationText(0), "0s");
    assert.equal(durationText(45_000), "45s");
    assert.equal(durationText(90_000), "1m 30s");
    assert.equal(durationText(3_600_000), "1h");
    assert.equal(durationText(5_400_000), "1h 30m");
    assert.equal(durationText(90_000_000), "1d 1h");
  });
});

// --- Blocked summary ------------------------------------------------------

describe("blocked summary", () => {
  it("splits permission blocks from input blocks", () => {
    const summary = blockedSummary([
      agent({ id: "a", pendingPermissions: [{ id: "r" }] }),
      agent({ id: "b", requiresAttention: true, attentionReason: "input" }),
      agent({ id: "c" }),
    ]);
    assert.deepEqual(summary, { total: 2, permissions: 1, awaitingInput: 1 });
  });
});
