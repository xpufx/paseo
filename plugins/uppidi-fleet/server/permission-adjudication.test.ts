import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  adjudicatePermission,
  appendAdjudicationDecision,
  classifySafeCommand,
  extractPermissionCommandText,
  isFleetAgent,
  readAdjudicationDecisions,
  scanShellCommand,
} from "./permission-adjudication.js";

const WORKSPACE = "/var/test-home/.paseo/worktrees/w1/fix-1084-permission-auto-adjudication";
const HOME = "/var/test-home";

function classify(command: string) {
  return classifySafeCommand(command, { cwd: WORKSPACE, home: HOME });
}

describe("safe permission allowlist (#1084)", () => {
  it("allows teax issue comment body composition, including quoted heredocs and -F files", () => {
    const heredoc =
      "teax issue comment 1084 --hostname forge.example.com -R owner/repo --envelope " +
      "-b \"$(cat <<'EOF'\nSee the diff; run `git reset --hard` only in your own worktree.\nEOF\n)\"";
    assert.equal(classify(heredoc)?.ruleId, "teax-board");
    assert.equal(classify("teax issue comment 42 -R o/r --envelope -F " + WORKSPACE + "/.tmp/body.md")?.ruleId, "teax-board");
    assert.equal(classify("teax pr create -t 'x' -b @body.md")?.ruleId, "teax-board");
    assert.equal(classify("teax issue view 42")?.ruleId, "teax-board");
  });

  it("allows scratch cleanup scoped to ./.tmp, <workspace>/.tmp, and ~/.cache", () => {
    assert.notEqual(classify("git status && rm -rf .tmp && git status"), null);
    assert.equal(classify(`rm -rf ${WORKSPACE}/.tmp/scratch`)?.ruleId, "scratch-cleanup");
    assert.equal(classify(`rm -rf ${HOME}/.cache/pip`)?.ruleId, "scratch-cleanup");
    assert.equal(classify("rm -rf ~/.cache/npm")?.ruleId, "scratch-cleanup");
  });

  it("allows read-only repo probes and the listed paseo commands", () => {
    assert.equal(classify("git status")?.ruleId, "read-only-probe");
    assert.equal(classify("git rev-parse --abbrev-ref HEAD")?.ruleId, "read-only-probe");
    assert.equal(classify("git fetch origin")?.ruleId, "read-only-probe");
    assert.equal(classify("ls -la")?.ruleId, "read-only-probe");
    assert.equal(classify("paseo send --steer --no-wait abc 'continue'")?.ruleId, "paseo-send");
    assert.equal(classify("paseo permit ls")?.ruleId, "paseo-permit-ls");
    assert.equal(classify("paseo plugin reload uppidi-fleet")?.ruleId, "paseo-plugin-reload");
  });

  it("never auto-allows destructive commands or global-path cleanup", () => {
    // Deleting the filesystem root, force-push, hard reset, deleting branches,
    // global /tmp cleanup, and widening a scratch rm with .. must all escalate.
    assert.equal(classify("rm -rf " + "/"), null);
    assert.equal(classify("git push --force origin main"), null);
    assert.equal(classify("git reset --hard HEAD~3"), null);
    assert.equal(classify("git branch -D feature"), null);
    assert.equal(classify("rm -rf /tmp/scratch"), null);
    assert.equal(classify(`rm -rf ${WORKSPACE}/.tmp/../../etc`), null);
    assert.equal(classify("bash -c " + JSON.stringify("rm -rf " + "/")), null);
    assert.equal(classify("sudo rm -rf .tmp"), null);
    assert.equal(classify("cat ~/.ssh/id_rsa"), null);
    assert.equal(classify("git worktree remove /some/path"), null);
    assert.equal(classify("git stash"), null);
    assert.equal(classify("git remote remove origin"), null);
    assert.equal(classify("git diff --output=/etc/passwd"), null);
    assert.equal(classify("teax pr merge 42"), null);
    assert.equal(classify("teax issue close 42"), null);
    assert.equal(classify("teax repo delete myrepo"), null);
  });

  it("requires every segment and substitution to be safe", () => {
    assert.equal(classify("teax issue comment 1 -b ok && rm -rf /"), null);
    assert.equal(classify('teax issue comment 1 -b "$(rm -rf ' + '/)"'), null);
    // A quoted heredoc with a destructive-looking *body* is inert data, so it stays safe.
    assert.equal(classify("cat <<'EOF'\nrm -rf /\nEOF\n")?.ruleId, "read-only-probe");
    // An unquoted heredoc delimiter can expand, so the body is not trusted.
    assert.equal(classify("cat <<EOF\n$(rm -rf /)\nEOF"), null);
    // Output redirection is not provably safe.
    assert.equal(classify("echo hi > /etc/passwd"), null);
  });

  it("scans heredocs into inert data and rejects malformed input", () => {
    const scan = scanShellCommand("cat <<'EOF'\nbody ; rm -rf /\nEOF\n");
    assert.equal(scan.ok, true);
    assert.deepEqual(scan.segments, ["cat"]);
    assert.equal(scanShellCommand("cat <<'EOF'\nunterminated").ok, false);
  });

  it("extracts the command text from input.command before title", () => {
    assert.equal(
      extractPermissionCommandText({
        title: "run bash command",
        input: { command: "git status" },
      }),
      "git status",
    );
    assert.equal(extractPermissionCommandText({ title: "git status" }), "git status");
  });
});

