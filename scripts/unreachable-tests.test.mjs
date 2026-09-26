/**
 * Repo-wide guard for the unreachable-test class: a tracked `*.test.*` /
 * `*.spec.*` file that no runner invocation in this repo names, so it has
 * never executed and cannot.
 *
 * That class is #702. Test discovery here is a hand-maintained list of file
 * names, so a new suite is dead on arrival unless someone remembers to add it.
 * This repo has paid for that seven times in one cycle: five `uppidi-fleet`
 * suites (#625, #628, #635, #645) and two `x-comms` suites (#699) were merged
 * and reported as delivered regression coverage, and none of them execute.
 * `scripts/declared-tooling.test.mjs` is the same kind of gate for the other
 * direction (a tool used but not declared); this one is the mirror image.
 *
 * This guard reports nine, not seven. The two extra are in `scripts/` itself:
 * `reload-notify.test.mjs` and `runner-host-diagnostics.test.py`, which no
 * npm script, Makefile target or workflow step names either. They are the same
 * defect in a directory the issue did not audit, and dropping them to hit a
 * rounder number would be the guard's own version of the bug it exists to
 * catch.
 *
 * #700/#702 note: this guard makes no symlink changes and no production
 * changes. It reads the tree, it does not reshape it.
 *
 * ## What counts as a test file
 *
 * A tracked path whose basename matches the SUITE regexp below. `spec` is
 * included because vitest's own default include treats the two as equivalent
 * and a suite named either way is equally runnable.
 *
 * Files are enumerated with `git ls-files`, never by walking the filesystem.
 * Walking skips symlinked directories, and `plugins/uppidi-forge` is a tracked
 * symlink to `plugins/uppidi-fleet`; a `find`-based count would either miss
 * the alias or double-count the fifteen fleet suites under it. `git ls-files`
 * reports the symlink as one entry and never descends into it, which is the
 * behaviour we want: the suites are seen once, under their real path.
 *
 * ## No directory is excluded
 *
 * There is no `examples/`, `vendor/`, `fixtures/` or any other carve-out, and
 * no per-package count threshold. #702 claimed `plugins/forges` held ~400
 * `*.test.*` files under `examples/`; it does not. Tracked
 * `plugins/forges/examples` is 13 files with zero tests, forges' real suite is
 * 8 files, and all 8 are named by its `test` script. An exclusion rule added to
 * cope with a number that turned out to be wrong excludes nothing while
 * implying a judgement nobody made, so the rule is simply absent. A future
 * vendored tree that really does carry hundreds of unrunnable test files is a
 * real finding and should be reported as one, with its own deliberate rule.
 *
 * ## What counts as naming a file
 *
 * Three runner surfaces exist in this repo, and all three are read:
 *
 *  1. every `scripts` entry of every tracked package.json. Tokens resolve from
 *     that package's own directory, because `npm run` executes there.
 *  2. Makefile recipes (tab-prefixed lines), resolved from the repo root.
 *  3. `run:` steps in tracked `.forgejo/workflows` and `.github/workflows`,
 *     resolved from the repo root.
 *
 * Surfaces 2 and 3 exist because four suites in `scripts/` -- board-hygiene,
 * vendor-sync, publish-npm, npm-stage-native -- are named by no npm script and
 * are run only from a Makefile target or a workflow step. Counting package.json
 * alone would report them as orphans, which would be a lie: they execute.
 * `npm test` calling `npm run test --workspaces` needs no special case, since
 * each workspace's own scripts are read directly.
 *
 * Each runner's argument convention is modelled, rather than scraping every
 * token for something path-shaped — the conventions differ and conflating them
 * is how a guard starts passing for the wrong reason:
 *
 *  - `node --test <files...>` and `tsx --test <files...>` take *paths*. A token
 *    that names a directory covers everything under it, a token with glob
 *    characters is matched as a glob (npm runs scripts through `sh`, so the
 *    shell would expand it), and `node --test` with no file token walks the
 *    package directory — the directory-discovery future of #702 item 2, which
 *    must not turn every suite in the package into a false failure.
 *  - `vitest [run] <filters...>` takes *filters, not paths*: a positional is a
 *    substring match against the path of a file the configured `include` globs
 *    already selected. `plugins/wellbeing` names `client/surface.test.tsx` no
 *    other way. A rule that parsed only `--test` positionals would report that
 *     suite as an orphan, and a guard with false positives gets ignored, which
 *     is worse than no guard at all. So: include-glob match AND substring
 *     filter. No positionals means no filter, and the include set is the whole
 *     story.
 *  - A `vitest run` with `--config` gets its `include` globs read out of that
 *     config. The config's `root` is *not* evaluated — this guard does not
 *     execute TypeScript to find out where a glob is anchored. Instead a glob
 *     may match at any depth below the package. That is deliberately
 *     permissive: it can only ever miss an orphan, never invent one. The
 *     `test.root is now load-bearing` test below asserts the relaxation is
 *     still a no-op on the current tree, so it cannot rot into a hidden hole.
 *  - A runner with no `--test` flag at all still runs a suite if a non-flag
 *     token's basename looks like one and resolves to it:
 *     `node scripts/vendor-sync.test.mjs` is a bespoke runner, on any surface,
 *     and pretending otherwise would report a running suite as an orphan.
 *
 * Path comparisons are exact identities, so a script in one package cannot
 * "cover" a suite in another. The one relative rule (vitest include globs and
 * filters) is restricted to the suite's owning package: the nearest ancestor
 * directory with a package.json.
 *
 * ## Closed world
 *
 * A suite-shaped token that resolves to nothing tracked is a failure, not a
 * pass — renaming or deleting a script's target must not be able to quietly
 * disable the check. A `--config` this guard cannot read an `include` out of is
 * likewise a failure.
 *
 * ## Deliberately NOT checked
 *
 * That a named suite *passes*, and that it is the right suite. Wiring a suite
 * up and making it pass are separate tasks (#702 item 3); this guard is the
 * first half only. A suite can be reachable and still be wrong -- that is a
 * different defect, and a `--test` invocation is evidence about reachability,
 * not about correctness.
 *
 * EXEMPT is the escape hatch for a tracked, test-shaped file that no runner
 * names and never will — a fixture of test-shaped naming, say. It is empty,
 * and stays empty until such a file actually exists; the seven orphans are not
 * exempt, because they are the finding. It is a named list, never a directory
 * or glob, and the rot-check below fails an entry that has stopped being an
 * orphan or stopped being tracked, so the list cannot become a place where dead
 * tests go to be forgotten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Basename shape of a file this guard treats as a suite. */
