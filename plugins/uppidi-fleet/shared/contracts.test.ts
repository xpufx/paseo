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
  isCodingAgentCategory,
  UppidiAgentCategorySchema,
  getPendingPermissionAction,
  getPermissionAdjudicationCommand,
  getAgentAttentionReason,
  agentRequiresAttention,
  deriveLifecycleState,
  resolveAgentLifecycleState,
  isBlockedLifecycleState,
  extractPermissionScope,
  buildAgentBlockDetail,
  AgentLifecycleStateSchema,
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
  HookInfoOutputSchema,
  uppidiHookInfoContract,
  uppidiCreateFrontDeskContract,
  uppidiReplaceFrontDeskContract,
  uppidiAddOrchestratorContract,
  uppidiReplaceOrchestratorContract,
  uppidiToggleRepoPauseContract,
  UppidiCreateFrontDeskInputSchema,
  UppidiCreateFrontDeskOutputSchema,
  UppidiReplaceFrontDeskInputSchema,
  UppidiReplaceFrontDeskOutputSchema,
  UppidiAddOrchestratorInputSchema,
  UppidiAddOrchestratorOutputSchema,
  UppidiReplaceOrchestratorInputSchema,
  UppidiReplaceOrchestratorOutputSchema,
  UppidiToggleRepoPauseInputSchema,
  UppidiToggleRepoPauseOutputSchema,
  uppidiReposContract,
  UppidiRepoSchema,
  UppidiReposInputSchema,
  UppidiReposOutputSchema,
  uppidiEnrollRepoContract,
  UppidiEnrollRepoInputSchema,
  UppidiEnrollRepoOutputSchema,
  uppidiUnenrollRepoContract,
  UppidiUnenrollRepoInputSchema,
  UppidiUnenrollRepoOutputSchema,
  uppidiFleetSettingsSchema,
  uppidiFleetSettingsContract,
  FleetResetStateInputSchema,
  FleetResetStateOutputSchema,
  uppidiFleetResetStateContract,
  FleetHaltInputSchema,
  FleetHaltOutputSchema,
  uppidiFleetHaltContract,
  FleetResumeInputSchema,
  FleetResumeOutputSchema,
  uppidiFleetResumeContract,
  uppidiFrontDeskActivityContract,
  UppidiFrontDeskActivityInputSchema,
  UppidiFrontDeskActivityOutputSchema,
  uppidiFrontDeskPromptContract,
  UppidiFrontDeskPromptInputSchema,
  UppidiFrontDeskPromptOutputSchema,
  isSignalActivityItem,
  parseTranscriptToActivityItems,
  KanbanColumnIdSchema,
  UppidiTransitionIssueInputSchema,
  UppidiTransitionIssueOutputSchema,
  uppidiTransitionIssueContract,
  UppidiFleetAuditReceiptSchema,
  UppidiAuditRecordInputSchema,
  UppidiAuditRecordOutputSchema,
  uppidiAuditRecordContract,
  UppidiAuditCheckOutputSchema,
  uppidiAuditCheckContract,
  UppidiAuditSummaryOutputSchema,
  uppidiAuditSummaryContract,
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

  it("defaults hook-status capabilities to x-comms absent (#572)", () => {
    const minimal = HookStatusOutputSchema.parse({ ok: true });
    assert.deepEqual(minimal.capabilities, { xCommsInstalled: false });

    const present = HookStatusOutputSchema.parse({
      ok: true,
      capabilities: { xCommsInstalled: true },
    });
    assert.equal(present.capabilities.xCommsInstalled, true);
  });

  it("validates HookInfoOutputSchema defaults and the hook.info contract (#545)", () => {
    assert.equal(uppidiHookInfoContract.name, "uppidi-fleet.hook.info");

    const empty = HookInfoOutputSchema.parse({ ok: true });
    assert.equal(empty.running, false);
    assert.equal(empty.hookHost, null);
    assert.equal(empty.hookPort, null);
    assert.equal(empty.url, null);
    assert.equal(empty.frontDeskAgentId, null);
    assert.deepEqual(empty.registeredRepoKeys, []);
    assert.equal(empty.registeredRepoCount, 0);

    const running = HookInfoOutputSchema.parse({
      ok: true,
      running: true,
      hookHost: "10.20.30.24",
      hookPort: 8099,
      url: "http://10.20.30.24:8099",
      isListening: true,
      frontDeskAgentId: "fd-1",
      registeredRepoKeys: ["forge.mrs.uppidi.com/xpufx-org/paseo"],
      registeredRepoCount: 1,
      uptime: 42,
    });
    assert.equal(running.running, true);
    assert.equal(running.frontDeskAgentId, "fd-1");
    assert.equal(running.registeredRepoCount, 1);
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
    assert.equal(getAgentCategoryIcon("coding-agent"), "Terminal");
    assert.equal(getAgentCategoryIcon("worker"), "Terminal");
    assert.equal(getAgentCategoryIcon(undefined), "Bot");
  });

  it("treats `coding-agent` as canonical and `worker` as a legacy alias (#1126)", () => {
    assert.equal(UppidiAgentCategorySchema.parse("coding-agent"), "coding-agent");
    assert.equal(UppidiAgentCategorySchema.parse("worker"), "worker");
    assert.equal(UppidiAgentCategorySchema.safeParse("sidecar").success, false);

    assert.equal(isCodingAgentCategory("coding-agent"), true);
    assert.equal(isCodingAgentCategory("worker"), true);
    assert.equal(isCodingAgentCategory("WORKER"), true);
    assert.equal(isCodingAgentCategory("orchestrator"), false);
    assert.equal(isCodingAgentCategory("front-desk"), false);
    assert.equal(isCodingAgentCategory(undefined), false);
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
      "forge.mrs.uppidi.com/xpufx-org/paseo"
    );

    // 2. From labels
    assert.equal(
      extractAgentProject({ labels: { repo: "xpufx-org/platform" } }),
      "forge.mrs.uppidi.com/xpufx-org/platform"
    );

    // 3. From authoritative workspace -> project mapping
    assert.equal(
      extractAgentProject(
        { workspaceId: "wks_abc" },
        undefined,
        { wks_abc: "xpufx-org/aur-automation" }
      ),
      "forge.mrs.uppidi.com/xpufx-org/aur-automation"
    );

    // 4. Workspace mapping takes precedence over unresolved default project
    assert.equal(
      extractAgentProject(
        { workspaceId: "wks_abc", project: "Default Project" },
        undefined,
        { wks_abc: "xpufx-org/paseo" }
      ),
      "forge.mrs.uppidi.com/xpufx-org/paseo"
    );

    // 5. Workspace mapping takes precedence over labels
    assert.equal(
      extractAgentProject(
        { workspaceId: "wks_abc", labels: { repo: "xpufx-org/platform" } },
        undefined,
        { wks_abc: "xpufx-org/paseo" }
      ),
      "forge.mrs.uppidi.com/xpufx-org/paseo"
    );

    // 6. Labels used when the workspace is not in the map
    assert.equal(
      extractAgentProject(
        { workspaceId: "wks_missing", labels: { repo: "xpufx-org/platform" } },
        undefined,
        { wks_abc: "xpufx-org/paseo" }
      ),
      "forge.mrs.uppidi.com/xpufx-org/platform"
    );

    // 7. Inherited from parent hierarchy
    assert.equal(
      extractAgentProject({ name: "Worker" }, "xpufx-org/paseo"),
      "forge.mrs.uppidi.com/xpufx-org/paseo"
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

    // 5. Toggle Repo Pause
    assert.equal(uppidiToggleRepoPauseContract.name, "uppidi-fleet.toggle-repo-pause");
    const pauseInput = UppidiToggleRepoPauseInputSchema.parse({ repo: "xpufx-org/paseo", paused: true });
    assert.equal(pauseInput.repo, "xpufx-org/paseo");
    assert.equal(pauseInput.paused, true);
    const pauseOutput = UppidiToggleRepoPauseOutputSchema.parse({
      ok: true,
      repo: "xpufx-org/paseo",
      isPaused: true,
      pausedRepos: ["xpufx-org/paseo"],
    });
    assert.equal(pauseOutput.ok, true);
    // 5b. Repo Enrollment Contracts (#867)
    assert.equal(uppidiReposContract.name, "uppidi-fleet.repos");
    const reposInput = UppidiReposInputSchema.parse({ query: "paseo" });
    assert.equal(reposInput.query, "paseo");
    const reposOutput = UppidiReposOutputSchema.parse({
      ok: true,
      repos: [
        {
          key: "forge.mrs.uppidi.com/xpufx-org/paseo",
          name: "paseo",
          fullName: "xpufx-org/paseo",
          owner: "xpufx-org",
          host: "forge.mrs.uppidi.com",
          url: "https://forge.mrs.uppidi.com/xpufx-org/paseo",
          private: false,
          enrolled: true,
          paused: false,
          hasOrchestrator: true,
          queueDepth: 2,
        },
      ],
    });
    assert.equal(reposOutput.ok, true);
    assert.equal(reposOutput.repos.length, 1);
    assert.equal(reposOutput.repos[0]?.key, "forge.mrs.uppidi.com/xpufx-org/paseo");

    assert.equal(uppidiEnrollRepoContract.name, "uppidi-fleet.enroll-repo");
    const enrollInput = UppidiEnrollRepoInputSchema.parse({ repo: "xpufx-org/paseo" });
    assert.equal(enrollInput.repo, "xpufx-org/paseo");
    const enrollOutput = UppidiEnrollRepoOutputSchema.parse({
      ok: true,
      repo: "forge.mrs.uppidi.com/xpufx-org/paseo",
      enrolledRepos: ["forge.mrs.uppidi.com/xpufx-org/paseo"],
      message: "Enrolled repository",
    });
    assert.equal(enrollOutput.ok, true);
    assert.deepEqual(enrollOutput.enrolledRepos, ["forge.mrs.uppidi.com/xpufx-org/paseo"]);

    assert.equal(uppidiUnenrollRepoContract.name, "uppidi-fleet.unenroll-repo");
    const unenrollInput = UppidiUnenrollRepoInputSchema.parse({ repo: "forge.mrs.uppidi.com/xpufx-org/paseo" });
    assert.equal(unenrollInput.repo, "forge.mrs.uppidi.com/xpufx-org/paseo");
    const unenrollOutput = UppidiUnenrollRepoOutputSchema.parse({
      ok: true,
      repo: "forge.mrs.uppidi.com/xpufx-org/paseo",
      enrolledRepos: [],
      message: "Unenrolled repository",
    });
    assert.equal(unenrollOutput.ok, true);
    assert.deepEqual(unenrollOutput.enrolledRepos, []);

    // 6. Schema extensions on UppidiAgent, TreeNode, Output
    const agent = UppidiAgentSchema.parse({
      id: "agent-1",
      shortId: "ag1",
      name: "Worker 1",
      category: "worker",
      status: "running",
      isEnrolled: true,
      isPaused: false,
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
      pausedRepos: ["xpufx-org/other"],
      repoQueuedHooks: { "xpufx-org/paseo": 3 },
    });
    assert.deepEqual(fleetOutput.enrolledRepos, ["xpufx-org/paseo"]);
    assert.deepEqual(fleetOutput.pausedRepos, ["xpufx-org/other"]);
    assert.equal(fleetOutput.repoQueuedHooks?.["xpufx-org/paseo"], 3);
  });

  it("validates uppidiFleetSettingsContract and schema defaults (#444)", () => {
    assert.equal(uppidiFleetSettingsContract.name, "uppidi-fleet.settings");
    const defaults = uppidiFleetSettingsSchema.parse({});
    assert.equal(defaults.hookHost, "127.0.0.1");
    assert.equal(defaults.hookPort, 8099);
    assert.deepEqual(defaults.enrolledRepos, []);
    assert.deepEqual(defaults.pausedRepos, []);
    assert.equal(defaults.mutedRepos, undefined);

    const customized = uppidiFleetSettingsSchema.parse({
      hookHost: "0.0.0.0",
      hookPort: 9000,
      enrolledRepos: ["xpufx-org/paseo"],
      pausedRepos: ["xpufx-org/other"],
    });
    assert.equal(customized.hookHost, "0.0.0.0");
    assert.equal(customized.hookPort, 9000);
    assert.deepEqual(customized.enrolledRepos, ["xpufx-org/paseo"]);
    assert.deepEqual(customized.pausedRepos, ["xpufx-org/other"]);

    // Pre-#984 installs persisted the paused set under the legacy key; the
    // schema must still parse it so loadRouterConfig can migrate it.
    const legacy = uppidiFleetSettingsSchema.parse({
      enrolledRepos: ["xpufx-org/paseo"],
      mutedRepos: ["xpufx-org/legacy"],
    });
    assert.deepEqual(legacy.mutedRepos, ["xpufx-org/legacy"]);
    assert.deepEqual(legacy.pausedRepos, []);
  });
});

