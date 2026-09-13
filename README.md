# xpufx/paseo

Monorepo for xpufx [Paseo](https://github.com/getpaseo/paseo) tooling: shared runtime libraries, plugins, MCP servers, and agent skills.

## Layout

- `plugins/top/` — Live host system resource monitor, timeline telemetry, and customizable metric pills (v0.4.0).
- `packages/paseo-plugin-helper/` — Shared runtime library for Paseo plugins (UI components, server utilities, RPC contracts, settings schema, and testing harness). Published to npm as `paseo-plugin-helper`.
- `plugins/mcp-tools/` — MCP server fleet management and diagnostic plugin.
- `plugins/x-comms/` — Cross-daemon agent conversation mesh plugin.
- `plugins/forgejo/` — Forgejo issue tracker and workflow integration plugin.
- `plugins/demo/` — Conformance testbed and canonical showcase for `paseo-plugin-helper` primitives.

## Installation

Plugins install individually via native Paseo 0.8 monorepo subpath syntax:

```sh
# Host system resource monitor
paseo plugin add xpufx/paseo --path plugins/top
```

*(Additional plugins will be enabled for public install as their releases are finalized.)*

## Development

```sh
npm install
make check      # Run full typecheck and unit test suite
make doctor     # Freshness diagnostic for helper build and running daemons
make reload     # Auto-rebuild helper, stamp git versions, and reload daemons
```

### Granular Workspace Commands

```sh
# Typecheck or test a single plugin
npm run typecheck --workspace=plugins/top
npm test --workspace=plugins/top
```

## Storage Namespace

Plugin persistent storage converges on `~/.paseo/xpufx-plugins/<pluginId>/`, managed canonically by `paseo-plugin-helper`.

## License

MIT
