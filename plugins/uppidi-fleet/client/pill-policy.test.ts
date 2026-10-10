import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFleetHarness } from "./testing/fleet-harness.js";
import {
  FLEET_PILL_POLICY,
  type AgentRoleKind,
  type FleetPillId,
} from "./pill-policy.js";
import type { UppidiAgent, UppidiAgentTreeNode } from "../shared/contracts.js";

describe("FLEET_PILL_POLICY declarative matrix", () => {
  it("verifies FLEET_PILL_POLICY mapping matches the approved spec", () => {
    assert.deepEqual(FLEET_PILL_POLICY["front-desk"], {
      defaultPills: ["state", "role"],
      subPills: ["shortId", "model", "worktree", "labels"],
    });

    assert.deepEqual(FLEET_PILL_POLICY.orchestrator, {
      defaultPills: ["state", "dirtyWarning", "branchWarning"],
      subPills: ["shortId", "role", "model", "worktree", "parentage", "labels"],
    });

    assert.deepEqual(FLEET_PILL_POLICY["coding-agent"], {
      defaultPills: ["state", "issue"],
      subPills: ["shortId", "model", "worktree", "parentage", "labels"],
    });
  });
});

describe("Tree View Pill Visibility & Drawer Rendering", () => {
  const sampleWorkerAgent: UppidiAgent = {
    id: "wks_worker_123",
    shortId: "w123456",
    name: "Worker Agent",
    category: "worker",
    status: "running",
    deterministicState: "working",
    stateDetail: "PR #1192 open",
    model: "gemini-3.8-flash-low",
    worktree: "feat-1192-configurable-pills",
    attributedWork: { issue: 1192 },
    parentName: "Orchestrator Paseo",
    parentId: "wks_orch_456",
    labels: { repo: "xpufx-org/paseo" },
    lastActivityAt: new Date(Date.now() - 60000).toISOString(),
  };

  const sampleWorkerNode: UppidiAgentTreeNode = {
    agent: sampleWorkerAgent,
    depth: 1,
    children: [],
  };

  const sampleOrchAgent: UppidiAgent = {
    id: "wks_orch_456",
    shortId: "o456789",
    name: "Orchestrator Paseo",
    category: "orchestrator",
    status: "running",
    deterministicState: "running",
    model: "gemini-3.8-flash-low",
    worktree: "paseo-main",
    isMainDirty: true,
    mainDirtySummary: "2 uncommitted files",
    isRepoRootOffMain: true,
    repoHeadBranch: "feat/some-branch",
    parentName: "Fleet Front Desk",
    parentId: "wks_fd_000",
    labels: { mode: "interactive" },
    lastActivityAt: new Date(Date.now() - 30000).toISOString(),
  };

  const sampleOrchNode: UppidiAgentTreeNode = {
    agent: sampleOrchAgent,
    depth: 0,
    children: [sampleWorkerNode],
  };

  const sampleFrontDeskAgent: UppidiAgent = {
    id: "wks_fd_000",
    shortId: "f000111",
    name: "Fleet Front Desk",
    category: "front-desk",
    status: "sleeping",
    deterministicState: "sleeping",
    stateDetail: "Standby",
    model: "gemini-3.8-flash-low",
    worktree: "host-checkout",
    labels: { role: "liaison" },
    lastActivityAt: new Date(Date.now() - 10000).toISOString(),
  };

  const sampleFrontDeskNode: UppidiAgentTreeNode = {
    agent: sampleFrontDeskAgent,
    depth: 0,
    children: [],
  };

  it("verifies DenseAgentRow default render displays only defaultPills and hides subPills initially", async () => {
    const h = await getFleetHarness();
    const { tree, root } = await h.renderWithRoot(
      h.React.createElement(h.DenseAgentRow, {
        node: sampleWorkerNode,
        colors: {},
        typography: {},
        onArchiveAgent: () => {},
      }),
    );

    // Default pills for coding-agent: ['state', 'issue']
    const issueBadges = root.findAll(
      (node: any) => node.props.label === "#1192",
    );
    assert.equal(issueBadges.length, 1, "Issue badge should be rendered on default row");

    const stateBadges = root.findAll(
      (node: any) => typeof node.props.label === "string" && node.props.label.includes("working"),
    );
    assert.equal(stateBadges.length, 1, "State badge should be rendered on default row");

    // Sub pills for coding-agent: ['shortId', 'model', 'worktree', 'parentage', 'labels']
    // Should NOT be rendered before drawer is expanded
    const shortIdBadges = root.findAll(
      (node: any) => node.props.label === sampleWorkerAgent.shortId,
    );
    assert.equal(shortIdBadges.length, 0, "shortId should not be rendered in default row");

    const modelBadges = root.findAll(
      (node: any) => node.props.label === sampleWorkerAgent.model,
    );
    assert.equal(modelBadges.length, 0, "model should not be rendered in default row");

    const worktreeBadges = root.findAll(
      (node: any) => node.props.label === sampleWorkerAgent.worktree,
    );
    assert.equal(worktreeBadges.length, 0, "worktree should not be rendered in default row");
  });

  it("verifies DenseAgentRow renders subPills when sub-row drawer is toggled", async () => {
    const h = await getFleetHarness();
    const { root } = await h.renderWithRoot(
      h.React.createElement(h.DenseAgentRow, {
        node: sampleWorkerNode,
        colors: {},
        typography: {},
        onArchiveAgent: () => {},
      }),
    );

    // Find the drawer toggle interactive button
    const toggle = root.find(
      (node: any) =>
        node.props.accessibilityRole === "button" &&
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.includes("secondary badges"),
    );
    assert.ok(toggle, "Secondary badges expand toggle button must be present");

    // Toggle expansion
    await h.TestRenderer.act(async () => {
      toggle.props.onPress();
    });

    // Sub pills should now be visible
    const shortIdBadges = root.findAll(
      (node: any) => node.props.label === sampleWorkerAgent.shortId,
    );
    assert.equal(shortIdBadges.length, 1, "shortId must be rendered after expanding drawer");

    const modelBadges = root.findAll(
      (node: any) => node.props.label === sampleWorkerAgent.model,
    );
    assert.equal(modelBadges.length, 1, "model must be rendered after expanding drawer");

    const worktreeBadges = root.findAll(
      (node: any) => node.props.label === sampleWorkerAgent.worktree,
    );
    assert.equal(worktreeBadges.length, 1, "worktree must be rendered after expanding drawer");
  });

  it("verifies OrchestratorRow default row only renders defaultPills and expands subPills in drawer", async () => {
    const h = await getFleetHarness();
    const { OrchestratorRow, getAgentRoleKind } = await import("./tree-view.js");

    assert.equal(getAgentRoleKind(sampleOrchAgent), "orchestrator");

    const { root } = await h.renderWithRoot(
      h.React.createElement(OrchestratorRow, {
        node: sampleOrchNode,
        colors: {},
        typography: {},
        onArchiveAgent: () => {},
      }),
    );

    // Orchestrator defaultPills: ['state', 'dirtyWarning', 'branchWarning']
    const dirtyBadges = root.findAll(
      (node: any) => typeof node.props.label === "string" && node.props.label.includes("Main Dirty"),
    );
    assert.equal(dirtyBadges.length, 1, "Main Dirty warning must be rendered in default row");

    const branchBadges = root.findAll(
      (node: any) => typeof node.props.label === "string" && node.props.label.includes("Not Main"),
    );
    assert.equal(branchBadges.length, 1, "Not Main warning must be rendered in default row");

    // Sub pills before expansion: shortId, model, role should not be visible
    const shortIdBadges = root.findAll(
      (node: any) => node.props.label === sampleOrchAgent.shortId,
    );
    assert.equal(shortIdBadges.length, 0, "shortId must not be visible on default orchestrator row");

    // Expand subPills drawer
    const toggle = root.find(
      (node: any) =>
        node.props.accessibilityRole === "button" &&
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.includes("secondary badges"),
    );
    assert.ok(toggle, "Orchestrator secondary badges expand toggle must exist");

    await h.TestRenderer.act(async () => {
      toggle.props.onPress();
    });

    // Now subPills should appear
    const expandedShortId = root.findAll(
      (node: any) => node.props.label === sampleOrchAgent.shortId,
    );
    assert.equal(expandedShortId.length, 1, "shortId must appear after expanding drawer");

    const roleBadges = root.findAll(
      (node: any) => node.props.label === "Orchestrator",
    );
    assert.equal(roleBadges.length, 1, "Orchestrator role pill must appear after expanding drawer");
  });

  it("verifies FrontDeskHero default renders defaultPills and expands subPills in drawer", async () => {
    const h = await getFleetHarness();
    const { FrontDeskHero, getAgentRoleKind } = await import("./tree-view.js");

    assert.equal(getAgentRoleKind(sampleFrontDeskAgent), "front-desk");

    const { root } = await h.renderWithRoot(
      h.React.createElement(FrontDeskHero, {
        node: sampleFrontDeskNode,
        orchestrators: [sampleOrchAgent],
        colors: {},
        typography: {},
        onArchiveAgent: () => {},
      }),
    );

    // Front-desk defaultPills: ['state', 'role']
    const roleBadges = root.findAll((node: any) => node.props.label === "Liaison");
    assert.equal(roleBadges.length, 1, "Liaison role pill must be in default row");

    const stateBadges = root.findAll(
      (node: any) => typeof node.props.label === "string" && node.props.label.includes("sleeping"),
    );
    assert.equal(stateBadges.length, 1, "State pill must be in default row");

    // Sub pills before expansion: shortId, model should not be visible
    const shortIdBadges = root.findAll((node: any) => node.props.label === sampleFrontDeskAgent.shortId);
    assert.equal(shortIdBadges.length, 0, "shortId must not be on default Front Desk hero");

    // Expand drawer
    const toggle = root.find(
      (node: any) =>
        node.props.accessibilityRole === "button" &&
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.includes("secondary badges"),
    );
    assert.ok(toggle, "Front Desk secondary badges toggle must exist");

    await h.TestRenderer.act(async () => {
      toggle.props.onPress();
    });

    const expandedShortId = root.findAll((node: any) => node.props.label === sampleFrontDeskAgent.shortId);
    assert.equal(expandedShortId.length, 1, "shortId must be visible after expanding Front Desk drawer");
  });

  it("verifies identity anchor in DenseAgentRow and OrchestratorRow never wraps and truncates safely (#1192)", async () => {
    const h = await getFleetHarness();
    const { DenseAgentRow, OrchestratorRow, AgentTitleLink } = await import("./tree-view.js");

    // Check DenseAgentRow identity anchor
    const { root: workerRoot } = await h.renderWithRoot(
      h.React.createElement(DenseAgentRow, {
        node: sampleWorkerNode,
        colors: { accent: "#3b82f6", surface1: "#1e293b", foregroundMuted: "#94a3b8", foreground: "#f8fafc" },
        typography: { body: {}, heading: {}, caption: {} },
        onArchiveAgent: () => {},
      }),
    );

    const workerTitle = workerRoot.findByType(AgentTitleLink);
    assert.ok(workerTitle, "Worker title link component must exist");
    // Verify parent of AgentTitleLink is the identity anchor cluster with wrap={false} and minWidth: 0
    const workerAnchor = workerTitle.parent;
    assert.ok(workerAnchor, "Worker title must be wrapped in anchor cluster");
    const workerStyle = Array.isArray(workerAnchor.props.style)
      ? Object.assign({}, ...workerAnchor.props.style.filter(Boolean))
      : workerAnchor.props.style;
    assert.equal(workerStyle.flexWrap, undefined, "Worker identity anchor cluster must not wrap");
    assert.equal(workerStyle.minWidth, 0, "Worker identity anchor must have minWidth: 0");
    assert.equal(workerStyle.flexShrink, 1, "Worker identity anchor must have flexShrink: 1");

    // Check OrchestratorRow identity anchor and distinct styling
    const { root: orchRoot } = await h.renderWithRoot(
      h.React.createElement(OrchestratorRow, {
        node: sampleOrchNode,
        colors: { accent: "#3b82f6", surface1: "#1e293b", foregroundMuted: "#94a3b8", foreground: "#f8fafc" },
        typography: { body: {}, heading: {}, caption: {} },
        onArchiveAgent: () => {},
      }),
    );

    const orchTitle = orchRoot.findByType(AgentTitleLink);
    assert.ok(orchTitle, "Orchestrator title link component must exist");
    const orchAnchor = orchTitle.parent;
    assert.ok(orchAnchor, "Orchestrator title must be wrapped in anchor cluster");
    const orchStyle = Array.isArray(orchAnchor.props.style)
      ? Object.assign({}, ...orchAnchor.props.style.filter(Boolean))
      : orchAnchor.props.style;
    assert.equal(orchStyle.flexWrap, undefined, "Orchestrator identity anchor cluster must not wrap");
    assert.equal(orchStyle.minWidth, 0, "Orchestrator identity anchor must have minWidth: 0");
    assert.equal(orchStyle.flexShrink, 1, "Orchestrator identity anchor must have flexShrink: 1");

    // Title weight must be distinct 700
    assert.equal(orchTitle.props.fontWeight, "700", "Orchestrator title link must have distinct fontWeight 700");

    // Container row must have subtle background tint applied
    const orchComp = orchRoot.findByType(OrchestratorRow);
    const orchContainer = orchComp.children[0] as any;
    assert.ok(orchContainer.props.style?.backgroundColor, "Orchestrator row must have background tint");
    assert.notEqual(
      orchContainer.props.style?.backgroundColor,
      "transparent",
      "Orchestrator row must have subtle background tint rather than transparent",
    );
  });
});

