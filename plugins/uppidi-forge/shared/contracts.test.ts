import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UppidiIssueSchema,
  HookQueueItemSchema,
  HookStatusOutputSchema,
  uppidiIssuesContract,
  uppidiHookStatusContract,
  DeterministicAgentStateSchema,
  UppidiAgentSchema,
  UppidiAgentTreeNodeSchema,
  UppidiAgentsOutputSchema,
  getDeterministicStateConfig,
  getAgentCategoryIcon,
  UppidiArchiveAgentInputSchema,
  UppidiArchiveAgentOutputSchema,
  uppidiArchiveAgentContract,
  UppidiArchiveInactiveAgentsInputSchema,
  UppidiArchiveInactiveAgentsOutputSchema,
  uppidiArchiveInactiveAgentsContract,
  extractAgentWorktree,
  extractAgentProject,
  HookServiceStatusOutputSchema,
  HookServiceConfigInputSchema,
  HookServiceConfigOutputSchema,
  uppidiHookConfigureContract,
} from "./contracts.js";


describe("uppidi-forge shared contracts", () => {
  it("validates UppidiIssueSchema with defaults", () => {
    const issue = UppidiIssueSchema.parse({
      number: 123,
      title: "Fix crash on launch",
      state: "open",
      repo: "paseo",
      status: "In progress",
      attention: "attention/0-orchestrator",
      comments: 5,
    });
    assert.equal(issue.number, 123);
    assert.equal(issue.status, "In progress");
    assert.equal(issue.attention, "attention/0-orchestrator");
    assert.equal(issue.comments, 5);
    assert.deepEqual(issue.labels, []);
  });

  it("validates HookQueueItemSchema", () => {
    const item = HookQueueItemSchema.parse({
      key: "forge.mrs.uppidi.com/xpufx-org/paseo",
      depth: 3,
      paused: false,
      isBusy: true,
      messages: [{ id: "msg-1", ts: 123456, preview: "push event" }],
    });
    assert.equal(item.key, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(item.depth, 3);
    assert.equal(item.isBusy, true);
    assert.equal(item.messages.length, 1);
  });

  it("has valid contract definitions", () => {
    assert.equal(uppidiIssuesContract.name, "uppidi-forge.issues");
    assert.equal(uppidiHookStatusContract.name, "uppidi-forge.hook-status");
  });

  it("validates deterministic agent state taxonomy strictly", () => {
    const validStates = [
      "working",
      "running",
      "sleeping",
      "idle:waiting",
      "idle:quota-exhausted",
      "failed:quota-exhausted",
      "failed:spawn",
      "failed:timeout",
      "failed:error",
      "unknown",
    ];

    for (const s of validStates) {
      assert.equal(DeterministicAgentStateSchema.parse(s), s);
    }

    assert.throws(() => DeterministicAgentStateSchema.parse("invalid-state"));
  });

  it("validates UppidiAgentSchema with lineage, work attribution, and deterministic state", () => {
    const agent = UppidiAgentSchema.parse({
      id: "agent-123",
      shortId: "ag123",
      name: "Worker feat-385",
      category: "worker",
      status: "running",
      parentId: "orch-456",
      model: "gemini-3.8-flash-low",
      deterministicState: "working",
      stateDetail: "#385 (feat/385-tree-fleet-view)",
      attributedWork: {
        repo: "xpufx-org/paseo",
        issue: 385,
        slug: "feat/385-tree-fleet-view",
      },
    });

    assert.equal(agent.id, "agent-123");
    assert.equal(agent.parentId, "orch-456");
    assert.equal(agent.deterministicState, "working");
    assert.equal(agent.attributedWork?.issue, 385);
  });

  it("validates UppidiAgentTreeNodeSchema recursively", () => {
    const tree = UppidiAgentTreeNodeSchema.parse({
      agent: {
        id: "root-1",
        shortId: "root1",
        name: "Front Desk",
        category: "front-desk",
        status: "running",
        parentId: null,
        deterministicState: "running",
      },
      depth: 0,
      children: [
        {
          agent: {
            id: "child-1",
            shortId: "chld1",
            name: "Orchestrator",
            category: "orchestrator",
            status: "running",
            parentId: "root-1",
            deterministicState: "working",
          },
          depth: 1,
          children: [],
        },
      ],
    });

    assert.equal(tree.agent.id, "root-1");
    assert.equal(tree.depth, 0);
    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0].agent.id, "child-1");
    assert.equal(tree.children[0].depth, 1);
  });

  it("maps deterministic states strictly to fixed color taxonomy and icons", () => {
    // working: success/emerald (#10b981) + pulsing
    const working = getDeterministicStateConfig("working", "front-desk");
    assert.equal(working.color, "#10b981");
    assert.equal(working.badgeVariant, "success");
    assert.equal(working.pulse, true);
    assert.equal(working.categoryIcon, "Inbox");

    // running: info/blue (#3b82f6)
    const running = getDeterministicStateConfig("running", "orchestrator");
    assert.equal(running.color, "#3b82f6");
    assert.equal(running.badgeVariant, "info");
    assert.equal(running.pulse, false);
    assert.equal(running.categoryIcon, "Network");

    // sleeping: neutral/muted/purple (#a855f7)
    const sleeping = getDeterministicStateConfig("sleeping", "worker");
    assert.equal(sleeping.color, "#a855f7");
    assert.equal(sleeping.badgeVariant, "neutral");
    assert.equal(sleeping.pulse, false);
    assert.equal(sleeping.categoryIcon, "Terminal");

    // idle:waiting: neutral/gray (#9ca3af)
    const idleWaiting = getDeterministicStateConfig("idle:waiting");
    assert.equal(idleWaiting.color, "#9ca3af");
    assert.equal(idleWaiting.badgeVariant, "neutral");

    // idle:quota-exhausted: warning/amber (#f59e0b)
    const idleQuota = getDeterministicStateConfig("idle:quota-exhausted");
    assert.equal(idleQuota.color, "#f59e0b");
    assert.equal(idleQuota.badgeVariant, "warning");

    // failed:quota-exhausted: warning/orange (#f97316)
    const failedQuota = getDeterministicStateConfig("failed:quota-exhausted");
    assert.equal(failedQuota.color, "#f97316");
    assert.equal(failedQuota.badgeVariant, "warning");

    // failed:spawn, failed:timeout, failed:error: danger/error/red (#ef4444)
    const failedSpawn = getDeterministicStateConfig("failed:spawn");
    assert.equal(failedSpawn.color, "#ef4444");
    assert.equal(failedSpawn.badgeVariant, "danger");

    const failedTimeout = getDeterministicStateConfig("failed:timeout");
    assert.equal(failedTimeout.color, "#ef4444");
    assert.equal(failedTimeout.badgeVariant, "danger");

    const failedError = getDeterministicStateConfig("failed:error");
    assert.equal(failedError.color, "#ef4444");
    assert.equal(failedError.badgeVariant, "danger");

    // unknown: neutral/gray (#6b7280)
    const unknown = getDeterministicStateConfig("unknown");
    assert.equal(unknown.color, "#6b7280");
    assert.equal(unknown.badgeVariant, "neutral");
  });

  it("resolves agent category icons accurately", () => {
    assert.equal(getAgentCategoryIcon("front-desk"), "Inbox");
    assert.equal(getAgentCategoryIcon("orchestrator"), "Network");
    assert.equal(getAgentCategoryIcon("worker"), "Terminal");
    assert.equal(getAgentCategoryIcon(undefined), "Bot");
  });

  it("validates UppidiAgentSchema with optional url", () => {
    const agentWithUrl = UppidiAgentSchema.parse({
      id: "agent-123",
      shortId: "agent12",
      name: "Worker 1",
      category: "worker",
      status: "running",
      url: "paseo://agent/agent-123",
    });
    assert.equal(agentWithUrl.url, "paseo://agent/agent-123");

    const agentWithoutUrl = UppidiAgentSchema.parse({
      id: "agent-456",
      shortId: "agent45",
      name: "Worker 2",
      category: "worker",
      status: "idle",
    });
    assert.equal(agentWithoutUrl.url, undefined);
  });

  it("validates archive contracts and schemas (#402)", () => {
    assert.equal(uppidiArchiveAgentContract.name, "uppidi-forge.archive-agent");
    assert.equal(uppidiArchiveInactiveAgentsContract.name, "uppidi-forge.archive-inactive-agents");

    const inputOne = UppidiArchiveAgentInputSchema.parse({ agentId: "agent-123" });
    assert.equal(inputOne.agentId, "agent-123");

    const outputOne = UppidiArchiveAgentOutputSchema.parse({
      ok: true,
      agentId: "agent-123",
      message: "Archived agent agent-123",
    });
    assert.equal(outputOne.ok, true);
    assert.equal(outputOne.agentId, "agent-123");

    const inputBulk = UppidiArchiveInactiveAgentsInputSchema.parse({
      agentIds: ["agent-1", "agent-2"],
    });
    assert.deepEqual(inputBulk.agentIds, ["agent-1", "agent-2"]);

    const inputBulkEmpty = UppidiArchiveInactiveAgentsInputSchema.parse({});
    assert.equal(inputBulkEmpty.agentIds, undefined);

    const outputBulk = UppidiArchiveInactiveAgentsOutputSchema.parse({
      ok: true,
      archivedCount: 2,
      archivedIds: ["agent-1", "agent-2"],
    });
    assert.equal(outputBulk.ok, true);
    assert.equal(outputBulk.archivedCount, 2);
    assert.deepEqual(outputBulk.archivedIds, ["agent-1", "agent-2"]);
  });

  it("extracts agent worktree accurately (#403)", () => {
    // 1. From worktree property
    assert.equal(
      extractAgentWorktree({ worktree: "feat-403-dense-fleet-tree" }),
      "feat-403-dense-fleet-tree"
    );

    // 2. From cwd worktree path
    assert.equal(
      extractAgentWorktree({ cwd: "/home/xpufx/.paseo/worktrees/2h0dw6vb/feat-403-dense-fleet-tree" }),
      "feat-403-dense-fleet-tree"
    );

    // 3. From cwd code repo path
    assert.equal(
      extractAgentWorktree({ cwd: "/home/xpufx/code/paseo" }),
      "paseo"
    );

    // 4. From attributed work slug/branch
    assert.equal(
      extractAgentWorktree({ attributedWork: { slug: "feat/403-dense-tree" } }),
      "feat/403-dense-tree"
    );

    // 5. From workspaceId
    assert.equal(
      extractAgentWorktree({ workspaceId: "wks_e29c301bc004300c" }),
      "wks_e29c301b"
    );

    // 6. From labels
    assert.equal(
      extractAgentWorktree({ labels: { worktree: "custom-worktree" } }),
      "custom-worktree"
    );
  });

  it("extracts agent project accurately (#403)", () => {
    // 1. From project property
    assert.equal(
      extractAgentProject({ project: "xpufx-org/paseo" }),
      "xpufx-org/paseo"
    );

    // 2. From labels
    assert.equal(
      extractAgentProject({ labels: { repo: "xpufx-org/platform" } }),
      "xpufx-org/platform"
    );

    // 3. From name pattern
    assert.equal(
      extractAgentProject({ name: "Orchestrator · xpufx-org/paseo" }),
      "xpufx-org/paseo"
    );

    // 4. From attributed work
    assert.equal(
      extractAgentProject({ attributedWork: { repo: "xpufx-org/aur-automation" } }),
      "xpufx-org/aur-automation"
    );

    // 5. From cwd
    assert.equal(
      extractAgentProject({ cwd: "/home/xpufx/code/paseo" }),
      "xpufx-org/paseo"
    );

    // 6. Inherited from parent
    assert.equal(
      extractAgentProject({ name: "Worker" }, "xpufx-org/paseo"),
      "xpufx-org/paseo"
    );

    // 7. Fallback
    assert.equal(
      extractAgentProject({ name: "Unassigned Worker" }),
      "Default Project"
    );
  });

  it("validates hook service configuration contract and schemas (#427)", () => {
    assert.equal(uppidiHookConfigureContract.name, "uppidi-forge.hook-configure");

    // Input schema with defaults
    const defaultInput = HookServiceConfigInputSchema.parse({});
    assert.equal(defaultInput.restart, true);
    assert.equal(defaultInput.host, undefined);
    assert.equal(defaultInput.port, undefined);

    // Input schema with custom host and port
    const customInput = HookServiceConfigInputSchema.parse({
      host: "0.0.0.0",
      port: 9000,
      restart: false,
    });
    assert.equal(customInput.host, "0.0.0.0");
    assert.equal(customInput.port, 9000);
    assert.equal(customInput.restart, false);

    // Output schema
    const output = HookServiceConfigOutputSchema.parse({
      ok: true,
      configuredHost: "0.0.0.0",
      configuredPort: 9000,
      activeHost: "0.0.0.0",
      activePort: 9000,
      restarted: true,
      message: "Reconfigured and restarted",
    });
    assert.equal(output.ok, true);
    assert.equal(output.configuredHost, "0.0.0.0");
    assert.equal(output.configuredPort, 9000);
    assert.equal(output.restarted, true);

    // Status output schema with new listen address fields
    const statusOutput = HookServiceStatusOutputSchema.parse({
      ok: true,
      active: true,
      state: "active",
      host: "127.0.0.1",
      configuredHost: "127.0.0.1",
      port: 8099,
      configuredPort: 8099,
      availableInterfaces: ["127.0.0.1", "0.0.0.0", "192.168.1.50"],
    });
    assert.equal(statusOutput.host, "127.0.0.1");
    assert.equal(statusOutput.configuredHost, "127.0.0.1");
    assert.equal(statusOutput.port, 8099);
    assert.equal(statusOutput.configuredPort, 8099);
    assert.deepEqual(statusOutput.availableInterfaces, ["127.0.0.1", "0.0.0.0", "192.168.1.50"]);
  });
});


