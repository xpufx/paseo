#!/usr/bin/env node
// vendor-sync: refresh the committed paseo-plugin-helper copies under
// plugins/<plugin>/{client,server,shared}/vendor/paseo-plugin-helper/ so the
// published plugin installs with zero host requirements (no npm, no registry).
//
// Dev source imports the bare specifier `paseo-plugin-helper/client|server|
// shared|mcp`; each plugin's tsconfig `paths` aliases it to the helper src, so
// a helper src edit shows up on reload with no copy step (#176). The vendored
// copies are the *publish* artifact: mirror-github.mjs rewrites the bare
// specifiers to these relative copies when it stages the scoped tree.
//
// Usage: node scripts/vendor-sync.mjs [--check] [--link]
//   --check: exit non-zero if the vendored copies drift from a fresh copy of
//     the helper src, or if a legacy dev symlink is present (not publishable).
//   --link: dev-link preflight (no longer creates symlinks). Verifies the
//     workspace link + per-plugin tsconfig alias that give live helper edits.
//     The old relative-vendor symlink is unsupported by Paseo's compiler and
//     is retired (#146 option C).
// See plugins/top/shared/vendor/paseo-plugin-helper/README.md (Track B, #71).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PLUGINS, TREES, destDir } from "./lib/plugin-helper-layout.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER_SRC = path.join(ROOT, "packages", "paseo-plugin-helper", "src");
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

// Dev-link preflight: the live dev link is the workspace
// node_modules/paseo-plugin-helper package plus each plugin's tsconfig `paths`
// alias to the helper src. No vendor symlink is created (Paseo's compiler
// rejects a relative vendored symlink that escapes the plugin directory).
function devLinkStatus() {
  const helperRoot = path.join(ROOT, "packages", "paseo-plugin-helper");
  const workspaceLink = path.join(ROOT, "node_modules", "paseo-plugin-helper");
  const problems = [];

  let linkTarget = null;
  try {
    linkTarget = fs.realpathSync(workspaceLink);
  } catch {
    problems.push(`node_modules/paseo-plugin-helper is missing — run: npm install`);
  }
  if (linkTarget && linkTarget !== fs.realpathSync(helperRoot)) {
    problems.push(`node_modules/paseo-plugin-helper points at ${linkTarget}, not packages/paseo-plugin-helper`);
  }

  for (const plugin of Object.keys(PLUGINS)) {
    const tsconfig = path.join(ROOT, "plugins", plugin, "tsconfig.json");
    let raw = "";
    try {
      raw = fs.readFileSync(tsconfig, "utf-8");
    } catch {
      problems.push(`plugins/${plugin}/tsconfig.json is missing`);
      continue;
    }
    if (!raw.includes('"paseo-plugin-helper/client"')) {
      problems.push(`plugins/${plugin}/tsconfig.json has no "paseo-plugin-helper/client" path alias`);
    }
  }

  if (problems.length > 0) {
    console.error("dev live link is not ready:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("dev live link OK: bare paseo-plugin-helper/* resolves to helper src via the workspace link + tsconfig paths");
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
      // The client-side core and ui trees are colocated under the client
      // vendor root, but have their own source trees and prune passes.
      if (tree === "client" && dir === dstDir && e.isDirectory() && (e.name === "core" || e.name === "ui")) continue;
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

function main() {
  if (LINK) {
    if (CHECK) {
      console.error("error: --link and --check are mutually exclusive");
      process.exit(2);
    }
    devLinkStatus();
    return;
  }
  syncOnce();
}

// Only run when invoked as a script; mirror-github.mjs imports the shared
// layout module, not this file, but keep the guard so any import stays inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

function syncOnce() {
let dirty = 0;
for (const [plugin, trees] of Object.entries(PLUGINS)) {
  const pluginRoot = path.join(ROOT, "plugins", plugin);
  for (const tree of trees) {
    const dest = destDir(pluginRoot, tree);
    // A legacy relative-vendor symlink (pre-#176) is not copy drift: report it
    // with a distinct marker so it is never mistaken for stale copies. It is
    // not publishable and plain vendor-sync materializes it below.
    if (isLink(dest)) {
      console.log(`  linked: ${path.relative(ROOT, dest)} (legacy dev symlink — not publishable; run node scripts/vendor-sync.mjs to materialize)`);
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
