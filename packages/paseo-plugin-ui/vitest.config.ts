import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    alias: {
      // The real react-native entrypoint ships Flow syntax Vite cannot parse.
      // The shared mock mirrors the one the helper package tests use.
      "react-native": path.resolve(root, "src/__tests__/mocks/react-native.ts"),
    },
  },
});
