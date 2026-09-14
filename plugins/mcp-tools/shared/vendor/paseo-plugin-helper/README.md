# Vendored paseo-plugin-helper (Track B of issue #71, plugin #100)

Pinned helper version: 0.4.0-beta.12.

Docs: https://github.com/xpufx/paseo/tree/main/packages/paseo-plugin-helper — npm: https://www.npmjs.com/package/paseo-plugin-helper

Zero host requirements (no npm, no registry, no build key): the daemon bundles
this source directly. Layout: `client/`, `server/`, `shared/` (+ `mcp/` under
server) vendor splits mapping helper `src/` trees (daemon accepts modules only
under those dirs). Updating: run `make vendor-sync` and bump the pinned version
above.
