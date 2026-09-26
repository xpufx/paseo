/**
 * Repo-wide guard for the undeclared-tooling class: an npm script that invokes
 * a CLI the declaring package does not depend on.
 *
 * That script resolves the tool from some *other* workspace's hoisted
 * `node_modules/.bin`, or from $PATH, so the suite runs against a tool version
 * no manifest here accounts for. Nothing in the tree explains the break, and
 * the only symptom is a "command not found" in a script nobody runs. This repo
 * has paid for it three times: bare `esbuild` in forges (#603), `npx tsx` in
 * three plugins (#609), a hoisted `vitest` in plugin-updates (#613).
 *
 * Scope: every package.json under the repo root outside an ignored directory.
 * Symlinked plugin directories are skipped — `plugins/uppidi-forge` is an alias
 * symlink to `plugins/uppidi-fleet`, so following it would check one manifest
 * twice under two paths and report findings under the alias.
 *
 * Deliberately NOT checked: whether a *declared* dependency is exact-pinned.
 * Every `typescript` and `vitest` in this repo is `^`-ranged, so enforcing
 * exact pins would fail on all 18 of them; that is its own change, not this
 * one. What is checked is the weaker and unambiguous half — the tool is
 * declared at all — plus run-time downloads, which are undeclared by
 * definition.
 *
 * The command tables are closed-world: a command this guard does not recognise
 * is a failure, not a pass. Otherwise renaming an invocation to a tool nobody
 * added to the tables would silently disable the check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".vitest", "publish-stage"]);

/**
 * Commands a package.json script may invoke that are not npm-installable
 * tooling: the interpreters, the shell/coreutils, and VCS/OS binaries that
 * exist on any dev machine regardless of what this repo declares.
 */
const AMBIENT_COMMANDS = new Set([
  // interpreters and the script runner
  "node", "npm", "sh", "bash", "zsh", "env",
  // shell builtins
  "cd", "echo", "exit", "export", "printf", "pwd", "read", "set", "test", "true", "false",
  "if", "for", "while", "exec", "command", "trap", "wait", "unset",
  // coreutils
  "basename", "cat", "chmod", "cp", "date", "dirname", "find", "grep", "head", "ls",
  "mkdir", "mv", "rm", "rsync", "sed", "sort", "tail", "tar", "uniq", "wc", "xargs", "gzip",
  // vcs, network, and other dev-machine binaries
  "curl", "diff", "git", "jq", "make", "ssh", "scp", "uname", "which",
  // darwin
  "codesign", "defaults", "hdiutil", "keychain", "open", "osascript", "plutil",
  "security", "sqlite3", "sw_vers", "xattr",
  // python
  "python3",
]);

/** CLI command -> the package that provides its binary. */
const TOOL_PROVIDERS = {
  ava: "ava",
  babel: "@babel/cli",
  biome: "@biomejs/biome",
  esbuild: "esbuild",
  eslint: "eslint",
  jest: "jest",
  mocha: "mocha",
  nx: "nx",
  parcel: "parcel",
  prettier: "prettier",
  rollup: "rollup",
  swc: "@swc/cli",
  "ts-node": "ts-node",
  tsc: "typescript",
  tsup: "tsup",
  tsx: "tsx",
  vite: "vite",
  vitest: "vitest",
  webpack: "webpack",
};

/** Runners that fetch a package at run time, so whatever they name is undeclared by construction. */
const DOWNLOAD_RUNNERS = { npx: "npx", bunx: "bunx", pnpx: "pnpx" };

function findManifests(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      findManifests(full, acc);
    } else if (entry.isFile() && entry.name === "package.json") {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Split a script into one entry per command, dropping quoted spans first so a
 * `;` or `|` inside a `node -e "..."` payload cannot be read as a separator.
 * Leading `VAR=value` assignments are stripped so `NODE_ENV=test node ...`
 * reads as `node`.
 */
function commandSegments(script) {
  return script
    .replace(/"[^"]*"/g, " ")
    .replace(/'[^']*'/g, " ")
    .split(/&&|\|\||[;|]/)
    .map((segment) => {
      let rest = segment.trim();
      while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(rest)) {
        rest = rest.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s*/, "").trim();
      }
      return rest;
    })
    .filter(Boolean)
    .map((segment) => {
      const token = segment.match(/^(\S+)/)?.[1];
      if (!token) return null;
      const base = token.split("/").pop();
      const args = segment.slice(token.length).trim().split(/\s+/).filter(Boolean);
      return { base, args };
    })
    .filter(Boolean);
}

