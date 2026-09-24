import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// This file sits under `client/` so the published plugin root keeps only the
// `client/`, `server/`, and `shared/` trees the v0.8 compiler accepts (the UI
// conformance audit rejects a code module at the plugin root). The test root is
// still the plugin directory so the `node:test` suites and JSX tests resolve
// across client/server/shared.
const root = path.resolve(here, "..");

/**
 * Single vitest runner for the top plugin.
 *
 * The existing `node:test` suites run unchanged through a small `node:test`
 * shim alias, and the JSX regression tests render the real pill path against a
 * stubbed React Native. The helper resolves through the workspace link to its
 * built `dist`, so tests exercise the same helper bundle the plugin ships.
 */
export default defineConfig({
  root,
  resolve: {
    alias: {
      "node:test": path.resolve(root, "server/__node-test-shim.ts"),
      "react-native": path.resolve(root, "client/test-utils/react-native.ts"),
    },
  },
  test: {
    include: [
      "client/**/*.test.ts",
      "client/**/*.test.tsx",
      "server/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
    testTimeout: 30_000,
  },
});
