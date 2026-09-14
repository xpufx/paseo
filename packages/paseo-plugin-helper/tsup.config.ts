import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "client/index": "src/client/index.ts",
    "server/index": "src/server/index.ts",
    "mcp/index": "src/mcp/index.ts",
    "shared/index": "src/shared/index.ts",
    "testing/index": "src/testing/index.ts",
    cli: "src/cli/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  external: [
    "@getpaseo/plugin",
    "@getpaseo/plugin/client",
    "@getpaseo/plugin/client/react-native",
    "@getpaseo/plugin/server",
    "@getpaseo/client",
    "@tanstack/react-query",
    "react",
    "react-native",
    "zod",
  ],
});
