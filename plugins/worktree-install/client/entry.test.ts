import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { builtinModules, createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Dependency-resolution contract.
 *
 * `uppidi-fleet` imports the bare specifier `paseo-plugin-helper/client`,
 * declares no dependency on it, and resolves it only through a tsconfig `paths`
 * alias to `../../packages/paseo-plugin-helper/src`. Nothing about that
 * arrangement holds up once the plugin is installed somewhere other than this
 * monorepo, and CI cannot catch it (see #630).
 *
 * This plugin is built so the question cannot arise: it imports the shared
 * helper nowhere, so there is no vendored copy to keep in sync and no alias to
 * rely on. These tests make that a checked property rather than a claim —
 * including resolution from the plugin directory alone, with no tsconfig.
 */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(PLUGIN_ROOT, "package.json"));

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/** `node:` always means a builtin, even where `builtinModules` omits the name. */
const isBuiltin = (specifier: string): boolean =>
  specifier.startsWith("node:") || BUILTINS.has(specifier);

/**
 * Strips comments so a prose sentence containing the word "from" followed by a
 * quoted word is not mistaken for an import specifier.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function pluginFiles(dir = PLUGIN_ROOT, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "vendor" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) pluginFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCES = pluginFiles();

/** Every import/require specifier in the plugin, external ones only. */
function externalSpecifiers(): string[] {
  const found = new Set<string>();
  for (const file of SOURCES) {
    const source = codeOnly(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      // Relative paths stay inside the plugin; they need no resolution check.
      if (specifier.startsWith(".")) continue;
      found.add(specifier);
    }
  }
  return [...found].sort();
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

describe("dependency resolution", () => {
  it("ships source files to check", () => {
    assert.ok(SOURCES.length > 10, `only found ${SOURCES.length} source files`);
  });

  it("does not import the shared plugin helper anywhere", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const source = codeOnly(readFileSync(file, "utf8"));
      if (/(?:from|import|require)\s*\(?\s*["'][^"']*paseo-plugin-helper/.test(source)) {
        offenders.push(path.relative(PLUGIN_ROOT, file));
      }
    }
    assert.deepEqual(offenders, [], "the plugin must not depend on paseo-plugin-helper");
  });

  it("needs no vendored helper tree and no tsconfig path alias", () => {
    const vendored: string[] = [];
    const collect = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const full = path.join(dir, entry);
        if (!statSync(full).isDirectory()) continue;
        if (entry === "vendor") vendored.push(path.relative(PLUGIN_ROOT, full));
        collect(full);
      }
    };
    collect(PLUGIN_ROOT);
    assert.deepEqual(vendored, [], "nothing needs vendoring; there is no bare helper specifier");

    const tsconfig = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, "tsconfig.json"), "utf8"));
    assert.equal(tsconfig.compilerOptions?.paths, undefined, "no path aliases to drift");
  });

  it("declares every package it imports", () => {
    const pkg = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf8"));
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    const undeclared = externalSpecifiers()
      .filter((s) => !isBuiltin(s))
      .map(packageNameOf)
      .filter((name) => !declared.has(name));
    assert.deepEqual([...new Set(undeclared)], []);
  });

  it("resolves every import from the plugin directory, with no tsconfig involved", () => {
    const unresolved: string[] = [];
    for (const specifier of externalSpecifiers()) {
      if (isBuiltin(specifier)) continue;
      try {
        require.resolve(specifier);
      } catch {
        unresolved.push(specifier);
      }
    }
    assert.deepEqual(unresolved, [], "these would fail at install time");
  });

  it("keeps every relative import inside the plugin directory", () => {
    // A relative import that realpaths outside the plugin is what Paseo's
    // compiler rejects, and what a vendored-tree symlink used to do.
    const escapes: string[] = [];
    for (const file of SOURCES) {
      const source = codeOnly(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/from\s*["'](\.[^"']+)["']/g)) {
        const resolved = path.resolve(path.dirname(file), match[1]!);
        if (path.relative(PLUGIN_ROOT, resolved).startsWith("..")) {
          escapes.push(`${path.relative(PLUGIN_ROOT, file)} -> ${match[1]}`);
        }
      }
    }
    assert.deepEqual(escapes, []);
  });
});

describe("host contributions", () => {
  it("registers a sidebar item, a surface, and a workspace panel", () => {
    const source = readFileSync(path.join(PLUGIN_ROOT, "index.client.tsx"), "utf8");
    assert.match(source, /addSidebarItem\(/);
    assert.match(source, /addSurface\(/);
    assert.match(source, /addWorkspacePanel\(/);
    // Registration goes through the host, not a helper registrar that would
    // wrap the surface in the shared kit's chrome.
    assert.ok(!source.includes("paseo-plugin-helper"), "no helper registrar");
    assert.ok(!/registerSidebarSurface|registerWorkspacePanel/.test(source), "no helper registrar");
  });

  it("registers every server handler the client can call", async () => {
    const server = readFileSync(path.join(PLUGIN_ROOT, "index.server.ts"), "utf8");
    const contracts = readFileSync(path.join(PLUGIN_ROOT, "shared", "contracts.ts"), "utf8");
    const declared = [...contracts.matchAll(/name: "(worktree-install\.[a-z0-9-]+)"/g)].map((m) => m[1]!);
    const handled = [...server.matchAll(/server\.handle\(\s*(\w+)/g)].map((m) => m[1]!);
    for (const name of declared) {
      const identifier = [...contracts.matchAll(/export const (\w+) = defineContract\(\{\s*name: "([^"]+)"/g)]
        .find((m) => m[2] === name)?.[1];
      assert.ok(identifier, `no contract constant for ${name}`);
      assert.ok(handled.includes(identifier), `${identifier} (${name}) is never handled`);
    }
    assert.equal(declared.length, handled.length, "a handler exists for a contract that does not");
  });

  it("namespaces every method to this plugin", () => {
    const contracts = readFileSync(path.join(PLUGIN_ROOT, "shared", "contracts.ts"), "utf8");
    const names = [...contracts.matchAll(/name: "([^"]+)"/g)].map((m) => m[1]!);
    assert.ok(names.length > 0);
    for (const name of names) {
      assert.match(name, /^worktree-install\./, name);
    }
  });
});
