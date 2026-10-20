import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FLEET_MCP_TOOLS,
  FLEET_MANAGEMENT_TOOLS,
  TICKET_MCP_TOOLS,
  PR_MCP_TOOLS,
  CI_MCP_TOOLS,
  executeFleetCheckBoard,
  executeFleetWatchdogAudit,
  executeFleetBoardSweep,
  executeFleetPruneOrchestrators,
  executeFleetQueueInspect,
  executeFleetQueuePurge,
  executeFleetHandoffGenerate,
  executeFleetEnsureOrchestrator,
  executeFleetRotateRole,
  executeFleetValidateWorkspace,
  executeFleetPruneDeadSessions,
  executeFleetStatusGet,
  executeFleetQueuePause,
  executeFleetQueueResume,
  executeFleetQueueDrain,
  executeFleetControlMode,
  executeFleetReposList,
  executeFleetStageEvaluate,
  executeFleetStageTransition,
  executeFleetAuditRecord,
  executeFleetAuditCheck,
  executeFleetAuditSummary,
  executeTicketList,
  executeTicketView,
  executeTicketCreate,
  executeTicketComment,
  executeTicketEdit,
  executePrList,
  executePrView,
  executePrCreate,
  executePrDiff,
  executePrMerge,
  executeCiLogs,
  executeFleetTool,
  handleFleetToolList,
  handleFleetToolExecute,
  renderWatchdogAuditMarkdown,
  setTicketHandlersForTest,
} from "./mcp.js";
import { HookRouter, setActiveHookRouter, type WatchdogAuditResult } from "./hook-router.js";
import type { IssuesCheckIo } from "./issues-check.js";

