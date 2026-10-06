import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

import {
  normalizeRawAgent,
  normalizePendingPermissions,
  normalizeAttentionReason,
  normalizeAgentMetrics,
  handleUppidiAgents,
  getWorkspaceProjectMap,
  setWorkspaceProjectMapForTest,
  applyParentProjectInheritance,
  resolveSpawnMode,
  resolveAutoAccept,
  findScopeMatchingPermission,
  autoAllowScopedPermission,
  setExecFileAsyncForTest,
  evaluateSpawnAuthority,
  resolveSpawnCallerAgentId,
  resolveDeskWorkingDirs,
  SPAWN_AUTHORITY_WORKER_ERROR,
  SPAWN_AUTHORITY_WORKSPACE_ERROR,
  spawnPaseoAgent,
  buildFrontDeskIntroPrompt,
  handleUppidiFrontDeskActivity,
  handleUppidiFrontDeskPrompt,
  handleUppidiCreateFrontDesk,
  handleFleetTeardown,
  handleFleetHalt,
  handleFleetResume,
  getPersistedStateDir,
  resolveRegisteredFrontDeskAgentId,
  checkRepoMainDirty,
} from "./agents.js";
import { HookRouter, setActiveHookRouter } from "./hook-router.js";
import { DEFAULT_PROJECT } from "../shared/contracts.js";

