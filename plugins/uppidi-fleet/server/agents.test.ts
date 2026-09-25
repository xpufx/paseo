import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
  handleUppidiAgents,
  getWorkspaceProjectMap,
  setWorkspaceProjectMapForTest,
  applyParentProjectInheritance,
  resolveSpawnMode,
  findScopeMatchingPermission,
  autoAllowScopedPermission,
  setExecFileAsyncForTest,
} from "./agents.js";
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
      assert.equal(worker.project, "xpufx-org/paseo");
      assert.equal(worker.worktree, "fix-530-authoritative-agent-project-resolution");

      // Ad-hoc agent with a non-repo title still resolves via workspaceId.
      const adHoc = normalizeRawAgent({
        id: "ad-hoc",
        name: "Fleet UI: Modern Executive Cockpit",
        status: "idle",
        workspaceId: "wks_platform",
      });
      assert.equal(adHoc.project, "xpufx-org/platform");
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
      assert.equal(labeled.project, "xpufx-org/platform");

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
      assert.equal(worker.project, "xpufx-org/paseo");
      assert.equal(grandchild.project, "xpufx-org/paseo");
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
      assert.equal(map["wks_worktree"], "xpufx-org/paseo");
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
            description: "Scope: /home/xpufx/code/paseo/*",
          },
        ],
      },
      new Set(),
      {}
    );

    assert.equal(agent.deterministicState, "permission-prompt");
    assert.equal(agent.lifecycleState, "waiting_for_input");
    assert.equal(agent.stateDetail, "access external dir (/home/xpufx/code/paseo/*)");
    assert.equal(agent.blockDetail?.requiredPermissionId, "perm-req-537");
    assert.equal(agent.blockDetail?.scope, "/home/xpufx/code/paseo/*");
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