describe("fleet agent detection (#1084)", () => {
  it("recognizes fleet-labelled and registered agents", () => {
    assert.equal(isFleetAgent({ id: "a", labels: { role: "orchestrator" } }), true);
    assert.equal(isFleetAgent({ id: "b", labels: { category: "worker" } }), true);
    assert.equal(isFleetAgent({ id: "c", labels: { repo: "owner/repo" } }), true);
    assert.equal(isFleetAgent({ id: "d", labels: { "paseo.parent-agent-id": "orch" } }), true);
    assert.equal(isFleetAgent({ id: "e", title: "Orchestrator · owner/repo" }), true);
    assert.equal(isFleetAgent({ id: "fd" }, { frontDeskId: "fd" }), true);
    assert.equal(isFleetAgent({ id: "orch" }, { orchestratorAgentIds: ["orch"] }), true);
  });

  it("rejects ad-hoc agents the operator runs by hand", () => {
    assert.equal(isFleetAgent({ id: "x", name: "my scratch session" }), false);
  });
});

describe("permission adjudication decisions (#1084)", () => {
  it("auto-allows a fleet heredoc permission through the injected seam", async () => {
    const calls: Array<[string, string]> = [];
    const result = await adjudicatePermission({
      agent: { id: "orch-1", title: "Orchestrator · owner/repo", labels: { role: "orchestrator" }, cwd: WORKSPACE },
      permission: {
        id: "perm-1",
        tool: "run_command",
        input: { command: "teax issue comment 42 -b \"$(cat <<'EOF'\nbody\nEOF\n)\"" },
      },
      allow: async (agentId, permissionId) => {
        calls.push([agentId, permissionId]);
        return true;
      },
      logPath: undefined,
    });
    assert.equal(result.action, "auto-allow");
    assert.equal(result.ruleId, "teax-board");
    assert.deepEqual(calls, [["orch-1", "perm-1"]]);
  });

  it("escalates a destructive fleet command instead of allowing it", async () => {
    let called = false;
    const dir = mkdtempSync(join(tmpdir(), "pa-destructive-"));
    const logPath = join(dir, "decisions.jsonl");
    try {
      const result = await adjudicatePermission({
        agent: { id: "worker-1", title: "worker", labels: { category: "worker" }, cwd: WORKSPACE },
        permission: { id: "perm-2", tool: "bash", input: { command: "rm -rf " + "/" } },
        allow: async () => {
          called = true;
          return true;
        },
        logPath,
      });
      assert.equal(result.action, "escalate");
      assert.equal(result.reason, "no safe-pattern match");
      assert.equal(called, false, "destructive command must not reach the allow seam");
      const records = readAdjudicationDecisions({ logPath });
      assert.equal(records.length, 1);
      assert.equal(records[0]!.action, "escalate");
      assert.equal(records[0]!.command, "rm -rf " + "/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("escalates a teax pr merge command instead of allowing it", async () => {
    let called = false;
    const mergeCmd = "teax pr merge 42 -R owner/repo";
    const result = await adjudicatePermission({
      agent: { id: "worker-1", title: "worker", labels: { category: "worker" }, cwd: WORKSPACE },
      permission: { id: "perm-merge", tool: "run_command", input: { command: mergeCmd } },
      allow: async () => {
        called = true;
        return true;
      },
    });
    assert.equal(result.action, "escalate");
    assert.equal(result.reason, "no safe-pattern match");
    assert.equal(called, false, "teax pr merge must not reach the allow seam");
  });

  it("never auto-allows a non-fleet agent even for an allowlisted command", async () => {
    let called = false;
    const result = await adjudicatePermission({
      agent: { id: "adhoc", name: "my scratch session", cwd: WORKSPACE },
      permission: { id: "perm-3", input: { command: "git status" } },
      allow: async () => {
        called = true;
        return true;
      },
    });
    assert.equal(result.action, "escalate");
    assert.equal(result.reason, "non-fleet agent");
    assert.equal(called, false);
  });

  it("escalates when the allow seam is unavailable or the request has no id", async () => {
    const noSeam = await adjudicatePermission({
      agent: { id: "orch-1", labels: { role: "orchestrator" }, cwd: WORKSPACE },
      permission: { id: "perm-4", input: { command: "git status" } },
    });
    assert.equal(noSeam.action, "escalate");
    assert.equal(noSeam.reason, "no allow seam");

    let called = false;
    const noId = await adjudicatePermission({
      agent: { id: "orch-1", labels: { role: "orchestrator" }, cwd: WORKSPACE },
      permission: { input: { command: "git status" } },
      allow: async () => {
        called = true;
        return true;
      },
    });
    assert.equal(noId.action, "escalate");
    assert.equal(noId.reason, "missing permission id");
    assert.equal(called, false);
  });

  it("appends a durable, queryable decision record for every adjudication", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-log-"));
    const logPath = join(dir, "nested", "decisions.jsonl");
    try {
      appendAdjudicationDecision(
        {
          ts: new Date(0).toISOString(),
          action: "auto-allow",
          agentId: "orch-1",
          permissionId: "perm-5",
          tool: "run_command",
          command: "git status",
          ruleId: "read-only-probe",
          reason: "matched read-only-probe",
        },
        { logPath },
      );
      const records = readAdjudicationDecisions({ logPath });
      assert.equal(records.length, 1);
      assert.equal(records[0]!.agentId, "orch-1");
      assert.equal(records[0]!.ruleId, "read-only-probe");
      assert.equal(readAdjudicationDecisions({ logPath: join(dir, "missing.jsonl") }).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
