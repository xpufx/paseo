import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FLEET_MCP_TOOLS,
  executeFleetCheckBoard,
  executeFleetWatchdogAudit,
  executeFleetBoardSweep,
  executeFleetPruneOrchestrators,
  executeFleetQueueInspect,
  executeFleetQueuePurge,
  executeFleetHandoffGenerate,
  executeFleetEnsureOrchestrator,
  executeFleetValidateWorkspace,
  executeFleetTool,
  handleFleetToolList,
  handleFleetToolExecute,
  renderWatchdogAuditMarkdown,
} from "./mcp-tools.js";
import { HookRouter, setActiveHookRouter, type WatchdogAuditResult } from "./hook-router.js";

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
    assert.equal(FLEET_MCP_TOOLS.length, 10);

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
    ]);

    const boardTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_check_board");
    assert.ok(boardTool, "fleet_check_board tool must be registered");
    assert.equal(boardTool.inputSchema.type, "object");
    assert.ok(boardTool.inputSchema.properties.repo);
    assert.ok(boardTool.inputSchema.properties.role);
    assert.ok(boardTool.inputSchema.properties.force);
    assert.ok(boardTool.inputSchema.properties.dryRun);

    const watchdogTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_watchdog_audit");
    assert.ok(watchdogTool, "fleet_watchdog_audit tool must be registered");
    assert.equal(watchdogTool.inputSchema.type, "object");
    assert.ok(watchdogTool.inputSchema.properties.recover);
    assert.ok(watchdogTool.inputSchema.properties.frontDeskId);

    const sweepTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_board_sweep");
    assert.ok(sweepTool, "fleet_board_sweep tool must be registered");
    assert.equal(sweepTool.inputSchema.type, "object");
    assert.ok(sweepTool.inputSchema.properties.repos);
    assert.ok(sweepTool.inputSchema.properties.json);

    const pruneTool = FLEET_MCP_TOOLS.find((t) => t.name === "fleet_prune_orchestrators");
    assert.ok(pruneTool, "fleet_prune_orchestrators tool must be registered");
    assert.equal(pruneTool.inputSchema.type, "object");
    assert.ok(pruneTool.inputSchema.properties.dryRun);
    assert.ok(pruneTool.inputSchema.properties.json);

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

  test("handleFleetToolList returns all 10 available tools", async () => {
    const res = await handleFleetToolList({});
    assert.equal(res.ok, true);
    assert.equal(res.tools.length, 10);
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
});
