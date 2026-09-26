// Single source of truth for "which paseo-plugin-helper does this plugin serve,
// and can anyone prove it?" (#633).
//
// The resolution rule implemented here mirrors what the daemon's esbuild pass
// does, derived from the plugin's own files rather than from a claim:
//
//   * A bare `paseo-plugin-helper/<tree>` import resolves inside *this checkout*
//     — through the plugin's tsconfig `paths` alias when it has one (which points
//     at packages/paseo-plugin-helper/src), otherwise through the workspace
//     node_modules link. Either way the code that runs came from a revision of
//     this repository, not from anything the plugin carries.
//   * A relative `./vendor/paseo-plugin-helper/...` import resolves to the
//     plugin's own committed copy, which travels with the plugin.
//
// Verified against the installed daemon's own esbuild: bundling
// plugins/uppidi-fleet/index.client.tsx inlines 73 helper inputs, every one from
// packages/paseo-plugin-helper/src and none from dist, while
// plugins/x-comms/index.client.tsx — which imports the vendored path directly —
// inlines 69 inputs, all from plugins/x-comms/**/vendor/. The committed
// `client/vendor/paseo-plugin-helper/` tree is therefore the *publish* artifact
// (mirror-github.mjs rewrites the bare specifiers to it) and not, by itself, the
// resolution a locally-loaded plugin gets.
//
// A plugin bundle cannot report its own resolution. The daemon evaluates it with
// globalThis.eval in a forked child handed no plugin directory, and esbuild has
// already inlined — and discarded the provenance of — the helper source. So the
// resolved identity is read here, from the checkout, and the plugin is only ever
// asked what it *declares*. Neither side fabricates a version: the resolved
// version is the helper's own package.json `version`, and the resolved revision
// is `git log -1` over the tree that was actually read.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

/** Helper package root — the tree a checkout-served resolution reads from. */
export const HELPER_ROOT = "packages/paseo-plugin-helper";

/** Where a plugin's runtime code gets its helper from. */
export const SERVED_FROM = ["checkout", "vendored", "mixed", "none"];

/** Plugin-owned declaration file. Parsed by regex, like shared/version.ts. */
const DECLARATION_FILE = "shared/helper-version.ts";

/** Vendored trees a plugin may own, matching the layout mirror-github.mjs rewrites to. */
const VENDORED_TREES = ["client", "server", "shared"];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", "vendor", "dist", ".git", "test"]);

