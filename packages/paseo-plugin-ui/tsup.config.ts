import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.tsx",
    "tickets/index": "src/tickets/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: true,
  splitting: true,
  treeshake: true,
  target: "es2022",
  external: [
    "@getpaseo/plugin",
    "@getpaseo/plugin/client",
    "@getpaseo/plugin/client/react-native",
    "react",
    "react-native",
  ],
});