describe("fleet MCP tools and handlers", () => {
  let tmpDir: string;
  let router: HookRouter;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fleet-mcp-test-"));
    router = new HookRouter(null, {
      queueDir: join(tmpDir, "queues"),
      stateDir: join(tmpDir, "state"),
      port: 0,
    });
    (router as any).fetchAgentMap = async () => new Map();
    router.enrollRepo("test-org/repo-a");
    router.enrollRepo("test-org/repo-b");
    setActiveHookRouter(router);
  });

  after(() => {
    setActiveHookRouter(null);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test("FLEET_MCP_TOOLS declares typed tools with valid schemas", () => {
    assert.equal(FLEET_MANAGEMENT_TOOLS.length, 22);
    assert.equal(TICKET_MCP_TOOLS.length, 5);
    assert.equal(PR_MCP_TOOLS.length, 5);
    assert.equal(CI_MCP_TOOLS.length, 1);
    assert.equal(FLEET_MCP_TOOLS.length, 33);

    const toolNames = FLEET_MCP_TOOLS.map((t) => t.name);
    assert.deepEqual(toolNames, [
      "fleet_check_board",
      "fleet_watchdog_audit",
      "fleet_board_sweep",
      "fleet_prune_orchestrators",
      "fleet_queue_inspect",
      "fleet_queue_purge",
      "fleet_handoff_generate",
      "fleet_rotate_role",
      "fleet_ensure_orchestrator",
      "fleet_validate_workspace",
      "fleet_prune_dead_sessions",
      "fleet_status_get",
      "fleet_queue_pause",
      "fleet_queue_resume",
      "fleet_queue_drain",
      "fleet_control_mode",
      "fleet_repos_list",
      "fleet_stage_evaluate",
      "fleet_stage_transition",
      "fleet_audit_record",
      "fleet_audit_check",
      "fleet_audit_summary",
      "ticket_list",
      "ticket_view",
      "ticket_create",
      "ticket_comment",
      "ticket_edit",
      "pr_list",
      "pr_view",
      "pr_create",
      "pr_diff",
      "pr_merge",
      "ci_logs",
    ]);

    const boardTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_check_board");
    assert.ok(boardTool, "fleet_check_board tool must be registered");
    assert.equal(boardTool.inputSchema.type, "object");
    assert.ok(boardTool.inputSchema.properties.repo);
    assert.ok(boardTool.inputSchema.properties.role);
    assert.ok(boardTool.inputSchema.properties.force);
    assert.ok(boardTool.inputSchema.properties.dryRun);
    assert.ok(boardTool.inputSchema.properties.trace);
    assert.ok(boardTool.inputSchema.properties.diagnosticComment);
    assert.ok(boardTool.inputSchema.properties.sweepStaleWip);
    assert.equal(boardTool.inputSchema.properties.sweepStaleWip.type, "boolean");
    assert.equal(boardTool.inputSchema.properties.sweepStaleWip.default, true);

    const watchdogTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_watchdog_audit");
    assert.ok(watchdogTool, "fleet_watchdog_audit tool must be registered");
    assert.equal(watchdogTool.inputSchema.type, "object");
    assert.ok(watchdogTool.inputSchema.properties.recover);
    assert.ok(watchdogTool.inputSchema.properties.frontDeskId);
    assert.ok(watchdogTool.inputSchema.properties.repetitiveToolLoopThreshold);
    assert.equal(watchdogTool.inputSchema.properties.repetitiveToolLoopThreshold.type, "number");
    assert.ok(watchdogTool.inputSchema.properties.childWakeups);
    assert.equal(watchdogTool.inputSchema.properties.childWakeups.type, "boolean");

    const sweepTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_board_sweep");
    assert.ok(sweepTool, "fleet_board_sweep tool must be registered");
    assert.equal(sweepTool.inputSchema.type, "object");
    assert.ok(sweepTool.inputSchema.properties.repos);
    assert.ok(sweepTool.inputSchema.properties.json);
    assert.ok(sweepTool.inputSchema.properties.trace);
    assert.ok(sweepTool.inputSchema.properties.diagnosticComment);

    const pruneTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_prune_orchestrators");
    assert.ok(pruneTool, "fleet_prune_orchestrators tool must be registered");
    assert.equal(pruneTool.inputSchema.type, "object");
    assert.ok(pruneTool.inputSchema.properties.dryRun);
    assert.ok(pruneTool.inputSchema.properties.json);
    assert.ok(pruneTool.inputSchema.properties.graceSweeps);
    assert.equal(pruneTool.inputSchema.properties.graceSweeps.type, "number");
    assert.equal(pruneTool.inputSchema.properties.graceSweeps.default, 3);

    const queueInspectTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_queue_inspect");
    assert.ok(queueInspectTool, "fleet_queue_inspect tool must be registered");
    assert.equal(queueInspectTool.inputSchema.type, "object");
    assert.ok(queueInspectTool.inputSchema.properties.repo);
    assert.ok(queueInspectTool.inputSchema.properties.json);

    const queuePurgeTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_queue_purge");
    assert.ok(queuePurgeTool, "fleet_queue_purge tool must be registered");
    assert.equal(queuePurgeTool.inputSchema.type, "object");
    assert.ok(queuePurgeTool.inputSchema.properties.repo);
    assert.ok(queuePurgeTool.inputSchema.properties.confirm);
    assert.ok(queuePurgeTool.inputSchema.properties.json);
    assert.deepEqual(queuePurgeTool.inputSchema.required, ["repo", "confirm"]);

    const handoffTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_handoff_generate");
    assert.ok(handoffTool, "fleet_handoff_generate tool must be registered");
    assert.equal(handoffTool.inputSchema.type, "object");
    assert.ok(handoffTool.inputSchema.properties.json);

    const ensureTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_ensure_orchestrator");
    assert.ok(ensureTool, "fleet_ensure_orchestrator tool must be registered");
    assert.equal(ensureTool.inputSchema.type, "object");
    assert.ok(ensureTool.inputSchema.properties.repo);
    assert.ok(ensureTool.inputSchema.properties.mode);
    assert.deepEqual(ensureTool.inputSchema.required, ["repo"]);

    const rotateTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_rotate_role");
    assert.ok(rotateTool, "fleet_rotate_role tool must be registered");
    assert.equal(rotateTool.inputSchema.type, "object");
    assert.ok(rotateTool.inputSchema.properties.role);
    assert.ok(rotateTool.inputSchema.properties.repo);
    assert.ok(rotateTool.inputSchema.properties.force);
    assert.equal(rotateTool.inputSchema.properties.force.type, "boolean");
    assert.equal(rotateTool.inputSchema.properties.force.default, true);

    const statusTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_status_get");
    assert.ok(statusTool, "fleet_status_get tool must be registered");
    assert.equal(statusTool.inputSchema.type, "object");
    assert.ok(statusTool.inputSchema.properties.json);

    const pauseTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_queue_pause");
    assert.ok(pauseTool, "fleet_queue_pause tool must be registered");
    assert.equal(pauseTool.inputSchema.type, "object");
    assert.ok(pauseTool.inputSchema.properties.key);

    const resumeTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_queue_resume");
    assert.ok(resumeTool, "fleet_queue_resume tool must be registered");
    assert.equal(resumeTool.inputSchema.type, "object");
    assert.ok(resumeTool.inputSchema.properties.key);

    const drainTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_queue_drain");
    assert.ok(drainTool, "fleet_queue_drain tool must be registered");
    assert.deepEqual(drainTool.inputSchema.required, ["key"]);

    const controlModeTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_control_mode");
    assert.ok(controlModeTool, "fleet_control_mode tool must be registered");
    assert.deepEqual(controlModeTool.inputSchema.required, ["mode"]);
    assert.deepEqual(controlModeTool.inputSchema.properties.mode.enum, ["RUN", "DRAIN", "HALT", "STOP"]);

    const reposListTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_repos_list");
    assert.ok(reposListTool, "fleet_repos_list tool must be registered");
    assert.equal(reposListTool.inputSchema.type, "object");

    const stageEvalTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_stage_evaluate");
    assert.ok(stageEvalTool, "fleet_stage_evaluate tool must be registered");
    assert.deepEqual(stageEvalTool.inputSchema.required, ["repo", "issue", "targetStage", "actor"]);

    const stageTransTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_stage_transition");
    assert.ok(stageTransTool, "fleet_stage_transition tool must be registered");
    assert.deepEqual(stageTransTool.inputSchema.required, ["repo", "issue", "targetStage", "actor"]);

    const auditRecordTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_audit_record");
    assert.ok(auditRecordTool, "fleet_audit_record tool must be registered");
    assert.deepEqual(auditRecordTool.inputSchema.required, ["repo", "pr", "headCommit", "verdict", "summary"]);

    const auditCheckTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_audit_check");
    assert.ok(auditCheckTool, "fleet_audit_check tool must be registered");
    assert.deepEqual(auditCheckTool.inputSchema.required, ["repo", "pr", "commit"]);

    const auditSummaryTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_audit_summary");
    assert.ok(auditSummaryTool, "fleet_audit_summary tool must be registered");
    assert.equal(auditSummaryTool.inputSchema.type, "object");
  });

  test("executeFleetCheckBoard rejects invalid role", async () => {
    const res = await executeFleetCheckBoard({ role: "invalid_role_name" });
    assert.equal(res.isError, true);
    assert.match(res.content[0]!.text, /Invalid role/);
  });

  test("executeFleetCheckBoard rejects negative staleWipHours", async () => {
    const res = await executeFleetCheckBoard({ staleWipHours: -1 });
    assert.equal(res.isError, true);
    assert.match(res.content[0]!.text, /staleWipHours must be a non-negative number/);
  });

  test("executeFleetCheckBoard supports trace: true for JSON and markdown output", async () => {
    const mockIo: IssuesCheckIo = {
      getOpenIssues: async () => ({
        ok: true,
        issues: [
          {
            number: 1415,
            title: "Decision tree logging",
            state: "open",
            labels: [{ name: "kind/feature" }, { name: "priority/normal" }],
            created_at: "2026-10-16T16:00:00Z",
            updated_at: "2026-10-16T16:00:00Z",
          },
        ],
      }),
      loadCache: async () => ({}),
      saveCache: async () => {},
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async () => true,
    };
    router.setIssuesCheckIoForTest(mockIo);
    try {
      const jsonRes = await executeFleetCheckBoard({ trace: true, json: true });
      assert.equal(jsonRes.isError, false);
      const data = JSON.parse(jsonRes.content[0]!.text);
      assert.ok(Array.isArray(data.decision_traces));
      assert.equal(data.decision_traces.length, 1);
      assert.equal(data.decision_traces[0].number, 1415);
      assert.equal(data.decision_traces[0].path, "new");

      const mdRes = await executeFleetCheckBoard({ trace: true, json: false });
      assert.equal(mdRes.isError, false);
      assert.match(mdRes.content[0]!.text, /Decision Traces/);
      assert.match(mdRes.content[0]!.text, /#1415/);
    } finally {
      router.setIssuesCheckIoForTest(null);
    }
  });

  test("executeFleetBoardSweep supports trace: true for JSON and markdown output", async () => {
    const mockIo: IssuesCheckIo = {
      getOpenIssues: async () => ({
        ok: true,
        issues: [
          {
            number: 1415,
            title: "Decision tree logging",
            state: "open",
            labels: [{ name: "kind/feature" }, { name: "priority/normal" }],
            created_at: "2026-10-16T16:00:00Z",
            updated_at: "2026-10-16T16:00:00Z",
          },
        ],
      }),
      loadCache: async () => ({}),
      saveCache: async () => {},
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async () => true,
    };
    router.setIssuesCheckIoForTest(mockIo);
    try {
      const jsonRes = await executeFleetBoardSweep({ repos: ["test-org/repo-a"], trace: true, json: true });
      assert.equal(jsonRes.isError, false);
      const parsed = JSON.parse(jsonRes.content[0]!.text);
      assert.equal(parsed.ok, true);
      assert.ok(Array.isArray(parsed.decisionTraces));
      assert.equal(parsed.decisionTraces.length, 1);
      assert.equal(parsed.decisionTraces[0].number, 1415);

      const mdRes = await executeFleetBoardSweep({ repos: ["test-org/repo-a"], trace: true, json: false });
      assert.equal(mdRes.isError, false);
      assert.match(mdRes.content[0]!.text, /### Decision Traces/);
      assert.match(mdRes.content[0]!.text, /#1415/);
    } finally {
      router.setIssuesCheckIoForTest(null);
    }
  });

  test("renderWatchdogAuditMarkdown renders clean state", () => {
    const cleanAudit: WatchdogAuditResult = {
      ok: true,
      timestamp: 1700000000000,
      audited: { orchestrators: 2, agents: 5, queues: 0 },
      anomalies: [],
    };
    const md = renderWatchdogAuditMarkdown(cleanAudit);
    assert.match(md, /All agents healthy/);
    assert.match(md, /5 agents/);
    assert.match(md, /2 orchestrators/);
  });

  test("renderWatchdogAuditMarkdown renders anomalies with taxonomy details", () => {
    const anomalyAudit: WatchdogAuditResult = {
      ok: false,
      timestamp: 1700000000000,
      audited: { orchestrators: 2, agents: 5, queues: 0 },
      anomalies: [
        {
          type: "TURN_CONCURRENCY_LOCK",
          agentId: "agent-123",
          severity: "high",
          taxonomy: ["TURN_CONCURRENCY_LOCK"],
          details: {
            TURN_CONCURRENCY_LOCK: "Locked in concurrent execution for 600s",
          },
          recovered: true,
          recoveryActions: ["aborted lock", "steered wake message"],
        },
      ],
    };
    const md = renderWatchdogAuditMarkdown(anomalyAudit);
    assert.match(md, /1 anomaly detected/);
    assert.match(md, /Agent `agent-123`/);
    assert.match(md, /HIGH/);
    assert.match(md, /TURN_CONCURRENCY_LOCK/);
    assert.match(md, /Locked in concurrent execution/);
    assert.match(md, /Recovered:.*Yes/);
  });

  test("executeFleetBoardSweep runs across repos and outputs markdown/json", async () => {
    const mdRes = await executeFleetBoardSweep({ repos: "test-org/repo-a, test-org/repo-b" });
    assert.equal(mdRes.isError, false);
    assert.match(mdRes.content[0]!.text, /# Fleet Board Sweep/);
    assert.match(mdRes.content[0]!.text, /Swept repositories:/);

    const jsonRes = await executeFleetBoardSweep({ repos: ["test-org/repo-a"], json: true });
    assert.equal(jsonRes.isError, false);
    const parsed = JSON.parse(jsonRes.content[0]!.text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.swept, 1);
  });

  test("executeFleetPruneOrchestrators supports dryRun and json formats", async () => {
    const dryRes = await executeFleetPruneOrchestrators({ dryRun: true });
    assert.equal(dryRes.isError, false);
    assert.match(dryRes.content[0]!.text, /# Fleet Orchestrator Prune \(Dry Run\)/);

    const jsonRes = await executeFleetPruneOrchestrators({ dryRun: false, json: true });
    assert.equal(jsonRes.isError, false);
    const parsed = JSON.parse(jsonRes.content[0]!.text);
    assert.equal(parsed.ok, true);
    assert.equal(typeof parsed.prunedCount, "number");
  });

  test("executeFleetQueueInspect inspects fleet queues", async () => {
    const allRes = await executeFleetQueueInspect({});
    assert.equal(allRes.isError, false);
    assert.match(allRes.content[0]!.text, /# Fleet Queue Inspection/);
    assert.match(allRes.content[0]!.text, /Service: uppidi-fleet-hook-router/);

    const repoRes = await executeFleetQueueInspect({ repo: "test-org/repo-a", json: true });
    assert.equal(repoRes.isError, false);
    const parsed = JSON.parse(repoRes.content[0]!.text);
    assert.equal(parsed.ok, true);
    assert.ok(Array.isArray(parsed.queues));
  });

  test("executeFleetQueuePurge validates arguments and purges target queue", async () => {
    // Missing repo
    const noRepoRes = await executeFleetQueuePurge({});
    assert.equal(noRepoRes.isError, true);
    assert.match(noRepoRes.content[0]!.text, /repo parameter is required/);

    // Confirm false or missing
    const unconfirmedRes = await executeFleetQueuePurge({ repo: "test-org/purge-target", confirm: false });
    assert.equal(unconfirmedRes.isError, true);
    assert.match(unconfirmedRes.content[0]!.text, /confirm must be set to true/);

    // Enqueue a message and then purge
    router.enqueue("test-org/purge-target", "test event payload 1", false);
    router.enqueue("test-org/purge-target", "test event payload 2", false);

    const inspectBefore = router.inspectQueues("test-org/purge-target");
    const targetQueueBefore = (inspectBefore.queues as any[]).find((q) => q.key === "test-org/purge-target");
    assert.equal(targetQueueBefore?.depth, 2);

    const purgeRes = await executeFleetQueuePurge({ repo: "test-org/purge-target", confirm: true });
    assert.equal(purgeRes.isError, false);
    assert.match(purgeRes.content[0]!.text, /# Fleet Queue Purge/);
    assert.match(purgeRes.content[0]!.text, /Purged Messages: 2/);

    const inspectAfter = router.inspectQueues("test-org/purge-target");
    const targetQueueAfter = (inspectAfter.queues as any[]).find((q) => q.key === "test-org/purge-target");
    assert.equal(targetQueueAfter?.depth ?? 0, 0);
  });

  test("executeFleetHandoffGenerate creates shift handoff report", async () => {
    const mdRes = await executeFleetHandoffGenerate({});
    assert.equal(mdRes.isError, false);
    assert.match(mdRes.content[0]!.text, /# Fleet Shift Handoff Report/);
    assert.match(mdRes.content[0]!.text, /## Fleet Overview/);
    assert.match(mdRes.content[0]!.text, /## Active Worker Assignments/);
    assert.match(mdRes.content[0]!.text, /## Repository Status/);

    const jsonRes = await executeFleetHandoffGenerate({ json: true });
    assert.equal(jsonRes.isError, false);
    const parsed = JSON.parse(jsonRes.content[0]!.text);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.report);
  });

  test("executeFleetTool dispatches all 7 tools", async () => {
    const tools = [
      "fleet_check_board",
      "fleet_watchdog_audit",
      "fleet_board_sweep",
      "fleet_prune_orchestrators",
      "fleet_queue_inspect",
      "fleet_queue_purge",
      "fleet_handoff_generate",
    ];

    for (const toolName of tools) {
      const args = toolName === "fleet_queue_purge" ? { repo: "test-org/dummy", confirm: true } : {};
      const res = await executeFleetTool(toolName, args);
      assert.ok(res.content.length > 0);
      assert.doesNotMatch(res.content[0]!.text, /^Unknown tool/);
    }
  });

  test("executeFleetTool returns error for unknown tool", async () => {
    const res = await executeFleetTool("unknown_nonexistent_tool");
    assert.equal(res.isError, true);
    assert.match(res.content[0]!.text, /Unknown tool/);
  });

  test("handleFleetToolList returns all 33 available tools", async () => {
    const res = await handleFleetToolList({});
    assert.equal(res.ok, true);
    assert.equal(res.tools.length, 33);
    assert.deepEqual(
      res.tools.map((t) => t.name),
      [
        "fleet_check_board",
        "fleet_watchdog_audit",
        "fleet_board_sweep",
        "fleet_prune_orchestrators",
        "fleet_queue_inspect",
        "fleet_queue_purge",
        "fleet_handoff_generate",
        "fleet_rotate_role",
        "fleet_ensure_orchestrator",
        "fleet_validate_workspace",
        "fleet_prune_dead_sessions",
        "fleet_status_get",
        "fleet_queue_pause",
        "fleet_queue_resume",
        "fleet_queue_drain",
        "fleet_control_mode",
        "fleet_repos_list",
        "fleet_stage_evaluate",
        "fleet_stage_transition",
        "fleet_audit_record",
        "fleet_audit_check",
        "fleet_audit_summary",
        "ticket_list",
        "ticket_view",
        "ticket_create",
        "ticket_comment",
        "ticket_edit",
        "pr_list",
        "pr_view",
        "pr_create",
        "pr_diff",
        "pr_merge",
        "ci_logs",
      ],
    );
  });

  test("handleFleetToolExecute executes each tool via RPC input", async () => {
    const res = await handleFleetToolExecute({
      toolName: "fleet_queue_inspect",
      arguments: { json: true },
    });
    assert.equal(res.ok, true);
    assert.equal(res.isError, false);
    assert.ok(res.output);
  });

  test("executeFleetValidateWorkspace refuses the primary checkout and passes a worktree (#918)", async () => {
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

    const root = mkdtempSync(join(tmpdir(), "fleet-918-root-"));
    const wtParent = mkdtempSync(join(tmpdir(), "fleet-918-wt-"));
    const worktree = join(wtParent, "checkout");
    git(root, ["init", "-b", "main"]);
    writeFileSync(join(root, "README.md"), "hello\n");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-m", "init"]);
    git(root, ["worktree", "add", "-b", "feat/918-mcp", worktree]);

    try {
      const missing = await executeFleetValidateWorkspace({});
      assert.equal(missing.isError, true);
      assert.match(missing.content[0]!.text, /path or workspaceId is required/);

      const refused = await executeFleetValidateWorkspace({ path: root, json: true });
      assert.equal(refused.isError, true);
      const refusedPayload = JSON.parse(refused.content[0]!.text);
      assert.equal(refusedPayload.ok, false);
      assert.match(refusedPayload.error, /primary checkout/);

      const allowed = await executeFleetValidateWorkspace({ path: worktree });
      assert.equal(allowed.isError, false);
      assert.match(allowed.content[0]!.text, /worktree-only dispatch: OK/);
    } finally {
      try {
        git(root, ["worktree", "remove", "--force", worktree]);
      } catch {
        // best-effort cleanup
      }
      rmSync(root, { recursive: true, force: true });
      rmSync(wtParent, { recursive: true, force: true });
    }
  });

  test("executeFleetEnsureOrchestrator requires repo argument", async () => {
    const res = await executeFleetEnsureOrchestrator({});
    assert.equal(res.isError, true);
    assert.match(res.content[0]!.text, /repo is required/);
  });

  test("handleFleetToolExecute handles unknown tool cleanly", async () => {
    const res = await handleFleetToolExecute({
      toolName: "nonexistent",
      arguments: {},
    });
    assert.equal(res.ok, false);
    assert.equal(res.isError, true);
    assert.match(res.error ?? "", /Unknown tool/);
  });

  test("fleet_prune_dead_sessions dry-run reports dead sessions without mutating", async () => {
    // With no agents, should return empty results in dry-run mode
    const res = await executeFleetPruneDeadSessions({ dryRun: true, json: true });
    assert.equal(res.isError, false);
    const body = JSON.parse(res.content[0]!.text);
    assert.equal(body.dryRun, true);
    assert.equal(body.totalDead, 0);
    assert.equal(body.pruned.length, 0);
  });

  test("fleet_prune_dead_sessions requires apply when kill is set", async () => {
    const res = await executeFleetPruneDeadSessions({ kill: true, apply: false });
    assert.equal(res.isError, true);
    assert.match(res.content[0]!.text, /kill requires apply/);
  });

  test("executeFleetPruneDeadSessions invokes archiveAgent when apply: true and kill: true", async () => {
    const originalWatchdog = router.runWatchdogAudit;
    const originalArchive = (router as any).archiveAgent;
    const archivedIds: string[] = [];
    (router as any).archiveAgent = async (agentId: string) => {
      archivedIds.push(agentId);
      return true;
    };
    (router as any).runWatchdogAudit = async () => ({
      ok: true,
      timestamp: Date.now(),
      audited: { orchestrators: 1, agents: 1, queues: 0 },
      anomalies: [],
      deadSessions: [
        {
          agentId: "dead-agent-123",
          name: "Coding Agent #1458",
          deadPredicates: ["TERMINAL_FATAL_ERROR"],
          deadReasons: ["Fatal process exit code 1"],
          killAllowed: true,
          killBlockedReasons: [],
        },
      ],
    });

    try {
      const res = await executeFleetPruneDeadSessions({ apply: true, kill: true, dryRun: false, json: true });
      assert.equal(res.isError, false);
      assert.deepEqual(archivedIds, ["dead-agent-123"]);
      const body = JSON.parse(res.content[0]!.text);
      assert.equal(body.applied, true);
      assert.equal(body.killed, true);
      assert.equal(body.pruned.length, 1);
      assert.equal(body.pruned[0].action, "killed");

      // Verify failure path records kill_failed
      (router as any).archiveAgent = async () => false;
      const failRes = await executeFleetPruneDeadSessions({ apply: true, kill: true, dryRun: false, json: true });
      assert.equal(failRes.isError, false);
      const failBody = JSON.parse(failRes.content[0]!.text);
      assert.equal(failBody.pruned[0].action, "kill_failed");
    } finally {
      router.runWatchdogAudit = originalWatchdog;
      (router as any).archiveAgent = originalArchive;
    }
  });

  test("executeFleetRotateRole respects force: false", async () => {
    let capturedForce: boolean | undefined;
    const originalRotateRole = router.rotateRole;
    (router as any).rotateRole = async (input: any) => {
      capturedForce = input.force;
      return { ok: true, role: input.role, repo: input.repo, agentId: "new-agent", triggers: ["manual"] };
    };

    try {
      const resFalse = await executeFleetRotateRole({ role: "orchestrator", repo: "test-org/repo-a", force: false, json: true });
      assert.equal(resFalse.isError, false);
      assert.equal(capturedForce, false);

      const resDefault = await executeFleetRotateRole({ role: "orchestrator", repo: "test-org/repo-a", json: true });
      assert.equal(resDefault.isError, false);
      assert.equal(capturedForce, true);
    } finally {
      router.rotateRole = originalRotateRole;
    }
  });

  test("executeFleetCheckBoard passes sweepStaleWip", async () => {
    let staleWipSwept = false;
    const now = Date.now();
    const mockIo: IssuesCheckIo = {
      getOpenIssues: async () => ({
        ok: true,
        issues: [
          {
            number: 100,
            title: "Stale WIP issue",
            state: "open",
            labels: [{ name: "state/wip" }],
            created_at: new Date(now - 10 * 3600 * 1000).toISOString(),
            updated_at: new Date(now - 10 * 3600 * 1000).toISOString(),
          },
        ],
      }),
      loadCache: async () => ({}),
      saveCache: async () => {},
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async () => {
        staleWipSwept = true;
        return true;
      },
    };

    router.setIssuesCheckIoForTest(mockIo);
    try {
      // With sweepStaleWip: false, stale WIP recovery should NOT execute
      staleWipSwept = false;
      const resDisabled = await executeFleetCheckBoard({ sweepStaleWip: false, json: true });
      assert.equal(resDisabled.isError, false);
      assert.equal(staleWipSwept, false);
      const parsedDisabled = JSON.parse(resDisabled.content[0]!.text);
      assert.equal(parsedDisabled.stale_wip_recovery.length, 0);

      // With sweepStaleWip: true (or default), stale WIP recovery executes
      staleWipSwept = false;
      const resEnabled = await executeFleetCheckBoard({ sweepStaleWip: true, json: true });
      assert.equal(resEnabled.isError, false);
      assert.equal(staleWipSwept, true);
      const parsedEnabled = JSON.parse(resEnabled.content[0]!.text);
      assert.equal(parsedEnabled.stale_wip_recovery.length, 1);
    } finally {
      router.setIssuesCheckIoForTest(null);
    }
  });

  test("executeFleetPruneOrchestrators passes graceSweeps", async () => {
    let capturedGraceSweeps: number | undefined;
    const originalPrune = router.pruneOrchestrators;
    (router as any).pruneOrchestrators = async (opts: any) => {
      capturedGraceSweeps = opts.graceSweeps;
      return { ok: true, prunedCount: 0, pruned: [], dryRun: opts.dryRun };
    };

    try {
      await executeFleetPruneOrchestrators({ graceSweeps: 5, dryRun: true });
      assert.equal(capturedGraceSweeps, 5);
    } finally {
      router.pruneOrchestrators = originalPrune;
    }
  });

  describe("Phase 2, 3, 4 operational fleet control, playbooks, and audit tools", () => {
    test("executeFleetStatusGet returns status overview in json and markdown", async () => {
      const jsonRes = await executeFleetStatusGet({ json: true });
      assert.equal(jsonRes.isError, false);
      const data = JSON.parse(jsonRes.content[0]!.text);
      assert.equal(data.ok, true);
      assert.equal(data.mode, "RUN");
      assert.equal(data.halted, false);
      assert.ok(Array.isArray(data.queues));
      assert.ok(data.capabilities);

      const mdRes = await executeFleetStatusGet({ json: false });
      assert.equal(mdRes.isError, false);
      assert.match(mdRes.content[0]!.text, /# Fleet Operational Status/);
      assert.match(mdRes.content[0]!.text, /- Mode: `RUN`/);
    });

    test("executeFleetQueuePause and executeFleetQueueResume control queues", async () => {
      // Pause specific queue
      const pauseSingle = await executeFleetQueuePause({ key: "test-org/repo-a", json: true });
      assert.equal(pauseSingle.isError, false);
      const pauseSingleData = JSON.parse(pauseSingle.content[0]!.text);
      assert.equal(pauseSingleData.ok, true);
      assert.equal(pauseSingleData.paused, "test-org/repo-a");
      assert.ok(pauseSingleData.allPaused.includes("test-org/repo-a"));

      // Resume specific queue
      const resumeSingle = await executeFleetQueueResume({ key: "test-org/repo-a", json: true });
      assert.equal(resumeSingle.isError, false);
      const resumeSingleData = JSON.parse(resumeSingle.content[0]!.text);
      assert.equal(resumeSingleData.ok, true);
      assert.equal(resumeSingleData.resumed, "test-org/repo-a");
      assert.ok(!resumeSingleData.allPaused.includes("test-org/repo-a"));

      // Pause all queues
      const pauseAll = await executeFleetQueuePause({ json: false });
      assert.equal(pauseAll.isError, false);
      assert.match(pauseAll.content[0]!.text, /# Fleet Queue Paused/);
      assert.match(pauseAll.content[0]!.text, /Target: `all`/);

      // Resume all queues
      const resumeAll = await executeFleetQueueResume({ json: false });
      assert.equal(resumeAll.isError, false);
      assert.match(resumeAll.content[0]!.text, /# Fleet Queue Resumed/);
    });

    test("executeFleetQueueDrain validates required key and triggers drain", async () => {
      const missingKey = await executeFleetQueueDrain({});
      assert.equal(missingKey.isError, true);
      assert.match(missingKey.content[0]!.text, /key parameter is required/);

      const res = await executeFleetQueueDrain({ key: "test-org/repo-a", json: true });
      assert.equal(res.isError, false);
      const data = JSON.parse(res.content[0]!.text);
      assert.equal(data.ok, true);
      assert.equal(data.draining, "test-org/repo-a");

      const mdRes = await executeFleetQueueDrain({ repo: "test-org/repo-b" });
      assert.equal(mdRes.isError, false);
      assert.match(mdRes.content[0]!.text, /# Fleet Queue Drain/);
    });

    test("executeFleetControlMode validates mode and updates router mode", async () => {
      const invalid = await executeFleetControlMode({ mode: "INVALID_MODE" });
      assert.equal(invalid.isError, true);
      assert.match(invalid.content[0]!.text, /Invalid mode/);

      const drainRes = await executeFleetControlMode({ mode: "DRAIN", json: true });
      assert.equal(drainRes.isError, false);
      const drainData = JSON.parse(drainRes.content[0]!.text);
      assert.equal(drainData.mode, "DRAIN");
      assert.equal(router.mode, "DRAIN");

      const haltRes = await executeFleetControlMode({ mode: "HALT", json: true });
      assert.equal(haltRes.isError, false);
      const haltData = JSON.parse(haltRes.content[0]!.text);
      assert.equal(haltData.mode, "HALT");
      assert.equal(haltData.halted, true);
      assert.equal(router.isHalted(), true);

      // Return to RUN
      const runRes = await executeFleetControlMode({ mode: "RUN", json: false });
      assert.equal(runRes.isError, false);
      assert.match(runRes.content[0]!.text, /Current Mode: `RUN`/);
      assert.equal(router.mode, "RUN");
    });

    test("executeFleetReposList returns enrolled repositories and automation tiers", async () => {
      const jsonRes = await executeFleetReposList({ json: true });
      assert.equal(jsonRes.isError, false);
      const data = JSON.parse(jsonRes.content[0]!.text);
      assert.equal(data.ok, true);
      assert.ok(data.count >= 2);
      const repoA = data.repos.find((r: any) => r.repo.includes("test-org/repo-a"));
      assert.ok(repoA);
      assert.equal(repoA.tier, "full-active");
      assert.equal(repoA.isPaused, false);
      assert.equal(repoA.isKanbanOnly, false);

      const mdRes = await executeFleetReposList({ json: false });
      assert.equal(mdRes.isError, false);
      assert.match(mdRes.content[0]!.text, /# Enrolled Fleet Repositories/);
      assert.match(mdRes.content[0]!.text, /test-org\/repo-a/);
    });

    test("executeFleetStageEvaluate validates input and evaluates transitions", async () => {
      // Validation failures
      const noRepo = await executeFleetStageEvaluate({ issue: 1, targetStage: "stage/spec", actor: "wrk-1" });
      assert.equal(noRepo.isError, true);
      assert.match(noRepo.content[0]!.text, /repo parameter is required/);

      const badIssue = await executeFleetStageEvaluate({ repo: "test-org/repo-a", issue: -1, targetStage: "stage/spec", actor: "wrk-1" });
      assert.equal(badIssue.isError, true);
      assert.match(badIssue.content[0]!.text, /positive integer/);

      const badStage = await executeFleetStageEvaluate({ repo: "test-org/repo-a", issue: 1, targetStage: "invalid/stage", actor: "wrk-1" });
      assert.equal(badStage.isError, true);
      assert.match(badStage.content[0]!.text, /not a canonical playbook stage/);

      const noActor = await executeFleetStageEvaluate({ repo: "test-org/repo-a", issue: 1, targetStage: "stage/spec" });
      assert.equal(noActor.isError, true);
      assert.match(noActor.content[0]!.text, /actor parameter is required/);

      // Successful evaluation (to stage/spec)
      const validRes = await executeFleetStageEvaluate({
        repo: "test-org/repo-a",
        issue: 1,
        targetStage: "stage/spec",
        actor: "wrk-1",
        json: true,
      });
      assert.equal(validRes.isError, false);
      const data = JSON.parse(validRes.content[0]!.text);
      assert.equal(data.ok, true);
      assert.equal(data.decision.allowed, true);
      assert.equal(data.decision.toStage, "stage/spec");

      // Markdown evaluation output
      const mdRes = await executeFleetStageEvaluate({
        repo: "test-org/repo-a",
        issue: 1,
        toStage: "stage/spec",
        actor: "wrk-1",
        json: false,
      });
      assert.equal(mdRes.isError, false);
      assert.match(mdRes.content[0]!.text, /# Playbook Stage Evaluation/);
    });

    test("executeFleetStageTransition validates input and delegates to router guard", async () => {
      const missing = await executeFleetStageTransition({});
      assert.equal(missing.isError, true);
      assert.match(missing.content[0]!.text, /repo parameter is required/);

      const res = await executeFleetStageTransition({
        repo: "test-org/repo-a",
        issue: 1,
        targetStage: "stage/spec",
        actor: "wrk-1",
        json: true,
      });
      const data = JSON.parse(res.content[0]!.text);
      assert.ok("acted" in data);
    });

    test("executeFleetAuditRecord, executeFleetAuditCheck, and executeFleetAuditSummary", async () => {
      // Audit record validation
      const missingRepo = await executeFleetAuditRecord({});
      assert.equal(missingRepo.isError, true);
      assert.match(missingRepo.content[0]!.text, /repo parameter is required/);

      const badVerdict = await executeFleetAuditRecord({
        repo: "test-org/repo-a",
        pr: 10,
        headCommit: "commit-abc",
        verdict: "bad_verdict",
        summary: "test",
      });
      assert.equal(badVerdict.isError, true);
      assert.match(badVerdict.content[0]!.text, /verdict must be one of/);

      // Successful audit record
      const recordRes = await executeFleetAuditRecord({
        repo: "test-org/repo-a",
        pr: 10,
        headCommit: "commit-abc",
        verdict: "approved",
        summary: "Code and tests verified clean",
        auditorAgentId: "auditor-1",
        authorAgentId: "wrk-1",
        json: true,
      });
      assert.equal(recordRes.isError, false);
      const recordData = JSON.parse(recordRes.content[0]!.text);
      assert.equal(recordData.ok, true);
      assert.ok(recordData.auditId.startsWith("aud_"));
      assert.ok(recordData.recordedAt);

      // Audit check validation & lookup
      const checkMissing = await executeFleetAuditCheck({});
      assert.equal(checkMissing.isError, true);

      // Positive check
      const checkFound = await executeFleetAuditCheck({
        repo: "test-org/repo-a",
        pr: 10,
        commit: "commit-abc",
        json: true,
      });
      assert.equal(checkFound.isError, false);
      const foundData = JSON.parse(checkFound.content[0]!.text);
      assert.equal(foundData.audited, true);
      assert.equal(foundData.audit.verdict, "approved");

      // Negative check
      const checkNotFound = await executeFleetAuditCheck({
        repo: "test-org/repo-a",
        pr: 10,
        commit: "different-commit",
        json: true,
      });
      assert.equal(checkNotFound.isError, true);
      const notFoundData = JSON.parse(checkNotFound.content[0]!.text);
      assert.equal(notFoundData.audited, false);

      // Audit summary
      const summaryJson = await executeFleetAuditSummary({ repo: "test-org/repo-a", json: true });
      assert.equal(summaryJson.isError, false);
      const summaryData = JSON.parse(summaryJson.content[0]!.text);
      assert.equal(summaryData.ok, true);
      assert.ok(summaryData.totalAudits >= 1);

      const summaryMd = await executeFleetAuditSummary({ json: false });
      assert.equal(summaryMd.isError, false);
      assert.match(summaryMd.content[0]!.text, /# Fleet Audit Summary/);
    });
  });

  describe("consolidated ticket and PR MCP tools", () => {
    const mockTicketHandlers: any = {
      handleOpenIssues: async (input: any) => ({
        repo: "test-org/repo-a",
        host: "forge.mrs.uppidi.com",
        issues: [{ number: 1, title: "Test issue", state: "open", labels: [] }],
        page: input.page ?? 1,
      }),
      handleIssueDetail: async (input: any) => ({
        repo: "test-org/repo-a",
        issue: { number: input.issueNumber, title: "Test issue", state: "open", labels: [], body: "Hello", comments: [] },
        fetchedAt: new Date().toISOString(),
      }),
      handleCreateIssue: async (input: any) => ({
        repo: "test-org/repo-a",
        host: "forge.mrs.uppidi.com",
        number: 42,
      }),
      handleAddComment: async (input: any) => ({
        number: input.issueNumber,
        commentId: 101,
      }),
      handleSetLabel: async (input: any) => ({
        number: input.issueNumber,
        labels: [input.label],
      }),
      handlePrList: async (input: any) => ({
        repo: "test-org/repo-a",
        host: "forge.mrs.uppidi.com",
        pullRequests: [{ number: 10, title: "Test PR", state: input.state ?? "open", labels: [], headBranch: "feat", baseBranch: "main", author: "xpufx", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
        page: input.page ?? 1,
      }),
      handlePrView: async (input: any) => ({
        repo: "test-org/repo-a",
        host: "forge.mrs.uppidi.com",
        pr: { number: input.pullRequestNumber, title: "Test PR", state: "open", labels: [], headBranch: "feat", baseBranch: "main", author: "xpufx", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        reviewComments: [],
        fetchedAt: new Date().toISOString(),
      }),
      handlePrCreate: async (input: any) => ({
        repo: "test-org/repo-a",
        host: "forge.mrs.uppidi.com",
        number: 11,
        url: "https://forge.mrs.uppidi.com/test-org/repo-a/pulls/11",
      }),
      handlePrDiff: async (input: any) => ({
        repo: "test-org/repo-a",
        pullRequestNumber: input.pullRequestNumber,
        diff: "diff --git a/test.txt b/test.txt\n+new line",
      }),
      handlePrMerge: async (input: any) => ({
        repo: "test-org/repo-a",
        pullRequestNumber: input.pullRequestNumber,
        merged: true,
        mergeCommitSha: "abc1234",
      }),
      handleCiLogs: async (input: any) => ({
        repo: "test-org/repo-a",
        host: "forge.mrs.uppidi.com",
        run: { id: input.runId, runId: input.runId, name: "build", status: "completed", conclusion: "success", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), triggeredBy: "push", ref: "main", workflowName: "ci", steps: [], url: "https://forge.mrs.uppidi.com" },
        stepLog: "Build step output log",
        steps: [],
        page: input.page ?? 1,
      }),
    };

    before(() => {
      setTicketHandlersForTest(mockTicketHandlers);
    });

    after(() => {
      setTicketHandlersForTest(undefined);
    });

    test("ticket tools validate inputs and dispatch cleanly", async () => {
      // ticket_list
      const listRes = await executeTicketList({ page: 2 });
      assert.equal(listRes.isError, false);
      const listData = JSON.parse(listRes.content[0]!.text);
      assert.equal(listData.page, 2);
      assert.equal(listData.issues.length, 1);

      // ticket_view validation
      const viewMissing = await executeTicketView({});
      assert.equal(viewMissing.isError, true);
      assert.match(viewMissing.content[0]!.text, /issueNumber is required/);

      // ticket_view success
      const viewRes = await executeTicketView({ issueNumber: 1 });
      assert.equal(viewRes.isError, false);
      const viewData = JSON.parse(viewRes.content[0]!.text);
      assert.equal(viewData.issue.number, 1);

      // ticket_create validation
      const createMissing = await executeTicketCreate({ title: "" });
      assert.equal(createMissing.isError, true);
      assert.match(createMissing.content[0]!.text, /title is required/);

      // ticket_create success
      const createRes = await executeTicketCreate({ title: "Issue #42", labels: ["kind/feature"] });
      assert.equal(createRes.isError, false);
      const createData = JSON.parse(createRes.content[0]!.text);
      assert.equal(createData.number, 42);

      // ticket_comment validation
      const commentMissing = await executeTicketComment({ issueNumber: 42, body: "" });
      assert.equal(commentMissing.isError, true);
      assert.match(commentMissing.content[0]!.text, /body is required/);

      // ticket_comment success
      const commentRes = await executeTicketComment({ issueNumber: 42, body: "Progress comment" });
      assert.equal(commentRes.isError, false);
      const commentData = JSON.parse(commentRes.content[0]!.text);
      assert.equal(commentData.commentId, 101);

      // ticket_edit validation
      const editMissing = await executeTicketEdit({ issueNumber: 42, label: "" });
      assert.equal(editMissing.isError, true);
      assert.match(editMissing.content[0]!.text, /label is required/);

      // ticket_edit success
      const editRes = await executeTicketEdit({ issueNumber: 42, label: "state/review" });
      assert.equal(editRes.isError, false);
      const editData = JSON.parse(editRes.content[0]!.text);
      assert.deepEqual(editData.labels, ["state/review"]);
    });

    test("PR and CI tools validate inputs and dispatch cleanly", async () => {
      // pr_list
      const prListRes = await executePrList({ state: "open" });
      assert.equal(prListRes.isError, false);
      const prListData = JSON.parse(prListRes.content[0]!.text);
      assert.equal(prListData.pullRequests.length, 1);

      // pr_view validation
      const prViewMissing = await executePrView({});
      assert.equal(prViewMissing.isError, true);
      assert.match(prViewMissing.content[0]!.text, /pullRequestNumber is required/);

      // pr_view success
      const prViewRes = await executePrView({ pullRequestNumber: 10 });
      assert.equal(prViewRes.isError, false);
      const prViewData = JSON.parse(prViewRes.content[0]!.text);
      assert.equal(prViewData.pr.number, 10);

      // pr_create validation
      const prCreateMissing = await executePrCreate({ title: "PR", headBranch: "" });
      assert.equal(prCreateMissing.isError, true);
      assert.match(prCreateMissing.content[0]!.text, /headBranch is required/);

      // pr_create success
      const prCreateRes = await executePrCreate({ title: "PR", headBranch: "feat", baseBranch: "main" });
      assert.equal(prCreateRes.isError, false);
      const prCreateData = JSON.parse(prCreateRes.content[0]!.text);
      assert.equal(prCreateData.number, 11);

      // pr_diff validation & success
      const prDiffMissing = await executePrDiff({});
      assert.equal(prDiffMissing.isError, true);
      const prDiffRes = await executePrDiff({ pullRequestNumber: 10 });
      assert.equal(prDiffRes.isError, false);
      const prDiffData = JSON.parse(prDiffRes.content[0]!.text);
      assert.match(prDiffData.diff, /diff --git/);

      // pr_merge validation & success
      const prMergeMissing = await executePrMerge({});
      assert.equal(prMergeMissing.isError, true);
      const prMergeRes = await executePrMerge({ pullRequestNumber: 10 });
      assert.equal(prMergeRes.isError, false);
      const prMergeData = JSON.parse(prMergeRes.content[0]!.text);
      assert.equal(prMergeData.merged, true);

      // ci_logs validation & success
      const ciLogsMissing = await executeCiLogs({});
      assert.equal(ciLogsMissing.isError, true);
      assert.match(ciLogsMissing.content[0]!.text, /runId is required/);
      const ciLogsRes = await executeCiLogs({ runId: 55, stepId: 1 });
      assert.equal(ciLogsRes.isError, false);
      const ciLogsData = JSON.parse(ciLogsRes.content[0]!.text);
      assert.equal(ciLogsData.run.id, 55);
      assert.equal(ciLogsData.stepLog, "Build step output log");
    });

    test("executeFleetTool dispatches all 33 tools", async () => {
      const allToolNames = FLEET_MCP_TOOLS.map((t) => t.name);
      assert.equal(allToolNames.length, 33);

      const safeArgs: Record<string, Record<string, unknown>> = {
        fleet_check_board: { repo: "test-org/repo-a", dryRun: true, json: true },
        fleet_watchdog_audit: { json: true },
        fleet_board_sweep: { repos: "test-org/repo-a", json: true },
        fleet_prune_orchestrators: { dryRun: true, json: true },
        fleet_queue_inspect: { repo: "test-org/repo-a", json: true },
        fleet_queue_purge: { repo: "test-org/repo-a", confirm: false, json: true },
        fleet_handoff_generate: { json: true },
        fleet_rotate_role: { role: "orchestrator", repo: "test-org/repo-a", json: true },
        fleet_ensure_orchestrator: { repo: "test-org/repo-a", json: true },
        fleet_validate_workspace: { path: tmpDir, json: true },
        fleet_prune_dead_sessions: { dryRun: true, json: true },
        fleet_status_get: { json: true },
        fleet_queue_pause: { key: "test-org/repo-a", json: true },
        fleet_queue_resume: { key: "test-org/repo-a", json: true },
        fleet_queue_drain: { key: "test-org/repo-a", json: true },
        fleet_control_mode: { mode: "RUN", json: true },
        fleet_repos_list: { json: true },
        fleet_stage_evaluate: { repo: "test-org/repo-a", issue: 1, targetStage: "stage/spec", actor: "wrk-1", json: true },
        fleet_stage_transition: { repo: "test-org/repo-a", issue: 1, targetStage: "stage/spec", actor: "wrk-1", json: true },
        fleet_audit_record: { repo: "test-org/repo-a", pr: 1, headCommit: "abc", verdict: "approved", summary: "ok", json: true },
        fleet_audit_check: { repo: "test-org/repo-a", pr: 1, commit: "abc", json: true },
        fleet_audit_summary: { json: true },
        ticket_list: { page: 1 },
        ticket_view: { issueNumber: 1 },
        ticket_create: { title: "New issue" },
        ticket_comment: { issueNumber: 1, body: "Comment" },
        ticket_edit: { issueNumber: 1, label: "state/wip" },
        pr_list: { state: "open" },
        pr_view: { pullRequestNumber: 1 },
        pr_create: { title: "PR", headBranch: "feat", baseBranch: "main" },
        pr_diff: { pullRequestNumber: 1 },
        pr_merge: { pullRequestNumber: 1 },
        ci_logs: { runId: 10 },
      };

      for (const name of allToolNames) {
        const result = await executeFleetTool(name, safeArgs[name] ?? {});
        assert.ok(result.content.length > 0, `${name} must return content`);
        assert.doesNotMatch(result.content[0]!.text, /^Unknown tool/, `${name} must be handled`);
      }
    });
  });
});