describe("authoritative agent project resolution (#530)", () => {
  it("resolves a worktree worker from workspaceId metadata without title/cwd heuristics", () => {
    setWorkspaceProjectMapForTest({
      wks_fix_530: "xpufx-org/paseo",
      wks_platform: "xpufx-org/platform",
    });
    try {
      // Worktree cwd (no /code/ segment) and a title with no issue number.
      const worker = normalizeRawAgent({
        id: "worker-fix-530",
        name: "worker-fix-530",
        status: "idle",
        cwd: "/var/test-home/.paseo/worktrees/2h0dw6vb/fix-530-authoritative-agent-project-resolution",
        workspaceId: "wks_fix_530",
      });
      assert.equal(worker.project, "forge.mrs.uppidi.com/xpufx-org/paseo");
      assert.equal(worker.worktree, "fix-530-authoritative-agent-project-resolution");

      // Ad-hoc agent with a non-repo title still resolves via workspaceId.
      const adHoc = normalizeRawAgent({
        id: "ad-hoc",
        name: "Fleet UI: Modern Executive Cockpit",
        status: "idle",
        workspaceId: "wks_platform",
      });
      assert.equal(adHoc.project, "forge.mrs.uppidi.com/xpufx-org/platform");
    } finally {
      setWorkspaceProjectMapForTest(null);
    }
  });

  it("does not consult titles or cwd paths when workspace metadata is absent", () => {
    setWorkspaceProjectMapForTest({});
    try {
      const titled = normalizeRawAgent({
        id: "titled",
        name: "Orchestrator · xpufx-org/paseo",
        status: "idle",
        cwd: "/var/test-home/code/paseo",
      });
      assert.equal(titled.project, DEFAULT_PROJECT);
    } finally {
      setWorkspaceProjectMapForTest(null);
    }
  });

  it("prefers canonical workspace mapping over labels and inherits from parent hierarchy", () => {
    setWorkspaceProjectMapForTest({ wks_platform: "xpufx-org/platform" });
    try {
      const labeled = normalizeRawAgent({
        id: "labeled",
        name: "labeled worker",
        status: "idle",
        workspaceId: "wks_platform",
        labels: { repo: "xpufx-org/paseo" },
      });
      assert.equal(labeled.project, "forge.mrs.uppidi.com/xpufx-org/platform");

      const orchestrator = normalizeRawAgent(
        {
          id: "orch-paseo",
          name: "Orchestrator · paseo",
          status: "idle",
          labels: { repo: "xpufx-org/paseo" },
        },
        new Set(),
        {}
      );
      const worker = normalizeRawAgent(
        {
          id: "worker-child",
          name: "worker-child",
          status: "idle",
          parentId: "orch-paseo",
        },
        new Set(),
        {}
      );
      const grandchild = normalizeRawAgent(
        {
          id: "grandchild",
          name: "grandchild",
          status: "idle",
          labels: { "paseo.parent-agent-id": "worker-child" },
        },
        new Set(),
        {}
      );

      assert.equal(worker.project, DEFAULT_PROJECT);
      applyParentProjectInheritance([orchestrator, worker, grandchild]);
      assert.equal(worker.project, "forge.mrs.uppidi.com/xpufx-org/paseo");
      assert.equal(grandchild.project, "forge.mrs.uppidi.com/xpufx-org/paseo");
    } finally {
      setWorkspaceProjectMapForTest(null);
    }
  });

  it("builds the workspace -> project map from projects.json and workspaces.json", () => {
    const originalHome = process.env.HOME;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-530-home-"));
    const projectsDir = path.join(tempHome, ".paseo", "projects");
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectsDir, "projects.json"),
      JSON.stringify([
        {
          projectId: "prj_paseo",
          rootPath: "/var/test-home/code/paseo",
          displayName: "paseo",
          projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
        },
        {
          projectId: "prj_plain",
          rootPath: "/var/test-home/code/meta",
          displayName: "meta",
          projectKey: null,
        },
      ])
    );
    fs.writeFileSync(
      path.join(projectsDir, "workspaces.json"),
      JSON.stringify([
        {
          workspaceId: "wks_worktree",
          projectId: "prj_paseo",
          cwd: "/var/test-home/.paseo/worktrees/2h0dw6vb/fix-530",
          mainRepoRoot: "/var/test-home/code/paseo",
          isPaseoOwnedWorktree: true,
        },
        {
          workspaceId: "wks_plain",
          projectId: "prj_plain",
          cwd: "/var/test-home/code/meta",
        },
      ])
    );

    process.env.HOME = tempHome;
    try {
      const map = getWorkspaceProjectMap({ forceRefresh: true });
      assert.equal(map["wks_worktree"], "forge.mrs.uppidi.com/xpufx-org/paseo");
      assert.equal(map["wks_plain"], "meta");
    } finally {
      process.env.HOME = originalHome;
      setWorkspaceProjectMapForTest(null);
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});

describe("agent pending permissions and attention mapping (#534)", () => {
  it("maps daemon pendingPermissions and requiresAttention into the client payload", () => {
    const agent = normalizeRawAgent(
      {
        id: "agent-perm-534",
        name: "Worker Perm",
        status: "running",
        requiresAttention: true,
        attentionReason: "permission",
        pendingPermissions: [
          {
            id: "perm-req-534",
            tool: "run_command",
            title: "run bash command",
            kind: "tool",
          },
        ],
      },
      new Set(),
      {}
    );

    assert.equal(agent.pendingPermissions?.length, 1);
    assert.equal(agent.pendingPermissions?.[0]?.id, "perm-req-534");
    assert.equal(agent.pendingPermissions?.[0]?.tool, "run_command");
    assert.equal(agent.pendingPermissions?.[0]?.title, "run bash command");
    assert.equal(agent.requiresAttention, true);
    assert.equal(agent.attentionReason, "permission");
    assert.equal(agent.deterministicState, "permission-prompt");
    assert.equal(agent.stateDetail, "run bash command");
  });

  it("marks a non-permission attention agent as attention-required", () => {
    const agent = normalizeRawAgent(
      {
        id: "agent-att-534",
        name: "Worker Input",
        status: "idle",
        requiresAttention: true,
        attentionReason: "input",
        pendingPermissions: [],
      },
      new Set(),
      {}
    );

    assert.equal(agent.requiresAttention, true);
    assert.equal(agent.attentionReason, "input");
    assert.equal(agent.deterministicState, "attention-required");
    assert.equal(agent.stateDetail, "input");
  });

  it("ignores a benign finished attention flag but keeps healthy state", () => {
    const agent = normalizeRawAgent(
      {
        id: "agent-done-534",
        name: "Worker Done",
        status: "idle",
        requiresAttention: true,
        attentionReason: "finished",
      },
      new Set(),
      {}
    );

    assert.equal(agent.requiresAttention, false);
    assert.equal(agent.pendingPermissions?.length, 0);
    assert.equal(agent.deterministicState, "idle:waiting");
  });

  it("drops malformed permission entries rather than emitting partial rows", () => {
    const permissions = normalizePendingPermissions([
      { id: "ok-1", tool: "run_command" },
      { tool: "no-id" } as any,
      null as any,
    ]);
    assert.equal(permissions.length, 1);
    assert.equal(permissions[0].id, "ok-1");
  });

  it("normalizes unknown attention reasons to null", () => {
    assert.equal(normalizeAttentionReason("permission"), "permission");
    assert.equal(normalizeAttentionReason("input"), "input");
    assert.equal(normalizeAttentionReason("stalled"), null);
    assert.equal(normalizeAttentionReason(undefined), null);
  });

  it("surfaces pendingPermissions and requiresAttention through the agents RPC handler", async () => {
    const mockContext: any = {
      paseo: {
        agents: {
          list: async () => ({
            entries: [
              {
                agent: {
                  id: "rpc-perm-534",
                  title: "Worker Permission",
                  status: "running",
                  requiresAttention: true,
                  attentionReason: "permission",
                  pendingPermissions: [
                    { id: "req-rpc-534", tool: "external_directory", title: "access external dir" },
                  ],
                },
              },
              {
                agent: {
                  id: "rpc-input-534",
                  title: "Worker Input",
                  status: "idle",
                  requiresAttention: true,
                  attentionReason: "input",
                  pendingPermissions: [],
                },
              },
            ],
          }),
        },
      },
    };

    const res = await handleUppidiAgents({}, mockContext);
    assert.equal(res.ok, true);

    const permissionAgent = res.workers.find((a) => a.id === "rpc-perm-534");
    assert.ok(permissionAgent);
    assert.equal(permissionAgent?.pendingPermissions?.length, 1);
    assert.equal(permissionAgent?.pendingPermissions?.[0]?.id, "req-rpc-534");
    assert.equal(permissionAgent?.requiresAttention, true);
    assert.equal(permissionAgent?.deterministicState, "permission-prompt");

    const inputAgent = res.workers.find((a) => a.id === "rpc-input-534");
    assert.ok(inputAgent);
    assert.equal(inputAgent?.requiresAttention, true);
    assert.equal(inputAgent?.attentionReason, "input");
    assert.equal(inputAgent?.deterministicState, "attention-required");
  });
});

describe("subagent lifecycle projection & structured block detail (#537)", () => {
  it("maps permission blocks onto waiting_for_input with stateDetail scope and blockDetail", () => {
    const agent = normalizeRawAgent(
      {
        id: "agent-lifecycle-537",
        name: "Worker Lifecycle",
        status: "running",
        pendingPermissions: [
          {
            id: "perm-req-537",
            name: "external_directory",
            title: "access external dir",
            description: "Scope: /home/user/code/paseo/*",
          },
        ],
      },
      new Set(),
      {}
    );

    assert.equal(agent.deterministicState, "permission-prompt");
    assert.equal(agent.lifecycleState, "waiting_for_input");
    assert.equal(agent.stateDetail, "access external dir (/home/user/code/paseo/*)");
    assert.equal(agent.blockDetail?.requiredPermissionId, "perm-req-537");
    assert.equal(agent.blockDetail?.scope, "/home/user/code/paseo/*");
    assert.equal(agent.blockDetail?.command, "paseo permit allow agent-lifecycle-537 perm-req-537");
  });

  it("derives lifecycleState for idle and error agents without block detail", () => {
    const idle = normalizeRawAgent({ id: "idle-537", status: "idle" }, new Set(), {});
    assert.equal(idle.lifecycleState, "idle");
    assert.equal(idle.blockDetail ?? null, null);

    const errored = normalizeRawAgent(
      { id: "err-537", status: "error", lastError: "boom" },
      new Set(),
      {}
    );
    assert.equal(errored.lifecycleState, "errored");
  });

  it("normalizes permission input metadata into a scope", () => {
    const [permission] = normalizePendingPermissions([
      { id: "p-537", tool: "external_directory", metadata: { path: "/tmp/scratch" } },
    ]);
    assert.equal(permission?.scope, "/tmp/scratch");
  });

  it("resolves the spawn mode per provider and declared capabilities", () => {
    assert.equal(resolveSpawnMode("antigravity-acp"), "yolo");
    assert.equal(resolveSpawnMode("opencode"), undefined);
    assert.equal(
      resolveSpawnMode("opencode", { mode: "bypass", modeProviders: ["opencode"] }),
      "bypass",
    );
    assert.equal(resolveSpawnMode("antigravity-acp", { mode: "plan" }), "plan");
  });

  it("resolves auto_accept per provider with capability override (#574)", () => {
    // opencode's unattendedness is a feature toggle, not a mode.
    assert.equal(resolveSpawnMode("opencode"), undefined);
    assert.equal(resolveAutoAccept("opencode"), true);
    // antigravity keeps its yolo mode path and does not use auto_accept.
    assert.equal(resolveAutoAccept("antigravity-acp"), false);
    assert.equal(resolveAutoAccept("codex"), false);
    // Explicit override wins in both directions.
    assert.equal(resolveAutoAccept("opencode", { autoAccept: false }), false);
    assert.equal(resolveAutoAccept("antigravity-acp", { autoAccept: true }), true);
  });

  it("matches only pending permissions whose scope falls under a declared prefix", () => {
    const perms = [
      { id: "unrelated", description: "Scope: /var/other" },
      { id: "match", description: "Scope: /tmp/worktree/sub" },
    ];
    const match = findScopeMatchingPermission(perms, ["/tmp/worktree"]);
    assert.equal(match?.permission.id, "match");
    assert.equal(match?.scope, "/tmp/worktree/sub");
    assert.equal(findScopeMatchingPermission(perms, ["/nope"]), undefined);
    assert.equal(findScopeMatchingPermission(perms, []), undefined);
  });
});

describe("spawn capability auto-allow (#537)", () => {
  it("allows the first scope-matching pending permission via the CLI fallback", async () => {
    const calls: string[][] = [];
    setExecFileAsyncForTest(async (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === "permit" && args[1] === "ls") {
        return {
          stdout: JSON.stringify([
            { id: "other", agentId: "agent-auto-537", description: "Scope: /var/elsewhere" },
            { id: "target-req", agentId: "agent-auto-537", description: "Scope: /tmp/worktree" },
          ]),
        };
      }
      return { stdout: "" };
    });
    try {
      const res = await autoAllowScopedPermission("agent-auto-537", ["/tmp/worktree"], undefined, {
        timeoutMs: 0,
        pollMs: 0,
      });
      assert.equal(res.allowed, true);
      assert.equal(res.permissionId, "target-req");
      assert.equal(res.scope, "/tmp/worktree");
      assert.ok(
        calls.some(
          (c) => c[0] === "paseo" && c[1] === "permit" && c[2] === "allow" && c[4] === "target-req",
        ),
      );
    } finally {
      setExecFileAsyncForTest(null);
    }
  });

  it("reports no match when nothing falls under the declared prefix", async () => {
    setExecFileAsyncForTest(async (file, args) => {
      if (args[0] === "permit" && args[1] === "ls") {
        return { stdout: JSON.stringify([{ id: "x", agentId: "agent-none", description: "Scope: /var/other" }]) };
      }
      return { stdout: "" };
    });
    try {
      const res = await autoAllowScopedPermission("agent-none", ["/tmp/worktree"], undefined, {
        timeoutMs: 0,
        pollMs: 0,
      });
      assert.equal(res.allowed, false);
      assert.equal(res.reason, "no scope-matching pending permission");
    } finally {
      setExecFileAsyncForTest(null);
    }
  });
});

