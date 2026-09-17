/**
 * npm publish metadata for plugin packages (xpufx-org/paseo#211).
 *
 * A Paseo plugin is consumed as TypeScript source: the daemon's plugin runtime
 * accepts only `index.client.{ts,tsx}` / `index.server.{ts,tsx}` and compiles
 * them with esbuild at load time. There is therefore no build step and no
 * `dist/`; `files` must ship the sources (which also carries the vendored
 * `paseo-plugin-helper` copies nested under client/server/shared).
 */

/** Directories every plugin package must publish. */
export const REQUIRED_DIRS = ["client", "server", "shared"];

/** Optional directories published when present. */
export const OPTIONAL_DIRS = ["mcp", "docs", "examples", "scripts"];

/** Root-level files every plugin package must publish. */
export const REQUIRED_FILES = ["paseo-plugin.json", "README.md", "LICENSE"];

/**
 * Negation patterns applied to every package. `*.test.*` covers the plugin test
 * suites and the helper's vendored tests; `.DS_Store` and `node_modules` are
 * never intended to ship.
 */
export const TEST_EXCLUDES = ["!**/*.test.ts", "!**/*.test.tsx", "!**/*.test.mjs", "!**/.DS_Store"];

/**
 * Compute the npm publish name for a plugin.
 *
 * The npm package name is independent of the plugin's identity: the daemon
 * reads `id` from `paseo-plugin.json`, so `@xpufx/paseo-top` publishes while the
 * plugin still installs and displays as `top`. Scoping is required only because
 * bare names like `top` are taken on the public registry.
 */
export function publishName(pluginId, scope = "@xpufx") {
  return `${scope}/paseo-${pluginId}`;
}

/**
 * Build the `files` allowlist for a plugin directory.
 *
 * Only existing paths are listed, so a plugin without an `mcp/` directory does
 * not reference one. Screenshots are deliberately excluded: they are the bulk
 * of the current tarballs and are not needed at install time.
 *
 * Test files are excluded by negation. They are harmless at install (the daemon
 * only loads the entry points) but they are publish bloat, and npm `files`
 * supports `!` patterns.
 */
export function filesAllowlist(existingPaths) {
  const present = new Set(existingPaths);
  return [
    ...REQUIRED_FILES.filter((f) => present.has(f)),
    ...REQUIRED_DIRS.filter((d) => present.has(d)),
    ...OPTIONAL_DIRS.filter((d) => present.has(d)),
    ...TEST_EXCLUDES,
  ];
}

/** Repository metadata shared by every published plugin package. */
export function repositoryField(repoUrl) {
  return { type: "git", url: repoUrl };
}
