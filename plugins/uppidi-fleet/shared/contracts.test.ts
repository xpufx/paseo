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
  getPendingPermissionAction,
  getPermissionAdjudicationCommand,
  getAgentAttentionReason,
  agentRequiresAttention,
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
  uppidiCreateFrontDeskContract,
  uppidiReplaceFrontDeskContract,
  uppidiAddOrchestratorContract,
  uppidiReplaceOrchestratorContract,
  uppidiToggleRepoMuteContract,
  UppidiCreateFrontDeskInputSchema,
  UppidiCreateFrontDeskOutputSchema,
  UppidiReplaceFrontDeskInputSchema,
  UppidiReplaceFrontDeskOutputSchema,
  UppidiAddOrchestratorInputSchema,
  UppidiAddOrchestratorOutputSchema,
  UppidiReplaceOrchestratorInputSchema,
  UppidiReplaceOrchestratorOutputSchema,
  UppidiToggleRepoMuteInputSchema,
  UppidiToggleRepoMuteOutputSchema,
  uppidiFleetSettingsSchema,
  uppidiFleetSettingsContract,
} from "./contracts.js";


describe("uppidi-fleet shared contracts", () => {
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
    assert.equal(uppidiIssuesContract.name, "uppidi-fleet.issues");
    assert.equal(uppidiHookStatusContract.name, "uppidi-fleet.hook-status");
  });

  it("validates deterministic agent state taxonomy strictly", () => {
    const validStates = [
      "working",
      "running",
      "sleeping",
      "idle:waiting",
      "idle:quota-exhausted",
      "attention-required",
      "permission-prompt",
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
      parentName: "Orchestrator · repo",
      parentCategory: "orchestrator",
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
    assert.equal(agent.parentName, "Orchestrator · repo");
    assert.equal(agent.parentCategory, "orchestrator");
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

  it("maps blocked permission and attention states to prominent warning configs (#534)", () => {
    const permission = getDeterministicStateConfig("permission-prompt", "worker");
    assert.equal(permission.badgeVariant, "warning");
    assert.equal(permission.dotVariant, "warning");
    assert.equal(permission.label, "Permission Needed");
    assert.equal(permission.pulse, true);

    const attention = getDeterministicStateConfig("attention-required", "orchestrator");
    assert.equal(attention.badgeVariant, "warning");
    assert.equal(attention.label, "Awaiting Input");
    assert.equal(attention.pulse, true);
  });

  it("derives permission action labels, adjudication commands, and attention flags (#534)", () => {
    assert.equal(getPendingPermissionAction({ id: "r1", title: "run bash command" }), "run bash command");
    assert.equal(getPendingPermissionAction({ id: "r1", tool: "run_command" }), "run_command");
    assert.equal(getPendingPermissionAction({ id: "r1", name: "external_directory" }), "external_directory");
    assert.equal(getPendingPermissionAction({ id: "r1" }), "tool permission");

    assert.equal(
      getPermissionAdjudicationCommand("agent-1", { id: "req-42" }),
      "paseo permit allow agent-1 req-42"
    );
    assert.equal(
      getPermissionAdjudicationCommand("agent-1", { id: "req-42", requestId: "fallback" }),
      "paseo permit allow agent-1 req-42"
    );
    assert.equal(getPermissionAdjudicationCommand("agent-1", { id: "req-42", title: "" }), "paseo permit allow agent-1 req-42");

    assert.equal(getAgentAttentionReason({ attentionReason: "permission" }), "permission request");
    assert.equal(getAgentAttentionReason({ attentionReason: "input" }), "operator input");
    assert.equal(getAgentAttentionReason({ attentionReason: null }), undefined);

    assert.equal(agentRequiresAttention({ pendingPermissions: [{ id: "r1" }] }), true);
    assert.equal(agentRequiresAttention({ requiresAttention: true, attentionReason: "input" }), true);
    assert.equal(agentRequiresAttention({ requiresAttention: true, attentionReason: "finished" }), false);
    assert.equal(agentRequiresAttention({ requiresAttention: false }), false);
  });

  it("parses pendingPermissions and attention fields on UppidiAgentSchema (#534)", () => {
    const agent = UppidiAgentSchema.parse({
      id: "agent-534",
      shortId: "ag534",
      name: "Worker Blocked",
      category: "worker",
      status: "running",
      deterministicState: "permission-prompt",
      requiresAttention: true,
      attentionReason: "permission",
      pendingPermissions: [{ id: "req-534", tool: "run_command", title: "run bash command" }],
    });
    assert.equal(agent.pendingPermissions?.length, 1);
    assert.equal(agent.pendingPermissions?.[0]?.id, "req-534");
    assert.equal(agent.requiresAttention, true);
    assert.equal(agent.attentionReason, "permission");
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
    assert.equal(uppidiArchiveAgentContract.name, "uppidi-fleet.archive-agent");
    assert.equal(uppidiArchiveInactiveAgentsContract.name, "uppidi-fleet.archive-inactive-agents");

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
      extractAgentWorktree({ cwd: "/home/user/.paseo/worktrees/2h0dw6vb/feat-403-dense-fleet-tree" }),
      "feat-403-dense-fleet-tree"
    );

    // 3. From cwd code repo path
    assert.equal(
      extractAgentWorktree({ cwd: "/home/user/code/paseo" }),
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

  it("extracts agent project from authoritative metadata only (#530)", () => {
    // 1. From resolved project property
    assert.equal(
      extractAgentProject({ project: "xpufx-org/paseo" }),
      "xpufx-org/paseo"
    );

    // 2. From labels
    assert.equal(
      extractAgentProject({ labels: { repo: "xpufx-org/platform" } }),
      "xpufx-org/platform"
    );

    // 3. From authoritative workspace -> project mapping
    assert.equal(
      extractAgentProject(
        { workspaceId: "wks_abc" },
        undefined,
        { wks_abc: "xpufx-org/aur-automation" }
      ),
      "xpufx-org/aur-automation"
    );

    // 4. Workspace mapping takes precedence over unresolved default project
    assert.equal(
      extractAgentProject(
        { workspaceId: "wks_abc", project: "Default Project" },
        undefined,
        { wks_abc: "xpufx-org/paseo" }
      ),
      "xpufx-org/paseo"
    );

    // 5. Workspace mapping takes precedence over labels
    assert.equal(
      extractAgentProject(
        { workspaceId: "wks_abc", labels: { repo: "xpufx-org/platform" } },
        undefined,
        { wks_abc: "xpufx-org/paseo" }
      ),
      "xpufx-org/paseo"
    );

    // 6. Labels used when the workspace is not in the map
    assert.equal(
      extractAgentProject(
        { workspaceId: "wks_missing", labels: { repo: "xpufx-org/platform" } },
        undefined,
        { wks_abc: "xpufx-org/paseo" }
      ),
      "xpufx-org/platform"
    );

    // 7. Inherited from parent hierarchy
    assert.equal(
      extractAgentProject({ name: "Worker" }, "xpufx-org/paseo"),
      "xpufx-org/paseo"
    );

    // 8. Title and cwd heuristics are NOT used
    assert.equal(
      extractAgentProject({ name: "Orchestrator · xpufx-org/paseo" }),
      "Default Project"
    );
    assert.equal(
      extractAgentProject({ cwd: "/home/user/code/paseo" }),
      "Default Project"
    );
    assert.equal(
      extractAgentProject({ cwd: "/home/user/.paseo/worktrees/2h0dw6vb/ghost" }),
      "Default Project"
    );

    // 9. Fallback when no authoritative source is available
    assert.equal(
      extractAgentProject({ name: "Unassigned Worker" }),
      "Default Project"
    );
  });

  it("validates hook service configuration contract and schemas (#427)", () => {
    assert.equal(uppidiHookConfigureContract.name, "uppidi-fleet.hook-configure");

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

  it("validates fleet roster contracts and schemas (#426)", () => {
    // 1. Create Front Desk
    assert.equal(uppidiCreateFrontDeskContract.name, "uppidi-fleet.create-front-desk");
    const createFdInput = UppidiCreateFrontDeskInputSchema.parse({});
    assert.equal(createFdInput.model, undefined);
    const createFdOutput = UppidiCreateFrontDeskOutputSchema.parse({
      ok: true,
      agentId: "agent-fd-1",
      agentName: "Front Desk Liaison",
      message: "Spawned Front Desk",
    });
    assert.equal(createFdOutput.ok, true);
    assert.equal(createFdOutput.agentId, "agent-fd-1");

    // 2. Replace Front Desk
    assert.equal(uppidiReplaceFrontDeskContract.name, "uppidi-fleet.replace-front-desk");
    const replaceFdInput = UppidiReplaceFrontDeskInputSchema.parse({ existingAgentId: "agent-fd-old" });
    assert.equal(replaceFdInput.existingAgentId, "agent-fd-old");
    const replaceFdOutput = UppidiReplaceFrontDeskOutputSchema.parse({
      ok: true,
      oldAgentId: "agent-fd-old",
      agentId: "agent-fd-new",
      message: "Replaced Front Desk",
    });
    assert.equal(replaceFdOutput.ok, true);
    assert.equal(replaceFdOutput.agentId, "agent-fd-new");

    // 3. Add Orchestrator
    assert.equal(uppidiAddOrchestratorContract.name, "uppidi-fleet.add-orchestrator");
    const addOrchInput = UppidiAddOrchestratorInputSchema.parse({ repo: "xpufx-org/paseo" });
    assert.equal(addOrchInput.repo, "xpufx-org/paseo");
    const addOrchOutput = UppidiAddOrchestratorOutputSchema.parse({
      ok: true,
      repo: "xpufx-org/paseo",
      agentId: "agent-orch-1",
    });
    assert.equal(addOrchOutput.ok, true);
    assert.equal(addOrchOutput.agentId, "agent-orch-1");

    // 4. Replace Orchestrator
    assert.equal(uppidiReplaceOrchestratorContract.name, "uppidi-fleet.replace-orchestrator");
    const replaceOrchInput = UppidiReplaceOrchestratorInputSchema.parse({
      repo: "xpufx-org/paseo",
      existingAgentId: "agent-orch-old",
    });
    assert.equal(replaceOrchInput.repo, "xpufx-org/paseo");
    assert.equal(replaceOrchInput.existingAgentId, "agent-orch-old");
    const replaceOrchOutput = UppidiReplaceOrchestratorOutputSchema.parse({
      ok: true,
      repo: "xpufx-org/paseo",
      oldAgentId: "agent-orch-old",
      agentId: "agent-orch-new",
    });
    assert.equal(replaceOrchOutput.ok, true);
    assert.equal(replaceOrchOutput.agentId, "agent-orch-new");

    // 5. Toggle Repo Mute
    assert.equal(uppidiToggleRepoMuteContract.name, "uppidi-fleet.toggle-repo-mute");
    const muteInput = UppidiToggleRepoMuteInputSchema.parse({ repo: "xpufx-org/paseo", muted: true });
    assert.equal(muteInput.repo, "xpufx-org/paseo");
    assert.equal(muteInput.muted, true);
    const muteOutput = UppidiToggleRepoMuteOutputSchema.parse({
      ok: true,
      repo: "xpufx-org/paseo",
      isMuted: true,
      mutedRepos: ["xpufx-org/paseo"],
    });
    assert.equal(muteOutput.ok, true);
    assert.equal(muteOutput.isMuted, true);
    assert.deepEqual(muteOutput.mutedRepos, ["xpufx-org/paseo"]);

    // 6. Schema extensions on UppidiAgent, TreeNode, Output
    const agent = UppidiAgentSchema.parse({
      id: "agent-1",
      shortId: "ag1",
      name: "Worker 1",
      category: "worker",
      status: "running",
      isEnrolled: true,
      isMuted: false,
      hasOrchestrator: true,
      queuedHooksCount: 3,
      isDetached: false,
    });
    assert.equal(agent.isEnrolled, true);
    assert.equal(agent.queuedHooksCount, 3);
    assert.equal(agent.isDetached, false);

    const treeNode = UppidiAgentTreeNodeSchema.parse({
      agent,
      depth: 0,
      children: [],
      isEnrolled: true,
      isDetached: false,
    });
    assert.equal(treeNode.isEnrolled, true);

    const fleetOutput = UppidiAgentsOutputSchema.parse({
      ok: true,
      frontDesk: [],
      orchestrators: [],
      workers: [],
      tree: [treeNode],
      enrolledRepos: ["xpufx-org/paseo"],
      mutedRepos: ["xpufx-org/other"],
      repoQueuedHooks: { "xpufx-org/paseo": 3 },
    });
    assert.deepEqual(fleetOutput.enrolledRepos, ["xpufx-org/paseo"]);
    assert.deepEqual(fleetOutput.mutedRepos, ["xpufx-org/other"]);
    assert.equal(fleetOutput.repoQueuedHooks?.["xpufx-org/paseo"], 3);
  });

  it("validates uppidiFleetSettingsContract and schema defaults (#444)", () => {
    assert.equal(uppidiFleetSettingsContract.name, "uppidi-fleet.settings");
    const defaults = uppidiFleetSettingsSchema.parse({});
    assert.equal(defaults.hookHost, "127.0.0.1");
    assert.equal(defaults.hookPort, 8099);
    assert.deepEqual(defaults.enrolledRepos, []);
    assert.deepEqual(defaults.mutedRepos, []);

    const customized = uppidiFleetSettingsSchema.parse({
      hookHost: "0.0.0.0",
      hookPort: 9000,
      enrolledRepos: ["xpufx-org/paseo"],
      mutedRepos: ["xpufx-org/other"],
    });
    assert.equal(customized.hookHost, "0.0.0.0");
    assert.equal(customized.hookPort, 9000);
    assert.deepEqual(customized.enrolledRepos, ["xpufx-org/paseo"]);
    assert.deepEqual(customized.mutedRepos, ["xpufx-org/other"]);
  });
});


