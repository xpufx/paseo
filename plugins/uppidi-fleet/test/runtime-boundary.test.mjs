import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const hookRouterPath = path.join(pluginDir, "server", "hook-router.ts");

describe("uppidi-fleet server runtime boundary compliance", () => {
  test("hook-router.ts does not import @getpaseo/client directly", () => {
    const content = fs.readFileSync(hookRouterPath, "utf8");
    assert.doesNotMatch(
      content,
      /from\s+["']@getpaseo\/client["']/,
      "Must not import from @getpaseo/client across plugin server runtime boundary",
    );
  });

  test("hook-router.ts derives PaseoApi from @getpaseo/plugin/server", () => {
    const content = fs.readFileSync(hookRouterPath, "utf8");
    assert.match(
      content,
      /import type\s*\{[^}]*PluginHandlerContext[^}]*\}\s*from\s*["']@getpaseo\/plugin\/server["']/,
      "Must import PluginHandlerContext from @getpaseo/plugin/server",
    );
    assert.match(
      content,
      /export type PaseoApi = PluginHandlerContext\["paseo"\]/,
      "Must derive PaseoApi from PluginHandlerContext['paseo']",
    );
    assert.match(
      content,
      /export type PaseoAgentSendOptions = NonNullable<Parameters<PaseoAgentHandle\["send"\]>\[1\]>/,
      "Must derive PaseoAgentSendOptions from PaseoAgentHandle['send'] parameter",
    );
  });

  test("esbuild compiles uppidi-fleet server bundle cleanly when edge compiler exists", async () => {
    const compilerPath = "/usr/lib/paseo-cli-edge/node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js";
    if (!fs.existsSync(compilerPath)) return;

    const { compilePlugin } = await import(compilerPath);
    const result = await compilePlugin({
      server: path.join(pluginDir, "index.server.ts"),
      client: path.join(pluginDir, "index.client.tsx"),
    });

    assert.ok(result.serverBundle, "server bundle compiled");
    assert.ok(result.serverBundle.length > 0, "server bundle is non-empty");
  });
});
