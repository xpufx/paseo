// Registered via `node --import` (see package.json test script): installs the
// TS-extension resolve hooks for the test process. Separate file because a
// hooks module must be registered, not merely imported.
import { register } from "node:module";

register("./resolve-ts-hooks.mjs", import.meta.url);
