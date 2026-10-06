import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../bin/fleet-ensure-orchestrator.mjs");

describe("bin/fleet-ensure-orchestrator.mjs CLI (#793)", () => {
  test("--help displays usage and exits 0", async () => {
    const { stdout } = await execFileAsync("node", [cliPath, "--help"]);
    assert.match(stdout, /Usage: fleet-ensure-orchestrator/);
    assert.match(stdout, /--repo/);
    assert.match(stdout, /--mode/);
    assert.match(stdout, /--provider/);
  });

  test("--help documents the unattended pre-grant and advertises no --auto-accept flag (#974)", async () => {
    const { stdout } = await execFileAsync("node", [cliPath, "--help"]);
    assert.match(stdout, /auto_accept/);
    assert.match(stdout, /no\s+auto-accept\/feature flag/);
    assert.doesNotMatch(
      stdout,
      /--auto-accept/,
      "paseo run exposes no auto-accept flag; the CLI must not offer one",
    );
  });

  test("missing repo exits with error", async () => {
    await assert.rejects(
      async () => {
        await execFileAsync("node", [cliPath]);
      },
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /repository is required/);
        return true;
      },
    );
  });
});