const SUITE = /\.(?:test|spec)\.(?:js|jsx|cjs|mjs|ts|tsx|py)$/;

/** Characters that make a script token a shell glob rather than a path. */
const GLOB_CHARS = /[*?[\]{}]/;

/** vitest's own default `test.include`, used when a config declares none. */
const VITEST_DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];

/** Runners whose positional arguments this guard knows how to interpret. */
const PATH_TAKING_RUNNERS = new Set(["node", "tsx"]);

const EXEMPT = new Set([
  // Empty. A tracked, test-shaped file that no runner names and never will
  // goes here as `repo/path.test.ts`, one line, no globs — and only once it
  // exists. The seven #702 orphans are deliberately absent: unreachable is the
  // finding, not an exemption.
]);

/* ------------------------------------------------------------------ inputs */

let trackedCache;

function trackedFiles() {
  if (trackedCache) return trackedCache;
  let out;
  try {
    out = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(
      "this guard enumerates the tree with `git ls-files` (see the header for why), " +
        `which failed: ${err.message}. Run it from a git checkout.`,
    );
  }
  trackedCache = out.split("\0").filter(Boolean);
  return trackedCache;
}

/** Every tracked package.json, longest directory first so the nearest wins. */
const packages = (() => {
  const dirs = new Set();
  for (const file of trackedFiles()) {
    if (file === "package.json") dirs.add("");
    else if (file.endsWith("/package.json")) dirs.add(file.slice(0, -"/package.json".length));
  }
  const found = [];
  for (const dir of dirs) {
    const path = join(REPO_ROOT, dir, "package.json");
    if (!existsSync(path)) continue;
    found.push({ dir, pkg: JSON.parse(readFileSync(path, "utf8")) });
  }
  return found.sort((a, b) => b.dir.length - a.dir.length);
})();

/** The nearest ancestor package directory owning `file`. */
function ownerOf(file) {
  for (const { dir } of packages) {
    if (dir === "" || file.startsWith(`${dir}/`)) return dir;
  }
  return null;
}

