# xpufx/paseo

> [!NOTE]
> **Release mirror**: this GitHub repository mirrors releases of the canonical monorepo, which lives on a private Forgejo instance. It is read-only for development purposes.

Monorepo for xpufx [Paseo](https://github.com/getpaseo/paseo) tooling: shared runtime libraries, plugins, MCP servers, and agent skills.

> [!NOTE]
> **Platform Support**: Developed and tested primarily on **Linux**, but structured to work cross-platform on **macOS** and **Windows**.

## Layout

- [`plugins/top/`](plugins/top/) — Live host system resource monitor, timeline telemetry, and customizable metric pills (v0.4.0).
- [`packages/paseo-plugin-helper/`](packages/paseo-plugin-helper/) — Shared runtime library for Paseo plugins (UI components, server utilities, RPC contracts, settings schema, and testing harness). Published to npm as `paseo-plugin-helper`.
- [`plugins/mcp-tools/`](plugins/mcp-tools/) — MCP server fleet management and diagnostic plugin.
- [`plugins/x-comms/`](plugins/x-comms/) — Cross-daemon agent conversation mesh plugin (coming soon).
- [`plugins/forges/`](plugins/forges/) — Forge/Gitea-family issue tracker and workflow integration plugin.
- [`plugins/slash/`](plugins/slash/) — Slash-command console: manage and run custom composer slash commands.
- [`plugins/twofado/`](plugins/twofado/) — Approval-gate surface for the 2fado privileged-command daemon (coming soon).
- [`plugins/plugin-updates/`](plugins/plugin-updates/) — Git-source update monitor for installed plugins.
- [`plugins/demo/`](plugins/demo/) — Conformance testbed and canonical showcase for `paseo-plugin-helper` primitives.

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

## Branch & Backport Policy

- **`main`** — SDK 0.9 mainline. Feature work targets here.
- **`release/0.8`** — SDK 0.8 maintenance. Preserved baseline; only necessary
  bug/security fixes.

Normal PRs target `main`; only bug/security fixes are backported to
`release/0.8`, generally landing on `main` first. Milestones: 0.8.x fixes →
`0.8.x Maintenance`; 0.9 work → `0.9.0 Features` / `0.9.0 Migration`.

See [`docs/branch-policy.md`](docs/branch-policy.md) for details.

## Deepwiki Link

[xpufx/paseo](https://deepwiki.com/xpufx/paseo)

### Granular Workspace Commands

```sh
# Typecheck or test a single plugin
npm run typecheck --workspace=plugins/top
npm test --workspace=plugins/top
```

## Plugin npm publishing (stage → upload → 2FA publish)

Plugins are publish-ready as `@xpufx/paseo-<id>`; see `scripts/publish-npm.mjs`.
The flow keeps proof-of-presence (npm 2FA/OTP) on the human while agents/CI do
the mechanical work:

```sh
make npm-stage           # agent/CI: pack tarballs into publish-stage/ (no registry, no 2FA)
# upload publish-stage/ as a CI artifact
make npm-publish-dry     # human: print the exact publish commands
make npm-publish         # human: npm publish --access public (prompts for OTP)
```

`node scripts/publish-npm.mjs` with no flags stays a credential-free dry run.
Registry-native alternative (npm >= 11.19): only an explicitly dispatched
`npm stage` workflow with the `NPM_TOKEN` repository secret runs
`npm stage publish <tarball>` (no 2FA). It skips versions already pending in
npm staging; the human runs `npm stage approve <stage-id>` (2FA).

## Native npm acquisition support

Published plugins are tested with Node.js **18 or later** by
`npm run test:npm-acquisition`: each package is packed, installed into a new
consumer with production dependencies only and lifecycle scripts disabled, and
then only its `paseo-plugin.json` build commands run. `top` and
`plugin-updates` support Paseo **>= 0.8.0**. `x-comms` uses the 0.9 multi-host
client/protocol APIs and requires Paseo **>= 0.9.0-beta.2**.

## Storage Namespace

Plugin persistent storage converges on `~/.paseo/plugin-data/xpufx/<pluginId>/`, managed canonically by `paseo-plugin-helper`.

## License

MIT
