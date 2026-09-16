#!/usr/bin/env node
// vendor-sync: re-copy paseo-plugin-helper src trees into
// plugins/<plugin>/{client,server,shared}/vendor/paseo-plugin-helper/ so the
// released plugin installs with zero host requirements (no npm, no registry).
// Directory plugins import these vendored trees directly; they do not resolve
// the workspace package at runtime.
// See plugins/top/shared/vendor/paseo-plugin-helper/README.md (Track B, #71).
//
// Usage: node scripts/vendor-sync.mjs [--check] [--link]
//   --check: exit non-zero if the vendor trees differ from a fresh copy or are
//     dev links (a linked tree is not publishable).
//   --link: REFUSED. Dev symlinks are unsupported: Paseo's plugin compiler
//     reclassifies relative vendored imports by realpath and rejects a symlink
//     that resolves outside the plugin directory (plugin:
//     paseo-plugin-server-runtime-boundary), so a linked plugin will not load
//     or install. We must never ship or publish something that won't install;
//     run plain vendor-sync to materialize copies. A pre-existing linked tree
//     is still materialized by the plain sync path.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HELPER_SRC = path.join(ROOT, "packages", "paseo-plugin-helper", "src");
// Per-plugin helper src trees to vendor. "mcp" is server-side (node-only)
// and lands in <plugin>/server/vendor/paseo-plugin-helper/mcp/.
const PLUGINS = {
  "top": ["client", "server", "shared"],
  "mcp-tools": ["client", "server", "shared", "mcp"],
  "demo": ["client", "server", "shared"],
  "forges": ["client", "server", "shared"],
  "slash": ["client", "server", "shared"],
  "x-comms": ["client", "server", "shared", "mcp"],
  "twofado": ["client", "server", "shared"],
  "plugin-updates": ["client", "server", "shared"],
};
const TREES = ["client", "server", "shared", "mcp"];
const DEST_ROOT = "vendor/paseo-plugin-helper";
const CHECK = process.argv.includes("--check");
const LINK = process.argv.includes("--link");

// The shared vendor README has no helper-src counterpart, so a legacy --link pass
// would delete it (and per-plugin copies may differ).
// Stash it next to the link as <name>.link-bak (gitignored, dev-only) and
// restore it on materialize.
const README_BAK_SUFFIX = ".link-bak";

function readmeBackupPath(dest) {
  return `${dest}${README_BAK_SUFFIX}/README.md`;
}

function isLink(dir) {
  try {
    return fs.lstatSync(dir).isSymbolicLink();
  } catch {
    return false;
  }
}

// Dev-link mode is refused outright: Paseo's plugin compiler rejects a
// relative vendored symlink that realpaths outside the plugin directory, so a
// linked tree cannot load, build, or install. Never create that state.
function refuseLink() {
  console.error(
    [
      "error: --link is unsupported — vendored helper trees must remain materialized copies.",
      "",
      "Paseo's plugin compiler reclassifies relative vendored imports by realpath and",
      "rejects a symlink that resolves outside the plugin directory",
      "(plugin: paseo-plugin-server-runtime-boundary). A linked plugin will not load,",
      "build, or install, so we refuse to create that state.",
      "",
      "Materialize the vendored copies instead:",
      "  node scripts/vendor-sync.mjs",
    ].join("\n")
  );
  process.exit(2);
}

// Publish mode: replace linked dirs with transformed copies, restoring the
// stashed shared README.
function materializeLinks() {
  let changed = 0;
  for (const [plugin, trees] of Object.entries(PLUGINS)) {
    const pluginRoot = path.join(ROOT, "plugins", plugin);
    for (const tree of trees) {
      const dest = destDir(pluginRoot, tree);
      if (!isLink(dest)) continue;
      fs.unlinkSync(dest);
      fs.mkdirSync(dest, { recursive: true });
      const bak = readmeBackupPath(dest);
      if (fs.existsSync(bak)) {
        fs.renameSync(bak, path.join(dest, "README.md"));
        try {
          fs.rmdirSync(path.dirname(bak));
        } catch {
          // Non-empty (shouldn't happen) — leave it.
        }
      }
      changed++;
    }
  }
  return changed;
}

// Destination dir for a helper src tree inside a plugin.
function destDir(pluginRoot, srcTree) {
  if (srcTree === "mcp") return path.join(pluginRoot, "server", DEST_ROOT, "mcp");
  return path.join(pluginRoot, srcTree, DEST_ROOT);
}

// Rewrite a module specifier from a helper-src file to its vendored location.
// destFile: absolute path of the destination file being written.
// pluginRoot: absolute path of the plugin (e.g. plugins/top).
function rewriteSpecifier(spec, srcFile, destFile, pluginRoot) {
  if (!spec.startsWith(".")) return spec;
  let out = spec.replace(/\.js$/, "");
  const resolved = path.normalize(path.join(path.dirname(srcFile), out));
  const rel = path.relative(HELPER_SRC, resolved);
  const segs = rel.split(path.sep);
  const srcTree = path.relative(HELPER_SRC, srcFile).split(path.sep)[0];
  if (segs[0] === ".." || segs[0] !== srcTree) {
    // Cross-tree (or escaping) reference: map into the split vendor layout.
    // Supported shapes: ../<tree>/..., ../../<tree>/... relative to src file.
    const targetTree = segs.includes("..") ? null : segs[0];
    if (!targetTree || !TREES.includes(targetTree)) {
      console.warn(`  ! ${path.relative(ROOT, srcFile)}: unmapped cross-tree import "${spec}" — vendored copy may be broken`);
      return out;
    }
    const target = path.join(destDir(pluginRoot, targetTree), ...segs.slice(1));
    let relOut = path.relative(path.dirname(destFile), target);
    if (!relOut.startsWith(".")) relOut = `./${relOut}`;
    return relOut;
  }
  return out;
}

