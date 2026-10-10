// Regression tests for the main-branch test guard (#1161).
//
// The guard exists so a bare-metal fleet test run cannot unlink live operator
// state from the primary checkout (#1160). It is a process-level abort, so
// these tests spawn the real CLI module in throwaway git repositories rather
// than re-implementing the branch lookup. A bypass test pins CI's escape hatch
// so it cannot silently start blocking `ALLOW_MAIN_TESTS=1` runs on main.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOW_MAIN_TESTS_ENV,
  MAIN_BRANCH_MESSAGE,
  assertNotOnMainBranch,
  resolveCurrentBranch,
} from "./main-branch-guard.mjs";

const GUARD = fileURLToPath(new URL("./main-branch-guard.mjs", import.meta.url));

function withTempRepos(fn) {
  const root = mkdtempSync(join(tmpdir(), "fleet-main-guard-"));
  const make = (name, branch) => {
    const dir = join(root, name);
    mkdirSync(dir);
    const init = spawnSync("git", ["init", "-q", "-b", branch], { cwd: dir, encoding: "utf8" });
    assert.equal(init.status, 0, `git init -b ${branch} failed: ${init.stderr}`);
    return dir;
  };
  try {
    mkdirSync(join(root, "plain"));
    return fn({ make, plain: join(root, "plain") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runGuard({ cwd, env = {} }) {
  return spawnSync(process.execPath, [GUARD], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("resolveCurrentBranch reads the current branch and rejects non-repos", () => {
  withTempRepos(({ make, plain }) => {
    assert.equal(resolveCurrentBranch({ cwd: make("feat", "feat/1161-guard") }), "feat/1161-guard");
    assert.equal(resolveCurrentBranch({ cwd: make("main", "main") }), "main");
    assert.equal(resolveCurrentBranch({ cwd: plain }), null);
  });
});

test("assertNotOnMainBranch allows non-blocked branches", () => {
  assert.deepEqual(assertNotOnMainBranch({ branch: "feat/1161-guard" }), {
    branch: "feat/1161-guard",
    bypassed: false,
  });
  assert.deepEqual(assertNotOnMainBranch({ branch: null }), { branch: null, bypassed: false });
});

test("assertNotOnMainBranch throws the actionable message on main and master", () => {
  for (const branch of ["main", "master"]) {
    assert.throws(() => assertNotOnMainBranch({ branch }), { message: MAIN_BRANCH_MESSAGE });
  }
});

test("assertNotOnMainBranch honours the ALLOW_MAIN_TESTS bypass", () => {
  assert.deepEqual(assertNotOnMainBranch({ branch: "main", env: { [ALLOW_MAIN_TESTS_ENV]: "1" } }), {
    branch: "main",
    bypassed: true,
  });
});

test("CLI aborts on main with a non-zero exit and the exact message", () => {
  withTempRepos(({ make }) => {
    const result = runGuard({ cwd: make("main", "main") });
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.trim(), MAIN_BRANCH_MESSAGE);
  });
});

test("CLI aborts on master too", () => {
  withTempRepos(({ make }) => {
    const result = runGuard({ cwd: make("master", "master") });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Testing on main branch is disallowed/);
  });
});

test("CLI bypasses main under ALLOW_MAIN_TESTS=1", () => {
  withTempRepos(({ make }) => {
    const result = runGuard({
      cwd: make("main-bypass", "main"),
      env: { [ALLOW_MAIN_TESTS_ENV]: "1" },
    });
    assert.equal(result.status, 0, result.stderr);
  });
});

test("CLI proceeds on a non-main branch and outside a git checkout", () => {
  withTempRepos(({ make, plain }) => {
    assert.equal(runGuard({ cwd: make("feat", "feat/1161-guard") }).status, 0);
    assert.equal(runGuard({ cwd: plain }).status, 0);
  });
});

test("guard module is wired into the node --test entrypoint", () => {
  // The guard must run before `node --test`, so register-ts-hooks.mjs (loaded
  // via --import) has to import it. Pin that wiring rather than trusting it.
  const hooks = readFileSync(new URL("./register-ts-hooks.mjs", import.meta.url), "utf8");
  assert.match(hooks, /import \{ enforceMainBranchGuard \} from "\.\/main-branch-guard\.mjs"/);
  assert.match(hooks, /enforceMainBranchGuard\(\)/);
});
