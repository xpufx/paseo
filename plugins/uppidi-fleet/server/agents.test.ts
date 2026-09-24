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