const SPEC_RE = /(from\s+|import\s*\(\s*|export\s+[^"']*from\s+)(["'])(\.[^"']*)\2/g;

function transform(src, srcFile, destFile, pluginRoot) {
  return src.replace(SPEC_RE, (m, kw, q, spec) => {
    return `${kw}${q}${rewriteSpecifier(spec, srcFile, destFile, pluginRoot)}${q}`;
  });
}

function copyTree(pluginRoot, tree) {
  const srcDir = path.join(HELPER_SRC, tree);
  const dstDir = destDir(pluginRoot, tree);
  let changed = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      // Never follow the committed src/server/mcp symlink here: the mcp
      // tree has its own copy pass with cross-tree specifier rewriting.
      if (e.isSymbolicLink()) continue;
      const s = path.join(dir, e.name);
      const rel = path.relative(srcDir, s);
      const d = path.join(dstDir, rel);
      if (e.isDirectory()) {
        if (!CHECK) fs.mkdirSync(d, { recursive: true });
        walk(s);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        const out = transform(fs.readFileSync(s, "utf-8"), s, d, pluginRoot);
        if (CHECK) {
          const cur = fs.existsSync(d) ? fs.readFileSync(d, "utf-8") : null;
          if (cur !== out) {
            console.log(`  drift: ${path.relative(ROOT, d)}`);
            changed++;
          }
        } else {
          fs.mkdirSync(path.dirname(d), { recursive: true });
          if (!fs.existsSync(d) || fs.readFileSync(d, "utf-8") !== out) {
            fs.writeFileSync(d, out);
            changed++;
          }
        }
      }
    }
  };
  walk(srcDir);
  return changed;
}

// Drop files in vendor dirs that no longer exist in helper src.
function prune(pluginRoot, tree) {
  const srcDir = path.join(HELPER_SRC, tree);
  const dstDir = destDir(pluginRoot, tree);
  let removed = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      // The "mcp" helper tree lives under server/vendor/.../mcp; the
      // "server" prune pass must not treat it as dead server files.
      if (tree === "server" && dir === dstDir && e.isDirectory() && e.name === "mcp") continue;
      const d = path.join(dir, e.name);
      const s = path.join(srcDir, path.relative(dstDir, d));
      if (e.isDirectory()) {
        walk(d);
        if (fs.readdirSync(d).length === 0 && !CHECK) fs.rmdirSync(d);
      } else if (!fs.existsSync(s)) {
        // Keep the vendor README (has no helper-src counterpart).
        if (e.name === "README.md") continue;
        console.log(`  pruned: ${path.relative(ROOT, d)}`);
        if (!CHECK) fs.unlinkSync(d);
        removed++;
      }
    }
  };
  if (fs.existsSync(dstDir)) walk(dstDir);
  return removed;
}

if (LINK) {
  if (CHECK) {
    console.error("error: --link and --check are mutually exclusive");
    process.exit(2);
  }
  refuseLink();
} else {
  syncOnce();
}

function syncOnce() {
let dirty = 0;
for (const [plugin, trees] of Object.entries(PLUGINS)) {
  const pluginRoot = path.join(ROOT, "plugins", plugin);
  for (const tree of trees) {
    const dest = destDir(pluginRoot, tree);
    // A deliberate dev link is not copy drift: report it with a distinct
    // marker so callers keying on "drift:" (doctor-live auto-sync) do not
    // mistake it for stale copies and materialize it away.
    if (isLink(dest)) {
      console.log(`  linked: ${path.relative(ROOT, dest)} (dev link to helper src — not publishable; run node scripts/vendor-sync.mjs to materialize)`);
      dirty++;
      continue;
    }
    // A leftover README stash without a link is still real drift.
    if (fs.existsSync(readmeBackupPath(dest))) {
      console.log(`  drift: ${path.relative(ROOT, dest)} (leftover README stash — run node scripts/vendor-sync.mjs)`);
      dirty++;
      continue;
    }
    if (CHECK) {
      dirty += copyTree(pluginRoot, tree);
      dirty += prune(pluginRoot, tree);
      continue;
    }
    dirty += copyTree(pluginRoot, tree);
    dirty += prune(pluginRoot, tree);
  }
}
if (!CHECK) {
  dirty += materializeLinks();
  for (const [plugin, trees] of Object.entries(PLUGINS)) {
    const pluginRoot = path.join(ROOT, "plugins", plugin);
    for (const tree of trees) {
      dirty += copyTree(pluginRoot, tree);
      dirty += prune(pluginRoot, tree);
    }
  }
}

// Stamp pinned version into each plugin's vendor README.
const helperVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, "packages", "paseo-plugin-helper", "package.json"), "utf-8")
).version;
for (const plugin of Object.keys(PLUGINS)) {
  const readmePath = path.join(destDir(path.join(ROOT, "plugins", plugin), "shared"), "README.md");
if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, "utf-8");
  const updated = readme.replace(
    /Pinned helper version: \S+/,
    `Pinned helper version: ${helperVersion}`
  );
  if (updated !== readme) {
      if (!CHECK) fs.writeFileSync(readmePath, updated);
      dirty++;
    }
  }
}

if (CHECK && dirty > 0) {
  console.log(`vendor trees drifted (${dirty} file(s)) — run node scripts/vendor-sync.mjs`);
  process.exit(1);
}
console.log(dirty === 0 ? "vendor trees in sync" : `vendor trees updated (${dirty} file(s))`);
}