describe("agent health metrics mapping (#560)", () => {
  it("projects lastUsage/activeTurn/attentionTimestamp onto the metrics block", () => {
    const metrics = normalizeAgentMetrics({
      id: "agent-metrics-560",
      status: "running",
      lastUsage: {
        inputTokens: 1200,
        outputTokens: 800,
        cachedInputTokens: 600,
        totalCostUsd: 1.23,
        contextWindowUsedTokens: 96000,
        contextWindowMaxTokens: 128000,
      },
      activeTurn: { turnId: "t1", startedAt: "2026-09-25T10:00:00.000Z" },
      attentionTimestamp: "2026-09-25T10:05:00.000Z",
    });

    assert.ok(metrics);
    assert.equal(metrics?.contextUsedTokens, 96000);
    assert.equal(metrics?.contextMaxTokens, 128000);
    assert.equal(metrics?.cachedTokens, 600);
    assert.equal(metrics?.inputTokens, 1200);
    assert.equal(metrics?.outputTokens, 800);
    assert.equal(metrics?.costUsd, 1.23);
    assert.equal(metrics?.activeTurnStartedAt, "2026-09-25T10:00:00.000Z");
    assert.equal(metrics?.attentionTimestamp, "2026-09-25T10:05:00.000Z");
  });

  it("returns null for a legacy payload with no usage or turn signals", () => {
    assert.equal(normalizeAgentMetrics({ id: "legacy-560", status: "idle" }), null);
  });

  it("drops malformed numeric and timestamp values rather than emitting partials", () => {
    const metrics = normalizeAgentMetrics({
      id: "malformed-560",
      lastUsage: {
        inputTokens: Number.NaN as any,
        contextWindowUsedTokens: "96000" as any,
        contextWindowMaxTokens: 128000,
      },
      activeTurn: { startedAt: 42 as any },
    });

    assert.ok(metrics);
    assert.equal(metrics?.inputTokens, undefined);
    assert.equal(metrics?.contextUsedTokens, undefined);
    assert.equal(metrics?.contextMaxTokens, 128000);
    assert.equal(metrics?.activeTurnStartedAt, undefined);
  });

  it("exposes metrics and lastError through normalizeRawAgent", () => {
    const agent = normalizeRawAgent({
      id: "agent-normalize-560",
      name: "Worker Metrics",
      status: "running",
      lastError: "",
      lastUsage: { contextWindowUsedTokens: 64000, contextWindowMaxTokens: 128000 },
      activeTurn: { startedAt: "2026-09-25T10:00:00.000Z" },
    });

    assert.ok(agent.metrics);
    assert.equal(agent.metrics?.contextUsedTokens, 64000);
    assert.equal(agent.metrics?.contextMaxTokens, 128000);
    assert.equal(agent.metrics?.activeTurnStartedAt, "2026-09-25T10:00:00.000Z");
    // Empty error string normalizes to null so the gauge does not light red.
    assert.equal(agent.lastError, null);
  });

  it("omits the metrics block (null) for a legacy normalizeRawAgent payload", () => {
    const agent = normalizeRawAgent({
      id: "agent-legacy-560",
      name: "Legacy Worker",
      status: "idle",
    });
    assert.equal(agent.metrics, null);
    assert.equal(agent.lastError, null);
  });

  it("surfaces metrics through the agents RPC handler", async () => {
    const mockContext: any = {
      paseo: {
        agents: {
          list: async () => ({
            entries: [
              {
                agent: {
                  id: "rpc-metrics-560",
                  title: "Worker Metrics",
                  status: "running",
                  lastUsage: {
                    contextWindowUsedTokens: 120000,
                    contextWindowMaxTokens: 128000,
                    totalCostUsd: 4.5,
                  },
                  activeTurn: { turnId: "t-rpc", startedAt: "2026-09-25T10:00:00.000Z" },
                },
              },
            ],
          }),
        },
      },
    };

    const res = await handleUppidiAgents({}, mockContext);
    const worker = res.workers.find((a) => a.id === "rpc-metrics-560");
    assert.ok(worker);
    assert.equal(worker?.metrics?.contextUsedTokens, 120000);
    assert.equal(worker?.metrics?.contextMaxTokens, 128000);
    assert.equal(worker?.metrics?.costUsd, 4.5);
    assert.equal(worker?.metrics?.activeTurnStartedAt, "2026-09-25T10:00:00.000Z");
  });
});

