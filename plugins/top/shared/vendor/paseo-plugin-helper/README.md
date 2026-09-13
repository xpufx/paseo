# Vendored paseo-plugin-helper (Track B of issue #71)

Pinned helper version: 0.4.0-beta.12 (copied from `packages/paseo-plugin-helper/src/{client,server,shared}`).

Why: lets `top` install with zero host requirements (no npm, no registry, no build key).
`plugins/top/paseo-plugin.json` has no `build` steps; Paseo's daemon bundles this source directly.

Layout (split to satisfy the daemon bundler, which only accepts modules under
`client/`, `server/`, `shared/`):
- `client/vendor/paseo-plugin-helper/` <- helper `src/client`
- `server/vendor/paseo-plugin-helper/` <- helper `src/server`
- `shared/vendor/paseo-plugin-helper/` <- helper `src/shared` (this dir)

Relative `.js` suffixes were stripped from intra-vendor imports (both tsc-bundler
and esbuild resolve extensionless); cross-tree imports (`../shared/...`) were
rewritten to the split locations.

Updating: re-copy the three dirs from the helper repo at the new version, redo
the import rewrites above, run `npm run typecheck` and the plugin tests in
`plugins/top`, and bump the pinned version above.
Manual versioning — dependabot/renovate will NOT update this copy.
