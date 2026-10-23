import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "../bin/fleet-mcp-server.mjs");

/** Declaration order of the 33 tools, asserted against `tools/list`. */
const TOOL_NAMES = [
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
];

// ---------------------------------------------------------------------------
// Controlled environment
//
// The server is spawned as a child process, so its `getActiveHookRouter()` is
// always null and every tool builds a fresh `HookRouter`. `NODE_ENV=test` puts
// that router in its hermetic mode (no daemon roster, tmp-scoped storage), and
// `HOME`/`HOOK_*` pin the few paths the router reads. A `teax` shim on PATH
// keeps `fleet_check_board` off the network and deterministic.
// ---------------------------------------------------------------------------

const SAMPLE_ISSUE = {
  number: 42,
  title: "Sample fleet issue",
  state: "open",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2099-01-01T00:00:00Z",
  comments: 0,
  labels: [{ name: "kind/feature" }, { name: "priority/normal" }, { name: "state/1-wip" }],
};

const QUEUE_KEY = "test-org/purge-target";
const QUEUE_FILE = `${QUEUE_KEY.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`;

function writeTeaxStub(target) {
  const script = `#!${process.execPath}
const args = process.argv.slice(2);
const endpoint = args[0] === "api" ? String(args[1] ?? "") : "";
const issues = ${JSON.stringify([SAMPLE_ISSUE])};
const write = (value) => process.stdout.write(JSON.stringify(value));
if (endpoint.includes("/issues?")) {
  write(issues);
} else {
  write([]);
}
`;
  fs.writeFileSync(target, script, { mode: 0o755 });
}