describe("subagent lifecycle contract & structured block detail (#537)", () => {
  it("exposes the five canonical lifecycle states", () => {
    const states = AgentLifecycleStateSchema.options;
    assert.deepEqual([...states].sort(), [
      "completed",
      "errored",
      "idle",
      "running",
      "waiting_for_input",
    ]);
  });

  it("projects deterministic states onto the lifecycle contract without renaming #534", () => {
    assert.equal(deriveLifecycleState("permission-prompt"), "waiting_for_input");
    assert.equal(deriveLifecycleState("attention-required"), "waiting_for_input");
    assert.equal(deriveLifecycleState("working"), "running");
    assert.equal(deriveLifecycleState("running"), "running");
    assert.equal(deriveLifecycleState("idle:waiting"), "idle");
    assert.equal(deriveLifecycleState("sleeping"), "idle");
    assert.equal(deriveLifecycleState("idle:quota-exhausted"), "idle");
    assert.equal(deriveLifecycleState("failed:error"), "errored");
    assert.equal(deriveLifecycleState("failed:quota-exhausted"), "errored");
    assert.equal(deriveLifecycleState("unknown"), "idle");
    assert.equal(isBlockedLifecycleState("waiting_for_input"), true);
    assert.equal(isBlockedLifecycleState("running"), false);
  });

  it("resolves lifecycle from a payload, falling back to deterministicState", () => {
    assert.equal(resolveAgentLifecycleState({ lifecycleState: "errored" }), "errored");
    assert.equal(resolveAgentLifecycleState({ deterministicState: "permission-prompt" }), "waiting_for_input");
    assert.equal(resolveAgentLifecycleState(null), "idle");
  });

  it("extracts scope from input keys, then a Scope: description", () => {
    assert.equal(extractPermissionScope({ input: { path: "/tmp/work" } }), "/tmp/work");
    assert.equal(extractPermissionScope({ input: { paths: ["/a", "/b"] } }), "/a, /b");
    assert.equal(
      extractPermissionScope({ description: "Scope: /home/user/code/paseo/*" }),
      "/home/user/code/paseo/*",
    );
    assert.equal(extractPermissionScope({ description: "no scope here" }), "no scope here");
    assert.equal(extractPermissionScope({}), undefined);
    // Explicit scope wins.
    assert.equal(
      extractPermissionScope({ scope: "/explicit", input: { path: "/ignored" } }),
      "/explicit",
    );
  });

  it("builds structured block detail with required permission id, scope, and command", () => {
    const detail = buildAgentBlockDetail("agent-537", [
      {
        id: "perm-req-537",
        title: "run bash command",
        description: "Scope: /tmp/worktree",
      },
    ]);
    assert.ok(detail);
    assert.equal(detail?.requiredPermissionId, "perm-req-537");
    assert.equal(detail?.scope, "/tmp/worktree");
    assert.equal(detail?.action, "run bash command");
    assert.equal(detail?.command, "paseo permit allow agent-537 perm-req-537");
    assert.equal(buildAgentBlockDetail("agent-537", []), undefined);
  });

  it("parses lifecycleState and blockDetail on UppidiAgentSchema", () => {
    const agent = UppidiAgentSchema.parse({
      id: "a-537",
      shortId: "a-537",
      name: "Worker",
      category: "worker",
      status: "running",
      deterministicState: "permission-prompt",
      lifecycleState: "waiting_for_input",
      blockDetail: {
        requiredPermissionId: "req-537",
        scope: "/tmp",
        command: "paseo permit allow a-537 req-537",
      },
    });
    assert.equal(agent.lifecycleState, "waiting_for_input");
    assert.equal(agent.blockDetail?.requiredPermissionId, "req-537");

    // Legacy payloads without the new fields remain parseable.
    const legacy = UppidiAgentSchema.parse({
      id: "a-legacy",
      shortId: "a-legacy",
      name: "Legacy",
      category: "worker",
      status: "idle",
    });
    assert.equal(legacy.lifecycleState, undefined);
    assert.equal(resolveAgentLifecycleState(legacy), "idle");
  });

  it("parses the optional metrics block and lastError on UppidiAgentSchema (#560)", () => {
    const agent = UppidiAgentSchema.parse({
      id: "a-560",
      shortId: "a-560",
      name: "Worker Metrics",
      category: "worker",
      status: "running",
      metrics: {
        contextUsedTokens: 96000,
        contextMaxTokens: 128000,
        cachedTokens: 600,
        inputTokens: 1200,
        outputTokens: 800,
        costUsd: 1.23,
        activeTurnStartedAt: "2026-09-25T10:00:00.000Z",
        attentionTimestamp: "2026-09-25T10:05:00.000Z",
      },
      lastError: "boom",
    });
    assert.equal(agent.metrics?.contextUsedTokens, 96000);
    assert.equal(agent.metrics?.contextMaxTokens, 128000);
    assert.equal(agent.metrics?.cachedTokens, 600);
    assert.equal(agent.metrics?.costUsd, 1.23);
    assert.equal(agent.metrics?.activeTurnStartedAt, "2026-09-25T10:00:00.000Z");
    assert.equal(agent.metrics?.attentionTimestamp, "2026-09-25T10:05:00.000Z");
    assert.equal(agent.lastError, "boom");

    // Legacy payloads without metrics stay parseable and absent.
    const legacy = UppidiAgentSchema.parse({
      id: "a-560-legacy",
      shortId: "a-560-legacy",
      name: "Legacy",
      category: "worker",
      status: "idle",
    });
    assert.equal(legacy.metrics, undefined);
    assert.equal(legacy.lastError, undefined);
  });

  it("validates uppidiFleetResetStateContract and schemas (#764)", () => {
    assert.equal(uppidiFleetResetStateContract.name, "uppidi-fleet.reset-state");

    const input = FleetResetStateInputSchema.parse({ confirm: true });
    assert.equal(input.confirm, true);
    assert.equal(input.notifyOrchestrators, true);

    const inputWithoutNotify = FleetResetStateInputSchema.parse({
      confirm: true,
      notifyOrchestrators: false,
    });
    assert.equal(inputWithoutNotify.notifyOrchestrators, false);

    assert.throws(() => {
      FleetResetStateInputSchema.parse({ confirm: false });
    });

    const output = FleetResetStateOutputSchema.parse({
      ok: true,
      cleared: {
        boardStateFiles: 3,
        queueFiles: 2,
        cacheFiles: 5,
      },
      notifiedOrchestrators: 1,
      errors: [],
      message: "Purged 10 files",
    });
    assert.equal(output.ok, true);
    assert.equal(output.cleared.boardStateFiles, 3);
    assert.equal(output.cleared.queueFiles, 2);
    assert.equal(output.cleared.cacheFiles, 5);
    assert.equal(output.notifiedOrchestrators, 1);
  });

  it("validates the fleet HALT / RESUME contracts and schemas (#1013)", () => {
    assert.equal(uppidiFleetHaltContract.name, "uppidi-fleet.fleet-halt");
    assert.equal(uppidiFleetResumeContract.name, "uppidi-fleet.fleet-resume");

    assert.equal(FleetHaltInputSchema.parse({ confirm: true }).confirm, true);
    assert.throws(() => FleetHaltInputSchema.parse({}));
    assert.equal(FleetResumeInputSchema.parse({ confirm: true }).confirm, true);

    const halt = FleetHaltOutputSchema.parse({ ok: true });
    assert.equal(halt.halted, false);
    assert.equal(halt.alreadyHalted, false);
    assert.equal(halt.teardownInProgress, false);

    const resume = FleetResumeOutputSchema.parse({ ok: true });
    assert.equal(resume.halted, false);
    assert.equal(resume.teardownInProgress, false);
  });

  describe("Front Desk Watch & Console Drawer (#710)", () => {
    it("validates uppidiFrontDeskActivityContract and schemas", () => {
      assert.equal(uppidiFrontDeskActivityContract.name, "uppidi-fleet.front-desk.activity");

      const input = UppidiFrontDeskActivityInputSchema.parse({});
      assert.equal(input.limit, undefined);

      const customInput = UppidiFrontDeskActivityInputSchema.parse({
        agentId: "agent-fd-42",
        limit: 100,
      });
      assert.equal(customInput.agentId, "agent-fd-42");
      assert.equal(customInput.limit, 100);

      const output = UppidiFrontDeskActivityOutputSchema.parse({
        ok: true,
        agentId: "agent-fd-42",
        agentTitle: "Front Desk Liaison",
        status: "running",
        items: [
          {
            id: "act-1",
            timestamp: "2026-09-29T10:00:00.000Z",
            type: "user",
            role: "operator",
            text: "Please verify PR #710",
            isSignal: true,
          },
          {
            id: "act-2",
            timestamp: "2026-09-29T10:00:05.000Z",
            type: "assistant",
            role: "front-desk",
            text: "Understood, checking orchestrators now.",
            isSignal: true,
          },
        ],
        totalCount: 2,
        signalCount: 2,
      });

      assert.equal(output.ok, true);
      assert.equal(output.items.length, 2);
      assert.equal(output.signalCount, 2);
    });

    it("validates uppidiFrontDeskPromptContract and schemas", () => {
      assert.equal(uppidiFrontDeskPromptContract.name, "uppidi-fleet.front-desk.prompt");

      const input = UppidiFrontDeskPromptInputSchema.parse({
        agentId: "agent-fd-42",
        prompt: "Check fleet board",
      });
      assert.equal(input.agentId, "agent-fd-42");
      assert.equal(input.prompt, "Check fleet board");

      assert.throws(() => {
        UppidiFrontDeskPromptInputSchema.parse({ prompt: "" });
      });

      const output = UppidiFrontDeskPromptOutputSchema.parse({
        ok: true,
        agentId: "agent-fd-42",
        message: "Prompt sent to Front Desk",
      });
      assert.equal(output.ok, true);
      assert.equal(output.message, "Prompt sent to Front Desk");
    });

    it("accurately classifies activity items as signal vs noise (#710)", () => {
      // 1. Operator and assistant messages are signal
      assert.equal(
        isSignalActivityItem({
          id: "1",
          timestamp: "ts",
          type: "user",
          role: "operator",
          text: "hello",
          isSignal: true,
        }),
        true
      );
      assert.equal(
        isSignalActivityItem({
          id: "2",
          timestamp: "ts",
          type: "assistant",
          role: "front-desk",
          text: "ready",
          isSignal: true,
        }),
        true
      );

      // 2. Dispatches and decisions are signal
      assert.equal(
        isSignalActivityItem({
          id: "3",
          timestamp: "ts",
          type: "dispatch",
          role: "dispatch",
          text: "paseo send agent-1 do work",
          isSignal: true,
        }),
        true
      );
      assert.equal(
        isSignalActivityItem({
          id: "4",
          timestamp: "ts",
          type: "decision",
          role: "decision",
          text: "Adjudicated permit request",
          isSignal: true,
        }),
        true
      );

      // 3. Heartbeats and internal thoughts are noise (hidden in Signal Only)
      assert.equal(
        isSignalActivityItem({
          id: "5",
          timestamp: "ts",
          type: "heartbeat",
          role: "heartbeat",
          text: "heartbeat ping",
          isSignal: false,
        }),
        false
      );
      assert.equal(
        isSignalActivityItem({
          id: "6",
          timestamp: "ts",
          type: "thought",
          role: "front-desk",
          text: "I should inspect the directory first",
          isSignal: false,
        }),
        false
      );

      // 4. Repetitive inspection tools are noise
      assert.equal(
        isSignalActivityItem({
          id: "7",
          timestamp: "ts",
          type: "tool",
          role: "tool",
          toolName: "cat",
          text: "cat /tmp/file",
          isSignal: false,
        }),
        false
      );
      assert.equal(
        isSignalActivityItem({
          id: "8",
          timestamp: "ts",
          type: "tool",
          role: "tool",
          toolName: "read_file",
          text: "read /src/index.ts",
          isSignal: false,
        }),
        false
      );
    });

    it("parses raw transcript logs into structured activity items (#710)", () => {
      const rawLog = `
[User] please sweep the fleet and check #710
[Shell] cat /tmp/test.txt
[Thought] Analyzing the situation...
[Shell] paseo send --steer --no-wait agent-orch-1 "run tests"
[Heartbeat] Scheduled tick
[Assistant] Dispatched the test command to orchestrator.
[Error] Temporary connection drop
`;
      const items = parseTranscriptToActivityItems(rawLog);
      assert.equal(items.length, 7);

      // 1. [User]
      assert.equal(items[0].type, "user");
      assert.equal(items[0].role, "operator");
      assert.equal(items[0].isSignal, true);

      // 2. [Shell] cat -> tool noise
      assert.equal(items[1].type, "tool");
      assert.equal(items[1].isSignal, false);

      // 3. [Thought] -> thought noise
      assert.equal(items[2].type, "thought");
      assert.equal(items[2].isSignal, false);

      // 4. [Shell] paseo send -> dispatch signal
      assert.equal(items[3].type, "dispatch");
      assert.equal(items[3].isSignal, true);

      // 5. [Heartbeat] -> heartbeat noise
      assert.equal(items[4].type, "heartbeat");
      assert.equal(items[4].isSignal, false);

      // 6. [Assistant] -> assistant signal
      assert.equal(items[5].type, "assistant");
      assert.equal(items[5].role, "front-desk");
      assert.equal(items[5].isSignal, true);

      // 7. [Error] -> error signal
      assert.equal(items[6].type, "error");
      assert.equal(items[6].isSignal, true);

      // Total signals: User, paseo send dispatch, Assistant, Error = 4
      const signals = items.filter(isSignalActivityItem);
      assert.equal(signals.length, 4);
    });
  });

  describe("Kanban board and issue transition contracts (#755)", () => {
    it("validates KanbanColumnIdSchema canonical columns", () => {
      assert.equal(KanbanColumnIdSchema.parse("backlog"), "backlog");
      assert.equal(KanbanColumnIdSchema.parse("in_progress"), "in_progress");
      assert.equal(KanbanColumnIdSchema.parse("review"), "review");
      assert.equal(KanbanColumnIdSchema.parse("done"), "done");
      assert.throws(() => KanbanColumnIdSchema.parse("invalid_column"));
    });

    it("validates UppidiTransitionIssueInputSchema and defaults", () => {
      const parsed = UppidiTransitionIssueInputSchema.parse({
        number: 755,
        targetState: "in_progress",
      });
      assert.equal(parsed.number, 755);
      assert.equal(parsed.targetState, "in_progress");
      assert.equal(parsed.repo, "xpufx-org/paseo");

      const parsedWithRepo = UppidiTransitionIssueInputSchema.parse({
        number: 755,
        targetState: "done",
        repo: "xpufx-org/paseo",
      });
      assert.equal(parsedWithRepo.repo, "xpufx-org/paseo");
      assert.equal(parsedWithRepo.targetState, "done");
    });

    it("validates UppidiTransitionIssueOutputSchema", () => {
      const output = UppidiTransitionIssueOutputSchema.parse({
        ok: true,
        number: 755,
        targetState: "in_progress",
        appliedLabel: "state/1-wip",
        message: "Issue #755 moved to in_progress",
      });
      assert.equal(output.ok, true);
      assert.equal(output.appliedLabel, "state/1-wip");

      const failure = UppidiTransitionIssueOutputSchema.parse({
        ok: false,
        error: "CLI failure",
      });
      assert.equal(failure.ok, false);
      assert.equal(failure.error, "CLI failure");
    });

    it("registers uppidiTransitionIssueContract metadata", () => {
      assert.equal(uppidiTransitionIssueContract.name, "uppidi-fleet.transition-issue");
      assert.equal(
        uppidiTransitionIssueContract.description,
        "Transition a Forgejo issue between Kanban states",
      );
    });
  });
});

