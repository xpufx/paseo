// Registered via `node --import` (see package.json test script): installs the
// TS-extension resolve hooks for the test process. Separate file because a
// hooks module must be registered, not merely imported.
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

import { enforceMainBranchGuard } from "./main-branch-guard.mjs";

// Ensure NODE_ENV is set to "test" so storage is always isolated to tmpdir (#1238)
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

// Ensure PASEO_HOME is anchored in tmpdir during test runs to prevent unisolated file operations (#1238)
if (!process.env.PASEO_HOME) {
  process.env.PASEO_HOME = path.join(os.tmpdir(), `paseo-test-home-${process.pid}`);
}

// Ensure HOME and REAL_HOME are anchored to PASEO_HOME during test runs to hermetically
// isolate resolveHostHome(), legacy role-models config probing, and user config (#955)
process.env.HOME = process.env.PASEO_HOME;
process.env.REAL_HOME = process.env.PASEO_HOME;

// Fail fast before `node --test` starts: the fleet suites can unlink live
// operator state (#1160), so they must not run from main/master (#1161).
enforceMainBranchGuard();

register("./resolve-ts-hooks.mjs", import.meta.url);
