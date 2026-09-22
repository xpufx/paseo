import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  categorizeAgent,
  normalizeRawAgent,
  handleUppidiAgents,
  extractAttributedWork,
  deriveDeterministicState,
  buildAgentTree,
  handleUppidiArchiveAgent,
  handleUppidiArchiveInactiveAgents,
} from "./agents.js";

import { DEFAULT_ROLE_MODELS, handleUppidiRoleModels, handleUppidiSetRoleModel } from "./role-models.js";
import { handleUppidiRunners } from "./runners.js";

describe("fleet and agents classification", () => {
  it("categorizes agent names accurately", () => {
    assert.equal(categorizeAgent("Front Desk"), "front-desk");
    assert.equal(categorizeAgent("frontdesk"), "front-desk");
    assert.equal(categorizeAgent("Orchestrator · xpufx-org/paseo"), "orchestrator");
    assert.equal(categorizeAgent("Orchestrator · xpufx/platform"), "orchestrator");
    assert.equal(categorizeAgent("feat-367-worker"), "worker");
    assert.equal(categorizeAgent("platform #99 caller"), "worker");
  });

  it("extracts attributed work from titles, names, branches, and labels", () => {
    const work1 = extractAttributedWork({
      id: "agent-1",
      name: "feat-385-tree-fleet-view",
      cwd: "/home/xpufx/code/paseo",
    });
    assert.equal(work1?.issue, 385);
    assert.equal(work1?.repo, "xpufx-org/paseo");

    const work2 = extractAttributedWork({
      id: "agent-2",
      title: "Worker for xpufx-org/platform#109",
    });
    assert.equal(work2?.issue, 109);
    assert.equal(work2?.repo, "xpufx-org/platform");

    const work3 = extractAttributedWork({
      id: "agent-3",
      name: "worker",
      labels: { "forgejo.issue": "404", repo: "xpufx-org/aur-automation" },
    });
    assert.equal(work3?.issue, 404);
    assert.equal(work3?.repo, "xpufx-org/aur-automation");
  });

  it("derives deterministic states strictly according to taxonomy", () => {
    // 1. Working with issue
    const s1 = deriveDeterministicState(
      { id: "a1", status: "running" },
      { issue: 385, repo: "xpufx-org/paseo" }
    );
    assert.equal(s1.state, "working");
    assert.ok(s1.detail?.includes("#385"));

    // 2. Running without issue
    const s2 = deriveDeterministicState({ id: "a2", status: "running" }, null);
    assert.equal(s2.state, "running");

    // 3. Sleeping orchestrator (idle > 15m)
    const oldTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const s3 = deriveDeterministicState(
      { id: "a3", name: "Orchestrator · test", status: "idle", lastActivityAt: oldTime },
      null
    );
    assert.equal(s3.state, "sleeping");

    // 4. Idle waiting
    const recentTime = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const s4 = deriveDeterministicState(
      { id: "a4", name: "Orchestrator · test", status: "idle", lastActivityAt: recentTime },
      null
    );
    assert.equal(s4.state, "idle:waiting");

    // 5. Idle quota-exhausted
    const s5 = deriveDeterministicState(
      { id: "a5", status: "idle" },
      null,
      new Set(["a5"])
    );
    assert.equal(s5.state, "idle:quota-exhausted");

    // 6. Failed quota-exhausted
    const s6 = deriveDeterministicState(
      { id: "a6", status: "error", lastError: "Rate limit exceeded (429): Quota exhausted" },
      null
    );
    assert.equal(s6.state, "failed:quota-exhausted");

    // 7. Failed spawn
    const s7 = deriveDeterministicState(
      { id: "a7", status: "error", lastError: "spawn ENOENT /usr/bin/missing" },
      null
    );
    assert.equal(s7.state, "failed:spawn");

    // 8. Failed timeout
    const s8 = deriveDeterministicState(
      { id: "a8", status: "error", lastError: "Command timed out after 30000ms" },
      null
    );
    assert.equal(s8.state, "failed:timeout");

    // 9. Failed general error
    const s9 = deriveDeterministicState(
      { id: "a9", status: "error", lastError: "Unknown fatal exception in agent loop" },
      null
    );
    assert.equal(s9.state, "failed:error");
  });

  it("builds hierarchy tree correctly with depths and children", () => {
    const agents = [
      normalizeRawAgent({ id: "root-1", name: "Front Desk", status: "running" }),
      normalizeRawAgent({
        id: "orch-1",
        name: "Orchestrator · paseo",
        status: "running",
        parentId: "root-1",
        labels: { "forgejo.issue": "385" },
      }),
      normalizeRawAgent({
        id: "worker-1",
        name: "Worker 1",
        status: "running",
        parentId: "orch-1",
      }),
      normalizeRawAgent({ id: "solo-orch", name: "Orchestrator · other", status: "idle" }),
    ];

    const tree = buildAgentTree(agents);
    assert.equal(tree.length, 2); // root-1 and solo-orch

    const rootNode = tree.find((n) => n.agent.id === "root-1");
    assert.ok(rootNode);
    assert.equal(rootNode.depth, 0);
    assert.equal(rootNode.children.length, 1);

    const orchNode = rootNode.children[0];
    assert.equal(orchNode.agent.id, "orch-1");
    assert.equal(orchNode.depth, 1);
    assert.equal(orchNode.agent.deterministicState, "working");
    assert.equal(orchNode.children.length, 1);

    const workerNode = orchNode.children[0];
    assert.equal(workerNode.agent.id, "worker-1");
    assert.equal(workerNode.depth, 2);
    assert.equal(workerNode.children.length, 0);
  });

  it("normalizes raw agent records with defaults and deterministic states", () => {
    const agent = normalizeRawAgent({
      id: "64d89202-acaa-4071-b658-90db710875bd",
      name: "Front Desk",
      status: "idle",
      provider: "antigravity-acp/gemini-3.8-flash-low",
      cwd: "~/code/meta",
    });

    assert.equal(agent.id, "64d89202-acaa-4071-b658-90db710875bd");
    assert.equal(agent.shortId, "64d8920");
    assert.equal(agent.category, "front-desk");
    assert.equal(agent.status, "idle");
    assert.equal(agent.deterministicState, "idle:waiting");
    assert.equal(agent.url, "paseo://agent/64d89202-acaa-4071-b658-90db710875bd");
    assert.equal(agent.worktree, "meta");
    assert.equal(agent.project, "xpufx-org/meta");

    const custom = normalizeRawAgent({
      id: "agent-custom",
      url: "https://paseo.uppidi.com/agent/agent-custom",
    });
    assert.equal(custom.url, "https://paseo.uppidi.com/agent/agent-custom");
  });

  it("groups agents by hierarchy, calculates health totals, and attaches tree", async () => {
    const mockContext: any = {
      paseo: {
        agents: {
          list: async () => ({
            entries: [
              { agent: { id: "fd-1", name: "Front Desk", status: "idle" } },
              { agent: { id: "orch-1", name: "Orchestrator · test", status: "running" } },
              { agent: { id: "orch-2", name: "Orchestrator · platform", status: "idle" } },
              { agent: { id: "w-1", name: "Worker fix 1", status: "error" } },
            ],
          }),
        },
      },
    };

    const res = await handleUppidiAgents({}, mockContext);
    assert.equal(res.ok, true);
    assert.equal(res.frontDesk.length, 1);
    assert.equal(res.orchestrators.length, 2);
    assert.equal(res.workers.length, 1);
    assert.equal(res.tree.length, 4); // without explicit parentIds, all are roots
    assert.equal(res.totalCount, 4);
    assert.equal(res.runningCount, 1);
    assert.equal(res.idleCount, 2);
    assert.equal(res.errorCount, 1);
  });
});

