import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Runs this plugin's `node:test` suite under vitest.
 *
 * The canonical test command is `npm test` (node:test + tsx). Some environments
 * cannot install `tsx` — the npm cache is read-only and the registry is
 * unreachable — which would leave the update/reload guards unverified. This
 * config aliases `node:test` to a small vitest shim so the exact same test files
 * execute without tsx:
 *
 *   npx vitest run --config plugins/plugin-updates/vitest.config.ts
 *
 * It is a compatibility runner, not a second suite: no test logic lives here.
 */
export default defineConfig({
  root: path.resolve(__dirname, "../.."),
  resolve: {
    alias: {
      "node:test": path.resolve(__dirname, "server/__node-test-shim.ts"),
    },
  },
  test: {
    include: [
      "plugins/plugin-updates/shared/updates.test.ts",
      "plugins/plugin-updates/server/updates.test.ts",
      "plugins/plugin-updates/client/orphans.test.ts",
    ],
    testTimeout: 30_000,
  },
});
