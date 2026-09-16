#!/usr/bin/env node
// Per-plugin bundle-size measurement for the paseo-plugin-helper tree-shaking /
// minify hardening (issue #126).
//
// Host parity: mirrors compileTarget() in
//   @getpaseo/server .../plugins/compiler.js
// which is exactly what the daemon runs when it loads or installs a plugin:
//   bundle:true, format:"cjs", jsx:"automatic",
//   platform: server -> "node" / client -> "neutral",
//   target:   server -> "node20" / client -> "es2020",
//   supported: client -> {"async-await": false},
//   external: SDK specifiers (+ react et al for client, + zod for server),
//   treeShaking:true, metafile:true, write:false -- and NO minify.
//
// Two views are reported:
//   1. "as-loaded": natural module resolution. Every plugin vendors helper
//      source into `<plugin>/{client,server}/vendor/paseo-plugin-helper/` and
//      the daemon bundles that source.
//   2. "helper-dist": every plugin's helper imports are redirected to a built
//      helper dist so the build variants can be compared per plugin --
//      before = pre-#126 config (minify:false, treeshake:true), after = current
//      dist (minify:true, treeshake:true, sideEffects:false). For the vendored
//      plugins this is a projection.
//
// Usage:
//   node scripts/measure-plugin-bundles.mjs                 # markdown report
//   node scripts/measure-plugin-bundles.mjs --modules       # + surviving helper modules
//   node scripts/measure-plugin-bundles.mjs --json
//   HELPER_BEFORE_DIR=/tmp/x node scripts/measure-plugin-bundles.mjs   # reuse a "before" build
//
// Nothing under packages/paseo-plugin-helper/ is modified: the "before" helper
// is always built into a temp dir.

import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER_DIR = path.join(ROOT, "packages", "paseo-plugin-helper");
const PLUGINS = ["demo", "forges", "mcp-tools", "plugin-updates", "slash", "top", "twofado", "x-comms"];

const SDK_SPECIFIERS = [
  "@getpaseo/plugin",
  "@getpaseo/plugin/server",
  "@getpaseo/plugin/server/provider",
  "@getpaseo/plugin/server/acp",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@getpaseo/plugin/client/react-native",
];
const CLIENT_EXTERNAL = [...SDK_SPECIFIERS, "@tanstack/react-query", "react", "react/jsx-runtime", "react-native", "zod"];
const SERVER_EXTERNAL = [...SDK_SPECIFIERS, "zod"];

const HELPER_ENTRY = {
  index: "src/index.ts",
  "client/index": "src/client/index.ts",
  "server/index": "src/server/index.ts",
  "mcp/index": "src/mcp/index.ts",
  "shared/index": "src/shared/index.ts",
  "testing/index": "src/testing/index.ts",
  cli: "src/cli/index.ts",
};

function absoluteHelperEntry() {
  const out = {};
  for (const [name, rel] of Object.entries(HELPER_ENTRY)) out[name] = path.join(HELPER_DIR, rel);
  return out;
}

function entryPath(plugin, target) {
  const tsx = path.join(ROOT, "plugins", plugin, `index.${target}.tsx`);
  return fs.existsSync(tsx) ? tsx : path.join(ROOT, "plugins", plugin, `index.${target}.ts`);
}

// How a plugin obtains the helper: vendored source copies, or the package dist.
function helperConsumption(plugin) {
  for (const tree of ["client", "server"]) {
    if (fs.existsSync(path.join(ROOT, "plugins", plugin, tree, "vendor", "paseo-plugin-helper"))) return "vendored source";
  }
  return "package dist";
}

