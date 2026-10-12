import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "client/index": "src/client/index.ts",
    "shared/index": "src/shared/index.ts",
    "server/index": "src/server/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  treeshake: true,
  target: "es2022",
  external: [
    "zod",
    "node:fs",
    "node:fs/promises",
    "node:path",
    "node:os",
    "node:http",
    "node:https",
    "node:crypto",
    "node:child_process",
    "node:util",
  ],
});
