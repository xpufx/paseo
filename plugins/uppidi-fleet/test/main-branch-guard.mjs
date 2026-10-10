// Fail-fast pre-flight guard for the fleet test suite (#1161).
//
// The suites exercise live-host code paths and can unlink operator state under
// `~/.paseo/plugin-data/xpufx/uppidi-fleet` (#1160), so they must not run from
// the primary `main`/`master` checkout. CI runs in an ephemeral container and
// opts in with `ALLOW_MAIN_TESTS=1`.
//
// Loaded two ways:
//   * `node --import ./test/register-ts-hooks.mjs` (test:node), which calls
//     `enforceMainBranchGuard()` before `node --test` starts.
//   * `node ./test/main-branch-guard.mjs` as the pre-flight for test:tsx.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ALLOW_MAIN_TESTS_ENV = "ALLOW_MAIN_TESTS";
export const BLOCKED_BRANCHES = ["main", "master"];
export const MAIN_BRANCH_MESSAGE =
  "Testing on main branch is disallowed. Run tests inside an isolated worktree branch.";

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * Current branch name, or null when it cannot be determined (outside a git
 * checkout, or a detached HEAD). `rev-parse` is the primary probe; an unborn
 * branch (a fresh repo with no commits) fails it, so `symbolic-ref` backstops
 * that case.
 */
export function resolveCurrentBranch({ cwd = process.cwd() } = {}) {
  try {
    return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd) || null;
  } catch {
    try {
      return git(["symbolic-ref", "--short", "HEAD"], cwd) || null;
    } catch {
      return null;
    }
  }
}

/**
 * Throws when the checkout is main/master and the bypass is unset. Returns
 * `{ branch, bypassed }` otherwise. `branch` may be injected for tests.
 */
export function assertNotOnMainBranch({
  cwd = process.cwd(),
  env = process.env,
  branch = resolveCurrentBranch({ cwd }),
} = {}) {
  if (env[ALLOW_MAIN_TESTS_ENV] === "1") return { branch, bypassed: true };
  if (branch && BLOCKED_BRANCHES.includes(branch)) {
    throw new Error(MAIN_BRANCH_MESSAGE);
  }
  return { branch, bypassed: false };
}

/** CLI/import entrypoint: abort the process with the actionable one-liner. */
export function enforceMainBranchGuard(options) {
  try {
    return assertNotOnMainBranch(options);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

// Only self-execute when run as `node test/main-branch-guard.mjs`, not when
// imported by the regression suite or by register-ts-hooks.mjs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enforceMainBranchGuard();
}
