import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterIssues,
  sortIssues,
  filterQueues,
  sortQueues,
  filterAgents,
  sortAgents,
  filterRunners,
  sortRunners,
  filterMetricCandidates,
  sortMetricCandidates,
  isAgentEligibleForBulkArchive,
  filterBulkArchiveCandidates,
  collectAttentionAgents,
  countPermissionAgents,
  buildProjectGroups,
  selectPrimaryFrontDeskNode,
  filterAgentTree,
  isRepoMatching,
  getStatusLightColor,
  STATUS_LIGHT_GREEN,
  STATUS_LIGHT_ORANGE,
  STATUS_LIGHT_RED,
  STATUS_LIGHT_COLORS,
  deriveHealthGauge,
  DEFAULT_HEALTH_GAUGE_THRESHOLDS,
} from "./sort-filter.js";

import type {
  UppidiIssue,
  HookQueueItem,
  UppidiAgent,
  UppidiAgentTreeNode,
  UppidiRunner,
  CandidateModelMetrics,
} from "./contracts.js";

describe("Uppidi Fleet sort & filter predicates", () => {
  const issues: UppidiIssue[] = [
    {
      number: 10,
      title: "Fix crash on startup",
      state: "open",
      repo: "xpufx-org/paseo",
      status: "In progress",
      attention: "attention/1-agent",
      labels: ["state/1-wip", "priority/1-high"],
      comments: 3,
    },
    {
      number: 20,
      title: "Review architecture spec",
      state: "open",
      repo: "xpufx-org/paseo",
      status: "Review",
      attention: "attention/2-user",
      labels: ["state/2-review", "priority/2-normal"],
      comments: 12,
    },
    {
      number: 5,
      title: "Verify benchmark suite",
      state: "open",
      repo: "xpufx-org/platform",
      status: "In progress",
      attention: "attention/0-orchestrator",
      labels: ["state/3-verify"],
      comments: 0,
    },
  ];

  it("filters issues by preset and query", () => {
    assert.equal(filterIssues(issues, "all", "").length, 3);
    assert.equal(filterIssues(issues, "needs-attention", "").length, 3);
    assert.equal(filterIssues(issues, "needs-you", "").length, 1);
    assert.equal(filterIssues(issues, "needs-you", "")[0].number, 20);
    assert.equal(filterIssues(issues, "needs-you", "")[0].attention, "attention/2-user");
    assert.equal(filterIssues(issues, "in-progress", "").length, 1);
    assert.equal(filterIssues(issues, "in-progress", "")[0].number, 10);
    assert.equal(filterIssues(issues, "triage-review", "").length, 1);
    assert.equal(filterIssues(issues, "triage-review", "")[0].number, 20);
    assert.equal(filterIssues(issues, "verify", "").length, 1);
    assert.equal(filterIssues(issues, "verify", "")[0].number, 5);

    // Query filter
    assert.equal(filterIssues(issues, "all", "crash").length, 1);
    assert.equal(filterIssues(issues, "all", "platform").length, 1);
    assert.equal(filterIssues(issues, "all", "nonexistent").length, 0);
  });

  it("sorts issues ascending and descending", () => {
    const byNumAsc = sortIssues(issues, "number", "asc");
    assert.deepEqual(byNumAsc.map((i) => i.number), [5, 10, 20]);

    const byNumDesc = sortIssues(issues, "number", "desc");
    assert.deepEqual(byNumDesc.map((i) => i.number), [20, 10, 5]);

    const byCommentsDesc = sortIssues(issues, "comments", "desc");
    assert.deepEqual(byCommentsDesc.map((i) => i.number), [20, 10, 5]);
  });

  const queues: HookQueueItem[] = [
    { key: "repo-a", depth: 4, isBusy: true, paused: false, dropped: 0, busyAttempts: 0, messages: [] },
    { key: "repo-b", depth: 0, isBusy: false, paused: true, dropped: 0, busyAttempts: 0, messages: [] },
    { key: "repo-c", depth: 0, isBusy: false, paused: false, dropped: 0, busyAttempts: 0, messages: [] },
  ];

  it("filters and sorts hook queues", () => {
    assert.equal(filterQueues(queues, "all", "").length, 3);
    assert.equal(filterQueues(queues, "pending-processing", "").length, 1);
    assert.equal(filterQueues(queues, "pending-processing", "")[0].key, "repo-a");
    assert.equal(filterQueues(queues, "dead-failed", "").length, 1);
    assert.equal(filterQueues(queues, "dead-failed", "")[0].key, "repo-b");

    const byDepthDesc = sortQueues(queues, "depth", "desc");
    assert.equal(byDepthDesc[0].key, "repo-a");
  });

  const agents: UppidiAgent[] = [
    {
      id: "agent-1",
      shortId: "ag1",
      name: "Front Desk",
      category: "front-desk",
      status: "running",
      deterministicState: "working",
    },
    {
      id: "agent-2",
      shortId: "ag2",
      name: "Orchestrator",
      category: "orchestrator",
      status: "idle",
      deterministicState: "idle:waiting",
    },
    {
      id: "agent-3",
      shortId: "ag3",
      name: "Worker",
      category: "worker",
      status: "error",
      deterministicState: "failed:error",
    },
  ];

  it("filters and sorts agents", () => {
    assert.equal(filterAgents(agents, "all", "").length, 3);
    assert.equal(filterAgents(agents, "active", "").length, 1);
    assert.equal(filterAgents(agents, "idle", "").length, 1);
    assert.equal(filterAgents(agents, "blocked", "").length, 1);
    assert.equal(filterAgents(agents, "blocked", "")[0].id, "agent-3");

    const sortedByName = sortAgents(agents, "name", "asc");
    assert.equal(sortedByName[0].name, "Front Desk");
  });

  const runners: UppidiRunner[] = [
    { id: "1", name: "runner-online", status: "online", labels: ["ubuntu"] },
    { id: "2", name: "runner-offline", status: "offline", labels: ["docker"] },
  ];

  it("filters and sorts runners", () => {
    assert.equal(filterRunners(runners, "all", "").length, 2);
    assert.equal(filterRunners(runners, "online", "").length, 1);
    assert.equal(filterRunners(runners, "offline", "").length, 1);
  });

  const candidates: CandidateModelMetrics[] = [
    {
      model: "model-fast",
      provider: "openrouter",
      configProfile: "default",
      overallPassRate: 92,
      medianWallMs: 4000,
      totalTrials: 50,
      recommendedRoles: ["Worker/Coder"],
      profiles: [],
    },
    {
      model: "model-liaison",
      provider: "openrouter",
      configProfile: "default",
      overallPassRate: 88,
      medianWallMs: 2500,
      totalTrials: 100,
      recommendedRoles: ["Front Desk", "Liaison"],
      profiles: [],
    },
    {
      model: "model-cheap",
      provider: "google",
      configProfile: "default",
      overallPassRate: 70,
      medianWallMs: 1500,
      totalTrials: 30,
      recommendedRoles: ["Triage"],
      profiles: [],
    },
  ];

  it("filters and sorts benchmark candidates", () => {
    assert.equal(filterMetricCandidates(candidates, "all", "").length, 3);
    assert.equal(filterMetricCandidates(candidates, "high-pass", "").length, 2);
    assert.equal(filterMetricCandidates(candidates, "bugfix-suitable", "").length, 1);
    assert.equal(filterMetricCandidates(candidates, "bugfix-suitable", "")[0].model, "model-fast");
    assert.equal(filterMetricCandidates(candidates, "liaison-suitable", "").length, 1);
    assert.equal(filterMetricCandidates(candidates, "liaison-suitable", "")[0].model, "model-liaison");

    const byPassRateDesc = sortMetricCandidates(candidates, "passRate", "desc");
    assert.equal(byPassRateDesc[0].model, "model-fast");

    const byLatencyAsc = sortMetricCandidates(candidates, "latency", "asc");
    assert.equal(byLatencyAsc[0].model, "model-cheap");
  });

  describe("bulk archive eligibility predicates (#402)", () => {
    it("protects front-desk and orchestrator agents from bulk archive", () => {
      const frontDesk: UppidiAgent = {
        id: "fd-1",
        shortId: "fd1",
        name: "Front Desk",
        category: "front-desk",
        status: "idle",
        deterministicState: "idle:waiting",
      };
      const frontDeskFailed: UppidiAgent = {
        id: "fd-2",
        shortId: "fd2",
        name: "Front Desk Failed",
        category: "front-desk",
        status: "error",
        deterministicState: "failed:error",
      };
      const orchestrator: UppidiAgent = {
        id: "orch-1",
        shortId: "orch1",
        name: "Orchestrator",
        category: "orchestrator",
        status: "idle",
        deterministicState: "idle:waiting",
      };
      const orchestratorFailed: UppidiAgent = {
        id: "orch-2",
        shortId: "orch2",
        name: "Orchestrator Failed",
        category: "orchestrator",
        status: "error",
        deterministicState: "failed:quota-exhausted",
      };

      assert.equal(isAgentEligibleForBulkArchive(frontDesk), false);
      assert.equal(isAgentEligibleForBulkArchive(frontDeskFailed), false);
      assert.equal(isAgentEligibleForBulkArchive(orchestrator), false);
      assert.equal(isAgentEligibleForBulkArchive(orchestratorFailed), false);
    });

    it("protects running and working agents from bulk archive", () => {
      const workingWorker: UppidiAgent = {
        id: "w-work",
        shortId: "ww1",
        name: "Worker 1",
        category: "worker",
        status: "busy",
        deterministicState: "working",
      };
      const runningWorker: UppidiAgent = {
        id: "w-run",
        shortId: "wr1",
        name: "Worker 2",
        category: "worker",
        status: "running",
        deterministicState: "running",
      };
      const activeWorkerStatus: UppidiAgent = {
        id: "w-run-stat",
        shortId: "wrs1",
        name: "Worker 3",
        category: "worker",
        status: "Running",
        deterministicState: "sleeping",
      };

      assert.equal(isAgentEligibleForBulkArchive(workingWorker), false);
      assert.equal(isAgentEligibleForBulkArchive(runningWorker), false);
      assert.equal(isAgentEligibleForBulkArchive(activeWorkerStatus), false);
    });

    it("allows deterministic failed states for bulk archive", () => {
      const failedQuota: UppidiAgent = {
        id: "w-fail-q",
        shortId: "wfq1",
        name: "Worker Quota",
        category: "worker",
        status: "error",
        deterministicState: "failed:quota-exhausted",
      };
      const failedSpawn: UppidiAgent = {
        id: "w-fail-s",
        shortId: "wfs1",
        name: "Worker Spawn",
        category: "worker",
        status: "error",
        deterministicState: "failed:spawn",
      };
      const failedTimeout: UppidiAgent = {
        id: "w-fail-t",
        shortId: "wft1",
        name: "Worker Timeout",
        category: "worker",
        status: "error",
        deterministicState: "failed:timeout",
      };
      const failedError: UppidiAgent = {
        id: "w-fail-e",
        shortId: "wfe1",
        name: "Worker Error",
        category: "worker",
        status: "error",
        deterministicState: "failed:error",
      };

      assert.equal(isAgentEligibleForBulkArchive(failedQuota), true);
      assert.equal(isAgentEligibleForBulkArchive(failedSpawn), true);
      assert.equal(isAgentEligibleForBulkArchive(failedTimeout), true);
      assert.equal(isAgentEligibleForBulkArchive(failedError), true);
    });

    it("allows closed, completed, and terminated worker agents while protecting idle waiting workers (#409)", () => {
      const closedWorker: UppidiAgent = {
        id: "w-closed",
        shortId: "wc1",
        name: "Closed Worker",
        category: "worker",
        status: "closed",
        deterministicState: "sleeping",
      };
      const completedWorker: UppidiAgent = {
        id: "w-completed",
        shortId: "wcmp1",
        name: "Completed Worker",
        category: "worker",
        status: "completed",
        deterministicState: "sleeping",
      };
      const terminatedWorker: UppidiAgent = {
        id: "w-term",
        shortId: "wt1",
        name: "Terminated Worker",
        category: "worker",
        status: "terminated",
        deterministicState: "unknown",
      };
      const idleWaitingWorker: UppidiAgent = {
        id: "w-idle",
        shortId: "wi1",
        name: "Idle Worker",
        category: "worker",
        status: "idle",
        deterministicState: "idle:waiting",
      };
      const idleQuotaWorker: UppidiAgent = {
        id: "w-idle-q",
        shortId: "wiq1",
        name: "Idle Quota Worker",
        category: "worker",
        status: "idle",
        deterministicState: "idle:quota-exhausted",
      };

      assert.equal(isAgentEligibleForBulkArchive(closedWorker), true);
      assert.equal(isAgentEligibleForBulkArchive(completedWorker), true);
      assert.equal(isAgentEligibleForBulkArchive(terminatedWorker), true);
      assert.equal(isAgentEligibleForBulkArchive(idleWaitingWorker), false);
      assert.equal(isAgentEligibleForBulkArchive(idleQuotaWorker), false);
    });

    it("filterBulkArchiveCandidates filters out protected agents accurately", () => {
      const fleet: UppidiAgent[] = [
        {
          id: "fd",
          shortId: "fd",
          name: "Front Desk",
          category: "front-desk",
          status: "idle",
          deterministicState: "idle:waiting",
        },
        {
          id: "orch",
          shortId: "orch",
          name: "Orchestrator",
          category: "orchestrator",
          status: "running",
          deterministicState: "running",
        },
        {
          id: "w-running",
          shortId: "wr",
          name: "Running Worker",
          category: "worker",
          status: "running",
          deterministicState: "working",
        },
        {
          id: "w-failed",
          shortId: "wf",
          name: "Failed Worker",
          category: "worker",
          status: "error",
          deterministicState: "failed:spawn",
        },
        {
          id: "w-idle",
          shortId: "wi",
          name: "Idle Worker",
          category: "worker",
          status: "idle",
          deterministicState: "idle:waiting",
        },
        {
          id: "w-completed",
          shortId: "wc",
          name: "Completed Worker",
          category: "worker",
          status: "completed",
          deterministicState: "sleeping",
        },
      ];

      const candidates = filterBulkArchiveCandidates(fleet);
      assert.equal(candidates.length, 2);
      assert.deepEqual(
        candidates.map((c) => c.id),
        ["w-failed", "w-completed"]
      );
    });
  });

  describe("blocked agent attention collection (#534)", () => {
    const base = (id: string): UppidiAgent => ({
      id,
      shortId: id,
      name: id,
      category: "worker",
      status: "running",
      deterministicState: "permission-prompt",
    });

    it("collects permission-prompt and non-benign attention agents only", () => {
      const fleet: UppidiAgent[] = [
        {
          ...base("perm"),
          pendingPermissions: [{ id: "req-1", tool: "run_command" }],
          requiresAttention: true,
          attentionReason: "permission",
        },
        {
          ...base("input"),
          deterministicState: "attention-required",
          pendingPermissions: [],
          requiresAttention: true,
          attentionReason: "input",
        },
        {
          ...base("done"),
          deterministicState: "idle:waiting",
          pendingPermissions: [],
          requiresAttention: true,
          attentionReason: "finished",
        },
        { ...base("healthy"), deterministicState: "working" },
      ];

      const attention = collectAttentionAgents(fleet);
      assert.deepEqual(
        attention.map((a) => a.id),
        ["perm", "input"]
      );

      assert.equal(countPermissionAgents(fleet), 1);
    });

    it("treats a pending permission as attention even without the flag", () => {
      const agent: UppidiAgent = {
        ...base("perm-only"),
        pendingPermissions: [{ id: "req-2", title: "access external dir" }],
        requiresAttention: false,
      };
      assert.deepEqual(
        collectAttentionAgents([agent]).map((a) => a.id),
        ["perm-only"]
      );
    });

    it("counts blocked states as the blocked agent preset", () => {
      const fleet: UppidiAgent[] = [
        { ...base("perm"), pendingPermissions: [{ id: "req-1" }] },
        { ...base("att"), deterministicState: "attention-required" },
        { ...base("idle"), deterministicState: "idle:waiting" },
      ];
      assert.deepEqual(
        filterAgents(fleet, "blocked", "").map((a) => a.id),
        ["perm", "att"]
      );
    });

    it("never bulk-archives blocked agents awaiting clearance", () => {
      const blocked: UppidiAgent = {
        ...base("blocked"),
        status: "closed",
        deterministicState: "attention-required",
        requiresAttention: true,
        attentionReason: "input",
      };
      assert.equal(isAgentEligibleForBulkArchive(blocked), false);

      const blockedPerm: UppidiAgent = {
        ...base("blocked-perm"),
        status: "closed",
        deterministicState: "permission-prompt",
        pendingPermissions: [{ id: "req-3" }],
      };
      assert.equal(isAgentEligibleForBulkArchive(blockedPerm), false);
    });
  });

  describe("project grouping and tree hierarchy (#403)", () => {
    const frontDeskAgent: UppidiAgent = {
      id: "fd-1",
      shortId: "fd1",
      name: "Front Desk Liaison",
      category: "front-desk",
      status: "running",
      deterministicState: "running",
      worktree: "main",
    };

    const paseoOrch: UppidiAgent = {
      id: "orch-paseo",
      shortId: "orch1",
      name: "Orchestrator · xpufx-org/paseo",
      category: "orchestrator",
      status: "running",
      deterministicState: "working",
      project: "xpufx-org/paseo",
      worktree: "paseo",
    };

    const paseoWorker1: UppidiAgent = {
      id: "worker-403",
      shortId: "w403",
      name: "feat-403-dense-fleet-tree",
      category: "worker",
      status: "busy",
      parentId: "orch-paseo",
      deterministicState: "working",
      project: "xpufx-org/paseo",
      worktree: "feat-403-dense-fleet-tree",
      attributedWork: { repo: "xpufx-org/paseo", issue: 403, slug: "feat-403-dense-fleet-tree" },
    };

    const platformOrch: UppidiAgent = {
      id: "orch-plat",
      shortId: "orch2",
      name: "Orchestrator · xpufx-org/platform",
      category: "orchestrator",
      status: "idle",
      deterministicState: "sleeping",
      project: "xpufx-org/platform",
      worktree: "platform",
    };

    const unparentedWorker: UppidiAgent = {
      id: "worker-misc",
      shortId: "wmisc",
      name: "scratch-worker",
      category: "worker",
      status: "idle",
      deterministicState: "idle:waiting",
      project: "Default Project",
    };

    const tree: UppidiAgentTreeNode[] = [
      {
        agent: frontDeskAgent,
        depth: 0,
        children: [],
      },
      {
        agent: paseoOrch,
        depth: 0,
        children: [
          {
            agent: paseoWorker1,
            depth: 1,
            children: [],
          },
        ],
      },
      {
        agent: platformOrch,
        depth: 0,
        children: [],
      },
      {
        agent: unparentedWorker,
        depth: 0,
        children: [],
      },
    ];

    it("elevates Front Desk to top and groups rest by project", () => {
      const { frontDeskNodes, projectGroups } = buildProjectGroups(tree);

      assert.equal(frontDeskNodes.length, 1);
      assert.equal(frontDeskNodes[0].agent.id, "fd-1");

      assert.equal(projectGroups.length, 3);
      // paseo is active (runningCount: 2), so it is sorted first
      assert.equal(projectGroups[0].projectName, "xpufx-org/paseo");
      assert.equal(projectGroups[0].runningCount, 2);
      assert.equal(projectGroups[0].totalCount, 2);
      assert.equal(projectGroups[0].orchestrators.length, 1);
      assert.equal(projectGroups[0].orchestrators[0].children.length, 1);

      // platform is idle (runningCount: 0)
      assert.equal(projectGroups[1].projectName, "xpufx-org/platform");
      assert.equal(projectGroups[1].runningCount, 0);
      assert.equal(projectGroups[1].totalCount, 1);

      // Default Project is sorted last
      assert.equal(projectGroups[2].projectName, "Default Project");
      assert.equal(projectGroups[2].unparentedWorkers.length, 1);
    });

    it("filters agent tree preserving lineage to matching descendants", () => {
      // Search for "#403" should retain orchestrator -> worker-403
      const filtered = filterAgentTree(tree, (agent) =>
        agent.name.includes("403") || (agent.attributedWork?.issue === 403)
      );

      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].agent.id, "orch-paseo"); // Parent kept because child matches!
      assert.equal(filtered[0].children.length, 1);
      assert.equal(filtered[0].children[0].agent.id, "worker-403");
    });

    it("filterAgents matches query against worktree and project", () => {
      const agents = [frontDeskAgent, paseoOrch, paseoWorker1];
      const byWorktree = filterAgents(agents, "all", "dense-fleet-tree");
      assert.equal(byWorktree.length, 1);
      assert.equal(byWorktree[0].id, "worker-403");

      const byProject = filterAgents(agents, "all", "xpufx-org/paseo");
      assert.equal(byProject.length, 2);
    });

    it("promotes orchestrator spawned by Front Desk to project group while retaining subtasks (#430)", () => {
      const fdNode: UppidiAgentTreeNode = {
        agent: {
          id: "fd-1",
          shortId: "fd1",
          name: "Front Desk",
          category: "front-desk",
          status: "idle",
          deterministicState: "idle:waiting",
        },
        depth: 0,
        children: [
          {
            agent: {
              id: "fd-subtask-1",
              shortId: "fst1",
              name: "Research Subtask",
              category: "worker",
              status: "running",
              parentId: "fd-1",
              deterministicState: "working",
              project: "xpufx-org/aur-automation",
            },
            depth: 1,
            children: [],
          },
          {
            agent: {
              id: "orch-aur",
              shortId: "oaur",
              name: "Orchestrator · xpufx-org/aur-automation",
              category: "orchestrator",
              status: "running",
              parentId: "fd-1",
              deterministicState: "working",
              project: "xpufx-org/aur-automation",
            },
            depth: 1,
            children: [
              {
                agent: {
                  id: "worker-aur-1",
                  shortId: "waur1",
                  name: "feat-430-aur-task",
                  category: "worker",
                  status: "running",
                  parentId: "orch-aur",
                  deterministicState: "working",
                  project: "xpufx-org/aur-automation",
                },
                depth: 2,
                children: [],
              },
            ],
          },
        ],
      };

      const { frontDeskNodes, projectGroups } = buildProjectGroups([fdNode]);

      // 1. Front Desk node retained with non-orchestrator subtask only
      assert.equal(frontDeskNodes.length, 1);
      assert.equal(frontDeskNodes[0].agent.id, "fd-1");
      assert.equal(frontDeskNodes[0].children.length, 1);
      assert.equal(frontDeskNodes[0].children[0].agent.id, "fd-subtask-1");

      // 2. Promoted orchestrator placed in its project group
      assert.equal(projectGroups.length, 1);
      const aurGroup = projectGroups[0];
      assert.equal(aurGroup.projectName, "xpufx-org/aur-automation");
      assert.equal(aurGroup.orchestrators.length, 1);

      // 3. Depth adjustment: orchestrator depth 0, worker depth 1
      const promotedOrch = aurGroup.orchestrators[0];
      assert.equal(promotedOrch.agent.id, "orch-aur");
      assert.equal(promotedOrch.depth, 0);
      assert.equal(promotedOrch.children.length, 1);

      const promotedWorker = promotedOrch.children[0];
      assert.equal(promotedWorker.agent.id, "worker-aur-1");
      assert.equal(promotedWorker.depth, 1);

      // 4. Counts reflect orchestrator + worker
      assert.equal(aurGroup.totalCount, 2);
      assert.equal(aurGroup.runningCount, 2);
      assert.deepEqual(
        aurGroup.allAgents.map((a) => a.id),
        ["orch-aur", "worker-aur-1"]
      );
    });

    it("treats Front Desk as a singleton and elevates only the registered session (#470)", () => {
      const makeFd = (
        id: string,
        overrides: Partial<UppidiAgent> = {}
      ): UppidiAgentTreeNode => ({
        agent: {
          id,
          shortId: id,
          name: `Front Desk ${id}`,
          category: "front-desk",
          status: "running",
          deterministicState: "running",
          lastActivityAt: "2026-01-01T00:00:00.000Z",
          ...overrides,
        },
        depth: 0,
        children: [],
      });

      const registered = makeFd("fd-registered");
      const duplicate = makeFd("fd-duplicate", {
        lastActivityAt: "2026-05-01T00:00:00.000Z",
        status: "idle",
        deterministicState: "idle:waiting",
      });

      // 1. Hook-daemon registration decides the primary, regardless of activity
      const result = buildProjectGroups([duplicate, registered], {
        registeredFrontDeskAgentId: "fd-registered",
      });
      assert.equal(result.frontDeskNodes.length, 1);
      assert.equal(result.frontDeskNodes[0].agent.id, "fd-registered");
      assert.deepEqual(
        result.staleFrontDeskNodes.map((n) => n.agent.id),
        ["fd-duplicate"]
      );

      // 2. No "secondary front desk" grouping: at most one primary ever
      assert.equal(result.frontDeskNodes.length, 1);
    });

    it("selects a single active front desk when none is registered (#470)", () => {
      const makeFd = (
        id: string,
        overrides: Partial<UppidiAgent> = {}
      ): UppidiAgentTreeNode => ({
        agent: {
          id,
          shortId: id,
          name: `Front Desk ${id}`,
          category: "front-desk",
          status: "idle",
          deterministicState: "idle:waiting",
          lastActivityAt: "2026-01-01T00:00:00.000Z",
          ...overrides,
        },
        depth: 0,
        children: [],
      });

      const idleOlder = makeFd("fd-idle-older", {
        lastActivityAt: "2026-01-01T00:00:00.000Z",
      });
      const idleNewer = makeFd("fd-idle-newer", {
        lastActivityAt: "2026-06-01T00:00:00.000Z",
      });
      const active = makeFd("fd-active", {
        status: "running",
        deterministicState: "working",
        lastActivityAt: "2026-02-01T00:00:00.000Z",
      });

      // Active wins over newer idle; remaining sessions are stale, not secondary.
      const { primary, stale } = selectPrimaryFrontDeskNode([
        idleNewer,
        idleOlder,
        active,
      ]);
      assert.equal(primary?.agent.id, "fd-active");
      assert.deepEqual(
        stale.map((n) => n.agent.id).sort(),
        ["fd-idle-newer", "fd-idle-older"]
      );

      // Fallback to most recently active when none are running/working.
      const fallback = selectPrimaryFrontDeskNode([idleOlder, idleNewer]);
      assert.equal(fallback.primary?.agent.id, "fd-idle-newer");
      assert.deepEqual(
        fallback.stale.map((n) => n.agent.id),
        ["fd-idle-older"]
      );

      // Empty input yields no primary.
      assert.equal(selectPrimaryFrontDeskNode([]).primary, null);
    });

    it("routes duplicate front-desk sessions to staleFrontDeskNodes instead of a secondary group (#470)", () => {
      const fdNodes: UppidiAgentTreeNode[] = [
        {
          agent: {
            id: "fd-primary",
            shortId: "fdp",
            name: "Front Desk Primary",
            category: "front-desk",
            status: "running",
            deterministicState: "running",
          },
          depth: 0,
          children: [],
        },
        {
          agent: {
            id: "fd-orphan",
            shortId: "fdo",
            name: "Front Desk Orphan",
            category: "front-desk",
            status: "idle",
            deterministicState: "idle:waiting",
          },
          depth: 0,
          children: [],
        },
      ];

      const result = buildProjectGroups(fdNodes, {
        registeredFrontDeskAgentId: "fd-primary",
      });

      assert.equal(result.frontDeskNodes.length, 1);
      assert.equal(result.frontDeskNodes[0].agent.id, "fd-primary");
      assert.equal(result.staleFrontDeskNodes.length, 1);
      assert.equal(result.staleFrontDeskNodes[0].agent.id, "fd-orphan");
      // Stale front-desk sessions must not leak into project groups.
      assert.equal(
        result.projectGroups.some((g) =>
          g.allAgents.some((a) => a.category === "front-desk")
        ),
        false
      );
    });
  });

  describe("agent status lights (#410)", () => {
    it("exports standard light colors matching taxonomy", () => {
      assert.equal(STATUS_LIGHT_GREEN, "#10b981");
      assert.equal(STATUS_LIGHT_ORANGE, "#f59e0b");
      assert.equal(STATUS_LIGHT_RED, "#ef4444");
      assert.equal(STATUS_LIGHT_COLORS.GREEN, "#10b981");
      assert.equal(STATUS_LIGHT_COLORS.ORANGE, "#f59e0b");
      assert.equal(STATUS_LIGHT_COLORS.RED, "#ef4444");
    });

    it("returns Green (#10b981) for working, running, executing, and busy states", () => {
      assert.equal(
        getStatusLightColor({ deterministicState: "working", status: "running" }),
        STATUS_LIGHT_GREEN
      );
      assert.equal(
        getStatusLightColor({ deterministicState: "running", status: "running" }),
        STATUS_LIGHT_GREEN
      );
      assert.equal(
        getStatusLightColor({ status: "working" }),
        STATUS_LIGHT_GREEN
      );
      assert.equal(
        getStatusLightColor({ status: "executing" }),
        STATUS_LIGHT_GREEN
      );
      assert.equal(
        getStatusLightColor({ status: "busy" }),
        STATUS_LIGHT_GREEN
      );
    });

    it("returns Orange / Amber (#f59e0b) for idle, waiting, paused, ready, sleeping, and non-failure modes", () => {
      assert.equal(
        getStatusLightColor({ deterministicState: "idle:waiting", status: "idle" }),
        STATUS_LIGHT_ORANGE
      );
      assert.equal(
        getStatusLightColor({ deterministicState: "sleeping", status: "idle" }),
        STATUS_LIGHT_ORANGE
      );
      assert.equal(
        getStatusLightColor({ deterministicState: "idle:quota-exhausted", status: "idle" }),
        STATUS_LIGHT_ORANGE
      );
      assert.equal(
        getStatusLightColor({ status: "idle" }),
        STATUS_LIGHT_ORANGE
      );
      assert.equal(
        getStatusLightColor({ status: "waiting" }),
        STATUS_LIGHT_ORANGE
      );
      assert.equal(
        getStatusLightColor({ status: "paused" }),
        STATUS_LIGHT_ORANGE
      );
      assert.equal(
        getStatusLightColor({ status: "ready" }),
        STATUS_LIGHT_ORANGE
      );
      assert.equal(
        getStatusLightColor({ status: "standby" }),
        STATUS_LIGHT_ORANGE
      );
      // Non-failure generic/closed/completed/unknown states default to Orange
      assert.equal(
        getStatusLightColor({ status: "completed" }),
        STATUS_LIGHT_ORANGE
      );
      assert.equal(
        getStatusLightColor({ status: "closed" }),
        STATUS_LIGHT_ORANGE
      );
      assert.equal(
        getStatusLightColor({ deterministicState: "unknown" }),
        STATUS_LIGHT_ORANGE
      );
    });

    it("returns Red (#ef4444) for failed, error, and timeout failure modes", () => {
      assert.equal(
        getStatusLightColor({ deterministicState: "failed:error", status: "error" }),
        STATUS_LIGHT_RED
      );
      assert.equal(
        getStatusLightColor({ deterministicState: "failed:timeout", status: "running" }),
        STATUS_LIGHT_RED
      );
      assert.equal(
        getStatusLightColor({ deterministicState: "failed:spawn", status: "error" }),
        STATUS_LIGHT_RED
      );
      assert.equal(
        getStatusLightColor({ deterministicState: "failed:quota-exhausted", status: "error" }),
        STATUS_LIGHT_RED
      );
      assert.equal(
        getStatusLightColor({ status: "error" }),
        STATUS_LIGHT_RED
      );
      assert.equal(
        getStatusLightColor({ status: "failed" }),
        STATUS_LIGHT_RED
      );
      assert.equal(
        getStatusLightColor({ status: "failure" }),
        STATUS_LIGHT_RED
      );
      assert.equal(
        getStatusLightColor({ status: "timeout" }),
        STATUS_LIGHT_RED
      );
    });

    it("handles null and undefined safely by falling back to Orange", () => {
      assert.equal(getStatusLightColor(null), STATUS_LIGHT_ORANGE);
      assert.equal(getStatusLightColor(undefined), STATUS_LIGHT_ORANGE);
      assert.equal(getStatusLightColor({}), STATUS_LIGHT_ORANGE);
    });

    it("prioritizes failure mode over running status", () => {
      assert.equal(
        getStatusLightColor({ status: "running", deterministicState: "failed:timeout" }),
        STATUS_LIGHT_RED
      );
      assert.equal(
        getStatusLightColor({ status: "executing", deterministicState: "failed:error" }),
        STATUS_LIGHT_RED
      );
    });

    it("prioritizes idle / sleeping over generic running status", () => {
      assert.equal(
        getStatusLightColor({ status: "running", deterministicState: "sleeping" }),
        STATUS_LIGHT_ORANGE
      );
      assert.equal(
        getStatusLightColor({ status: "running", deterministicState: "idle:waiting" }),
        STATUS_LIGHT_ORANGE
      );
    });
  });

  describe("enrolled fleet roster, unstaffed state, per-repo mute, and detached workspaces (#426)", () => {
    it("matches repository identifiers robustly with isRepoMatching", () => {
      assert.equal(isRepoMatching("xpufx-org/paseo", "xpufx-org/paseo"), true);
      assert.equal(isRepoMatching("https://forgejo.example/xpufx-org/paseo.git", "xpufx-org/paseo"), true);
      assert.equal(isRepoMatching("git@forgejo.example:xpufx-org/paseo.git", "xpufx-org/paseo"), true);
      assert.equal(isRepoMatching("XPUFX-ORG/PASEO", "xpufx-org/paseo"), true);
      assert.equal(isRepoMatching("paseo", "xpufx-org/paseo"), true);
      assert.equal(isRepoMatching("xpufx-org/paseo", "xpufx-org/platform"), false);
    });

    it("synthesizes enrolled unstaffed repos, tracks muted states, and handles queued hooks", () => {
      // Tree with only one agent in xpufx-org/paseo
      const activeTree: UppidiAgentTreeNode[] = [
        {
          agent: {
            id: "orch-paseo",
            shortId: "orch1",
            name: "Orchestrator · xpufx-org/paseo",
            category: "orchestrator",
            status: "running",
            deterministicState: "working",
            project: "xpufx-org/paseo",
          },
          depth: 0,
          children: [],
        },
      ];

      const options = {
        enrolledRepos: ["xpufx-org/paseo", "xpufx-org/unstaffed-repo"],
        mutedRepos: ["xpufx-org/paseo"],
        repoQueuedHooks: {
          "xpufx-org/paseo": 4,
          "xpufx-org/unstaffed-repo": 7,
        },
      };

      const result = buildProjectGroups(activeTree, options);

      // 1. Enrolled groups should contain both repos
      assert.equal(result.enrolledGroups.length, 2);

      // Paseo: enrolled, muted, has orchestrator, 4 queued hooks
      const paseoGroup = result.enrolledGroups.find((g) => g.projectName === "xpufx-org/paseo");
      assert.ok(paseoGroup);
      assert.equal(paseoGroup.isEnrolled, true);
      assert.equal(paseoGroup.isMuted, true);
      assert.equal(paseoGroup.hasOrchestrator, true);
      assert.equal(paseoGroup.queuedHooksCount, 4);
      assert.equal(paseoGroup.totalCount, 1);

      // Unstaffed: enrolled, not muted, no orchestrator, 7 queued hooks
      const unstaffedGroup = result.enrolledGroups.find(
        (g) => g.projectName === "xpufx-org/unstaffed-repo"
      );
      assert.ok(unstaffedGroup);
      assert.equal(unstaffedGroup.isEnrolled, true);
      assert.equal(unstaffedGroup.isMuted, false);
      assert.equal(unstaffedGroup.hasOrchestrator, false);
      assert.equal(unstaffedGroup.queuedHooksCount, 7);
      assert.equal(unstaffedGroup.totalCount, 0);
      assert.equal(unstaffedGroup.orchestrators.length, 0);
    });

    it("groups detached and local workspaces separately from enrolled fleet roster", () => {
      const mixedTree: UppidiAgentTreeNode[] = [
        {
          agent: {
            id: "orch-enrolled",
            shortId: "oe",
            name: "Orchestrator · xpufx-org/paseo",
            category: "orchestrator",
            status: "running",
            deterministicState: "working",
            project: "xpufx-org/paseo",
          },
          depth: 0,
          children: [],
        },
        {
          agent: {
            id: "worker-detached",
            shortId: "wd",
            name: "local-scratchpad",
            category: "worker",
            status: "idle",
            deterministicState: "idle:waiting",
            project: "scratch-local-wks",
          },
          depth: 0,
          children: [],
        },
      ];

      const options = {
        enrolledRepos: ["xpufx-org/paseo"],
      };

      const result = buildProjectGroups(mixedTree, options);

      // Enrolled groups only have xpufx-org/paseo
      assert.equal(result.enrolledGroups.length, 1);
      assert.equal(result.enrolledGroups[0].projectName, "xpufx-org/paseo");
      assert.equal(result.enrolledGroups[0].isEnrolled, true);
      assert.equal(result.enrolledGroups[0].isDetached, false);

      // Detached groups have scratch-local-wks
      assert.equal(result.detachedGroups.length, 1);
      assert.equal(result.detachedGroups[0].projectName, "scratch-local-wks");
      assert.equal(result.detachedGroups[0].isEnrolled, false);
      assert.equal(result.detachedGroups[0].isDetached, true);
      // Detached groups never display missing orchestrator warnings
      assert.equal(result.detachedGroups[0].hasOrchestrator, false);

      // Combined projectGroups places detached groups at the end
      assert.equal(result.projectGroups.length, 2);
      assert.equal(result.projectGroups[0].projectName, "xpufx-org/paseo");
      assert.equal(result.projectGroups[1].projectName, "scratch-local-wks");
    });
  });

  describe("compact agent health gauge (#560)", () => {
    const NOW = Date.parse("2026-09-25T12:00:00.000Z");
    const minutesAgo = (m: number) => new Date(NOW - m * 60 * 1000).toISOString();

    const segment = (gauge: ReturnType<typeof deriveHealthGauge>, kind: string) =>
      gauge.segments.find((s) => s.kind === kind)!;

    it("exports the default thresholds (context 75/90, turn 5m)", () => {
      assert.equal(DEFAULT_HEALTH_GAUGE_THRESHOLDS.contextWarn, 0.75);
      assert.equal(DEFAULT_HEALTH_GAUGE_THRESHOLDS.contextCritical, 0.9);
      assert.equal(DEFAULT_HEALTH_GAUGE_THRESHOLDS.turnWarnMs, 5 * 60 * 1000);
    });

    it("yields three fixed-order ok segments when metrics are absent", () => {
      const gauge = deriveHealthGauge({ metrics: null }, undefined, NOW);
      assert.deepEqual(
        gauge.segments.map((s) => s.kind),
        ["context", "turn", "error"]
      );
      assert.ok(gauge.segments.every((s) => s.ratio === 0 && s.tone === "ok"));
      assert.equal(gauge.overall, "ok");
    });

    it("treats null/undefined agents safely", () => {
      assert.equal(deriveHealthGauge(undefined, undefined, NOW).overall, "ok");
      assert.equal(deriveHealthGauge(null, undefined, NOW).overall, "ok");
    });

    it("derives context segment tones across the 75/90 boundaries", () => {
      const cases: Array<[number, number, string]> = [
        [50, 100, "ok"],
        [74, 100, "ok"],
        [75, 100, "warn"],
        [89, 100, "warn"],
        [90, 100, "critical"],
        [100, 100, "critical"],
      ];
      for (const [used, max, expected] of cases) {
        const gauge = deriveHealthGauge(
          { metrics: { contextUsedTokens: used, contextMaxTokens: max } },
          undefined,
          NOW
        );
        const ctx = segment(gauge, "context");
        assert.equal(ctx.tone, expected, `context ${used}/${max} should be ${expected}`);
        assert.equal(ctx.ratio, Math.min(1, used / max));
      }
    });

    it("ignores a zero/missing context max rather than dividing by zero", () => {
      const gauge = deriveHealthGauge(
        { metrics: { contextUsedTokens: 1000, contextMaxTokens: 0 } },
        undefined,
        NOW
      );
      const ctx = segment(gauge, "context");
      assert.equal(ctx.ratio, 0);
      assert.equal(ctx.tone, "ok");
    });

    it("derives turn segment from active turn elapsed time", () => {
      const fresh = segment(
        deriveHealthGauge({ metrics: { activeTurnStartedAt: minutesAgo(1) } }, undefined, NOW),
        "turn"
      );
      assert.equal(fresh.tone, "ok");
      assert.equal(fresh.ratio, 0.2);

      const stalled = segment(
        deriveHealthGauge({ metrics: { activeTurnStartedAt: minutesAgo(5) } }, undefined, NOW),
        "turn"
      );
      assert.equal(stalled.tone, "warn");
      assert.equal(stalled.ratio, 1);

      // Over the threshold clamps the fill at 1 but stays amber.
      const overdue = segment(
        deriveHealthGauge({ metrics: { activeTurnStartedAt: minutesAgo(20) } }, undefined, NOW),
        "turn"
      );
      assert.equal(overdue.tone, "warn");
      assert.equal(overdue.ratio, 1);
    });

    it("honours custom turn/context thresholds", () => {
      const gauge = deriveHealthGauge(
        { metrics: { activeTurnStartedAt: minutesAgo(2), contextUsedTokens: 80, contextMaxTokens: 100 } },
        { contextWarn: 0.5, contextCritical: 0.95, turnWarnMs: 60 * 1000 },
        NOW
      );
      assert.equal(segment(gauge, "context").tone, "warn");
      assert.equal(segment(gauge, "turn").tone, "warn");
      assert.equal(gauge.overall, "warn");
    });

    it("lights the error segment on a fatal error string or failed:* state", () => {
      const byError = deriveHealthGauge(
        { metrics: { inputTokens: 1 }, lastError: "boom" },
        undefined,
        NOW
      );
      assert.equal(segment(byError, "error").tone, "critical");
      assert.equal(segment(byError, "error").ratio, 1);
      assert.equal(byError.overall, "critical");

      const byState = deriveHealthGauge(
        { metrics: { inputTokens: 1 }, deterministicState: "failed:timeout" },
        undefined,
        NOW
      );
      assert.equal(segment(byState, "error").tone, "critical");

      const healthy = deriveHealthGauge(
        { metrics: { inputTokens: 1 }, deterministicState: "running", lastError: "" },
        undefined,
        NOW
      );
      assert.equal(segment(healthy, "error").tone, "ok");
      assert.equal(healthy.overall, "ok");
    });

    it("reports the worst tone across segments as overall", () => {
      // context critical dominates an otherwise ok gauge
      const gauge = deriveHealthGauge(
        { metrics: { contextUsedTokens: 95, contextMaxTokens: 100 } },
        undefined,
        NOW
      );
      assert.equal(gauge.overall, "critical");
    });
  });
});