const manifests = findManifests(REPO_ROOT).map((path) => {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  const rel = relative(REPO_ROOT, path).split(sep).join("/");
  return { path: rel, dir: rel.slice(0, -"/package.json".length), pkg, declared };
});

function scriptEntries(manifest) {
  return Object.entries(manifest.pkg.scripts ?? {}).map(([name, script]) => ({ ...manifest, name, script }));
}

test("manifest discovery is not vacuous: every declared workspace is covered", () => {
  const found = new Set(manifests.map((m) => m.dir));
  assert.ok(manifests.length > 1, `expected several manifests, found ${manifests.length}`);

  const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  for (const workspace of root.workspaces ?? []) {
    assert.ok(found.has(workspace), `workspace ${workspace} was not discovered by the guard`);
  }
});

test("no npm script invokes a tool its own package does not declare", () => {
  const offenders = manifests.flatMap(scriptEntries).flatMap((entry) =>
    commandSegments(entry.script)
      .filter(({ base }) => base in TOOL_PROVIDERS)
      .filter(({ base }) => !entry.declared.has(TOOL_PROVIDERS[base]))
      .map(
        ({ base }) =>
          `${entry.path} scripts.${entry.name} runs \`${base}\` but does not declare ${TOOL_PROVIDERS[base]}`,
      ),
  );
  assert.deepEqual(
    offenders,
    [],
    "an npm script must not resolve a toolchain from another workspace's hoisted " +
      "node_modules/.bin or from $PATH. Add the package to devDependencies pinned " +
      "exactly, or drop the step -- node's type stripping plus a resolve hook " +
      "covers most TS test suites (#603, #609, #613).",
  );
});

test("no npm script downloads a tool at run time", () => {
  const offenders = manifests.flatMap(scriptEntries).flatMap((entry) =>
    commandSegments(entry.script)
      .filter(({ base }) => base in DOWNLOAD_RUNNERS)
      .map(({ base, args }) => {
        const target = args.find((a) => !a.startsWith("-"));
        return `${entry.path} scripts.${entry.name} runs \`${base} ${target ?? ""}\`, which fetches at run time`;
      }),
  );
  assert.deepEqual(
    offenders,
    [],
    "npx and friends resolve a package at run time, so the version that runs is " +
      "whatever the registry serves that day -- a clean checkout with no network " +
      "gets nothing at all. Run the tool from node_modules/.bin by declaring it (#609).",
  );
});

test("every tool an npm script invokes is a command this guard knows about", () => {
  const known = new Set([...AMBIENT_COMMANDS, ...Object.keys(TOOL_PROVIDERS), ...Object.keys(DOWNLOAD_RUNNERS)]);
  const unknown = manifests
    .flatMap(scriptEntries)
    .flatMap((entry) =>
      commandSegments(entry.script)
        .map(({ base }) => `${entry.path} scripts.${entry.name} runs \`${base}\``)
        .filter((line) => !known.has(line.match(/`([^`]+)`/)[1])),
    );
  assert.deepEqual(
    unknown,
    [],
    "these commands are neither ambient nor mapped to a package, so this guard " +
      "cannot say whether they are declared. Classify them: add the package to " +
      "TOOL_PROVIDERS, or the command to AMBIENT_COMMANDS if it is not " +
      "npm-installable tooling. Unknown commands are treated as failures on " +
      "purpose -- a silent pass here would be an undefended hole.",
  );
});

test("every npm run target a script invokes exists in the same package", () => {
  const offenders = manifests.flatMap(scriptEntries).flatMap((entry) => {
    const scripts = entry.pkg.scripts ?? {};
    return commandSegments(entry.script)
      .filter(({ base }) => base === "npm")
      .flatMap(({ args }) => {
        const at = args.indexOf("run");
        return at === -1 ? [] : [args[at + 1]];
      })
      .filter((target) => target && !(target in scripts))
      .map(
        (target) =>
          `${entry.path} scripts.${entry.name} runs \`npm run ${target}\`, which this package does not define`,
      );
  });
  assert.deepEqual(offenders, [], "a script must not delegate to a sibling script that does not exist");
});
