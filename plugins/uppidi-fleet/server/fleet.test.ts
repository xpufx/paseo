import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}
if (!process.env.HOOK_STATE_DIR) {
  process.env.HOOK_STATE_DIR = path.join(os.tmpdir(), `paseo-fleet-test-${process.pid}`);
}

import {
  categorizeAgent,
  normalizeRawAgent,
  handleUppidiAgents,
  extractAttributedWork,
  deriveDeterministicState,
  buildAgentTree,
  handleUppidiArchiveAgent,
  handleUppidiArchiveInactiveAgents,
  handleUppidiCreateFrontDesk,
  handleUppidiReplaceFrontDesk,
  handleUppidiAddOrchestrator,
  handleUppidiReplaceOrchestrator,
  handleUppidiToggleRepoMute,
  spawnPaseoAgent,
  setExecFileAsyncForTest,
  resolveRepoWorkspace,
  getPersistedStateDir,
} from "./agents.js";

import { DEFAULT_ROLE_MODELS, handleUppidiRoleModels, handleUppidiSetRoleModel } from "./role-models.js";
import { handleUppidiRunners } from "./runners.js";
import { buildProjectGroups } from "../shared/sort-filter.js";

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
      cwd: "/home/user/code/paseo",
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

    // 10. Stale / transient lastError on running or idle agent (#516)
    const s10Running = deriveDeterministicState(
      {
        id: "a10",
        name: "Worker 10",
        status: "running",
        lastError: "A foreground turn is already active",
      },
      null
    );
    assert.equal(s10Running.state, "running");

    const s10Idle = deriveDeterministicState(
      {
        id: "a11",
        name: "Worker 11",
        status: "idle",
        lastError: "A foreground turn is already active",
      },
      null
    );
    assert.equal(s10Idle.state, "idle:waiting");

    // But if requiresAttention has error reason, it should still fail even if status is idle
    const s10Attention = deriveDeterministicState(
      {
        id: "a12",
        status: "idle",
        requiresAttention: true,
        attentionReason: "error",
        lastError: "Connection refused",
      },
      null
    );
    assert.equal(s10Attention.state, "failed:spawn");
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

  it("buildProjectGroups extracts an orchestrator spawned by Front Desk into projectGroups (#430)", () => {
    const agents = [
      normalizeRawAgent({ id: "root-1", name: "Front Desk", status: "running" }),
      normalizeRawAgent({
        id: "orch-1",
        name: "Orchestrator · xpufx-org/paseo",
        status: "running",
        parentId: "root-1",
        labels: { "forgejo.issue": "430", repo: "xpufx-org/paseo" },
      }),
      normalizeRawAgent({
        id: "worker-1",
        name: "Worker 1",
        status: "running",
        parentId: "orch-1",
        labels: { repo: "xpufx-org/paseo" },
      }),
    ];

    const tree = buildAgentTree(agents);
    const { frontDeskNodes, projectGroups } = buildProjectGroups(tree);

    assert.equal(frontDeskNodes.length, 1);
    assert.equal(frontDeskNodes[0].agent.id, "root-1");
    assert.equal(frontDeskNodes[0].children.length, 0); // orch-1 promoted out of Front Desk

    assert.equal(projectGroups.length, 1);
    assert.equal(projectGroups[0].projectName, "xpufx-org/paseo");
    assert.equal(projectGroups[0].orchestrators.length, 1);

    const promotedOrch = projectGroups[0].orchestrators[0];
    assert.equal(promotedOrch.agent.id, "orch-1");
    assert.equal(promotedOrch.depth, 0);
    assert.equal(promotedOrch.children.length, 1);

    const promotedWorker = promotedOrch.children[0];
    assert.equal(promotedWorker.agent.id, "worker-1");
    assert.equal(promotedWorker.depth, 1);

    assert.equal(projectGroups[0].totalCount, 2);
    assert.equal(projectGroups[0].runningCount, 2);
  });

  it("assigns parentName and parentCategory to child agents in buildAgentTree (#430)", () => {
    const agents = [
      normalizeRawAgent({ id: "root-1", name: "Front Desk", status: "running" }),
      normalizeRawAgent({
        id: "orch-1",
        name: "Orchestrator · xpufx-org/paseo",
        status: "running",
        parentId: "root-1",
        labels: { "forgejo.issue": "430", repo: "xpufx-org/paseo" },
      }),
      normalizeRawAgent({
        id: "worker-1",
        name: "Worker 1",
        status: "running",
        parentId: "orch-1",
        labels: { repo: "xpufx-org/paseo" },
      }),
    ];

    const tree = buildAgentTree(agents);

    const root = agents.find((a) => a.id === "root-1")!;
    const orch = agents.find((a) => a.id === "orch-1")!;
    const worker = agents.find((a) => a.id === "worker-1")!;

    assert.equal(root.parentName, undefined);
    assert.equal(root.parentCategory, undefined);

    // Orchestrator spawned by Front Desk
    assert.equal(orch.parentName, "Front Desk");
    assert.equal(orch.parentCategory, "front-desk");

    // Worker spawned by orchestrator
    assert.equal(worker.parentName, "Orchestrator · xpufx-org/paseo");
    assert.equal(worker.parentCategory, "orchestrator");

    // Verify on tree nodes as well
    const rootNode = tree.find((n) => n.agent.id === "root-1")!;
    const orchNode = rootNode.children.find((n) => n.agent.id === "orch-1")!;
    const workerNode = orchNode.children.find((n) => n.agent.id === "worker-1")!;

    assert.equal(orchNode.agent.parentName, "Front Desk");
    assert.equal(orchNode.agent.parentCategory, "front-desk");
    assert.equal(workerNode.agent.parentName, "Orchestrator · xpufx-org/paseo");
    assert.equal(workerNode.agent.parentCategory, "orchestrator");
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
    // cwd is not authoritative for project resolution (#530)
    assert.equal(agent.project, "Default Project");

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

  it("bulk archives inactive and failed agents while protecting running agents, orchestrators, and idle waiting agents (#409)", async () => {
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
              { agent: { id: "worker-closed", name: "Worker closed", status: "closed" } },
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

    // Case 1: Pass explicit IDs including protected ones (fd-1, orch-1, worker-running, worker-idle)
    const resWithTargetIds = await handleUppidiArchiveInactiveAgents(
      {
        agentIds: [
          "fd-1",
          "orch-1",
          "worker-running",
          "worker-failed",
          "worker-idle",
          "worker-closed",
        ],
      },
      mockContext
    );

    assert.equal(resWithTargetIds.ok, true);
    assert.equal(resWithTargetIds.archivedCount, 2);
    assert.deepEqual(resWithTargetIds.archivedIds, ["worker-failed", "worker-closed"]);
    assert.deepEqual(archivedIds, ["worker-failed", "worker-closed"]);

    // Case 2: No IDs passed, archives all eligible agents (worker-idle MUST NOT be archived)
    archivedIds.length = 0;
    const resBulkAll = await handleUppidiArchiveInactiveAgents({}, mockContext);
    assert.equal(resBulkAll.ok, true);
    assert.equal(resBulkAll.archivedCount, 2);
    assert.deepEqual(resBulkAll.archivedIds, ["worker-failed", "worker-closed"]);
    assert.deepEqual(archivedIds, ["worker-failed", "worker-closed"]);
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

describe("fleet roster lifecycle actions and per-repo mute RPCs (#426)", () => {
  it("creates Front Desk session via handleUppidiCreateFrontDesk", async () => {
    let createdPayload: any = null;
    const mockContext: any = {
      paseo: {
        agents: {
          create: async (opts: any) => {
            createdPayload = opts;
            return {
              agent: {
                id: "agent-fd-new",
                name: opts.name,
                role: opts.role,
                status: "running",
              },
            };
          },
        },
      },
    };

    const res = await handleUppidiCreateFrontDesk({}, mockContext);
    assert.equal(res.ok, true);
    assert.equal(res.agentId, "agent-fd-new");
    assert.equal(createdPayload?.role, "front-desk");
    assert.ok(createdPayload?.title?.includes("Front Desk"));
  });

  it("replaces Front Desk session via handleUppidiReplaceFrontDesk", async () => {
    let archivedId = "";
    let createdAgent: any = null;

    const mockContext: any = {
      paseo: {
        agents: {
          create: async (opts: any) => {
            createdAgent = opts;
            return {
              agent: {
                id: "agent-fd-replaced",
                name: opts.name || opts.title,
                role: opts.role,
                status: "running",
              },
            };
          },
          ref: (id: string) => ({
            archive: async () => {
              archivedId = id;
              return { archivedAt: new Date().toISOString() };
            },
          }),
        },
      },
    };

    const res = await handleUppidiReplaceFrontDesk(
      { existingAgentId: "agent-fd-old" },
      mockContext
    );
    assert.equal(res.ok, true);
    assert.equal(res.oldAgentId, "agent-fd-old");
    assert.equal(res.agentId, "agent-fd-replaced");
    assert.equal(archivedId, "agent-fd-old");
    assert.ok(createdAgent);
  });

  it("adds Orchestrator for repository via handleUppidiAddOrchestrator", async () => {
    let createdPayload: any = null;
    const mockContext: any = {
      paseo: {
        agents: {
          create: async (opts: any) => {
            createdPayload = opts;
            return {
              agent: {
                id: "agent-orch-created",
                name: opts.name || opts.title,
                role: opts.role,
                status: "running",
              },
            };
          },
        },
      },
    };

    const res = await handleUppidiAddOrchestrator(
      { repo: "xpufx-org/aur-automation" },
      mockContext
    );
    assert.equal(res.ok, true);
    assert.equal(res.repo, "xpufx-org/aur-automation");
    assert.equal(res.agentId, "agent-orch-created");
    assert.equal(createdPayload?.role, "orchestrator");
    assert.ok(createdPayload?.title?.includes("xpufx-org/aur-automation"));
  });

  it("replaces Orchestrator for repository via handleUppidiReplaceOrchestrator", async () => {
    let archivedId = "";
    let createdAgent: any = null;

    const mockContext: any = {
      paseo: {
        agents: {
          create: async (opts: any) => {
            createdAgent = opts;
            return {
              agent: {
                id: "agent-orch-new",
                name: opts.name,
                role: opts.role,
                status: "running",
              },
            };
          },
          ref: (id: string) => ({
            archive: async () => {
              archivedId = id;
              return { archivedAt: new Date().toISOString() };
            },
          }),
        },
      },
    };

    const res = await handleUppidiReplaceOrchestrator(
      {
        repo: "xpufx-org/paseo",
        existingAgentId: "agent-orch-old",
      },
      mockContext
    );

    assert.equal(res.ok, true);
    assert.equal(res.repo, "xpufx-org/paseo");
    assert.equal(res.oldAgentId, "agent-orch-old");
    assert.equal(res.agentId, "agent-orch-new");
    assert.equal(archivedId, "agent-orch-old");
  });

  it("toggles repository mute status via handleUppidiToggleRepoMute", async () => {
    const resMute = await handleUppidiToggleRepoMute(
      { repo: "xpufx-org/mute-test", muted: true },
      {} as any
    );
    assert.equal(resMute.ok, true);
    assert.equal(resMute.isMuted, true);
    assert.ok(resMute.mutedRepos?.includes("xpufx-org/mute-test"));

    const resUnmute = await handleUppidiToggleRepoMute(
      { repo: "xpufx-org/mute-test", muted: false },
      {} as any
    );
    assert.equal(resUnmute.ok, true);
    assert.equal(resUnmute.isMuted, false);
    assert.ok(!resUnmute.mutedRepos?.includes("xpufx-org/mute-test"));
  });

  it("handleUppidiAgents outputs enrolledRepos, mutedRepos, and repoQueuedHooks", async () => {
    const mockContext: any = {
      paseo: {
        agents: {
          list: async () => ({
            entries: [
              {
                agent: {
                  id: "fd-1",
                  name: "Front Desk",
                  role: "front-desk",
                  status: "running",
                },
              },
              {
                agent: {
                  id: "orch-1",
                  name: "Orchestrator · xpufx-org/paseo",
                  role: "orchestrator",
                  status: "running",
                  project: "xpufx-org/paseo",
                },
              },
            ],
          }),
        },
      },
    };

    const output = await handleUppidiAgents({}, mockContext);
    assert.ok(Array.isArray(output.enrolledRepos));
    assert.ok(Array.isArray(output.mutedRepos));
    assert.equal(typeof output.repoQueuedHooks, "object");
    assert.ok(output.tree.length > 0);
  });

  it("resolves provider and model from role models when input model is omitted (#426)", async () => {
    let createdPayload: any = null;
    const mockContext: any = {
      paseo: {
        agents: {
          create: async (opts: any) => {
            createdPayload = opts;
            return {
              agent: {
                id: "agent-created-1",
                name: opts.title,
                role: opts.role,
                status: "running",
              },
            };
          },
        },
      },
    };

    // 1. handleUppidiCreateFrontDesk without explicit model
    const fdRes = await handleUppidiCreateFrontDesk({}, mockContext);
    assert.equal(fdRes.ok, true);
    assert.equal(createdPayload.provider, "antigravity-acp");
    assert.equal(createdPayload.model, "gemini-3.8-flash-low");
    assert.equal(createdPayload.role, "front-desk");
    assert.equal(createdPayload.mode, "yolo");

    // 2. handleUppidiAddOrchestrator without explicit model
    createdPayload = null;
    const orchRes = await handleUppidiAddOrchestrator(
      { repo: "xpufx-org/runner-containers" },
      mockContext
    );
    assert.equal(orchRes.ok, true);
    assert.equal(createdPayload.provider, "antigravity-acp");
    assert.equal(createdPayload.model, "gemini-3.8-flash-low");
    assert.equal(createdPayload.role, "orchestrator");
    assert.equal(createdPayload.mode, "yolo");

    // 3. handleUppidiAddOrchestrator with explicit model
    createdPayload = null;
    const orchCustomRes = await handleUppidiAddOrchestrator(
      { repo: "xpufx-org/runner-containers", model: "codex/gpt-5.6-luna" },
      mockContext
    );
    assert.equal(orchCustomRes.ok, true);
    assert.equal(createdPayload.provider, "codex");
    assert.equal(createdPayload.model, "gpt-5.6-luna");
    assert.equal(createdPayload.role, "orchestrator");
    assert.equal(createdPayload.mode, undefined);
  });

  it("spawnPaseoAgent invokes CLI fallback with --provider and appropriate args (#426)", async () => {
    let capturedCmd = "";
    let capturedArgs: readonly string[] = [];

    setExecFileAsyncForTest(async (cmd: string, args: readonly string[]) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return { stdout: JSON.stringify({ id: "agent-spawned-cli" }) };
    });

    try {
      // 1. Omitted model: resolves to role model (antigravity-acp/gemini-3.8-flash-low)
      const resDefault = await spawnPaseoAgent(
        {
          title: "Front Desk CLI",
          prompt: "Triaging requests",
          category: "front-desk",
        },
        {} as any
      );

      assert.equal(resDefault.ok, true);
      assert.equal(resDefault.agentId, "agent-spawned-cli");
      assert.equal(capturedCmd, "paseo");
      assert.ok(capturedArgs.includes("run"));
      assert.ok(capturedArgs.includes("-d"));
      assert.equal(capturedArgs[capturedArgs.indexOf("--provider") + 1], "antigravity-acp");
      assert.equal(capturedArgs[capturedArgs.indexOf("--model") + 1], "gemini-3.8-flash-low");
      assert.equal(capturedArgs[capturedArgs.indexOf("--mode") + 1], "yolo");

      // 2. Explicit model with slash: e.g. codex/gpt-5.6-luna
      const resExplicit = await spawnPaseoAgent(
        {
          title: "Orchestrator CLI",
          prompt: "Supervising workers",
          category: "orchestrator",
          model: "codex/gpt-5.6-luna",
        },
        {} as any
      );

      assert.equal(resExplicit.ok, true);
      assert.equal(capturedArgs[capturedArgs.indexOf("--provider") + 1], "codex");
      assert.equal(capturedArgs[capturedArgs.indexOf("--model") + 1], "gpt-5.6-luna");
      assert.equal(capturedArgs.includes("--mode"), false);

      // 3. Explicit provider without model slash
      const resProviderOnly = await spawnPaseoAgent(
        {
          title: "Worker CLI",
          prompt: "Coding agent",
          category: "worker",
          model: "custom-provider",
        },
        {} as any
      );

      assert.equal(resProviderOnly.ok, true);
      assert.equal(capturedArgs[capturedArgs.indexOf("--provider") + 1], "custom-provider");
      assert.equal(capturedArgs.includes("--model"), false);
      assert.equal(capturedArgs.includes("--mode"), false);
    } finally {
      setExecFileAsyncForTest(null);
    }
  });
});

describe("orchestrator workspace resolution and state isolation (#485, #486)", () => {
  it("resolveRepoWorkspace extracts workspaceId and prefers local workspace over worktrees", async () => {
    setExecFileAsyncForTest(async (cmd: string, args: readonly string[]) => {
      if (cmd === "paseo" && args[0] === "workspace" && args[1] === "ls") {
        return {
          stdout: JSON.stringify([
            {
              workspaceId: "wks_worktree_1",
              project: "paseo",
              name: "fix-branch",
              isolation: "worktree",
              cwd: "/home/user/.paseo/worktrees/fix-branch",
            },
            {
              workspaceId: "wks_local_main",
              project: "paseo",
              name: "Paseo",
              isolation: "local",
              cwd: "/home/user/code/paseo",
            },
          ]),
        };
      }
      return { stdout: "[]" };
    });

    try {
      const res = await resolveRepoWorkspace("xpufx-org/paseo");
      assert.equal(res.workspaceId, "wks_local_main");
      assert.equal(res.cwd, "/home/user/code/paseo");
    } finally {
      setExecFileAsyncForTest(null);
    }
  });

  it("handleUppidiAddOrchestrator supplies workspaceId and default orchestrator skill prompt", async () => {
    let capturedPayload: any = null;
    const mockContext: any = {
      paseo: {
        agents: {
          create: async (opts: any) => {
            capturedPayload = opts;
            return {
              agent: {
                id: "agent-orch-skill-test",
                name: opts.title,
                role: opts.role,
                status: "running",
              },
            };
          },
        },
      },
    };

    setExecFileAsyncForTest(async (cmd: string, args: readonly string[]) => {
      if (cmd === "paseo" && args[0] === "workspace" && args[1] === "ls") {
        return {
          stdout: JSON.stringify([
            {
              workspaceId: "wks_sample_repo",
              project: "sample-repo",
              name: "Main",
              isolation: "local",
              cwd: "/home/user/code/sample-repo",
            },
          ]),
        };
      }
      return { stdout: "[]" };
    });

    try {
      const res = await handleUppidiAddOrchestrator(
        { repo: "xpufx-org/sample-repo" },
        mockContext
      );

      assert.equal(res.ok, true);
      assert.equal(res.agentId, "agent-orch-skill-test");
      assert.equal(capturedPayload.workspaceId, "wks_sample_repo");
      assert.equal(capturedPayload.cwd, "/home/user/code/sample-repo");
      assert.ok(
        capturedPayload.prompt.includes(
          path.join(os.homedir(), "code/platform/skills/orchestrator/SKILL.md")
        )
      );
      assert.ok(capturedPayload.prompt.includes("fgjx"));
    } finally {
      setExecFileAsyncForTest(null);
    }
  });

  it("getPersistedStateDir isolates test state and respects HOOK_STATE_DIR", () => {
    const originalHookState = process.env.HOOK_STATE_DIR;
    try {
      process.env.HOOK_STATE_DIR = "/tmp/custom-hook-state-dir";
      assert.equal(getPersistedStateDir(), "/tmp/custom-hook-state-dir");

      delete process.env.HOOK_STATE_DIR;
      process.env.NODE_ENV = "test";
      const isolatedDir = getPersistedStateDir();
      assert.ok(isolatedDir.includes("paseo-uppidi-fleet-state-"));
      assert.ok(!isolatedDir.includes(".paseo/forgejo-hook"));
    } finally {
      process.env.HOOK_STATE_DIR = originalHookState;
    }
  });
});

describe("two-tier spawn authority guard (#573)", () => {
  const DESK = "desk-fleet-573";
  const ORCH = "orch-fleet-573";

  function withPersistedFrontDesk<T>(fn: () => Promise<T>): Promise<T> {
    const originalHookState = process.env.HOOK_STATE_DIR;
    const dir = path.join(os.tmpdir(), `paseo-573-fleet-${process.pid}-${Date.now()}`);
    process.env.HOOK_STATE_DIR = dir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "frontdesk.json"),
      JSON.stringify({ version: 1, agentId: DESK })
    );
    return fn().finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
      if (originalHookState === undefined) delete process.env.HOOK_STATE_DIR;
      else process.env.HOOK_STATE_DIR = originalHookState;
    });
  }

  it("handleUppidiAddOrchestrator rejects a desk spawn with no explicit repo workspace", async () => {
    await withPersistedFrontDesk(async () => {
      let created = false;
      const mockContext: any = {
        paseo: {
          agents: {
            list: async () => ({ entries: [] }),
            create: async () => {
              created = true;
              return { agent: { id: "should-not-spawn" } };
            },
          },
        },
      };

      // No matching workspace and a repo that has no ~/code/<basename> checkout,
      // so resolveRepoWorkspace yields neither workspaceId nor cwd.
      setExecFileAsyncForTest(async () => ({ stdout: "[]" }));
      try {
        const res = await handleUppidiAddOrchestrator(
          { repo: "xpufx-org/no-checkout-573", callerAgentId: DESK },
          mockContext
        );
        assert.equal(res.ok, false);
        assert.ok(res.error?.includes("two-tier spawn authority"));
        assert.ok(res.error?.includes("paseo send --steer --no-wait <orchId>"));
        assert.ok(res.error?.includes("POST <hook-host>:<port>/orchestrator"));
        assert.equal(created, false);
      } finally {
        setExecFileAsyncForTest(null);
      }
    });
  });

  it("handleUppidiAddOrchestrator allows a desk spawn with an explicit repo-local cwd", async () => {
    await withPersistedFrontDesk(async () => {
      let createdPayload: any = null;
      const mockContext: any = {
        paseo: {
          agents: {
            create: async (opts: any) => {
              createdPayload = opts;
              return { agent: { id: "orch-desk-573" } };
            },
          },
        },
      };

      setExecFileAsyncForTest(async (cmd: string, args: readonly string[]) => {
        if (cmd === "paseo" && args[0] === "workspace" && args[1] === "ls") {
          return {
            stdout: JSON.stringify([
              {
                workspaceId: "wks_paseo_573",
                project: "paseo",
                name: "Paseo",
                isolation: "local",
                cwd: "/home/user/code/paseo",
              },
            ]),
          };
        }
        return { stdout: "[]" };
      });

      try {
        const res = await handleUppidiAddOrchestrator(
          { repo: "xpufx-org/paseo", callerAgentId: DESK },
          mockContext
        );
        assert.equal(res.ok, true);
        assert.equal(res.agentId, "orch-desk-573");
        assert.equal(createdPayload.workspaceId, "wks_paseo_573");
      } finally {
        setExecFileAsyncForTest(null);
      }
    });
  });

  it("handleUppidiAddOrchestrator allows an unattributed orchestrator self-registration", async () => {
    await withPersistedFrontDesk(async () => {
      const mockContext: any = {
        paseo: {
          agents: {
            list: async () => ({ entries: [] }),
            create: async () => ({ agent: { id: "orch-self-573" } }),
          },
        },
      };

      setExecFileAsyncForTest(async () => ({ stdout: "[]" }));
      try {
        const res = await handleUppidiAddOrchestrator(
          { repo: "xpufx-org/aur-automation" },
          mockContext
        );
        assert.equal(res.ok, true);
        assert.equal(res.agentId, "orch-self-573");
      } finally {
        setExecFileAsyncForTest(null);
      }
    });
  });

  it("spawnPaseoAgent rejects a desk worker spawn and names both remediation paths", async () => {
    await withPersistedFrontDesk(async () => {
      const res = await spawnPaseoAgent(
        {
          title: "worker",
          prompt: "do work",
          category: "worker",
          callerAgentId: DESK,
        },
        {} as any
      );
      assert.equal(res.ok, false);
      assert.ok(res.error?.includes("paseo send --steer --no-wait <orchId>"));
      assert.ok(res.error?.includes("POST <hook-host>:<port>/orchestrator"));
    });
  });

  it("spawnPaseoAgent does not restrict worker spawns from an orchestrator caller", async () => {
    await withPersistedFrontDesk(async () => {
      setExecFileAsyncForTest(async () => ({
        stdout: JSON.stringify({ id: "worker-from-orch-573" }),
      }));
      try {
        const res = await spawnPaseoAgent(
          {
            title: "worker",
            prompt: "do work",
            category: "worker",
            callerAgentId: ORCH,
            model: "custom-provider",
          },
          {} as any
        );
        assert.equal(res.ok, true);
        assert.equal(res.agentId, "worker-from-orch-573");
      } finally {
        setExecFileAsyncForTest(null);
      }
    });
  });
});