describe("two-tier spawn authority guard (#573)", () => {
  const DESK = "desk-agent-573";
  const ORCH = "orch-agent-573";
  const deskDirs = new Set(["/home/user/code/meta", "/home/user/desk-cwd"]);

  const deps = {
    frontDeskAgentId: () => DESK,
    deskWorkingDirs: () => deskDirs,
  };

  it("rejects a worker spawn attributed to the front desk, naming the remediation paths verbatim", () => {
    const decision = evaluateSpawnAuthority({ category: "worker", callerAgentId: DESK }, undefined, deps);
    assert.equal(decision.allowed, false);
    assert.equal(decision.error, SPAWN_AUTHORITY_WORKER_ERROR);
    assert.ok(decision.error?.includes("paseo send --steer --no-wait <orchId>"));
    assert.ok(decision.error?.includes("POST <hook-host>:<port>/orchestrator"));
  });

  it("allows a worker spawn from an orchestrator (or unattributed) caller", () => {
    for (const callerAgentId of [ORCH, undefined]) {
      const decision = evaluateSpawnAuthority({ category: "worker", callerAgentId }, undefined, deps);
      assert.equal(decision.allowed, true, `caller=${String(callerAgentId)}`);
    }
  });

  it("rejects a desk orchestrator spawn with no workspaceId or cwd", () => {
    const decision = evaluateSpawnAuthority({ category: "orchestrator", callerAgentId: DESK }, undefined, deps);
    assert.equal(decision.allowed, false);
    assert.equal(decision.error, SPAWN_AUTHORITY_WORKSPACE_ERROR);
  });

  it("rejects a desk orchestrator spawn inheriting a desk working directory", () => {
    const deskCwd = evaluateSpawnAuthority(
      { category: "orchestrator", callerAgentId: DESK, cwd: "/home/user/code/meta" },
      undefined,
      deps,
    );
    assert.equal(deskCwd.allowed, false);
    assert.equal(deskCwd.error, SPAWN_AUTHORITY_WORKSPACE_ERROR);

    const recordedCwd = evaluateSpawnAuthority(
      { category: "orchestrator", callerAgentId: DESK, cwd: "/home/user/desk-cwd/" },
      undefined,
      deps,
    );
    assert.equal(recordedCwd.allowed, false);
  });

  it("allows a desk orchestrator spawn with an explicit workspaceId or repo-local cwd", () => {
    const byWorkspace = evaluateSpawnAuthority(
      { category: "orchestrator", callerAgentId: DESK, workspaceId: "wks_paseo" },
      undefined,
      deps,
    );
    assert.equal(byWorkspace.allowed, true);

    const byCwd = evaluateSpawnAuthority(
      { category: "orchestrator", callerAgentId: DESK, cwd: "/home/user/code/paseo" },
      undefined,
      deps,
    );
    assert.equal(byCwd.allowed, true);
  });

  it("abstains when the caller is unattributed or the registered desk is unknown", () => {
    assert.equal(
      evaluateSpawnAuthority({ category: "worker" }, undefined, deps).allowed,
      true,
    );
    assert.equal(
      evaluateSpawnAuthority({ category: "worker", callerAgentId: DESK }, undefined, {
        frontDeskAgentId: () => null,
        deskWorkingDirs: () => deskDirs,
      }).allowed,
      true,
    );
  });

  it("resolveSpawnCallerAgentId prefers the request id over a context id and ignores ambient env", () => {
    const originalEnv = process.env.PASEO_AGENT_ID;
    process.env.PASEO_AGENT_ID = "ambient-env-agent";
    try {
      assert.equal(resolveSpawnCallerAgentId({ callerAgentId: " req-agent " }), "req-agent");
      assert.equal(
        resolveSpawnCallerAgentId({}, { callerAgentId: "ctx-agent" } as any),
        "ctx-agent",
      );
      assert.equal(resolveSpawnCallerAgentId({}), undefined);
    } finally {
      if (originalEnv === undefined) delete process.env.PASEO_AGENT_ID;
      else process.env.PASEO_AGENT_ID = originalEnv;
    }
  });

  it("resolveDeskWorkingDirs includes ~/code/meta and the desk's recorded cwd", () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/home/user";
    try {
      const dirs = resolveDeskWorkingDirs(null);
      assert.ok(dirs.has("/home/user/code/meta"));
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("spawnPaseoAgent refuses a desk worker spawn before any SDK/CLI call", async () => {
    const originalEnv = process.env.HOOK_STATE_DIR;
    process.env.HOOK_STATE_DIR = path.join(
      os.tmpdir(),
      `paseo-573-authority-${process.pid}-${Date.now()}`,
    );
    fs.mkdirSync(process.env.HOOK_STATE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.HOOK_STATE_DIR, "frontdesk.json"),
      JSON.stringify({ version: 1, agentId: DESK }),
    );

    let sdkCalled = false;
    let cliCalled = false;
    setExecFileAsyncForTest(async () => {
      cliCalled = true;
      return { stdout: JSON.stringify({ id: "should-not-spawn" }) };
    });
    const context: any = {
      paseo: {
        agents: {
          create: async () => {
            sdkCalled = true;
            return { agent: { id: "should-not-spawn" } };
          },
        },
      },
    };

    try {
      const res = await spawnPaseoAgent(
        {
          title: "worker",
          prompt: "do work",
          category: "worker",
          callerAgentId: DESK,
        },
        context,
      );
      assert.equal(res.ok, false);
      assert.equal(res.error, SPAWN_AUTHORITY_WORKER_ERROR);
      assert.equal(sdkCalled, false);
      assert.equal(cliCalled, false);
    } finally {
      setExecFileAsyncForTest(null);
      if (originalEnv === undefined) delete process.env.HOOK_STATE_DIR;
      else process.env.HOOK_STATE_DIR = originalEnv;
    }
  });

  it("spawnPaseoAgent lets a non-desk worker spawn through the SDK path", async () => {
    const originalEnv = process.env.HOOK_STATE_DIR;
    process.env.HOOK_STATE_DIR = path.join(
      os.tmpdir(),
      `paseo-573-allow-${process.pid}-${Date.now()}`,
    );
    fs.mkdirSync(process.env.HOOK_STATE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.HOOK_STATE_DIR, "frontdesk.json"),
      JSON.stringify({ version: 1, agentId: DESK }),
    );

    let sdkCalled = false;
    const context: any = {
      paseo: {
        agents: {
          create: async () => {
            sdkCalled = true;
            return { agent: { id: "worker-ok" } };
          },
        },
      },
    };

    try {
      const res = await spawnPaseoAgent(
        {
          title: "worker",
          prompt: "do work",
          category: "worker",
          callerAgentId: ORCH,
        },
        context,
      );
      assert.equal(res.ok, true);
      assert.equal(res.agentId, "worker-ok");
      assert.equal(sdkCalled, true);
    } finally {
      if (originalEnv === undefined) delete process.env.HOOK_STATE_DIR;
      else process.env.HOOK_STATE_DIR = originalEnv;
    }
  });

  describe("Front Desk Watch & Console Handlers (#710)", () => {
    it("handleUppidiFrontDeskActivity returns error when no front desk agent is found", async () => {
      const originalEnv = process.env.HOOK_STATE_DIR;
      process.env.HOOK_STATE_DIR = path.join(os.tmpdir(), `paseo-empty-fd-${Date.now()}`);
      fs.mkdirSync(process.env.HOOK_STATE_DIR, { recursive: true });

      try {
        const res = await handleUppidiFrontDeskActivity({}, {
          paseo: {
            agents: {
              list: async () => ({
                entries: [
                  { id: "worker-agent", title: "Worker Agent", category: "worker", status: "idle" },
                ],
              }),
            },
          },
        } as any);
        assert.equal(res.ok, false);
        assert.equal(res.error, "No active Front Desk agent found");
      } finally {
        if (originalEnv === undefined) delete process.env.HOOK_STATE_DIR;
        else process.env.HOOK_STATE_DIR = originalEnv;
      }
    });

    it("handleUppidiFrontDeskActivity fetches and normalizes timeline entries from SDK context", async () => {
      const mockEntries = [
        {
          timestamp: "2026-09-29T10:00:00Z",
          item: { type: "user_message", text: "Please investigate issue #710" },
        },
        {
          timestamp: "2026-09-29T10:00:01Z",
          item: { type: "reasoning", text: "I should inspect the worktree" },
        },
        {
          timestamp: "2026-09-29T10:00:02Z",
          item: {
            type: "tool_call",
            name: "send_agent_prompt",
            arguments: { agentId: "worker-1", prompt: "Run tests" },
          },
        },
        {
          timestamp: "2026-09-29T10:00:03Z",
          item: {
            type: "assistant_message",
            text: "Dispatched prompt to worker-1",
          },
        },
      ];

      const context: any = {
        paseo: {
          agents: {
            ref: (id: string) => ({
              timeline: {
                refetch: async () => ({
                  entries: mockEntries,
                  agent: { id, title: "Front Desk Test", status: "running", modeId: "auto" },
                }),
              },
            }),
          },
        },
      };

      const res = await handleUppidiFrontDeskActivity({ agentId: "agent-fd-test" }, context);
      assert.equal(res.ok, true);
      assert.equal(res.agentId, "agent-fd-test");
      assert.equal(res.agentTitle, "Front Desk Test");
      assert.equal(res.totalCount, 4);
      // user, dispatch, and assistant are signals; reasoning is noise
      assert.equal(res.signalCount, 3);
      assert.equal(res.items[0].type, "user");
      assert.equal(res.items[0].isSignal, true);
      assert.equal(res.items[1].type, "thought");
      assert.equal(res.items[1].isSignal, false);
      assert.equal(res.items[2].type, "dispatch");
      assert.equal(res.items[2].isSignal, true);
      assert.equal(res.items[3].type, "assistant");
      assert.equal(res.items[3].isSignal, true);
    });

    it("handleUppidiFrontDeskPrompt validates input and delivers prompt", async () => {
      // 1. Empty prompt rejected
      const emptyRes = await handleUppidiFrontDeskPrompt({ prompt: "   " });
      assert.equal(emptyRes.ok, false);
      assert.equal(emptyRes.error, "Prompt cannot be empty");

      // 2. Successful delivery through context agent ref
      let sentPrompt = "";
      const context: any = {
        paseo: {
          agents: {
            ref: (id: string) => ({
              send: async (text: string) => {
                sentPrompt = text;
              },
            }),
          },
        },
      };

      const res = await handleUppidiFrontDeskPrompt(
        { agentId: "agent-fd-test", prompt: "Hello Front Desk" },
        context
      );
      assert.equal(res.ok, true);
      assert.equal(sentPrompt, "Hello Front Desk");
      assert.equal(res.agentId, "agent-fd-test");
    });
  });
});