async function bundlePlugin(plugin, target, opts = {}) {
  const result = await build({
    entryPoints: [entryPath(plugin, target)],
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    platform: target === "server" ? "node" : "neutral",
    target: target === "server" ? "node20" : "es2020",
    supported: target === "client" ? { "async-await": false } : undefined,
    external: target === "client" ? CLIENT_EXTERNAL : SERVER_EXTERNAL,
    alias: opts.alias,
    plugins: opts.plugins,
    metafile: true,
    logLevel: "silent",
    treeShaking: true,
    write: false,
  });
  const inputs = outputInputs(result.metafile);
  return {
    bytes: Buffer.byteLength(result.outputFiles[0].text, "utf8"),
    helperBytes: helperBytesInOutput(inputs),
    helperModules: helperModulesInOutput(inputs),
  };
}

// esbuild reports per-input output bytes under metafile.outputs[file].inputs.
function outputInputs(metafile) {
  const merged = {};
  for (const output of Object.values(metafile.outputs)) {
    for (const [file, meta] of Object.entries(output.inputs)) {
      merged[file] = (merged[file] || 0) + (meta.bytesInOutput || 0);
    }
  }
  return merged;
}

// Vendored source (`.../vendor/paseo-plugin-helper/...`), npm-installed
// (`node_modules/paseo-plugin-helper/...`) and the workspace package
// (`packages/paseo-plugin-helper/...`) all satisfy this.
function isHelperInput(file) {
  return file.includes("paseo-plugin-helper/");
}

function helperBytesInOutput(inputs) {
  let total = 0;
  for (const [file, bytes] of Object.entries(inputs)) {
    if (isHelperInput(file)) total += bytes;
  }
  return total;
}

