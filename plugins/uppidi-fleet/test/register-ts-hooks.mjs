// Registered via `node --import` (see package.json test script): installs the
// TS-extension resolve hooks for the test process. Separate file because a
// hooks module must be registered, not merely imported.
import { register } from "node:module";

import { enforceMainBranchGuard } from "./main-branch-guard.mjs";

// Ensure NODE_ENV is set to "test" so storage is always isolated to tmpdir (#1238)
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

// Fail fast before `node --test` starts: the fleet suites can unlink live
// operator state (#1160), so they must not run from main/master (#1161).
enforceMainBranchGuard();

register("./resolve-ts-hooks.mjs", import.meta.url);