describe("Fleet teardown state cleanup (#774)", () => {
  let tmpDir: string;
  let prevHookStateDir: string | undefined;
  let prevHookQueueDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uppidi-fleet-teardown-test-"));
    prevHookStateDir = process.env.HOOK_STATE_DIR;
    prevHookQueueDir = process.env.HOOK_QUEUE_DIR;
    process.env.HOOK_STATE_DIR = tmpDir;
    process.env.HOOK_QUEUE_DIR = path.join(tmpDir, "queues");
    setExecFileAsyncForTest(async () => ({ stdout: "[]", stderr: "" }));
  });

  afterEach(() => {
    setExecFileAsyncForTest(null);
    setActiveHookRouter(null);
    if (prevHookStateDir !== undefined) process.env.HOOK_STATE_DIR = prevHookStateDir;
    else delete process.env.HOOK_STATE_DIR;
    if (prevHookQueueDir !== undefined) process.env.HOOK_QUEUE_DIR = prevHookQueueDir;
    else delete process.env.HOOK_QUEUE_DIR;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("deletes frontdesk.json and clears active router when frontdesk is targeted", async () => {
    const fdFile = path.join(tmpDir, "frontdesk.json");
    const orchDir = path.join(tmpDir, "orchestrators");
    fs.mkdirSync(orchDir, { recursive: true });
    const repoFile = path.join(orchDir, "repo.json");

    fs.writeFileSync(fdFile, JSON.stringify({ agentId: "agent-fd-dead" }), "utf8");
    fs.writeFileSync(repoFile, JSON.stringify({ agentId: "agent-orch-live", key: "repo" }), "utf8");

    const router = new HookRouter(null, {
      stateDir: tmpDir,
      queueDir: path.join(tmpDir, "queues"),
      port: 0,
    });
    router.writeFrontDesk("agent-fd-dead");
    router.enqueue("frontdesk", "queued message");
    setActiveHookRouter(router);

    assert.equal(resolveRegisteredFrontDeskAgentId(), "agent-fd-dead");
    assert.equal(fs.existsSync(fdFile), true);
    assert.equal(fs.existsSync(repoFile), true);

    const mockContext = {
      paseo: {
        agents: {
          list: async () => ({ entries: [] }),
          ref: () => ({ archive: async () => ({ ok: true }) }),
        },
      },
    } as any;

    const res = await handleFleetTeardown(
      { targets: ["frontdesk"], confirm: true },
      mockContext
    );

    assert.equal(res.ok, true);
    assert.equal(fs.existsSync(fdFile), false, "frontdesk.json must be unlinked");
    assert.equal(resolveRegisteredFrontDeskAgentId(), null, "Front Desk agent ID must resolve to null");
    assert.equal(router.readFrontDesk(), null, "active router frontdesk registration must be cleared");
    assert.equal(router.getQueue("frontdesk").length, 0, "active router frontdesk queue must be cleared");
    assert.equal(fs.existsSync(repoFile), true, "orchestrator state file must be preserved when not targeted");
  });

  it("deletes orchestrators/*.json and clears active router orchestrators when targeted", async () => {
    const fdFile = path.join(tmpDir, "frontdesk.json");
    const orchDir = path.join(tmpDir, "orchestrators");
    fs.mkdirSync(orchDir, { recursive: true });
    const repoA = path.join(orchDir, "repo-a.json");
    const repoB = path.join(orchDir, "repo-b.json");

    fs.writeFileSync(fdFile, JSON.stringify({ agentId: "agent-fd-keep" }), "utf8");
    fs.writeFileSync(repoA, JSON.stringify({ agentId: "agent-orch-a", key: "repo-a" }), "utf8");
    fs.writeFileSync(repoB, JSON.stringify({ agentId: "agent-orch-b", key: "repo-b" }), "utf8");

    const router = new HookRouter(null, {
      stateDir: orchDir,
      queueDir: path.join(tmpDir, "queues"),
      port: 0,
    });
    router.writeOrchestrator("repo-a", "agent-orch-a");
    router.writeOrchestrator("repo-b", "agent-orch-b");
    setActiveHookRouter(router);

    assert.equal(router.listOrchestratorRecords().length, 2);

    const mockContext = {
      paseo: {
        agents: {
          list: async () => ({ entries: [] }),
          ref: () => ({ archive: async () => ({ ok: true }) }),
        },
      },
    } as any;

    const res = await handleFleetTeardown(
      { targets: ["orchestrators"], confirm: true },
      mockContext
    );

    assert.equal(res.ok, true);
    assert.equal(fs.existsSync(repoA), false, "repo-a.json must be unlinked");
    assert.equal(fs.existsSync(repoB), false, "repo-b.json must be unlinked");
    assert.equal(router.listOrchestratorRecords().length, 0, "active router orchestrators must be cleared");
    assert.equal(fs.existsSync(fdFile), true, "frontdesk.json must be preserved when not targeted");
  });

  it("clears worker queues when workers or all targets are targeted", async () => {
    const queueDir = path.join(tmpDir, "queues");
    fs.mkdirSync(queueDir, { recursive: true });
    const workerQ = path.join(queueDir, "worker-queue.json");
    fs.writeFileSync(workerQ, JSON.stringify([{ id: "w1" }]), "utf8");

    const router = new HookRouter(null, {
      stateDir: tmpDir,
      queueDir,
      port: 0,
    });
    router.enqueue("worker-task", "job 1");
    setActiveHookRouter(router);

    const mockContext = {
      paseo: {
        agents: {
          list: async () => ({ entries: [] }),
          ref: () => ({ archive: async () => ({ ok: true }) }),
        },
      },
    } as any;

    const res = await handleFleetTeardown(
      { targets: ["workers"], confirm: true },
      mockContext
    );

    assert.equal(res.ok, true);
    assert.equal(fs.existsSync(workerQ), false, "worker queue file must be unlinked");
    assert.equal(router.getQueue("worker-task").length, 0, "router worker queue must be cleared");
  });

  it("archives matching live agents and cleans state files on general teardown", async () => {
    const fdFile = path.join(tmpDir, "frontdesk.json");
    const orchDir = path.join(tmpDir, "orchestrators");
    fs.mkdirSync(orchDir, { recursive: true });
    const repoFile = path.join(orchDir, "repo.json");

    fs.writeFileSync(fdFile, JSON.stringify({ agentId: "agent-fd" }), "utf8");
    fs.writeFileSync(repoFile, JSON.stringify({ agentId: "agent-orch" }), "utf8");

    const archivedAgents: string[] = [];
    const mockContext = {
      paseo: {
        agents: {
          list: async () => ({
            entries: [
              { id: "agent-fd", name: "Front Desk", labels: { role: "front-desk" }, status: "idle" },
              { id: "agent-orch", name: "Orchestrator", labels: { role: "orchestrator" }, status: "idle" },
              { id: "agent-worker", name: "Worker", labels: { role: "worker" }, status: "idle" },
            ],
          }),
          ref: (id: string) => ({
            archive: async () => {
              archivedAgents.push(id);
              return { ok: true };
            },
          }),
        },
      },
    } as any;

    const res = await handleFleetTeardown(
      { targets: ["frontdesk", "orchestrators", "workers"], confirm: true },
      mockContext
    );

    assert.equal(res.ok, true);
    assert.equal(res.tornDown.frontdesk, 1);
    assert.equal(res.tornDown.orchestrators, 1);
    assert.equal(res.tornDown.workers, 1);
    assert.deepEqual(archivedAgents.sort(), ["agent-fd", "agent-orch", "agent-worker"].sort());
    assert.equal(fs.existsSync(fdFile), false);
    assert.equal(fs.existsSync(repoFile), false);
  });

  it("engages router.halt() at start of teardown and prevents new agent spawns (#994)", async () => {
    const router = new HookRouter(null, {
      stateDir: tmpDir,
      queueDir: path.join(tmpDir, "queues"),
      port: 0,
    });
    setActiveHookRouter(router);

    let haltObservedBeforeArchive = false;
    let archiveCalls = 0;

    const mockContext = {
      paseo: {
        agents: {
          list: async () => ({
            entries: [
              { id: "agent-1", name: "Worker 1", labels: { role: "worker" }, status: "idle" },
            ],
          }),
          ref: () => ({
            archive: async () => {
              archiveCalls++;
              if (router.isHalted()) {
                haltObservedBeforeArchive = true;
              }
              return { ok: true };
            },
          }),
        },
      },
    } as any;

    assert.equal(router.isHalted(), false);

    const res = await handleFleetTeardown(
      { targets: ["workers"], confirm: true },
      mockContext
    );

    assert.equal(res.ok, true);
    assert.equal(archiveCalls, 1);
    assert.equal(haltObservedBeforeArchive, true, "router must be halted before archiving agents");
    assert.equal(router.isHalted(), true, "router remains halted after teardown");

    // Attempting to spawn Front Desk during/after teardown must be rejected
    const createFdRes = await handleUppidiCreateFrontDesk(
      { title: "New Front Desk", prompt: "Hello" },
      mockContext
    );
    assert.equal(createFdRes.ok, false);
    assert.match(createFdRes.error || "", /halt|teardown/i);

    // Attempting to ensure an orchestrator must be rejected
    const ensureOrchRes = await router.ensureOrchestrator({ repo: "xpufx-org/test-repo" });
    assert.equal(ensureOrchRes.ok, false);
    assert.match(ensureOrchRes.error || "", /halted/i);
  });

  it("handles fleet teardown with drain: true waiting for running agent to become idle (#995)", async () => {
    let checkCount = 0;
    const archivedAgents: string[] = [];

    const mockContext = {
      paseo: {
        agents: {
          list: async () => {
            checkCount++;
            return {
              entries: [
                {
                  id: "agent-running-1",
                  name: "Worker 1",
                  labels: { role: "worker" },
                  // Status is running on first call, becomes idle on subsequent calls
                  status: checkCount === 1 ? "running" : "idle",
                },
              ],
            };
          },
          ref: (id: string) => ({
            archive: async () => {
              archivedAgents.push(id);
              return { ok: true };
            },
          }),
        },
      },
    } as any;

    const res = await handleFleetTeardown(
      { targets: ["workers"], confirm: true, drain: true, drainTimeoutMs: 2000 },
      mockContext
    );

    assert.equal(res.ok, true);
    assert.equal(res.tornDown.workers, 1);
    assert.deepEqual(archivedAgents, ["agent-running-1"]);
    assert.ok(checkCount >= 2, "must poll until the running agent becomes idle");
  });

  it("handles fleet teardown with drain: true timing out when agent remains running (#995)", async () => {
    const archivedAgents: string[] = [];

    const mockContext = {
      paseo: {
        agents: {
          list: async () => ({
            entries: [
              {
                id: "agent-running-forever",
                name: "Worker Stuck",
                labels: { role: "worker" },
                status: "running",
              },
            ],
          }),
          ref: (id: string) => ({
            archive: async () => {
              archivedAgents.push(id);
              return { ok: true };
            },
          }),
        },
      },
    } as any;

    const start = Date.now();
    const res = await handleFleetTeardown(
      { targets: ["workers"], confirm: true, drain: true, drainTimeoutMs: 300 },
      mockContext
    );
    const elapsed = Date.now() - start;

    assert.equal(res.ok, true);
    assert.ok(elapsed >= 250, "must wait for drain interval before timeout");
    assert.equal(res.tornDown.workers, 1, "archives remaining running agents after timeout");
    assert.deepEqual(archivedAgents, ["agent-running-forever"]);
  });
});

