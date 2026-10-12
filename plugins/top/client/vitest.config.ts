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
 *
 * `paseo-plugin-helper/core` and `paseo-plugin-helper/lifecycle` alias to the
 * helper *source* instead: the helper's lifecycle registrars and headless hooks
 * resolve host dependencies (`getClientHost`, `initClientHelpers`) through the
 * shared `client/host` module, and the published `dist` builds each entry as a
 * separate bundle with its own host state. A test that calls `initClientHelpers`
 * from the core entry would never reach a separate lifecycle bundle's copy, so
 * surfaces would throw "used before initClientHelpers". Aliasing to source gives
 * tests the same single host instance the esbuild-bundled plugin has in
 * production.
 */
export default defineConfig({
  root,
  resolve: {
    alias: {
      "node:test": path.resolve(root, "server/__node-test-shim.ts"),
      "react-native": path.resolve(root, "client/test-utils/react-native.ts"),
      "paseo-plugin-helper/core": path.resolve(
        root,
        "../../packages/paseo-plugin-helper/src/core/index.ts",
      ),
      "paseo-plugin-helper/shared": path.resolve(
        root,
        "../../packages/paseo-plugin-helper/src/shared/index.ts",
      ),
      "paseo-plugin-helper/lifecycle": path.resolve(
        root,
        "../../packages/paseo-plugin-helper/src/lifecycle/index.ts",
      ),
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
