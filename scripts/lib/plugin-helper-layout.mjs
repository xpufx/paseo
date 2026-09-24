// Single source of truth for how a plugin's vendored paseo-plugin-helper copies
// are laid out on disk, and for translating between the two import forms:
//
//   dev (committed)          publish (staged mirror tree)
//   paseo-plugin-helper/x    ./vendor/paseo-plugin-helper/index
//
// Dev source imports the bare specifier so the workspace
// node_modules/paseo-plugin-helper link (aliased to the helper src by each
// plugin's tsconfig paths) gives live helper edits with no copy step. Paseo's
// compiler rejects a *relative* vendored import that realpaths outside the
// plugin directory, but allows the bare specifier to resolve to a linked
// dependency root. The published tree has no node_modules, so mirror-github.mjs
// rewrites the bare specifiers to the committed vendored copies before staging.

import path from "node:path";

// Per-plugin helper src trees to vendor. "core" and "ui" are client-side
// exports and are colocated under <plugin>/client/vendor; "mcp" is server-side
// (node-only) and lands in <plugin>/server/vendor/paseo-plugin-helper/mcp/.
export const PLUGINS = {
  "top": ["client", "server", "shared"],
  "mcp-tools": ["client", "server", "shared", "mcp"],
  "demo": ["client", "core", "ui", "server", "shared"],
  "forges": ["client", "server", "shared"],
  "slash": ["client", "server", "shared"],
  "x-comms": ["client", "server", "shared", "mcp"],
  "twofado": ["client", "server", "shared"],
  "plugin-updates": ["client", "server", "shared"],
  "wellbeing": ["client", "server", "shared"],
};

export const TREES = ["client", "core", "ui", "server", "shared", "mcp"];
export const DEST_ROOT = "vendor/paseo-plugin-helper";

// Destination dir for a helper src tree inside a plugin.
export function destDir(pluginRoot, srcTree) {
  if (srcTree === "mcp") return path.join(pluginRoot, "server", DEST_ROOT, "mcp");
  if (srcTree === "core" || srcTree === "ui") {
    return path.join(pluginRoot, "client", DEST_ROOT, srcTree);
  }
  return path.join(pluginRoot, srcTree, DEST_ROOT);
}

const BARE_SPEC_RE =
  /(from\s+|import\s*\(\s*|export\s+[^"']*from\s+)(["'])paseo-plugin-helper\/([a-z-]+)\2/g;

// Publish rewrite: bare `paseo-plugin-helper/<tree>` -> the committed vendored
// relative copy. `fileAbs` is the source file (absolute) and `pluginRoot` the
// plugin directory; the returned specifier is relative to the source file.
export function rewriteBareSpecifiers(src, fileAbs, pluginRoot) {
  return src.replace(BARE_SPEC_RE, (match, kw, quote, tree) => {
    if (!TREES.includes(tree)) {
      throw new Error(
        `unmapped helper specifier "paseo-plugin-helper/${tree}" in ${fileAbs} — add it to plugin-helper-layout.mjs`
      );
    }
    const target = path.join(destDir(pluginRoot, tree), "index");
    let rel = path.relative(path.dirname(fileAbs), target);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `${kw}${quote}${rel}${quote}`;
  });
}

// True when a source file still carries a bare helper specifier (anything the
// publish rewrite must have removed). Used by the mirror as a post-rewrite guard.
export function hasBareHelperSpecifier(src) {
  return /(["'])paseo-plugin-helper(\/|\1)/.test(src);
}