describe("Front Desk intro prompt hook context (#903)", () => {
  let tmpDir: string;
  let prevSecretEnv: string | undefined;
  let prevSecretFile: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uppidi-fleet-fd-intro-"));
    prevSecretEnv = process.env.FORGEJO_WEBHOOK_SECRET;
    prevSecretFile = process.env.PASEO_FORGEJO_HOOK_SECRET_FILE;
  });

  afterEach(() => {
    setActiveHookRouter(null);
    if (prevSecretEnv !== undefined) process.env.FORGEJO_WEBHOOK_SECRET = prevSecretEnv;
    else delete process.env.FORGEJO_WEBHOOK_SECRET;
    if (prevSecretFile !== undefined) process.env.PASEO_FORGEJO_HOOK_SECRET_FILE = prevSecretFile;
    else delete process.env.PASEO_FORGEJO_HOOK_SECRET_FILE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends the active router endpoint and auth path without the secret value", () => {
    const secretPath = path.join(tmpDir, "forgejo-hook.secret");
    const secretValue = "yet-another-secret-value";
    fs.writeFileSync(secretPath, secretValue, "utf8");
    delete process.env.FORGEJO_WEBHOOK_SECRET;
    process.env.PASEO_FORGEJO_HOOK_SECRET_FILE = secretPath;

    const router = new HookRouter(null, {
      host: "10.9.8.7",
      port: 9123,
      stateDir: tmpDir,
      queueDir: path.join(tmpDir, "queues"),
    });
    setActiveHookRouter(router);

    const prompt = buildFrontDeskIntroPrompt("Custom Front Desk intro.");
    assert.ok(prompt.startsWith("Custom Front Desk intro."), "custom intro is preserved");
    assert.ok(prompt.includes("host: 10.9.8.7"), "host comes from the active router");
    assert.ok(prompt.includes("port: 9123"), "port comes from the active router");
    assert.ok(prompt.includes("baseUrl: http://10.9.8.7:9123"), "baseUrl is derived");
    assert.ok(prompt.includes("resolution source: active-router"), "the rung is named");
    assert.ok(prompt.includes(secretPath), "auth names the secret path");
    assert.ok(!prompt.includes(secretValue), "the secret value is never embedded");
  });

  it("reports missing auth without failing when the secret file is absent", () => {
    delete process.env.FORGEJO_WEBHOOK_SECRET;
    process.env.PASEO_FORGEJO_HOOK_SECRET_FILE = path.join(tmpDir, "missing.secret");

    const router = new HookRouter(null, {
      host: "10.9.8.7",
      port: 9123,
      stateDir: tmpDir,
      queueDir: path.join(tmpDir, "queues"),
    });
    setActiveHookRouter(router);

    const prompt = buildFrontDeskIntroPrompt();
    assert.ok(prompt.includes("auth: no shared webhook secret at"), "absence is stated");
    assert.ok(prompt.includes(path.join(tmpDir, "missing.secret")), "expected location is named");
  });
});