describe("fleet-mcp-server stdio E2E", () => {
  let root;
  let homeDir;
  let queueDir;
  let stateDir;
  let binDir;
  const clients = new Set();

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-mcp-server-e2e-"));
    homeDir = path.join(root, "home");
    queueDir = path.join(root, "queues");
    stateDir = path.join(root, "state");
    binDir = path.join(root, "bin");
    for (const dir of [homeDir, queueDir, stateDir, binDir]) fs.mkdirSync(dir, { recursive: true });
    writeTeaxStub(path.join(binDir, "teax"));
  });

  after(() => {
    for (const client of clients) client.close();
    clients.clear();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function childEnv(extra = {}) {
    return {
      ...process.env,
      NODE_ENV: "test",
      UPPIDI_FLEET_TEST_TEAX: "1",
      HOME: homeDir,
      PASEO_HOME: path.join(homeDir, ".paseo"),
      HOOK_QUEUE_DIR: queueDir,
      HOOK_STATE_DIR: stateDir,
      UPPIDI_FLEET_AUDITS_FILE: path.join(root, "audits.jsonl"),
      UPPIDI_FLEET_AUDIT_RECONCILIATIONS_FILE: path.join(root, "audit-reconciliations.jsonl"),
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      ...extra,
    };
  }

  function createMcpProcess({ env = {} } = {}) {
    const child = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv(env),
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let nextId = 1;
    let stderr = "";
    const received = [];
    const waiters = new Set();

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        return;
      }
      received.push(msg);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(msg)) {
          waiters.delete(waiter);
          waiter.resolve(msg);
        }
      }
    });

    function waitForMessage(predicate, timeoutMs = 20000) {
      const existing = received.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.add(waiter);
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`timed out waiting for MCP message; stderr=${stderr}`));
        }, timeoutMs);
        waiter.resolve = (msg) => {
          clearTimeout(timer);
          resolve(msg);
        };
      });
    }

    function writeRaw(payload) {
      child.stdin.write(`${payload}\n`);
    }

    function request(method, params) {
      const id = nextId++;
      writeRaw(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      return waitForMessage((msg) => msg.id === id);
    }

    function notify(method, params) {
      writeRaw(JSON.stringify({ jsonrpc: "2.0", method, params }));
    }

    async function callTool(name, args = {}) {
      const res = await request("tools/call", { name, arguments: args });
      assert.equal(res.jsonrpc, "2.0", `tools/call ${name} must be JSON-RPC 2.0`);
      assert.ok(res.result, `tools/call ${name} must return a result`);
      assert.ok(Array.isArray(res.result.content), `tools/call ${name} must return content[]`);
      assert.equal(typeof res.result.isError, "boolean", `tools/call ${name} must set isError`);
      assert.equal(res.result.content[0]?.type, "text");
      return res.result;
    }

    function close() {
      clients.delete(api);
      try {
        child.stdin.end();
      } catch {
        // already closed
      }
      child.kill();
    }

    const api = { request, notify, callTool, waitForMessage, writeRaw, received, close, getStderr: () => stderr };
    clients.add(api);
    return api;
  }

  /** Run a callback against a fresh server process and always tear it down. */
  async function withClient(fn) {
    const client = createMcpProcess();
    try {
      return await fn(client);
    } finally {
      client.close();
    }
  }

  describe("JSON-RPC 2.0 handshake", () => {
    test("initialize negotiates protocol, capabilities, server info, and instructions", async () => {
      await withClient(async (client) => {
        const res = await client.request("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "fleet-e2e", version: "1.0.0" },
        });
        assert.equal(res.jsonrpc, "2.0");
        assert.equal(res.result.protocolVersion, "2024-11-05");
        assert.equal(res.result.serverInfo.name, "uppidi-fleet");
        assert.equal(res.result.serverInfo.version, "0.1.0");
        assert.deepEqual(res.result.capabilities, { tools: {} });
        assert.match(res.result.instructions, /fleet_check_board/);
        assert.match(res.result.instructions, /fleet_watchdog_audit/);
      });
    });

    test("notifications/initialized is acknowledged without a response", async () => {
      await withClient(async (client) => {
        client.notify("notifications/initialized", {});
        const ping = await client.request("ping", {});
        assert.deepEqual(ping.result, {});
        assert.equal(
          client.received.filter((msg) => msg.id === null || msg.id === undefined).length,
          0,
          "a notification must not produce a response",
        );
      });
    });

    test("ping returns an empty result object", async () => {
      await withClient(async (client) => {
        const res = await client.request("ping", {});
        assert.equal(res.jsonrpc, "2.0");
        assert.deepEqual(res.result, {});
      });
    });

    test("tools/list advertises all 33 tools with object input schemas", async () => {
      await withClient(async (client) => {
        const res = await client.request("tools/list", {});
        assert.ok(Array.isArray(res.result.tools));
        assert.deepEqual(
          res.result.tools.map((tool) => tool.name),
          TOOL_NAMES,
        );
        for (const tool of res.result.tools) {
          assert.equal(tool.inputSchema.type, "object", `${tool.name} schema must be an object`);
          assert.equal(typeof tool.description, "string");
          assert.ok(tool.description.length > 0, `${tool.name} must carry a description`);
          for (const required of tool.inputSchema.required ?? []) {
            assert.ok(tool.inputSchema.properties[required], `${tool.name} requires declared property ${required}`);
          }
        }
        const purge = res.result.tools.find((tool) => tool.name === "fleet_queue_purge");
        assert.deepEqual(purge.inputSchema.required, ["repo", "confirm"]);
        assert.ok(purge.inputSchema.properties.confirm);
        const ensure = res.result.tools.find((tool) => tool.name === "fleet_ensure_orchestrator");
        assert.deepEqual(ensure.inputSchema.required, ["repo"]);
      });
    });

    test("unknown method returns JSON-RPC -32601", async () => {
      await withClient(async (client) => {
        const res = await client.request("nonexistent/method", {});
        assert.equal(res.error.code, -32601);
        assert.match(res.error.message, /Method not found/);
      });
    });

    test("tools/call without a tool name returns JSON-RPC -32602", async () => {
      await withClient(async (client) => {
        const missing = await client.request("tools/call", {});
        assert.equal(missing.error.code, -32602);
        assert.match(missing.error.message, /name is required/);

        const wrongType = await client.request("tools/call", { name: 123 });
        assert.equal(wrongType.error.code, -32602);
      });
    });

    test("malformed JSON line returns JSON-RPC -32700 with a null id", async () => {
      await withClient(async (client) => {
        client.writeRaw("{ not json");
        const res = await client.waitForMessage((msg) => msg.error?.code === -32700);
        assert.equal(res.id, null);
        assert.match(res.error.message, /Parse error/);
      });
    });
  });

  describe("tools/call executes all 33 tools over stdio", () => {
    test("dispatches every declared tool without an unknown-tool error", async () => {
      await withClient(async (client) => {
        const safeArgs = {
          fleet_check_board: { repo: "test-org/repo-a", dryRun: true, json: true },
          fleet_watchdog_audit: { recover: false, json: true },
          fleet_board_sweep: { repos: "test-org/repo-a", json: true },
          fleet_prune_orchestrators: { dryRun: true, json: true },
          fleet_queue_inspect: { json: true },
          fleet_queue_purge: { repo: "test-org/absent", confirm: true, json: true },
          fleet_handoff_generate: { json: true },
          fleet_rotate_role: { role: "orchestrator", repo: "test-org/repo-a", json: true },
          fleet_ensure_orchestrator: { repo: "test-org/repo-a", json: true },
          fleet_validate_workspace: { path: root, json: true },
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
          ticket_create: { title: "Test issue" },
          ticket_comment: { issueNumber: 1, body: "Test comment" },
          ticket_edit: { issueNumber: 1, label: "state/wip" },
          pr_list: { state: "open" },
          pr_view: { pullRequestNumber: 1 },
          pr_create: { title: "Test PR", headBranch: "feat", baseBranch: "main" },
          pr_diff: { pullRequestNumber: 1 },
          pr_merge: { pullRequestNumber: 1 },
          ci_logs: { runId: 1 },
        };

        for (const name of TOOL_NAMES) {
          const result = await client.callTool(name, safeArgs[name]);
          assert.doesNotMatch(
            result.content[0].text,
            /^Unknown tool/,
            `${name} must be dispatched by the server`,
          );
        }
      });
    });

    test("unknown tool returns a typed error payload, not a JSON-RPC fault", async () => {
      await withClient(async (client) => {
        const result = await client.callTool("fleet_does_not_exist", {});
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /Unknown tool/);
      });
    });

    test("fleet_check_board renders markdown by default and JSON when json: true", async () => {
      await withClient(async (client) => {
        const md = await client.callTool("fleet_check_board", { repo: "test-org/repo-a", dryRun: true });
        assert.equal(md.isError, false);
        assert.match(md.content[0].text, /# Forgejo Deterministic Board Ranking/);

        // A distinct repo keeps its own board-state cache, so the second call
        // still sees the fixture issue as first-seen rather than cached.
        const json = await client.callTool("fleet_check_board", { repo: "test-org/repo-b", dryRun: true, json: true });
        assert.equal(json.isError, false);
        const parsed = JSON.parse(json.content[0].text);
        assert.ok(Array.isArray(parsed.ranked_candidates));
        assert.equal(parsed.ranked_candidates.length, 1);
        assert.equal(parsed.ranked_candidates[0].number, SAMPLE_ISSUE.number);
      });
    });

    test("fleet_check_board rejects an invalid role and a negative stale window", async () => {
      await withClient(async (client) => {
        const badRole = await client.callTool("fleet_check_board", { role: "invalid", dryRun: true });
        assert.equal(badRole.isError, true);
        assert.match(badRole.content[0].text, /Invalid role/);

        const badHours = await client.callTool("fleet_check_board", { staleWipHours: -1, dryRun: true });
        assert.equal(badHours.isError, true);
        assert.match(badHours.content[0].text, /staleWipHours must be a non-negative number/);
      });
    });

    test("fleet_watchdog_audit renders a health report in both formats", async () => {
      await withClient(async (client) => {
        const md = await client.callTool("fleet_watchdog_audit", { recover: false });
        assert.equal(md.isError, false);
        assert.match(md.content[0].text, /# Fleet Watchdog Health Audit/);

        const json = await client.callTool("fleet_watchdog_audit", { recover: false, json: true });
        assert.equal(json.isError, false);
        const parsed = JSON.parse(json.content[0].text);
        assert.equal(typeof parsed.ok, "boolean");
        assert.equal(typeof parsed.timestamp, "number");
        assert.ok(parsed.audited);
        assert.ok(Array.isArray(parsed.anomalies));
      });
    });

    test("fleet_board_sweep reports swept repositories in both formats", async () => {
      await withClient(async (client) => {
        const md = await client.callTool("fleet_board_sweep", { repos: "test-org/repo-a" });
        assert.equal(md.isError, false);
        assert.match(md.content[0].text, /# Fleet Board Sweep/);

        const json = await client.callTool("fleet_board_sweep", { repos: "test-org/repo-a", json: true });
        assert.equal(json.isError, false);
        const parsed = JSON.parse(json.content[0].text);
        assert.equal(parsed.ok, true);
        assert.equal(parsed.swept, 1);
      });
    });

    test("fleet_prune_orchestrators reports an unreachable daemon in both formats", async () => {
      await withClient(async (client) => {
        const md = await client.callTool("fleet_prune_orchestrators", { dryRun: true });
        assert.equal(md.isError, true);
        assert.match(md.content[0].text, /# Fleet Orchestrator Prune/);
        assert.match(md.content[0].text, /Status: Failed/);
        assert.match(md.content[0].text, /daemon unreachable/);

        const json = await client.callTool("fleet_prune_orchestrators", { dryRun: true, json: true });
        assert.equal(json.isError, true);
        const parsed = JSON.parse(json.content[0].text);
        assert.equal(parsed.ok, false);
        assert.equal(parsed.error, "daemon unreachable");
      });
    });

    test("fleet_queue_inspect reports queue state in both formats", async () => {
      await withClient(async (client) => {
        const md = await client.callTool("fleet_queue_inspect", {});
        assert.equal(md.isError, false);
        assert.match(md.content[0].text, /# Fleet Queue Inspection/);

        const json = await client.callTool("fleet_queue_inspect", { json: true });
        assert.equal(json.isError, false);
        const parsed = JSON.parse(json.content[0].text);
        assert.ok(Array.isArray(parsed.queues));
      });
    });

    test("fleet_queue_purge enforces the confirm guard then purges a real queue file", async () => {
      const queueFile = path.join(queueDir, QUEUE_FILE);
      fs.writeFileSync(
        queueFile,
        JSON.stringify(
          [
            { id: "msg-1", key: QUEUE_KEY, msg: "payload 1", ts: Date.now(), isSos: false },
            { id: "msg-2", key: QUEUE_KEY, msg: "payload 2", ts: Date.now(), isSos: false },
          ],
          null,
          2,
        ),
      );

      await withClient(async (client) => {
        const noRepo = await client.callTool("fleet_queue_purge", {});
        assert.equal(noRepo.isError, true);
        assert.match(noRepo.content[0].text, /repo parameter is required/);

        const unconfirmed = await client.callTool("fleet_queue_purge", { repo: QUEUE_KEY, confirm: false });
        assert.equal(unconfirmed.isError, true);
        assert.match(unconfirmed.content[0].text, /confirm must be set to true/);
        assert.ok(fs.existsSync(queueFile), "an unconfirmed purge must not delete the queue file");

        const purged = await client.callTool("fleet_queue_purge", { repo: QUEUE_KEY, confirm: true });
        assert.equal(purged.isError, false);
        assert.match(purged.content[0].text, /# Fleet Queue Purge/);
        assert.match(purged.content[0].text, /Purged Messages: 2/);
        assert.equal(fs.existsSync(queueFile), false, "a confirmed purge must remove the queue file");
      });
    });

    test("fleet_handoff_generate produces a report in both formats", async () => {
      await withClient(async (client) => {
        const md = await client.callTool("fleet_handoff_generate", {});
        assert.equal(md.isError, false);
        assert.match(md.content[0].text, /# Fleet Shift Handoff Report/);

        const json = await client.callTool("fleet_handoff_generate", { json: true });
        assert.equal(json.isError, false);
        const parsed = JSON.parse(json.content[0].text);
        assert.equal(parsed.ok, true);
        assert.ok(parsed.report);
      });
    });

    test("fleet_rotate_role fails cleanly when no hook router is running", async () => {
      await withClient(async (client) => {
        const result = await client.callTool("fleet_rotate_role", { role: "orchestrator", repo: "test-org/repo-a" });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /hook router is not running/);
      });
    });

    test("fleet_ensure_orchestrator requires a repo and reports an unreachable daemon", async () => {
      await withClient(async (client) => {
        const missing = await client.callTool("fleet_ensure_orchestrator", {});
        assert.equal(missing.isError, true);
        assert.match(missing.content[0].text, /repo is required/);

        const unreachable = await client.callTool("fleet_ensure_orchestrator", {
          repo: "test-org/repo-a",
          json: true,
        });
        assert.equal(unreachable.isError, true);
        assert.match(unreachable.content[0].text, /No workspace found|workspace_not_found|failed/);
      });
    });

    test("fleet_validate_workspace requires a path and refuses a primary checkout", async () => {
      const gitRoot = path.join(root, "git-primary");
      const worktreeParent = path.join(root, "worktrees");
      const worktree = path.join(worktreeParent, "checkout");
      fs.mkdirSync(gitRoot, { recursive: true });
      fs.mkdirSync(worktreeParent, { recursive: true });

      const gitEnv = {
        ...childEnv(),
        GIT_AUTHOR_NAME: "Fleet Test",
        GIT_AUTHOR_EMAIL: "fleet-test@example.com",
        GIT_COMMITTER_NAME: "Fleet Test",
        GIT_COMMITTER_EMAIL: "fleet-test@example.com",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      };
      const git = (args, cwd) => {
        const res = spawnSync("git", args, { cwd, env: gitEnv, encoding: "utf-8" });
        assert.equal(res.status, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
        return res.stdout.trim();
      };

      git(["init", "-b", "main"], gitRoot);
      fs.writeFileSync(path.join(gitRoot, "README.md"), "fleet e2e\n");
      git(["add", "README.md"], gitRoot);
      git(["commit", "-m", "init"], gitRoot);
      git(["worktree", "add", "-b", "feat/e2e", worktree], gitRoot);

      try {
        await withClient(async (client) => {
          const missing = await client.callTool("fleet_validate_workspace", {});
          assert.equal(missing.isError, true);
          assert.match(missing.content[0].text, /path or workspaceId is required/);

          const refused = await client.callTool("fleet_validate_workspace", { path: gitRoot, json: true });
          assert.equal(refused.isError, true);
          const refusedPayload = JSON.parse(refused.content[0].text);
          assert.equal(refusedPayload.ok, false);

          const allowed = await client.callTool("fleet_validate_workspace", { path: worktree, json: true });
          assert.equal(allowed.isError, false);
          const allowedPayload = JSON.parse(allowed.content[0].text);
          assert.equal(allowedPayload.ok, true);
        });
      } finally {
        spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: gitRoot, env: gitEnv });
      }
    });
  });
});
