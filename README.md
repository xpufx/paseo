# xpufx/paseo

Monorepo for xpufx Paseo tooling. Primary home is Forgejo
(`ssh://git@forge.mrs.aager.de:222/xpufx/paseo.git`); GitHub
(`xpufx/paseo`) is a mirror target.

## Layout

- `packages/paseo-plugin-helper/` — shared runtime library for Paseo
  plugins (client UI, server utilities, settings contracts). Published to
  npm as `paseo-plugin-helper`; workspaces link it locally.
- `plugins/top/` — host resource monitor plugin.
- `plugins/mcp-tools/` — MCP server fleet management plugin.
- `plugins/x-comms/` — cross-daemon agent conversation plugin.
- `plugins/forgejo/` — Forgejo issues plugin.
- `mcp/` — standalone MCP servers (copy of `plugins/x-comms/mcp` at
  consolidation time; the plugin-embedded copy under `plugins/x-comms/mcp`
  is canonical).
- `skills/` — agent skills (copy of
  `packages/paseo-plugin-helper/.agents/skills` at consolidation time;
  the helper tree is canonical).

## Install (no fleet script)

Plugins install individually via native Paseo 0.8 subpath syntax:

```sh
paseo plugin add xpufx/paseo --path plugins/top
paseo plugin add xpufx/paseo --path plugins/mcp-tools
paseo plugin add xpufx/paseo --path plugins/x-comms
paseo plugin add xpufx/paseo --path plugins/forgejo
```

## Develop

```sh
npm install
npm run typecheck
npm test
```

Helper, top, and mcp-tools are green under the hoisted workspace
dependencies. Two pre-existing cross-version drifts fail root typecheck
and are intentionally untouched here (aggregation only, no plugin edits):

- `plugins/x-comms` targets SDK `0.8.0-beta.1` while the workspace hoists
  stable `0.8.0`, which dropped `PluginComposerPillProps`. It typechecks
  under its own lockfile; migration to the stable SDK belongs to its
  owner.
- `plugins/forgejo` passes react-query v5 `refetch()` promises into
  `void` slots. Same story: green in its own tree, fix belongs upstream
  of this repo.

## Storage namespace

Plugin persistent storage converges on `~/.paseo/xpufx-plugins/<pluginId>/`.
Tracked in [Issue #49](https://forge.mrs.aager.de/xpufx/paseo-plugin-helper/issues/49);
the helper implementation lives in its own issue, this repo only records
the direction.
