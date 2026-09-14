import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    alias: {
      "react-native": path.resolve(root, "src/__tests__/mocks/react-native.ts"),
    },
  },
});