const testFiles = trackedFiles()
  .filter((file) => SUITE.test(file))
  .sort();

/* ------------------------------------------------------- runner invocation */

/**
 * Split a command into one entry per command, dropping quoted spans first so a
 * `;` or `|` inside a payload cannot read as a separator, and stripping leading
 * `VAR=value` assignments so `NODE_ENV=test node ...` reads as `node`.
 */
function commandSegments(script) {
  return script
    .replace(/"[^"]*"/g, " ")
    .replace(/'[^']*'/g, " ")
    .split(/&&|\|\||[;|\n]/)
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
      return {
        base: token.split("/").pop(),
        args: segment
          .slice(token.length)
          .trim()
          .split(/\s+/)
          .filter(Boolean),
      };
    })
    .filter(Boolean);
}

function invocationsIn(script, source, dir) {
  return commandSegments(script).map((inv) => ({ ...inv, source, dir }));
}

function scriptInvocations() {
  return packages.flatMap(({ dir, pkg }) =>
    Object.entries(pkg.scripts ?? {}).flatMap(([name, script]) =>
      invocationsIn(script, `${dir === "" ? "" : `${dir}/`}package.json scripts.${name}`, dir),
    ),
  );
}

function makefileInvocations() {
  const path = join(REPO_ROOT, "Makefile");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((line, i) =>
      /^\t/.test(line)
        ? invocationsIn(line.replace(/^[\t@-]+/, ""), `Makefile:${i + 1}`, "")
        : [],
    );
}

/**
 * `run:` steps out of a workflow file: the inline form, and the `run: |` block
 * form, taken by indentation the way YAML does. This is a deliberate subset of
 * YAML, not a parser; the workflow-coverage test below fails if the subset ever
 * stops seeing a suite that only a workflow names.
 */
function workflowRunBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)(?:-\s+)?run:[ \t]*(.*)$/);
    if (!match) continue;
    const [, indent, inline] = match;
    const trimmed = inline.trim();
    if (trimmed && trimmed !== "|" && trimmed !== ">") {
      blocks.push(trimmed);
      continue;
    }
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") {
        body.push("");
        continue;
      }
      if (lines[j].match(/^\s*/)[0].length <= indent.length) break;
      body.push(lines[j].trim());
    }
    blocks.push(body.join("\n"));
    i += body.length;
  }
  return blocks;
}

function workflowInvocations() {
  return trackedFiles()
    .filter((file) => /^\.(?:forgejo|github)\/workflows\/.*\.ya?ml$/.test(file))
    .flatMap((file) =>
      workflowRunBlocks(readFileSync(join(REPO_ROOT, file), "utf8")).flatMap((block, i) =>
        invocationsIn(block, `${file} run step #${i + 1}`, ""),
      ),
    );
}

const invocations = [...scriptInvocations(), ...makefileInvocations(), ...workflowInvocations()];

/* ------------------------------------------------------------ path helpers */

