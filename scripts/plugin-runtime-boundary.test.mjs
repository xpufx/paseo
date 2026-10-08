/**
 * Guard against plugin server runtime boundary violations (#1109).
 *
 * In Paseo 0.9.0+, server plugins are compiled with esbuild under the
 * `paseo-plugin-server-runtime-boundary` plugin. The only modules provided by
 * the server host environment are `@getpaseo/plugin*` and `zod`.
 *
 * Directly importing `@getpaseo/client` (even type-only imports) in server code
 * fails compilation with:
 *   "Could not resolve type dependency '@getpaseo/client' imported by ..."
 * unless the plugin declares and installs `@getpaseo/client` in its own dependencies.
 *
 * Server files that need `PaseoApi` or `PaseoAgentSendOptions` must derive them
 * from `@getpaseo/plugin/server`:
 *   type PaseoApi = PluginHandlerContext["paseo"];
 *   type PaseoAgentSendOptions = NonNullable<Parameters<ReturnType<PaseoApi["agents"]["ref"]>["send"]>[1]>;
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, lstatSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = join(REPO_ROOT, "plugins");

function findSourceFiles(dir, exts = [".ts", ".js", ".tsx", ".jsx", ".mjs"]) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "vendor") continue;
    const full = join(dir, entry);
    const st = lstatSync(full);
    if (st.isDirectory()) {
      files.push(...findSourceFiles(full, exts));
    } else if (st.isFile() && exts.some((e) => entry.endsWith(e))) {
      files.push(full);
    }
  }
  return files;
}

test("no plugin server file imports @getpaseo/client without declared dependency", () => {
  const plugins = readdirSync(PLUGINS_DIR);
  const violations = [];

  for (const pluginName of plugins) {
    const pluginDir = join(PLUGINS_DIR, pluginName);
    const st = lstatSync(pluginDir);
    if (!st.isDirectory() || st.isSymbolicLink()) continue;

    // Check if the plugin explicitly declares @getpaseo/client in its dependencies
    let hasClientDep = false;
    const pkgPath = join(pluginDir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        hasClientDep = Boolean(pkg.dependencies?.["@getpaseo/client"]);
      } catch {}
    }

    const serverSources = [
      ...findSourceFiles(join(pluginDir, "server")),
      join(pluginDir, "index.server.ts"),
    ].filter((f) => existsSync(f));

    for (const file of serverSources) {
      const content = readFileSync(file, "utf8");
      // Check for import statements targeting @getpaseo/client
      const matches = content.match(/from\s+["']@getpaseo\/client(?:[/"'][^"']*)?["']/g);
      if (matches && !hasClientDep) {
        violations.push({
          plugin: pluginName,
          file: file.replace(REPO_ROOT + "/", ""),
          matches,
        });
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found server files importing @getpaseo/client without a declared dependency in package.json:\n` +
      violations.map((v) => `  - ${v.file}: ${v.matches.join(", ")}`).join("\n") +
      `\nDerive PaseoApi from @getpaseo/plugin/server instead.`,
  );
});

test("uppidi-fleet server hook-router derives PaseoApi from @getpaseo/plugin/server", () => {
  const hookRouterPath = join(PLUGINS_DIR, "uppidi-fleet", "server", "hook-router.ts");
  const content = readFileSync(hookRouterPath, "utf8");

  assert.doesNotMatch(
    content,
    /from\s+["']@getpaseo\/client["']/,
    "uppidi-fleet/server/hook-router.ts must not import from @getpaseo/client",
  );
  assert.match(
    content,
    /PluginHandlerContext/,
    "uppidi-fleet/server/hook-router.ts must import PluginHandlerContext from @getpaseo/plugin/server",
  );
  assert.match(
    content,
    /PaseoApi\s*=\s*PluginHandlerContext\["paseo"\]/,
    "uppidi-fleet/server/hook-router.ts must derive PaseoApi from PluginHandlerContext['paseo']",
  );
});

test("Paseo server compiler builds uppidi-fleet without runtime boundary errors", async () => {
  const compilerPath = "/usr/lib/paseo-cli-edge/node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js";
  if (!existsSync(compilerPath)) {
    return; // Skip if local machine does not have paseo edge compiler installed
  }

  const { compilePlugin } = await import(compilerPath);
  const serverEntry = join(PLUGINS_DIR, "uppidi-fleet", "index.server.ts");
  const clientEntry = join(PLUGINS_DIR, "uppidi-fleet", "index.client.tsx");

  const result = await compilePlugin({
    server: serverEntry,
    client: clientEntry,
  });

  assert.ok(result.serverBundle, "serverBundle must be produced");
  assert.ok(result.serverBundle.length > 0, "serverBundle must not be empty");
  assert.ok(result.clientBundle, "clientBundle must be produced");
  assert.ok(result.clientBundle.length > 0, "clientBundle must not be empty");
});
