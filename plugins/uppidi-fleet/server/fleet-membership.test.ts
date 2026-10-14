import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFleetMember, stampFrontDeskLabels, stampOrchestratorLabels, stampWorkerLabels } from "./fleet-membership.js";

describe("deterministic fleet membership (#1151)", () => {
  // -----------------------------------------------------------------------
  // isFleetMember — core predicate
  // -----------------------------------------------------------------------

  const emptyRoster = { frontDeskId: null, orchestratorIds: new Set<string>() };

  it("returns false for null / undefined agents", () => {
    assert.equal(isFleetMember(null, emptyRoster), false);
    assert.equal(isFleetMember(undefined, emptyRoster), false);
  });

  it("returns false for agents with empty id", () => {
    assert.equal(isFleetMember({ id: "" }, emptyRoster), false);
  });

  it("matches the registered Front Desk agent", () => {
    const roster = { frontDeskId: "fd-1", orchestratorIds: new Set<string>() };
    assert.equal(isFleetMember({ id: "fd-1" }, roster), true);
    assert.equal(isFleetMember({ id: "fd-2" }, roster), false);
  });

  it("matches registered orchestrators by id", () => {
    const orchIds = new Set(["orch-1", "orch-2"]);
    const roster = { frontDeskId: null, orchestratorIds: orchIds };
    assert.equal(isFleetMember({ id: "orch-1" }, roster), true);
    assert.equal(isFleetMember({ id: "orch-2" }, roster), true);
    assert.equal(isFleetMember({ id: "orch-3" }, roster), false);
  });

  it("matches coding agents whose parent is a registered orchestrator via labels", () => {
    const orchIds = new Set(["orch-parent"]);
    const roster = { frontDeskId: null, orchestratorIds: orchIds };

    // fleet.uppidi.com/parent label
    assert.equal(
      isFleetMember({ id: "worker-1", labels: { "fleet.uppidi.com/parent": "orch-parent" } }, roster),
      true,
    );
    // paseo.parent-agent-id label (legacy key)
    assert.equal(
      isFleetMember({ id: "worker-2", labels: { "paseo.parent-agent-id": "orch-parent" } }, roster),
      true,
    );
    // parentId field
    assert.equal(
      isFleetMember({ id: "worker-3", parentId: "orch-parent" }, roster),
      true,
    );
    // Priority: fleet.uppidi.com/parent > paseo.parent-agent-id > parentId
    assert.equal(
      isFleetMember(
        { id: "worker-prio", parentId: "unknown", labels: { "paseo.parent-agent-id": "orch-parent" } },
        roster,
      ),
      true,
    );
  });

  it("does NOT match when parent is not a registered orchestrator", () => {
    const orchIds = new Set(["orch-known"]);
    const roster = { frontDeskId: null, orchestratorIds: orchIds };
    assert.equal(
      isFleetMember({ id: "orphan", parentId: "unknown-parent" }, roster),
      false,
    );
    assert.equal(
      isFleetMember(
        { id: "orphan-labeled", labels: { "fleet.uppidi.com/parent": "unknown-parent" } },
        roster,
      ),
      false,
    );
  });

  it("rejects ad-hoc user sessions with similar names/repos (#1121 protection)", () => {
    const roster = { frontDeskId: null, orchestratorIds: new Set(["orch-1"]) };

    // Ad-hoc session with a repo label but no fleet parentage
    assert.equal(
      isFleetMember({ id: "adhoc-repo", labels: { repo: "xpufx-org/paseo" } }, roster),
      false,
    );
    // Ad-hoc session with issue label but no fleet parentage
    assert.equal(
      isFleetMember({ id: "adhoc-issue", labels: { "forgejo.issue": "42" } }, roster),
      false,
    );
    // Ad-hoc session with generic role=worker label but no roster match
    assert.equal(
      isFleetMember({ id: "adhoc-role", labels: { role: "worker" } }, roster),
      false,
    );
    // Ad-hoc session with title mentioning "Orchestrator" or "Front Desk"
    assert.equal(
      isFleetMember({ id: "fake-orch", name: "Orchestrator · xpufx-org/paseo" } as any, roster),
      false,
    );
    assert.equal(
      isFleetMember({ id: "fake-fd", name: "Front Desk" } as any, roster),
      false,
    );
    // Ad-hoc session working on an enrolled repo (no roster entry)
    assert.equal(
      isFleetMember({ id: "user-worktree", labels: { repo: "xpufx-org/paseo" }, parentId: null }, roster),
      false,
    );
  });

  it("handles both front-desk and orchestrator in the same roster", () => {
    const orchIds = new Set(["orch-1"]);
    const roster = { frontDeskId: "fd-1", orchestratorIds: orchIds };

    assert.equal(isFleetMember({ id: "fd-1" }, roster), true);
    assert.equal(isFleetMember({ id: "orch-1" }, roster), true);
    assert.equal(isFleetMember({ id: "worker-child", parentId: "orch-1" }, roster), true);
    assert.equal(isFleetMember({ id: "random-user" }, roster), false);
  });

  it("zero heuristics: no title regexes, no cwd guessing, no generic role checks", () => {
    const roster = { frontDeskId: null, orchestratorIds: new Set(["orch-1"]) };

    // Titles that used to match legacy regexes must NOT match now.
    assert.equal(isFleetMember({ id: "t1", title: "Orchestrator · main" } as any, roster), false);
    assert.equal(isFleetMember({ id: "t2", title: "Front Desk" } as any, roster), false);
    assert.equal(isFleetMember({ id: "t3", title: "paseo#1119 Front Desk live recovery" } as any, roster), false);
    assert.equal(isFleetMember({ id: "t4", title: "my scratch exploration session" } as any, roster), false);

    // Generic role="worker" must NOT match without roster/parentage.
    assert.equal(isFleetMember({ id: "w1", labels: { role: "worker" } }, roster), false);
    assert.equal(isFleetMember({ id: "w2", labels: { category: "coding-agent" } }, roster), false);

    // Cwd-based guessing is gone.
    assert.equal(isFleetMember({ id: "cwd-guess", cwd: "/home/user/code/paseo" } as any, roster), false);
  });
});

