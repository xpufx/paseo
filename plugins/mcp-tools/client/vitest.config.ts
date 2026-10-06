import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// This file sits under `client/` so the published plugin root keeps only the
// `client/`, `server/`, and `shared/` trees the v0.8 compiler accepts (the UI
// conformance audit rejects a code module at the plugin root). The test root is
// still the plugin directory so the suites resolve across client/server/shared.
const root = path.resolve(here, "..");
const helperSrc = path.resolve(root, "..", "..", "packages", "paseo-plugin-helper", "src");

/**
 * Single vitest runner for the mcp-tools plugin.
 *
 * `react-native` aliases to a local stub because the real entrypoint carries
 * Flow syntax Vite cannot parse. `paseo-plugin-helper/core` and `/lifecycle`
 * alias to the helper *source* instead of the published `dist`: the lifecycle
 * registrars and headless hooks resolve host dependencies through the shared
 * `client/host` module, and each published entry is a separate bundle with its
 * own host state. A test that called `initClientHelpers` from the core bundle
 * would never reach the lifecycle bundle's copy, so `registerComposerPill`
 * would throw "used before initClientHelpers". Aliasing to source gives tests
 * the same single host instance the esbuild-bundled plugin has in production.
 */
export default defineConfig({
  root,
  resolve: {
    alias: {
      "react-native": path.resolve(root, "client/test-utils/react-native.ts"),
      "paseo-plugin-helper/core": path.resolve(helperSrc, "core/index.ts"),
      "paseo-plugin-helper/lifecycle": path.resolve(helperSrc, "lifecycle/index.ts"),
    },
  },
  test: {
    include: [
      "client/**/*.test.ts",
      "client/**/*.test.tsx",
      "client/**/*.test.mjs",
      "server/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
    testTimeout: 30_000,
  },
});