function readGit(repoRoot, args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// A fixed 8-char abbreviation: `%h` alone is length-variable, so a report that
// prints a stamp's revision next to the served one would show `a50ea392` beside
// `b06f4886` and read as two different-length objects for the same thing.
const REV = ["log", "-n", "1", "--format=%h", "--abbrev=8"];

/** Short sha of the newest commit touching `relPath`, or null. */
export function revisionOf(repoRoot, relPath) {
  return readGit(repoRoot, [...REV, "--", relPath]) || null;
}

/** The helper revision as of a given commit, or null. */
export function helperRevisionAt(repoRoot, sha) {
  if (!sha) return null;
  return readGit(repoRoot, [...REV, sha, "--", HELPER_ROOT]) || null;
}

/** Short sha of HEAD, or null outside a repository. */
export function headOf(repoRoot) {
  return readGit(repoRoot, ["rev-parse", "--short", "HEAD"]) || null;
}

/**
 * Content digest of the helper tree, as `sha256:<12 hex>`.
 *
 * This replaces `git log -1 <stamped sha> -- <helper root>` as the way a
 * plugin's recorded helper revision is checked. That lookup depended on the
 * stamped sha still existing in the repository, and a squash-merge deletes the
 * very commit a stamp recorded: #643's own branch head `525c597e` landed as
 * `08277a55`, so four plugins carried a sha no clean clone could resolve
 * (`fatal: bad object`) and the gate failed in CI while passing on any machine
 * that still had the branch worktree.
 *
 * A digest of the files themselves has none of those failure modes. It is
 * unchanged by squash, rebase, force-push and shallow clones, and it answers
 * the question actually being asked — *is the helper I am serving the helper I
 * was built against* — rather than a proxy for it that a VCS operation can
 * invalidate.
 *
 * Sorted relative paths, hashed with their contents, so the result is
 * independent of directory iteration order.
 */
export function helperContentDigest(repoRoot) {
  const root = path.join(repoRoot, HELPER_ROOT, "src");
  if (!fs.existsSync(root)) return null;
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(root);
  if (files.length === 0) return null;
  const hash = crypto.createHash("sha256");
  for (const file of files.sort()) {
    hash.update(path.relative(root, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex").slice(0, 12)}`;
}

/**
 * True when `ancestor` is reachable from `descendant`, i.e. `descendant` carries
 * at least everything `ancestor` did. Prefers a real merge-base and falls back
 * to the prefix relation used elsewhere in this repo so a shallow clone still
 * answers instead of reporting a false negative.
 */
export function isAncestorOrEqual(repoRoot, ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  if (ancestor === descendant || descendant.startsWith(ancestor)) return true;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return true;
  } catch {
    // Exit 1 is the normal "not an ancestor" answer; a git failure is not a
    // verdict either way, and the caller reports `unknown` rather than a pass.
    return false;
  }
}

/** tsconfig.json is JSONC in practice; the repo's own configs carry no comments today. */
function parseTsconfig(tsconfigPath) {
  try {
    const raw = fs.readFileSync(tsconfigPath, "utf8")
      .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, comment) => (comment ? "" : m))
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The tsconfig `paths` entry for a helper subpath, or null. */
export function helperPathAlias(pluginDir, subpath = "client") {
  const paths = parseTsconfig(path.join(pluginDir, "tsconfig.json"))?.compilerOptions?.paths;
  if (!paths || typeof paths !== "object") return null;
  const alias = paths[`paseo-plugin-helper/${subpath}`];
  return Array.isArray(alias) ? alias : null;
}

/** Absolute path of a committed vendored helper tree, or null. */
export function vendoredTreeDir(pluginDir, tree) {
  const dir = path.join(pluginDir, tree, "vendor", "paseo-plugin-helper");
  try {
    return fs.statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Which vendored subpath a bare import route takes: the tsconfig alias names
 * the helper *src*, the workspace link's `exports` map names the built *dist*.
 * Both live in this checkout, so the route only sharpens the report.
 */
function bareImportRoute(pluginDir) {
  const alias = helperPathAlias(pluginDir);
  if (!alias) return "workspace-link";
  return alias.some((target) => /(^|\/)src\//.test(target)) ? "tsconfig-paths:src" : "tsconfig-paths:other";
}

function walkSources(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkSources(full, acc);
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !/\.test\.[cm]?tsx?$/.test(entry.name)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * A bare `paseo-plugin-helper/...` value import. Type-only imports are skipped
 * on purpose: the daemon erases them, so a file that imports only types never
 * pulls a helper copy into the bundle.
 */
const BARE_IMPORT_RE =
  /^(?!import\s+type\b)(?!export\s+type\b)(?:import|export)(?:\s+[^;"']*?\s+from\s+|\s*)["']paseo-plugin-helper(?:\/[^"']*)?["']/m;
const VENDORED_IMPORT_RE = /["'][^"']*\/vendor\/paseo-plugin-helper(?:\/[^"']*)?["']/;

/**
 * What a locally-loaded plugin of `pluginDir` actually gets, read off the
 * plugin's own runtime sources. Vendored trees, test files and the `test/`
 * helper directory are excluded: none of them reach the bundle.
 */
export function resolveServedFrom(pluginDir) {
  const bareSources = [];
  const vendoredSources = [];
  for (const file of walkSources(pluginDir)) {
    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (BARE_IMPORT_RE.test(src)) bareSources.push(path.relative(pluginDir, file));
    if (VENDORED_IMPORT_RE.test(src)) vendoredSources.push(path.relative(pluginDir, file));
  }

  const bare = bareSources.length;
  const vendored = vendoredSources.length;
  let servedFrom = "none";
  if (bare > 0 && vendored > 0) servedFrom = "mixed";
  else if (bare > 0) servedFrom = "checkout";
  else if (vendored > 0) servedFrom = "vendored";

  return {
    servedFrom,
    bareImports: bare,
    vendoredImports: vendored,
    // Both sides are named when they disagree: a bundle carrying two copies of
    // the helper is diagnosable only if you can see which files pulled which.
    // Only the minority side is listed in full — the bare side is usually most
    // of the plugin, and listing it buries the one file that caused the split.
    mixedSources:
      servedFrom === "mixed"
        ? bare >= vendored
          ? [...vendoredSources, `+${bare} more file(s) via the bare specifier`]
          : [...bareSources, `+${vendored} more file(s) via the vendored path`]
        : [],
    bareSources,
    vendoredSources,
    route: bare > 0 ? bareImportRoute(pluginDir) : null,
    vendoredTrees: VENDORED_TREES.filter((tree) => vendoredTreeDir(pluginDir, tree)),
  };
}

/** Reads `PLUGIN_VERSION` out of a plugin's generated stamp, if it has one. */
export function readPluginStamp(pluginDir) {
  for (const rel of ["shared/version.ts", "version.ts", "src/version.ts"]) {
    const file = path.join(pluginDir, rel);
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const full = content.match(/PLUGIN_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
    if (full) return { full, sha: full.includes("+") ? full.split("+").pop() : null, file };
  }
  return null;
}

/** `version` of the helper package rooted at `helperRoot`, or null. */
export function readHelperVersion(helperRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(helperRoot, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/**
 * The helper version a plugin *declares* it expects. Two existing forms in this
 * repo: a committed vendored tree pins it in its README, and a plugin served
 * from the checkout declares it in its own file, since nothing travelled with it
 * to be compared against.
 *
 * A README pin deliberately carries no `servedFrom`. It states which helper
 * version the *publish* copy holds, which is a different fact from what a
 * locally-loaded plugin runs — the eight plugins with a vendored tree all import
 * the bare specifier and serve this checkout instead. Only
 * `shared/helper-version.ts` declares a resolution, and that is the value the
 * gate holds the plugin to.
 */
export function readDeclaredHelper(pluginDir) {
  try {
    const content = fs.readFileSync(path.join(pluginDir, DECLARATION_FILE), "utf8");
    return {
      version: content.match(/HELPER_VERSION\s*=\s*["']([^"']+)["']/)?.[1] ?? null,
      servedFrom: content.match(/HELPER_SERVED_FROM\s*=\s*["']([^"']+)["']/)?.[1] ?? null,
      // Content digest of the helper this plugin was stamped against (#649).
      // Preferred over the checkout sha because no VCS operation can orphan it.
      revision: content.match(/HELPER_REVISION\s*=\s*["']([^"']+)["']/)?.[1] ?? null,
      source: DECLARATION_FILE,
    };
  } catch {
    // Fall through to the vendored pin.
  }

  for (const tree of ["shared", "client", "server"]) {
    try {
      const readme = fs.readFileSync(
        path.join(pluginDir, tree, "vendor", "paseo-plugin-helper", "README.md"),
        "utf8",
      );
      const pin = readme.match(/Pinned helper version:\s*([0-9A-Za-z.-]+)/)?.[1];
      if (pin) {
        return { version: pin.replace(/[.]+$/, ""), servedFrom: null, source: `${tree}/vendor/paseo-plugin-helper/README.md` };
      }
    } catch {
      // No pinned README in this tree; try the next.
    }
  }
  return null;
}

/**
 * Verdict for one plugin. `reasons` is empty exactly when `status` is "ok" or
 * "behind".
 *
 *  - "ok": what the plugin serves is attributable, and the checkout's helper is
 *    the one the plugin was last stamped against.
 *  - "behind": the checkout's helper is simply newer than the plugin's stamp —
 *    the helper improved and the plugin has not been re-stamped. The healthy
 *    direction of travel; worth a line, not a block.
 *  - "stale": the served helper cannot be attributed, is undeclared, is mixed
 *    with a second copy, or is older than the plugin's own stamp. Never healthy.
 *  - "unknown": git or the helper manifest could not be read, so no verdict is
 *    claimed. Never reported healthy either.
 */
export function evaluateHelperIdentity(pluginDir, repoRoot) {
  const observed = resolveServedFrom(pluginDir);
  const declared = readDeclaredHelper(pluginDir);
  const stamp = readPluginStamp(pluginDir);
  const helperRoot = path.join(repoRoot, HELPER_ROOT);
  const servedFromCheckout = observed.servedFrom === "checkout" || observed.servedFrom === "mixed";

  const resolvedVersion = servedFromCheckout ? readHelperVersion(helperRoot) : null;
  const resolvedRevision = servedFromCheckout ? revisionOf(repoRoot, HELPER_ROOT) : null;
  // The authoritative check is the content digest: `resolvedRevision` is kept for
  // display only, because it is a `git log` result and can be invalidated by a
  // squash-merge even when the helper is byte-for-byte the one that was built
  // against (#649).
  const resolvedDigest = servedFromCheckout ? helperContentDigest(repoRoot) : null;
  const stampedHelperRevision = stamp?.sha ? helperRevisionAt(repoRoot, stamp.sha) : null;

  const reasons = [];
  // `stale` must never be reported healthy, so it outranks `unknown`; `unknown`
  // outranks `ok`, because a check that could not complete is never a pass.
  let status = "ok";
  const fail = (reason) => {
    reasons.push(reason);
    status = "stale";
  };
  const undecidable = (reason) => {
    reasons.push(reason);
    if (status === "ok") status = "unknown";
  };

  if (observed.servedFrom === "mixed") {
    fail(
      `serves the helper twice — bare specifier and vendored copy in the same bundle (${observed.mixedSources.join(", ")}); which copy ran is not answerable from the log`,
    );
  }

  // A plugin that resolves no helper at all has nothing to declare: #629's
  // worktree-install exists precisely to prove the shared UI kit is not required,
  // and its own test enforces the absence of any helper import.
  if (observed.servedFrom !== "none") {
    if (!declared) {
      fail(`no declared helper expectation: add ${DECLARATION_FILE} or a pinned vendored README`);
    } else {
      if (declared.version && resolvedVersion && declared.version !== resolvedVersion) {
        fail(`declares helper ${declared.version} but the checkout's helper is ${resolvedVersion}`);
      }
      if (declared.servedFrom && !SERVED_FROM.includes(declared.servedFrom)) {
        fail(
          `${declared.source} declares HELPER_SERVED_FROM=${JSON.stringify(declared.servedFrom)}; expected one of ${SERVED_FROM.join(", ")}`,
        );
      } else if (declared.servedFrom && declared.servedFrom !== observed.servedFrom) {
        fail(
          `${declared.source} declares HELPER_SERVED_FROM="${declared.servedFrom}" but the plugin is served from "${observed.servedFrom}"`,
        );
      }
    }
  }

  if (servedFromCheckout) {
    if (!resolvedVersion) {
      undecidable(`cannot read ${path.join(HELPER_ROOT, "package.json")} version`);
    }
    if (!stamp) {
      // The whole of #633: a plugin served from the checkout with no stamp
      // cannot say which revision of the helper its process is running, so a
      // reload after a helper fix looks identical to a successful one.
      fail(
        "no shared/version.ts stamp: the served helper revision cannot be attributed to a commit (run `npm run stamp` in the plugin)",
      );
    } else if (!stamp.sha) {
      fail(`shared/version.ts carries no "+<sha>" revision: ${stamp.full}`);
    } else if (declared?.revision) {
      // Authoritative path (#649): compare the recorded content digest with
      // the digest of the helper tree actually on disk. No git involved, so a
      // squash-merge, rebase, force-push or shallow clone cannot invalidate it.
      if (declared.revision !== resolvedDigest) {
        fail(
          `serves helper ${resolvedDigest ?? "unreadable"} but was stamped against ${declared.revision}: the served helper is not the one this plugin was built with`,
        );
      }
    } else if (!stampedHelperRevision) {
      undecidable(
        `cannot resolve the helper as of the stamped revision ${stamp.sha}, and no HELPER_REVISION digest is recorded — run \`npm run stamp\` in the plugin`,
      );
    } else if (resolvedRevision && !isAncestorOrEqual(repoRoot, stampedHelperRevision, resolvedRevision)) {
      fail(
        `serves helper ${resolvedRevision} but was stamped at ${stamp.sha}, whose helper is ${stampedHelperRevision}: the served helper is older than the plugin's own stamp`,
      );
    } else if (resolvedRevision && resolvedRevision !== stampedHelperRevision && status === "ok") {
      status = "behind";
    }
  }

  return {
    servedFrom: observed.servedFrom,
    route: observed.route,
    bareImports: observed.bareImports,
    vendoredImports: observed.vendoredImports,
    mixedSources: observed.mixedSources,
    vendoredTrees: observed.vendoredTrees,
    declared,
    resolved: { version: resolvedVersion, revision: resolvedRevision, digest: resolvedDigest },
    stamped: stamp
      ? { full: stamp.full, sha: stamp.sha, helperRevision: stampedHelperRevision, digest: declared?.revision ?? null }
      : null,
    status,
    reasons,
  };
}