/** Join a script-relative token onto its base dir, POSIX-style, no fs access. */
function posixJoin(dir, token) {
  const out = [];
  for (const part of `${dir === "" ? "" : `${dir}/`}${token}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** A tracked file's path relative to `dir`, or null when it is not under it. */
function underDir(dir, file) {
  if (dir === "") return file;
  return file.startsWith(`${dir}/`) ? file.slice(dir.length + 1) : null;
}

function isDirectory(relPath) {
  try {
    return statSync(join(REPO_ROOT, relPath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Translate the glob dialect these runners actually use: `*` (one segment),
 * `**` (any number of segments), `?` (one char), `?(a|b)` (optional group),
 * `{a,b}` and `[abc]`. Enough for vitest's own default include and every
 * `include` in this repo.
 *
 * `?(a|b)` is the trap: it is a *zero-or-one* group, so it must compile to
 * `(?:a|b)?`, not to a bare `(?:a|b)`. Getting that wrong makes `.?(c|m)` demand
 * a `c` or an `m` where vitest means "at most one", and the default include
 * then matches almost nothing while still looking like a correct translation.
 */
function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      if (glob[i + 1] === "(") {
        const end = glob.indexOf(")", i);
        if (end !== -1) {
          source += `(?:${glob.slice(i + 2, end)})?`;
          i = end;
          continue;
        }
      }
      source += "[^/]";
    } else if (char === "{") {
      const end = glob.indexOf("}", i);
      if (end !== -1) {
        source += `(?:${glob.slice(i + 1, end).replaceAll(",", "|")})`;
        i = end;
        continue;
      }
      source += "\\{";
    } else if (char === "[") {
      const end = glob.indexOf("]", i);
      if (end !== -1) {
        const body = glob.slice(i + 1, end);
        source += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
        i = end;
        continue;
      }
      source += "\\[";
    } else {
      source += char.replace(/[.*+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

const globCache = new Map();

function matchesGlob(glob, relPath) {
  if (!globCache.has(glob)) globCache.set(glob, globToRegExp(glob));
  return globCache.get(glob).test(relPath);
}

/**
 * Include-glob matching that does not evaluate the config's `test.root`: try
 * the package root, then every deeper anchor. Permissive by construction — see
 * the header — and the `test.root is now load-bearing` test audits it.
 */
function matchesIncludeAtAnyDepth(glob, relPath) {
  if (matchesGlob(glob, relPath)) return true;
  for (let i = 0; i < relPath.length; i++) {
    if (relPath[i] === "/" && matchesGlob(glob, relPath.slice(i + 1))) return true;
  }
  return false;
}

/** The `include` globs of the config a vitest invocation points at, or null. */
function vitestIncludes(inv) {
  const at = inv.args.indexOf("--config");
  if (at === -1) return VITEST_DEFAULT_INCLUDE;
  const configPath = inv.args[at + 1];
  if (!configPath) return null;
  const abs = resolve(REPO_ROOT, inv.dir, configPath);
  if (!existsSync(abs)) return null;
  const source = readFileSync(abs, "utf8");
  if (!/(?:^|[^\w.])include\s*:/.test(source)) return VITEST_DEFAULT_INCLUDE;
  const block = source.match(/include\s*:\s*\[([^\]]*)\]/s);
  if (!block) return null;
  const globs = [...block[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  return globs.length > 0 ? globs : null;
}

/** vitest subcommands, so they are not mistaken for a filename filter. */
const VITEST_SUBCOMMANDS = new Set(["run", "watch", "related", "bench", "init", "list", "typecheck"]);

/** Positional filters of a vitest invocation, with flag values removed. */
function vitestFilters(inv) {
  const filters = [];
  for (let i = 0; i < inv.args.length; i++) {
    const arg = inv.args[i];
    if (arg === "--config" || arg === "-c" || arg === "--root" || arg === "--dir") {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    if (filters.length === 0 && VITEST_SUBCOMMANDS.has(arg)) continue;
    filters.push(arg);
  }
  return filters;
}

/** Non-flag tokens of an invocation, for the bespoke-runner rule. */
function pathTokens(inv) {
  return inv.args.filter((arg) => !arg.startsWith("-"));
}

/** Tokens that follow a `--test` flag, or null when the flag is absent. */
function argsAfterTestFlag(inv) {
  const at = inv.args.indexOf("--test");
  if (at === -1) return null;
  const rest = [];
  for (const arg of inv.args.slice(at + 1)) {
    if (arg.startsWith("-")) break;
    rest.push(arg);
  }
  return rest;
}

/** Does one path-semantics token name `file`? */
function tokenNamesFile(dir, token, file) {
  if (GLOB_CHARS.test(token)) {
    const rel = underDir(dir, file);
    return rel !== null && matchesGlob(token, rel);
  }
  const target = posixJoin(dir, token);
  if (target === file) return true;
  return isDirectory(target) && file.startsWith(`${target}/`);
}

/** A token whose basename looks like a suite: a bespoke runner's target. */
function looksLikeSuite(token) {
  return SUITE.test(posixJoin("", token).split("/").pop());
}

/* -------------------------------------------------------------- coverage */

/**
 * Does `inv` name `file`? `ownerDir` is the suite's nearest ancestor package
 * directory; only vitest's relative include/filter rules are scoped by it, and
 * every other rule is an exact path identity, so those cannot cross packages.
 *
 * `deepGlobs` off means include globs are anchored at the package directory
 * only, with no attempt to infer a deeper `test.root` from the vitest config.
 * The production path leaves it on; the audit test below turns it off.
 */
function namesFile(inv, file, ownerDir, deepGlobs = true) {
  if (inv.base === "vitest") {
    if (ownerDir !== inv.dir) return false;
    const rel = underDir(inv.dir, file);
    if (rel === null) return false;
    const includes = vitestIncludes(inv);
    if (includes === null) return false;
    const selected = includes.some((glob) =>
      deepGlobs ? matchesIncludeAtAnyDepth(glob, rel) : matchesGlob(glob, rel),
    );
    if (!selected) return false;
    const filters = vitestFilters(inv);
    return filters.length === 0 || filters.some((filter) => rel.includes(filter));
  }

  if (PATH_TAKING_RUNNERS.has(inv.base)) {
    const targets = argsAfterTestFlag(inv);
    // A bespoke runner with no --test flag: `node scripts/vendor-sync.test.mjs`
    // and friends, which run a suite just the same. Deliberately file-identity
    // only, so a package.json script cannot cover a suite by naming its
    // directory.
    if (targets === null) {
      return pathTokens(inv).some((token) => looksLikeSuite(token) && tokenNamesFile(inv.dir, token, file));
    }
    // `node --test` with no file token walks the package directory.
    if (targets.length === 0) {
      return underDir(inv.dir, file) !== null;
    }
    return targets.some((token) => tokenNamesFile(inv.dir, token, file));
  }

  return pathTokens(inv).some((token) => looksLikeSuite(token) && tokenNamesFile(inv.dir, token, file));
}

/** Every invocation that names `file`, for the failure message and the tests. */
function coverers(file, deepGlobs = true) {
  const ownerDir = ownerOf(file);
  return invocations.filter((inv) => namesFile(inv, file, ownerDir, deepGlobs));
}

const orphans = testFiles.filter((file) => coverers(file).length === 0);

/* ------------------------------------------------------------------ tests */

test("test discovery is not vacuous", () => {
  assert.ok(
    testFiles.length > 100,
    `expected this guard to see a substantial number of suites, found ${testFiles.length}. ` +
      "If that is wrong, `git ls-files` is not returning what the guard thinks.",
  );

  const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const found = new Set(packages.map((p) => p.dir));
  for (const workspace of root.workspaces ?? []) {
    assert.ok(found.has(workspace), `workspace ${workspace} was not discovered as a package by the guard`);
  }

  for (const file of testFiles) {
    assert.ok(ownerOf(file) !== null, `${file} has no owning package.json, so nothing could name it`);
  }

  // The `plugins/uppidi-forge` symlink to `plugins/uppidi-fleet` must not make
  // the fleet's suites appear twice, and must not hide them.
  assert.ok(
    !testFiles.some((file) => file.startsWith("plugins/uppidi-forge/")),
    "a suite was discovered under the plugins/uppidi-forge symlink alias; `git ls-files` should never descend into it",
  );
  assert.ok(
    testFiles.filter((file) => file === "plugins/uppidi-fleet/client/entry.test.ts").length === 1,
    "the uppidi-fleet suites are not seen exactly once",
  );
});

/**
 * One reachable suite per runner shape this repo uses, each asserted to be
 * covered *by the mechanism claimed* — not merely covered. This is what keeps
 * the argument conventions above honest: a matcher that quietly stops
 * recognising `test:tsx`, a vitest positional filter, a `--config` include, a
 * Makefile recipe or a workflow step fails here rather than quietly reclassing
 * those suites as orphans.
 */
const RUNNER_SHAPES = [
  ["packages/paseo-plugin-helper/src/__tests__/async.test.ts", /paseo-plugin-helper\/package\.json scripts\.test$/],
  ["packages/paseo-plugin-helper/src/__tests__/theme-tokens.test.ts", /paseo-plugin-helper\/package\.json scripts\.test$/],
  ["plugins/demo/shared/demo-header-mode.test.ts", /demo\/package\.json scripts\.test$/],
  ["plugins/mcp-tools/client/attribution.test.tsx", /mcp-tools\/package\.json scripts\.test$/],
  ["plugins/slash/server/orchestrate.test.ts", /slash\/package\.json scripts\.test$/],
  ["plugins/twofado/client/ask.test.tsx", /twofado\/package\.json scripts\.test$/],
  ["plugins/top/client/pill-render.test.tsx", /top\/package\.json scripts\.test$/],
  ["plugins/top/server/telemetry.test.ts", /top\/package\.json scripts\.test$/],
  ["plugins/forges/test/no-bare-bundler.test.mjs", /forges\/package\.json scripts\.test$/],
  ["plugins/plugin-updates/client/orphans.test.ts", /plugin-updates\/package\.json scripts\.test$/],
  ["plugins/uppidi-fleet/client/mobile-layout.test.ts", /uppidi-fleet\/package\.json scripts\.test:tsx$/],
  ["plugins/uppidi-fleet/server/fleet.test.ts", /uppidi-fleet\/package\.json scripts\.test:node$/],
  ["plugins/wellbeing/client/entry.test.ts", /wellbeing\/package\.json scripts\.test$/],
  // The trap: named by a vitest positional filter, not by a --test path.
  ["plugins/wellbeing/client/surface.test.tsx", /wellbeing\/package\.json scripts\.test$/],
  ["plugins/worktree-install/client/render.test.ts", /worktree-install\/package\.json scripts\.test:tsx$/],
  ["plugins/x-comms/index.server.test.ts", /x-comms\/package\.json scripts\.test$/],
  ["plugins/x-comms/mcp/test/redaction-parity.test.mjs", /x-comms\/package\.json scripts\.test$/],
  ["scripts/declared-tooling.test.mjs", /package\.json scripts\.check:declared-tooling$/],
  ["scripts/board-hygiene.test.mjs", /^Makefile:\d+$/],
  ["scripts/vendor-sync.test.mjs", /test-suites\.yml run step/],
  ["scripts/npm-stage-native.test.mjs", /npm-stage\.yml run step/],
];

test("every runner shape this repo uses is still recognised", () => {
  const wrong = RUNNER_SHAPES.flatMap(([file, shape]) => {
    assert.ok(testFiles.includes(file), `${file} is not a tracked suite, so this table needs updating`);
    const sources = coverers(file).map((inv) => inv.source);
    if (sources.length === 0) return [`${file} is reported as an orphan but is a known-reachable suite`];
    if (!sources.some((source) => shape.test(source))) {
      return [`${file} is covered by ${sources.join(", ")}, which is not the shape this guard claims to handle (${shape})`];
    }
    return [];
  });
  assert.deepEqual(wrong, [], "the runner-shape table and the guard's argument parsing disagree");
});

test("test.root is now load-bearing: the include-glob depth relaxation is a no-op", () => {
  // matchesIncludeAtAnyDepth tolerates a config whose `test.root` the guard
  // cannot evaluate. That tolerance is only defensible while it changes no
  // answer: if relaxing the anchor starts covering a suite, the real root has
  // become load-bearing and the guard is being permissive instead of correct.
  const strict = testFiles.filter((file) => coverers(file, false).length === 0);
  assert.deepEqual(
    strict,
    orphans,
    "vitest include globs now resolve at a depth this guard cannot infer from the config. " +
      "Teach it the config's root expression instead of leaning on the permissive match.",
  );
});

test("the glob dialect these runners use still translates correctly", () => {
  // The coverage rule is only as good as this translator, and a mistranslation
  // is silent: it reclassifies covered suites as orphans rather than throwing.
  const cases = [
    [VITEST_DEFAULT_INCLUDE[0], "src/__tests__/async.test.ts", true],
    [VITEST_DEFAULT_INCLUDE[0], "src/__tests__/theme-tokens.test.tsx", true],
    [VITEST_DEFAULT_INCLUDE[0], "client/surface.test.tsx", true],
    [VITEST_DEFAULT_INCLUDE[0], "server/presence.test.ts", true],
    [VITEST_DEFAULT_INCLUDE[0], "test/protocol.test.mjs", true],
    [VITEST_DEFAULT_INCLUDE[0], "vitest.config.ts", false],
    [VITEST_DEFAULT_INCLUDE[0], "src/client.ts", false],
    ["client/**/*.test.ts", "client/pill-labels.test.ts", true],
    ["client/**/*.test.ts", "client/nested/deep.test.ts", true],
    ["client/**/*.test.ts", "server/telemetry.test.ts", false],
    ["client/**/*.test.tsx", "client/pill-render.test.tsx", true],
    ["client/**/*.test.tsx", "client/pill-labels.test.ts", false],
    ["server/*.test.ts", "server/runners.test.ts", true],
    ["server/*.test.ts", "server/nested/runners.test.ts", false],
    ["server/**/*.test.ts", "server/nested/runners.test.ts", true],
    // `?` is one character, and `?(...)` is optional, not required.
    ["?erver/fleet.test.ts", "server/fleet.test.ts", true],
    ["?erver/fleet.test.ts", "sserver/fleet.test.ts", false],
    [VITEST_DEFAULT_INCLUDE[0], "test/protocol.test.js", true],
    [VITEST_DEFAULT_INCLUDE[0], "test/protocol.test.mts", true],
    [VITEST_DEFAULT_INCLUDE[0], "test/protocol.spec.tsx", true],
    [VITEST_DEFAULT_INCLUDE[0], "test/protocol.test.mjsx", true],
    [VITEST_DEFAULT_INCLUDE[0], "test/protocol.test.mpy", false],
    [VITEST_DEFAULT_INCLUDE[0], "test/protocol.test.py", false],
    ["{shared,server}/fleet.test.ts", "shared/fleet.test.ts", true],
    ["{shared,server}/fleet.test.ts", "client/fleet.test.ts", false],
    ["client/entry.test.{ts,tsx}", "client/entry.test.tsx", true],
    ["client/entry.test.{ts,tsx}", "client/entry.test.js", false],
    ["[!x]ustom.test.ts", "custom.test.ts", true],
    ["[!x]ustom.test.ts", "xustom.test.ts", false],
  ];
  const wrong = cases.flatMap(([glob, path, expected]) => {
    const actual = matchesGlob(glob, path);
    return actual === expected ? [] : [`${glob} vs ${path}: expected ${expected}, got ${actual}`];
  });
  assert.deepEqual(wrong, [], "the glob translator and the runners' glob dialect disagree");
});

test("no tracked suite is named by a runner that does not exist", () => {
  const tracked = new Set(trackedFiles());
  const offenders = [];
  for (const inv of invocations) {
    const tokens =
      inv.base === "vitest" ? [] : argsAfterTestFlag(inv) ?? pathTokens(inv);
    for (const token of tokens) {
      if (GLOB_CHARS.test(token) || !looksLikeSuite(token)) continue;
      const target = posixJoin(inv.dir, token);
      if (tracked.has(target)) continue;
      if (inv.dir !== "" && (underDir(inv.dir, target) === null || !target.startsWith(`${inv.dir}/`))) {
        offenders.push(`${inv.source} names ${target}, which is outside its own package directory`);
        continue;
      }
      offenders.push(`${inv.source} names ${target}, which is not a tracked file`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a runner names a suite that does not exist, so it names nothing at all. Renaming or " +
      "deleting the target must not be able to disable this guard's check silently — fix the " +
      "runner, or delete the name.",
  );
});

test("every EXEMPT entry is still a tracked, unreachable suite", () => {
  const tracked = new Set(testFiles);
  const stale = [...EXEMPT].flatMap((entry) => {
    if (!tracked.has(entry)) return [`${entry} is exempted but is not a tracked suite — delete the entry`];
    if (coverers(entry).length > 0) {
      return [
        `${entry} is exempted but is now named by ${coverers(entry)[0].source} — delete the entry, ` +
          "it is coverage the exemption list is hiding",
      ];
    }
    return [];
  });
  assert.deepEqual(
    stale,
    [],
    "EXEMPT must name real, still-unreachable suites. An entry that has become reachable or has " +
      "been deleted is a dead test the list would keep out of sight forever.",
  );
});

test("every tracked suite is named by a runner, so it can execute", () => {
  assert.deepEqual(
    orphans,
    [],
    (orphans.length === 0
      ? ""
      : `${orphans.length} tracked suite(s) are named by no runner invocation, so they have never ` +
        "executed and cannot:\n" +
        orphans.map((file) => `  ${file}`).join("\n") +
        "\n\n") +
      "Test discovery in this repo is a hand-maintained list of file names, so a new suite is dead " +
      "on arrival until someone adds it to the right script (#702). For each file above, either add " +
      "it to its package's test script — or, if it should never run, delete it. Making a wired-up " +
      "suite pass is a separate task from making it run: do not let 'it fails' turn into 'remove it " +
      "from the list'.",
  );
});
