#!/usr/bin/env node
// vendor-sync: re-copy paseo-plugin-helper src/{client,server,shared} into
// plugins/top/{client,server,shared}/vendor/paseo-plugin-helper/ so the
// released plugin installs with zero host requirements (no npm, no registry).
// See plugins/top/shared/vendor/paseo-plugin-helper/README.md (Track B, #71).
//
// Usage: node scripts/vendor-sync.mjs [--check]
//   --check: exit non-zero if the vendor trees differ from a fresh copy.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HELPER_SRC = path.join(ROOT, "packages", "paseo-plugin-helper", "src");
const TOP = path.join(ROOT, "plugins", "top");
const TREES = ["client", "server", "shared"];
const DEST_ROOT = "vendor/paseo-plugin-helper";
const CHECK = process.argv.includes("--check");

function destDir(tree) {
  return path.join(TOP, tree, DEST_ROOT);
}

// Rewrite a module specifier from a helper-src file to its vendored location.
// destFile: absolute path of the destination file being written.
function rewriteSpecifier(spec, srcFile, destFile) {
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
    const target = path.join(TOP, targetTree, DEST_ROOT, ...segs.slice(1));
    let relOut = path.relative(path.dirname(destFile), target);
    if (!relOut.startsWith(".")) relOut = `./${relOut}`;
    return relOut;
  }
  return out;
}

const SPEC_RE = /(from\s+|import\s*\(\s*|export\s+[^"']*from\s+)(["'])(\.[^"']*)\2/g;

function transform(src, srcFile, destFile) {
  return src.replace(SPEC_RE, (m, kw, q, spec) => {
    return `${kw}${q}${rewriteSpecifier(spec, srcFile, destFile)}${q}`;
  });
}

function copyTree(tree) {
  const srcDir = path.join(HELPER_SRC, tree);
  const dstDir = destDir(tree);
  let changed = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const s = path.join(dir, e.name);
      const rel = path.relative(srcDir, s);
      const d = path.join(dstDir, rel);
      if (e.isDirectory()) {
        if (!CHECK) fs.mkdirSync(d, { recursive: true });
        walk(s);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        const out = transform(fs.readFileSync(s, "utf-8"), s, d);
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
function prune(tree) {
  const srcDir = path.join(HELPER_SRC, tree);
  const dstDir = destDir(tree);
  let removed = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
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

let dirty = 0;
for (const tree of TREES) {
  dirty += copyTree(tree);
  dirty += prune(tree);
}

// Stamp pinned version into the vendor README.
const helperVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, "packages", "paseo-plugin-helper", "package.json"), "utf-8")
).version;
const readmePath = path.join(destDir("shared"), "README.md");
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

if (CHECK && dirty > 0) {
  console.log(`vendor trees drifted (${dirty} file(s)) — run node scripts/vendor-sync.mjs`);
  process.exit(1);
}
console.log(dirty === 0 ? "vendor trees in sync" : `vendor trees updated (${dirty} file(s))`);
