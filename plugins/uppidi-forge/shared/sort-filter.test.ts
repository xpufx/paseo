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
} from "./sort-filter.js";
import type {
  UppidiIssue,
  HookQueueItem,
  UppidiAgent,
  UppidiRunner,
  CandidateModelMetrics,
} from "./contracts.js";

describe("Uppidi Forge sort & filter predicates", () => {
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
});