describe("audit receipts & quality RPC contracts (#1172)", () => {
  it("accepts a full audit receipt", () => {
    const parsed = UppidiFleetAuditReceiptSchema.parse({
      v: 1,
      auditId: "aud_1",
      timestamp: "2026-10-09T00:00:00.000Z",
      repo: "forge.mrs.uppidi.com/xpufx-org/paseo",
      pr: 1172,
      issue: 1172,
      headCommit: "abc123",
      iteration: 1,
      actors: {
        auditor: { agentId: "aud-g", role: "orchestrator", model: "gemini-3.8-pro" },
        author: { agentId: "wrk-1", role: "worker", model: "gemini-3.8-flash" },
      },
      verdict: "approved",
      taxonomy: ["runtime_boundary_leak"],
      verification: {
        workerClaimed: "passed",
        auditorVerified: "passed",
        checksRun: ["typecheck"],
        isolatedEnv: true,
      },
      summary: "clean",
    });
    assert.equal(parsed.v, 1);
    assert.equal(parsed.iteration, 1);
    assert.deepEqual(parsed.taxonomy, ["runtime_boundary_leak"]);
  });

  it("defaults iteration and taxonomy on the receipt schema", () => {
    const parsed = UppidiFleetAuditReceiptSchema.parse({
      v: 1,
      auditId: "aud_1",
      timestamp: "2026-10-09T00:00:00.000Z",
      repo: "xpufx-org/paseo",
      pr: 1,
      headCommit: "deadbeef",
      actors: {
        auditor: { agentId: "aud-1", role: "operator", model: "Opus-4.1" },
        author: { agentId: "wrk-1", role: "worker", model: "gemini-3.8-flash" },
      },
      verdict: "changes_requested",
      verification: {
        workerClaimed: "failed",
        auditorVerified: "skipped",
        checksRun: [],
        isolatedEnv: true,
      },
      summary: "rework requested",
    });
    assert.equal(parsed.iteration, 1);
    assert.deepEqual(parsed.taxonomy, []);
    assert.equal(parsed.issue, undefined);
  });

  it("rejects an unknown verdict or taxonomy member", () => {
    assert.throws(() =>
      UppidiFleetAuditReceiptSchema.parse({
        v: 1,
        auditId: "aud_1",
        timestamp: "2026-10-09T00:00:00.000Z",
        repo: "xpufx-org/paseo",
        pr: 1,
        headCommit: "deadbeef",
        actors: {
          auditor: { agentId: "aud-1", role: "operator", model: "Opus-4.1" },
          author: {},
        },
        verdict: "not-a-verdict",
        verification: {
          workerClaimed: "passed",
          auditorVerified: "skipped",
          checksRun: [],
          isolatedEnv: true,
        },
        summary: "nope",
      }),
    );
  });

  it("omits the envelope fields from the record contract input", () => {
    const input = UppidiAuditRecordInputSchema.parse({
      repo: "xpufx-org/paseo",
      pr: 42,
      headCommit: "abc1234",
      actors: {
        auditor: { agentId: "aud-1", role: "reviewer", model: "gemini" },
        author: { agentId: "wrk-2", role: "worker", model: "gemini-flash" },
      },
      verdict: "approved",
      verification: {
        workerClaimed: "passed",
        auditorVerified: "passed",
        checksRun: [],
        isolatedEnv: false,
      },
      summary: "ok",
    });
    assert.equal(input.iteration, 1);
    // The envelope fields are not part of the record contract input.
    assert.ok(!("v" in input));
    assert.ok(!("auditId" in input));
    assert.ok(!("timestamp" in input));
    assert.equal(uppidiAuditRecordContract.name, "uppidi-fleet.record-audit");
  });

  it("validates record output against the schema", () => {
    UppidiAuditRecordOutputSchema.parse({
      ok: true,
      auditId: "aud_1",
      recordedAt: "2026-10-09T00:00:00.000Z",
    });
    UppidiAuditRecordOutputSchema.parse({
      ok: false,
      auditId: "",
      recordedAt: "",
      error: "boom",
    });
  });

  it("validates the check output shape", () => {
    const audited = UppidiAuditCheckOutputSchema.parse({
      ok: true,
      audited: true,
      repo: "xpufx-org/paseo",
      pr: 7,
      commit: "abc",
      audit: { auditId: "aud_1", verdict: "approved", timestamp: "2026-10-09T00:00:00.000Z", iteration: 1 },
    });
    assert.ok(audited.audit);
    assert.equal(audited.audit.verdict, "approved");
    const bare = UppidiAuditCheckOutputSchema.parse({
      ok: true,
      audited: false,
      repo: "xpufx-org/paseo",
      pr: 8,
      commit: "def",
    });
    assert.equal(bare.audit, null);
    assert.equal(uppidiAuditCheckContract.name, "uppidi-fleet.audit-check");
  });

  it("validates the summary projection shape", () => {
    const out = UppidiAuditSummaryOutputSchema.parse({
      ok: true,
      totalAudits: 2,
      auditedMerges: 1,
      unauditedMerges: 1,
      complianceRate: 50,
      firstPassSuccessRate: 100,
      defectTaxonomyCounts: { spec_mismatch: 1 },
      modelScorecard: [
        { model: "gemini", reviewsReceived: 2, firstPassApproved: 2, changesRequested: 0 },
      ],
    });
    assert.equal(out.defectTaxonomyCounts.spec_mismatch, 1);
    assert.equal(uppidiAuditSummaryContract.name, "uppidi-fleet.audit-summary");
    assert.equal(
      uppidiAuditSummaryContract.description,
      "Query server-projected PR audit telemetry and quality metrics",
    );
  });
});

