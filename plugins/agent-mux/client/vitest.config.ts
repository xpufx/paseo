import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const helperSrc = path.resolve(root, "..", "..", "packages", "paseo-plugin-helper", "src");
const pluginUiSrc = path.resolve(root, "..", "..", "packages", "paseo-plugin-ui", "src");

export default defineConfig({
  root,
  resolve: {
    alias: {
      "react-native": path.resolve(root, "client/test-utils/react-native.ts"),
      "paseo-plugin-helper/core": path.resolve(helperSrc, "core/index.ts"),
      "paseo-plugin-helper/lifecycle": path.resolve(helperSrc, "lifecycle/index.ts"),
      "paseo-plugin-helper/shared": path.resolve(helperSrc, "shared/index.ts"),
      "@xpufx/paseo-plugin-ui": path.resolve(pluginUiSrc, "index.tsx"),
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