describe("endpoint stamping helpers (#1151)", () => {
  it("stamps Front Desk labels", () => {
    const labels: Record<string, string> = {};
    stampFrontDeskLabels(labels, "fd-abc123", "fleet-x");
    assert.equal(labels["fleet.uppidi.com/role"], "front-desk");
    assert.equal(labels["fleet.uppidi.com/fleet-id"], "fleet-x");
  });

  it("stamps Orchestrator labels", () => {
    const labels: Record<string, string> = {};
    stampOrchestratorLabels(labels, "orch-def456", "fleet-x", "xpufx-org/paseo");
    assert.equal(labels["fleet.uppidi.com/role"], "orchestrator");
    assert.equal(labels["fleet.uppidi.com/fleet-id"], "fleet-x");
    assert.equal(labels["repo"], "xpufx-org/paseo");
  });

  it("stamps Worker labels with optional issue", () => {
    const labels1: Record<string, string> = {};
    stampWorkerLabels(labels1, "orch-abc", 42);
    assert.equal(labels1["fleet.uppidi.com/role"], "coding-agent");
    assert.equal(labels1["fleet.uppidi.com/parent"], "orch-abc");
    assert.equal(labels1["fleet.uppidi.com/issue"], "42");

    const labels2: Record<string, string> = {};
    stampWorkerLabels(labels2, "orch-abc", null);
    assert.equal(labels2["fleet.uppidi.com/role"], "coding-agent");
    assert.equal(labels2["fleet.uppidi.com/parent"], "orch-abc");
    assert.equal(labels2["fleet.uppidi.com/issue"] === undefined, true);
  });
});
