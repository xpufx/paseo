#!/usr/bin/env node
/**
 * Native npm acquisition smoke test for the published Paseo plugins.
 *
 * This deliberately does not use workspaces or the repository node_modules:
 * every package is packed and installed into a new temporary consumer with
 * --omit=dev and --ignore-scripts, matching the daemon acquisition sequence.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rewrittenPackingManifest } from "./publish-npm.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGES = [
  { id: "demo", manifestId: "paseo-helper-demo", name: "@xpufx/paseo-helper-demo", paseo: ">=0.8.0", runtime: [] },
  { id: "forges", name: "@xpufx/paseo-forges", paseo: ">=0.8.0", runtime: [] },
  { id: "mcp-tools", name: "@xpufx/paseo-mcp-tools", paseo: ">=0.8.0", runtime: [] },
  { id: "plugin-updates", name: "@xpufx/paseo-plugin-updates", paseo: ">=0.8.0", runtime: [] },
  { id: "slash", name: "@xpufx/paseo-slash", paseo: ">=0.8.0", runtime: [] },
  { id: "top", name: "@xpufx/paseo-top", paseo: ">=0.8.0", runtime: [] },
  { id: "twofado", name: "@xpufx/paseo-twofado", paseo: ">=0.8.0", runtime: [] },
  {
    id: "x-comms",
    name: "@xpufx/paseo-x-comms",
    paseo: ">=0.9.0-beta.2",
    runtime: [
      "@getpaseo/client/internal/daemon-client",
      "@getpaseo/plugin/server",
      "@getpaseo/protocol/daemon-endpoints",
      "@modelcontextprotocol/sdk/server/mcp.js",
      "zod",
    ],
  },
];

function fail(message) {
  throw new Error(`[npm-acquisition] ${message}`);
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  if (result.error) fail(`${command} ${args.join(" ")} could not start in ${cwd}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed in ${cwd} (exit ${result.status})\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function pack(plugin, dir) {
  const { manifest, root } = rewrittenPackingManifest({ id: plugin.id, dir: path.join(ROOT, "plugins", plugin.id) });
  try {
    const output = run("npm", ["pack", manifest.dir, "--json", "--pack-destination", dir], ROOT);
    const info = JSON.parse(output)[0];
    return { ...info, tarball: path.join(dir, info.filename) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertPackedContents(info, plugin) {
  const files = new Set(info.files.map(({ path: file }) => file));
  for (const required of ["package.json", "paseo-plugin.json", "README.md", "LICENSE", "index.client.tsx", "index.server.ts", "client", "server", "shared"]) {
    assert([...files].some((file) => file === required || file.startsWith(`${required}/`)), `${plugin.id}: tarball omits ${required}`);
  }
  assert(![...files].some((file) => file.startsWith("node_modules/")), `${plugin.id}: tarball includes node_modules`);
  assert(![...files].some((file) => /\.test\.(ts|tsx|mjs)$/.test(file)), `${plugin.id}: tarball includes test entrypoint`);
  if (plugin.id === "x-comms") assert(files.has("mcp/paseo-x-comms.mjs"), "x-comms: tarball omits MCP runtime");
}

function readManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, "paseo-plugin.json");
  return { manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")) };
}

function runBuildCommands({ id, manifestPath, manifest }, cwd) {
  for (const command of manifest.build ?? []) {
    if (!Array.isArray(command) || command.length === 0 || !command.every((part) => typeof part === "string")) {
      fail(`${id}: invalid build command in ${manifestPath}`);
    }
    const result = spawnSync(command[0], command.slice(1), { cwd, encoding: "utf8" });
    if (result.error || result.status !== 0) {
      const reason = result.error?.message ?? `exit ${result.status}`;
      fail(`${id}: build command ${JSON.stringify(command)} from ${manifestPath} failed: ${reason}\n${result.stderr || result.stdout}`);
    }
  }
}

function assertSafeNpmBuild({ id, manifest }) {
  for (const command of manifest.build ?? []) {
    if (command[0] === "npm" && command[1] === "install") {
      assert(command.includes("--omit=dev"), `${id}: npm build must omit dev dependencies`);
      assert(command.includes("--ignore-scripts"), `${id}: npm build must ignore lifecycle scripts`);
    }
  }
}

function assertRuntimeDependencies(pluginDir, plugin) {
  if (plugin.id !== "x-comms") return;
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));
  assert.equal(pkg.engines?.node, ">=18", "x-comms: package must declare the supported Node floor");
  for (const dependency of ["@getpaseo/plugin", "zod"]) {
    assert(pkg.dependencies?.[dependency], `x-comms: ${dependency} must be a production dependency`);
    assert(!pkg.devDependencies?.[dependency], `x-comms: ${dependency} must not be a development dependency`);
  }
}

function assertVendoredHelperImports(pluginDir, plugin) {
  const stack = ["client", "server", "shared"].map((dir) => path.join(pluginDir, dir));
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        if (entryPath.includes(`${path.sep}vendor${path.sep}paseo-plugin-helper${path.sep}`)) continue;
        const source = fs.readFileSync(entryPath, "utf8");
        assert(!/(["'])paseo-plugin-helper(?:\/|\1)/.test(source), `${plugin.id}: ${path.relative(pluginDir, entryPath)} bypasses its vendored helper`);
      }
    }
  }
}

function assertLifecycleGuard(tmp) {
  const fixture = path.join(tmp, "lifecycle-fixture");
  const consumer = path.join(tmp, "lifecycle-consumer");
  const packed = path.join(tmp, "lifecycle-pack");
  const marker = path.join(tmp, "lifecycle-ran");
  fs.mkdirSync(fixture, { recursive: true });
  fs.mkdirSync(consumer, { recursive: true });
  fs.mkdirSync(packed, { recursive: true });
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "paseo-smoke-lifecycle", version: "1.0.0", scripts: { postinstall: "node -e \"require('node:fs').writeFileSync(process.env.PASEO_SMOKE_MARKER, 'ran')\"" } }));
  fs.writeFileSync(path.join(consumer, "package.json"), '{"name":"consumer","private":true}\n');
  const tarball = JSON.parse(run("npm", ["pack", fixture, "--json", "--pack-destination", packed], tmp))[0].filename;
  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", path.join(packed, tarball)], consumer, { PASEO_SMOKE_MARKER: marker });
  assert(!fs.existsSync(marker), "--ignore-scripts allowed a package lifecycle hook to run");
}

function assertDiagnosticFailure(tmp) {
  const manifestPath = path.join(tmp, "broken-paseo-plugin.json");
  fs.writeFileSync(manifestPath, '{"id":"broken","build":[["node","-e","process.exit(23)"]]}\n');
  let message = "";
  try {
    runBuildCommands({ id: "broken", manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")) }, tmp);
  } catch (error) {
    message = String(error.message);
  }
  assert.match(message, /broken.*broken-paseo-plugin\.json.*exit 23/s, "failed build diagnostic lacks plugin, manifest, or exit status");
}

function smoke(plugin, tmp) {
  const packDir = path.join(tmp, `${plugin.id}-pack`);
  const consumer = path.join(tmp, `${plugin.id}-consumer`);
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(path.join(consumer, "package.json"), '{"name":"paseo-acquisition-consumer","private":true}\n');
  const info = pack(plugin, packDir);
  assertPackedContents(info, plugin);
  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", info.tarball], consumer);
  const pluginDir = path.join(consumer, "node_modules", ...plugin.name.split("/"));
  const { manifestPath, manifest } = readManifest(pluginDir);
  assert.equal(manifest.id, plugin.manifestId ?? plugin.id, `${plugin.id}: installed manifest ID is wrong`);
  assert.equal(manifest.requirements?.paseo, plugin.paseo, `${plugin.id}: Paseo floor is wrong`);
  assertRuntimeDependencies(pluginDir, plugin);
  assertVendoredHelperImports(pluginDir, plugin);
  assert(!fs.existsSync(path.join(pluginDir, "node_modules", "typescript")), `${plugin.id}: dev dependency typescript was installed`);
  assertSafeNpmBuild({ id: plugin.id, manifest });
  for (const specifier of plugin.runtime) {
    run("node", ["--input-type=module", "--eval", `await import(${JSON.stringify(specifier)})`], pluginDir);
  }
  runBuildCommands({ id: plugin.id, manifestPath, manifest }, pluginDir);
  console.log(`ok ${plugin.name}: packed, installed, manifest discovered, runtime resolved, lifecycle guarded`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-npm-acquisition-"));
try {
  assertLifecycleGuard(tmp);
  assertDiagnosticFailure(tmp);
  for (const plugin of PACKAGES) smoke(plugin, tmp);
  console.log("npm acquisition smoke matrix passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