describe("role models configuration", () => {
  it("provides default role mappings", async () => {
    const res = await handleUppidiRoleModels({}, {} as any);
    assert.equal(res.ok, true);
    assert.ok(res.roles["front-desk"]);
    assert.ok(res.roles["orchestrator"]);
    assert.ok(res.roles["coding-agent"]);
    assert.ok(res.availableModels.length > 0);
  });

  it("updates role model mapping", async () => {
    const updateRes = await handleUppidiSetRoleModel(
      {
        role: "orchestrator",
        primaryModel: "antigravity-acp/gemini-3.8-flash-low",
        fallbackGroup: ["antigravity-acp/gemini-3.8-flash-low", "codex/gpt-5.6-luna"],
      },
      {} as any
    );
    assert.equal(updateRes.ok, true);
  });
});

describe("runner fleet status", () => {
  it("returns known runner list", async () => {
    const res = await handleUppidiRunners({}, {} as any);
    assert.equal(res.ok, true);
    assert.ok(res.runners.length > 0);
    assert.ok(res.onlineCount >= 0);
  });
});

describe("archive agent actions (#402)", () => {
  it("archives an individual agent via Paseo SDK", async () => {
    let archivedId = "";
    const mockContext: any = {
      paseo: {
        agents: {
          ref: (id: string) => ({
            archive: async () => {
              archivedId = id;
              return { archivedAt: new Date().toISOString() };
            },
          }),
        },
      },
    };

    const res = await handleUppidiArchiveAgent({ agentId: "worker-1" }, mockContext);
    assert.equal(res.ok, true);
    assert.equal(res.agentId, "worker-1");
    assert.equal(archivedId, "worker-1");
  });

  it("handles missing agentId gracefully", async () => {
    const res = await handleUppidiArchiveAgent({ agentId: "" }, {} as any);
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("agentId is required"));
  });

  it("bulk archives inactive and failed agents while protecting running agents and orchestrators", async () => {
    const archivedIds: string[] = [];
    const mockContext: any = {
      paseo: {
        agents: {
          list: async () => ({
            entries: [
              { agent: { id: "fd-1", name: "Front Desk", status: "idle" } },
              { agent: { id: "orch-1", name: "Orchestrator · test", status: "idle" } },
              { agent: { id: "worker-running", name: "Worker running", status: "running" } },
              { agent: { id: "worker-failed", name: "Worker failed", status: "error" } },
              { agent: { id: "worker-idle", name: "Worker idle", status: "idle" } },
            ],
          }),
          ref: (id: string) => ({
            archive: async () => {
              archivedIds.push(id);
              return { archivedAt: new Date().toISOString() };
            },
          }),
        },
      },
    };

    // Case 1: Pass explicit IDs including protected ones (fd-1, orch-1, worker-running)
    const resWithTargetIds = await handleUppidiArchiveInactiveAgents(
      {
        agentIds: ["fd-1", "orch-1", "worker-running", "worker-failed", "worker-idle"],
      },
      mockContext
    );

    assert.equal(resWithTargetIds.ok, true);
    assert.equal(resWithTargetIds.archivedCount, 2);
    assert.deepEqual(resWithTargetIds.archivedIds, ["worker-failed", "worker-idle"]);
    assert.deepEqual(archivedIds, ["worker-failed", "worker-idle"]);

    // Case 2: No IDs passed, archives all eligible agents
    archivedIds.length = 0;
    const resBulkAll = await handleUppidiArchiveInactiveAgents({}, mockContext);
    assert.equal(resBulkAll.ok, true);
    assert.equal(resBulkAll.archivedCount, 2);
    assert.deepEqual(resBulkAll.archivedIds, ["worker-failed", "worker-idle"]);
    assert.deepEqual(archivedIds, ["worker-failed", "worker-idle"]);
  });

  it("handles empty candidate list gracefully", async () => {
    const mockContext: any = {
      paseo: {
        agents: {
          list: async () => ({
            entries: [
              { agent: { id: "fd-1", name: "Front Desk", status: "running" } },
              { agent: { id: "worker-1", name: "Worker 1", status: "running" } },
            ],
          }),
        },
      },
    };

    const res = await handleUppidiArchiveInactiveAgents({}, mockContext);
    assert.equal(res.ok, true);
    assert.equal(res.archivedCount, 0);
    assert.deepEqual(res.archivedIds, []);
    assert.ok(res.message?.includes("No eligible"));
  });
});