function helperModulesInOutput(inputs) {
  const modules = [];
  for (const [file, bytes] of Object.entries(inputs)) {
    if (!isHelperInput(file) || bytes === 0) continue;
    const short = file.replace(/^.*paseo-plugin-helper\//, "").replace(/^dist\/?/, "dist:");
    modules.push({ file: short, bytes });
  }
  modules.sort((a, b) => b.bytes - a.bytes);
  return modules;
}

// Redirect every helper import (bare package or vendored relative path) to a
// built helper dist tree, so helper build variants can be compared.
function helperSubstitution(helperDist) {
  const distEntry = (abs) => {
    const marker = "/vendor/paseo-plugin-helper/";
    const tail = abs.slice(abs.indexOf(marker) + marker.length);
    if (abs.includes("/client/vendor/paseo-plugin-helper/")) return "client/index.js";
    if (abs.includes("/server/vendor/paseo-plugin-helper/")) return tail.startsWith("mcp") ? "mcp/index.js" : "server/index.js";
    if (abs.includes("/shared/vendor/paseo-plugin-helper/")) return tail.startsWith("mcp") ? "mcp/index.js" : "shared/index.js";
    return "shared/index.js";
  };
  return {
    name: "helper-substitution",
    setup(b) {
      b.onResolve({ filter: /vendor\/paseo-plugin-helper\// }, (args) => {
        if (!args.path.startsWith(".") && !path.isAbsolute(args.path)) return;
        const abs = path.resolve(args.resolveDir, args.path);
        if (!abs.includes("/vendor/paseo-plugin-helper/")) return;
        return { path: path.join(helperDist, distEntry(abs)) };
      });
    },
  };
}

function packageAlias(helperDist) {
  const alias = {};
  for (const key of ["", "/client", "/server", "/shared", "/mcp", "/testing"]) {
    alias[`paseo-plugin-helper${key}`] = path.join(helperDist, key === "" ? "index.js" : `${key.slice(1)}/index.js`);
  }
  return alias;
}

async function buildHelperVariant(outDir, { minify, treeshake }) {
  const { build: tsupBuild } = await import("tsup");
  await tsupBuild({
    cwd: HELPER_DIR,
    entry: absoluteHelperEntry(),
    format: ["esm", "cjs"],
    dts: false,
    clean: true,
    silent: true,
    sourcemap: false,
    minify,
    splitting: false,
    treeshake,
    target: "es2022",
    outDir,
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
}

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function measure() {
  const beforeDir = process.env.HELPER_BEFORE_DIR || (await fs.promises.mkdtemp(path.join(os.tmpdir(), "paseo-helper-before-")));
  const beforeDist = path.join(beforeDir, "dist");
  if (!process.env.HELPER_BEFORE_DIR) {
    // Pre-#126 config: minify absent (false), treeshake already true.
    await buildHelperVariant(beforeDist, { minify: false, treeshake: true });
  }
  const afterDist = path.join(HELPER_DIR, "dist");

  const rows = [];
  for (const plugin of PLUGINS) {
    const row = { plugin, consumption: helperConsumption(plugin) };
    for (const target of ["client", "server"]) row[target] = await bundlePlugin(plugin, target);
    row.total = row.client.bytes + row.server.bytes;
    row.helperTotal = row.client.helperBytes + row.server.helperBytes;
    rows.push(row);
  }

  const packageRows = [];
  for (const plugin of PLUGINS) {
    const row = { plugin, consumption: helperConsumption(plugin) };
    for (const target of ["client", "server"]) {
      const after = await bundlePlugin(plugin, target, {
        alias: packageAlias(afterDist),
        plugins: [helperSubstitution(afterDist)],
      });
      const before = await bundlePlugin(plugin, target, {
        alias: packageAlias(beforeDist),
        plugins: [helperSubstitution(beforeDist)],
      });
      row[target] = { before: before.bytes, after: after.bytes };
    }
    row.totalBefore = row.client.before + row.server.before;
    row.totalAfter = row.client.after + row.server.after;
    packageRows.push(row);
  }

  return { rows, packageRows, beforeDir, sha: gitSha() };
}

function fmt(bytes) {
  return bytes.toLocaleString("en-US");
}

function pct(part, whole) {
  return whole ? `${((part / whole) * 100).toFixed(1)}%` : "0%";
}

function markdown({ rows, packageRows, beforeDir, sha }) {
  const lines = [];
  lines.push(`## 1. As-loaded plugin bundles (host-parity esbuild), source @ ${sha}`);
  lines.push("");
  lines.push("| plugin | helper in bundle | client B | server B | total B | helper B | helper % |");
  lines.push("|---|---|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    lines.push(
      `| ${r.plugin} | ${r.consumption} | ${fmt(r.client.bytes)} | ${fmt(r.server.bytes)} | ${fmt(r.total)} | ${fmt(r.helperTotal)} | ${pct(r.helperTotal, r.total)} |`
    );
  }
  lines.push("");
  lines.push("## 2. Helper #126 before -> after, per plugin (helper resolved as the built dist)");
  lines.push("");
  lines.push("| plugin | helper path | client before | client after | server before | server after | total before | total after | delta | Δ% |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of packageRows) {
    const delta = r.totalBefore - r.totalAfter;
    lines.push(
      `| ${r.plugin} | ${r.consumption} | ${fmt(r.client.before)} | ${fmt(r.client.after)} | ${fmt(r.server.before)} | ${fmt(r.server.after)} | ${fmt(r.totalBefore)} | ${fmt(r.totalAfter)} | ${fmt(delta)} | ${pct(delta, r.totalBefore)} |`
    );
  }
  lines.push("");
  lines.push(`before helper dist: \`${beforeDir}\``);
  return lines.join("\n");
}

const { rows, packageRows, beforeDir, sha } = await measure();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ sha, rows, packageRows, beforeDir }, null, 2));
} else {
  console.log(markdown({ rows, packageRows, beforeDir, sha }));
  if (process.argv.includes("--modules")) {
    console.log("\n## 3. Helper modules surviving tree-shaking in as-loaded bundles\n");
    for (const r of rows) {
      console.log(`### ${r.plugin} (${r.consumption})`);
      for (const [target, list] of [["client", r.client.helperModules], ["server", r.server.helperModules]]) {
        for (const m of list.slice(0, 15)) console.log(`${String(m.bytes).padStart(7)}  ${target}  ${m.file}`);
      }
      console.log("");
    }
  }
}
