import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  handleUppidiIssues,
  handleUppidiTransitionIssue,
  setIssueCommandRunnerForTest,
} from "./issues.js";
import { setFetchForTest, setTokenResolverForTest } from "./forgejo-api.js";

interface JsonLike {
  json: () => Promise<unknown>;
}

function jsonResponse(body: unknown): JsonLike {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as unknown as JsonLike;
}

/**
 * #724: without the repo in the RPC input the issues read silently resolved to
 * a default repository, so every non-default entry in the dashboard's repo
 * dropdown filtered a list the server had never served.
 */
describe("issues read resolves the requested repository (#724)", () => {
  afterEach(() => {
    setFetchForTest(null);
    setTokenResolverForTest(null);
    delete process.env.FORGEJO_HOST;
  });

  it("fetches the non-default repo the caller named, not the default", async () => {
    const paths: string[] = [];
    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async (input: string) => {
      paths.push(String(input).replace(/^https?:\/\/[^/]+/, ""));
      return jsonResponse([
        {
          number: 5001,
          title: "non-default repo issue",
          state: "open",
          html_url: "https://forge.example/xpufx-org/2fado/issues/5001",
          updated_at: "2026-09-25T10:00:00Z",
          labels: [],
        },
      ]);
    });

    const res = await handleUppidiIssues({ state: "open", repo: "xpufx-org/2fado" });
    assert.deepEqual(
      paths,
      ["/api/v1/repos/xpufx-org/2fado/issues?state=open&limit=50"],
      "the request must target the repo the caller named",
    );
    assert.equal(res.repo, "forge.mrs.uppidi.com/xpufx-org/2fado");
    assert.equal(res.ok, true);
    assert.equal(res.issues[0]?.repo, "forge.mrs.uppidi.com/xpufx-org/2fado");
  });

  it("defaults to the plugin's default repo only when no repo was passed", async () => {
    const paths: string[] = [];
    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async (input: string) => {
      paths.push(String(input).replace(/^https?:\/\/[^/]+/, ""));
      return jsonResponse([]);
    });

    const res = await handleUppidiIssues({ state: "open" });
    assert.equal(paths[0], "/api/v1/repos/xpufx-org/paseo/issues?state=open&limit=50");
    assert.equal(res.repo, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.deepEqual(res.issues, []);
  });

  it("rejects an unresolvable bare repo name instead of scoping it to a default (#888)", async () => {
    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async () => {
      throw new Error("must not hit the forge API for an unknown repo");
    });

    const res = await handleUppidiIssues({ state: "open", repo: "agent-mux" });
    assert.equal(res.ok, false);
    assert.equal(res.repo, null);
    assert.match(String(res.error ?? ""), /Unknown repository: agent-mux/);
  });

  it("surfaces an HTTP rejection as ok:false with the error, not as a blank list", async () => {
    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ message: "token does not have required scope" }),
    }));

    const res = await handleUppidiIssues({ state: "open", repo: "xpufx-org/2fado" });
    assert.equal(res.ok, false);
    assert.equal(res.issues.length, 0);
    assert.match(String(res.error ?? ""), /403/);
    assert.match(String(res.error ?? ""), /scope/);
  });
});

describe("issue state transition (#755)", () => {
  afterEach(() => {
    setIssueCommandRunnerForTest(null);
  });

  it("transitions an issue to in_progress by adding state/wip and removing other state labels", async () => {
    const executedCommands: string[][] = [];
    setIssueCommandRunnerForTest(async (args) => {
      executedCommands.push(args);
      return { code: 0, stdout: "ok", stderr: "" };
    });

    const res = await handleUppidiTransitionIssue({
      number: 755,
      targetState: "in_progress",
      repo: "xpufx-org/paseo",
    });

    assert.equal(res.ok, true);
    assert.equal(res.appliedLabel, "state/wip");
    assert.equal(res.targetState, "in_progress");

    // Must have reopened and edited labels
    assert.ok(executedCommands.length >= 2, "must execute reopen and edit commands");
    const reopenCmd = executedCommands[0];
    assert.deepEqual(reopenCmd.slice(0, 3), ["issue", "reopen", "755"]);

    const editCmd = executedCommands[1];
    assert.deepEqual(editCmd.slice(0, 3), ["issue", "edit", "755"]);
    assert.ok(editCmd.includes("--add-label") && editCmd.includes("state/wip"));
    assert.ok(editCmd.includes("--remove-label") && editCmd.includes("state/triage"));
    assert.ok(editCmd.includes("--remove-label") && editCmd.includes("state/done"));
    // Legacy numeric state labels are still cleared during the migration.
    assert.ok(editCmd.includes("state/0-triage") && editCmd.includes("state/4-done"));
  });

  it("transitions an issue to done by adding state/done and closing the issue", async () => {
    const executedCommands: string[][] = [];
    setIssueCommandRunnerForTest(async (args) => {
      executedCommands.push(args);
      return { code: 0, stdout: "ok", stderr: "" };
    });

    const res = await handleUppidiTransitionIssue({
      number: 755,
      targetState: "done",
      repo: "xpufx-org/paseo",
    });

    assert.equal(res.ok, true);
    assert.equal(res.appliedLabel, "state/done");
    assert.equal(res.targetState, "done");

    // Must have edited labels and closed
    assert.ok(executedCommands.length >= 2, "must execute edit and close commands");
    const editCmd = executedCommands[0];
    assert.deepEqual(editCmd.slice(0, 3), ["issue", "edit", "755"]);
    assert.ok(editCmd.includes("--add-label") && editCmd.includes("state/done"));

    const closeCmd = executedCommands[1];
    assert.deepEqual(closeCmd.slice(0, 3), ["issue", "close", "755"]);
  });

  it("handles CLI error gracefully and returns ok: false with error details", async () => {
    setIssueCommandRunnerForTest(async () => {
      throw new Error("teax command failed: connection refused");
    });

    const res = await handleUppidiTransitionIssue({
      number: 755,
      targetState: "review",
      repo: "xpufx-org/paseo",
    });

    assert.equal(res.ok, false);
    assert.match(String(res.error ?? ""), /connection refused/);
  });
});