describe("repo root off-main inspection (#919)", () => {
  let root: string;
  let worktreeParent: string;
  let worktree: string;

  const git = (cwd: string, args: string[]): string =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    }).trim();

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-919-root-"));
    worktreeParent = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-919-wt-"));
    worktree = path.join(worktreeParent, "checkout");
    git(root, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(root, "README.md"), "hello\n");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-m", "init"]);
    git(root, ["worktree", "add", "-b", "feat/919-inspect", worktree]);
  });

  afterEach(() => {
    try {
      git(root, ["worktree", "remove", "--force", worktree]);
    } catch {
      // best-effort cleanup
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(worktreeParent, { recursive: true, force: true });
  });

  it("reports main as on-main and clean on the primary checkout", async () => {
    const result = await checkRepoMainDirty(root);
    assert.equal(result.isDirty, false);
    assert.equal(result.branch, "main");
    assert.equal(result.isOffMain, false);
  });

  it("inspects the primary checkout when handed a linked worktree cwd", async () => {
    // The worktree is on feat/919-inspect; the badge must reflect the repo root.
    assert.equal(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]), "feat/919-inspect");
    const result = await checkRepoMainDirty(worktree);
    assert.equal(result.branch, "main");
    assert.equal(result.isOffMain, false);
  });

  it("flags a non-main primary branch and reflects it from a worktree cwd", async () => {
    git(root, ["checkout", "-b", "feat/primary-off-main"]);
    const primary = await checkRepoMainDirty(root);
    assert.equal(primary.branch, "feat/primary-off-main");
    assert.equal(primary.isOffMain, true);

    const fromWorktree = await checkRepoMainDirty(worktree);
    assert.equal(fromWorktree.branch, "feat/primary-off-main");
    assert.equal(fromWorktree.isOffMain, true);
  });

  it("treats detached HEAD as off-main", async () => {
    git(root, ["checkout", "--detach"]);
    const result = await checkRepoMainDirty(root);
    assert.equal(result.branch, "HEAD");
    assert.equal(result.isOffMain, true);
  });

  it("reports dirty state with a summary", async () => {
    fs.writeFileSync(path.join(root, "dirty.txt"), "uncommitted\n");
    const result = await checkRepoMainDirty(root);
    assert.equal(result.isDirty, true);
    assert.equal(result.summary, "1 uncommitted file");
    assert.equal(result.isOffMain, false);
  });

  it("returns a safe default when cwd is missing or not a repository", async () => {
    assert.deepEqual(await checkRepoMainDirty(undefined), { isDirty: false, isOffMain: false });
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-919-nonrepo-"));
    try {
      const result = await checkRepoMainDirty(nonRepo);
      assert.equal(result.isDirty, false);
      assert.equal(result.isOffMain, false);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});

describe("Fleet HALT / RESUME handlers (#1013)", () => {
  let tmpDir: string;
  let prevHookStateDir: string | undefined;
  let prevHookQueueDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uppidi-fleet-halt-rpc-test-"));
    prevHookStateDir = process.env.HOOK_STATE_DIR;
    prevHookQueueDir = process.env.HOOK_QUEUE_DIR;
    process.env.HOOK_STATE_DIR = tmpDir;
    process.env.HOOK_QUEUE_DIR = path.join(tmpDir, "queues");
    setExecFileAsyncForTest(async () => ({ stdout: "[]", stderr: "" }));
  });

  afterEach(() => {
    setExecFileAsyncForTest(null);
    setActiveHookRouter(null);
    if (prevHookStateDir !== undefined) process.env.HOOK_STATE_DIR = prevHookStateDir;
    else delete process.env.HOOK_STATE_DIR;
    if (prevHookQueueDir !== undefined) process.env.HOOK_QUEUE_DIR = prevHookQueueDir;
    else delete process.env.HOOK_QUEUE_DIR;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function makeRouter(): HookRouter {
    const router = new HookRouter(null, {
      stateDir: tmpDir,
      queueDir: path.join(tmpDir, "queues"),
      port: 0,
    });
    setActiveHookRouter(router);
    return router;
  }

  it("engages the canonical halt and reports a no-op on a second engage", async () => {
    const router = makeRouter();
    assert.equal(router.isHalted(), false);

    const first = await handleFleetHalt({ confirm: true });
    assert.equal(first.ok, true);
    assert.equal(first.halted, true);
    assert.equal(first.alreadyHalted, false);
    assert.equal(router.isHalted(), true);
    assert.equal(router.isAllPaused(), true);

    const second = await handleFleetHalt({ confirm: true });
    assert.equal(second.ok, true);
    assert.equal(second.halted, true);
    assert.equal(second.alreadyHalted, true, "double-engage must be guarded");
  });

  it("clears the halt through resume('all')", async () => {
    const router = makeRouter();
    await handleFleetHalt({ confirm: true });
    assert.equal(router.isHalted(), true);

    const res = await handleFleetResume({ confirm: true });
    assert.equal(res.ok, true);
    assert.equal(res.halted, false);
    assert.equal(router.isHalted(), false);
    assert.equal(router.isAllPaused(), false);
  });

  it("refuses resume while a teardown is mid-flight", async () => {
    const router = makeRouter();
    await handleFleetHalt({ confirm: true });
    router.markTeardownStart();

    const res = await handleFleetResume({ confirm: true });
    assert.equal(res.ok, false);
    assert.equal(res.teardownInProgress, true);
    assert.match(res.error || "", /teardown in progress/i);
    assert.equal(router.isHalted(), true, "halt must remain engaged during teardown");

    router.markTeardownEnd();
    const after = await handleFleetResume({ confirm: true });
    assert.equal(after.ok, true);
    assert.equal(router.isHalted(), false);
  });

  it("treats a missing active router as an error", async () => {
    setActiveHookRouter(null);
    const halt = await handleFleetHalt({ confirm: true });
    assert.equal(halt.ok, false);
    assert.match(halt.error || "", /not running/i);
    const resume = await handleFleetResume({ confirm: true });
    assert.equal(resume.ok, false);
    assert.match(resume.error || "", /not running/i);
  });

  it("holds the teardown window across handleFleetTeardown and releases it afterwards", async () => {
    const router = makeRouter();
    let sawTeardownWindow = false;
    let sawHalted = false;
    let sawListDuringTeardown = false;
    // The broadcast happens after halt() but before archiving, so it is the
    // earliest point where both the teardown window and the halt must be set.
    (router as any).broadcastTeardownNotice = async () => {
      sawTeardownWindow = router.isTeardownInProgress();
      sawHalted = router.isHalted();
      return { queuedKeys: [], delivered: 0 };
    };
    const mockContext = {
      paseo: {
        agents: {
          list: async () => {
            sawListDuringTeardown = sawListDuringTeardown || router.isTeardownInProgress();
            return { entries: [] };
          },
          ref: () => ({ archive: async () => ({ ok: true }) }),
        },
      },
    } as any;

    await handleFleetTeardown({ targets: ["workers"], confirm: true }, mockContext);

    assert.equal(sawListDuringTeardown, true, "teardown window must be open before archiving runs");
    assert.equal(sawTeardownWindow, true, "teardown window must be open while archiving runs");
    assert.equal(sawHalted, true, "canonical halt must be engaged while teardown runs");
    assert.equal(router.isTeardownInProgress(), false, "teardown window must close when the handler returns");
    assert.equal(router.isHalted(), true, "the halt remains engaged after teardown until RESUME");

    const resume = await handleFleetResume({ confirm: true });
    assert.equal(resume.ok, true);
    assert.equal(router.isHalted(), false);
  });
});
