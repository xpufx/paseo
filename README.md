# xpufx/paseo

> [!NOTE]
> **Release mirror**: this GitHub repository mirrors releases of the canonical monorepo, which lives on a private Forgejo instance. It is read-only for development purposes.

Monorepo for xpufx [Paseo](https://github.com/getpaseo/paseo) tooling: shared runtime libraries, plugins, MCP servers, backend domain engines, and agent skills.

> [!NOTE]
> **Platform Support**: Developed and tested primarily on **Linux**, but structured to work cross-platform on **macOS** and **Windows**.

## Layout

### Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`packages/paseo-plugin-helper/`](packages/paseo-plugin-helper/) | Shared runtime library for Paseo plugins — UI components, server utilities, RPC contracts, settings schema, and testing harness. Published as `paseo-plugin-helper`. | `paseo-plugin-helper` |
| [`packages/paseo-plugin-ui/`](packages/paseo-plugin-ui/) | Shared UI composition and design primitives for Paseo plugins (HostThemeProvider, HostCard, HostBadge, HostButton, etc.). | `@xpufx/paseo-plugin-ui` |
| [`packages/mcp-gateway/`](packages/mcp-gateway/) | Typed MCP gateway client and protocol adapter — composite routing, REST control server, and lightweight proxy. | `@xpufx/mcp-gateway` |
| [`packages/permission-audit/`](packages/permission-audit/) | Standalone permission policy audit and verification tooling. | — |
| [`packages/backend/fleet/`](packages/backend/fleet/) | Headless fleet management domain engine — agent roster graph, worktree resolution, queue state machine, and watchdog anomaly classifier. | `@xpufx/backend-fleet` |
| [`packages/backend/hook/`](packages/backend/hook/) | Multi-forge webhook signature validation and queue engine — HMAC validators, payload normalizers, and queue backends. | `@xpufx/backend-hook` |
| [`packages/backend/tickets/`](packages/backend/tickets/) | Headless ticket & kanban board domain engine — Forgejo issue tracker, label taxonomy, and Kanban state machine. | `@xpufx/backend-tickets` |

### Plugins

| Plugin | Description |
|--------|-------------|
| [`plugins/uppidi-fleet/`](plugins/uppidi-fleet/) | Fleet supervision, watchdog auto-recovery, and multi-repo orchestrator coordination. Turns a Forgejo/Gitea board into an autonomous engineering fleet control plane. |
| [`plugins/top/`](plugins/top/) | Live host system resource monitor, timeline telemetry, and metric pills. |
| [`plugins/x-comms/`](plugins/x-comms/) | Cross-daemon agent conversation mesh and two-tier peer discovery. |
| [`plugins/forges/`](plugins/forges/) | Forge/Gitea-family issue tracker and workflow integration — list issues, read bodies and comments, change labels, post comments from inside Paseo. |
| [`plugins/slash/`](plugins/slash/) | Slash-command console for custom composer commands with autocomplete support. |
| [`plugins/twofado/`](plugins/twofado/) | Approval-gate surface for the 2fado privileged-command daemon — approve, deny, or acknowledge risky commands without leaving Paseo. |
| [`plugins/mcp-tools/`](plugins/mcp-tools/) | MCP server fleet management and diagnostic plugin — list tools, execute them with auto-generated forms, and run diagnostics. |
| [`plugins/worktree-install/`](plugins/worktree-install/) | Git worktree management and workspace isolation tools — a second fleet surface with Fleet, Queue, and Tickets panels. |
| [`plugins/plugin-updates/`](plugins/plugin-updates/) | Git-source update monitor and updater for installed plugins — check status, pull updates, one-click refresh. |
| [`plugins/wellbeing/`](plugins/wellbeing/) | Developer wellbeing and ergonomics assistant — operator presence tracking, circadian schedule management, and fatigue alerting. |
| [`plugins/permission-logger/`](plugins/permission-logger/) | Permission request and resolution audit logging — records tool calls and permission decisions with agent attribution in a queryable sidebar. |
| [`plugins/demo/`](plugins/demo/) | Conformance testbed and canonical showcase for plugin helper primitives. |
| [`plugins/antigravity-claude/`](plugins/antigravity-claude/) | Antigravity Claude plugin provider integration — exposes Claude and GPT models under their own provider name. |

## Installation

### From npm

Install each plugin from npm:

```sh
# Host system resource monitor
paseo plugin add npm:@xpufx/paseo-top
```

Replace `@xpufx/paseo-top` with any published plugin package ID listed above. Each plugin README has copy-paste commands for that plugin.

### From git source

Install directly from this Git repository:

```sh
# Host system resource monitor
paseo plugin add xpufx/paseo --path plugins/top
```

Replace `top` with any plugin directory name listed above.

### npm packages (headless backend)

Headless backend packages are published to npm and consumed as dependencies by other packages or plugins:

```sh
npm install @xpufx/backend-fleet @xpufx/backend-hook @xpufx/backend-tickets @xpufx/mcp-gateway @xpufx/paseo-plugin-ui
```

## Development

```sh
npm install
make check      # Run full typecheck, tests, and plugin UI conformance
make doctor     # Freshness diagnostic for helper build and running daemons
make reload     # Auto-rebuild helper, stamp git versions, and reload daemons
```

### Make targets

| Target | Description |
|--------|-------------|
| `make doctor` | Inspect helper compilation, version stamps, and live Paseo daemons |
| `make reload` | Auto-rebuild and vendor helper, stamp version, and reload affected daemons |
| `make check` | Run typecheck, tests, and plugin UI conformance across the monorepo |
| `make typecheck` | Run TypeScript compiler check across all workspaces |
| `make test` | Run unit tests across all workspaces |
| `make conformance` | Check helper UI conformance for every plugin |
| `make build` | Build packages and plugins |
| `make packages-build` | Build all headless backend packages and plugin-ui |
| `make packages-publish-dry` | Dry-run publish headless packages to npm |
| `make packages-publish` | Publish headless packages to npm |

### Granular workspace commands

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
npm staging; after each newly accepted version it uses the existing
notify-only `2fado notify` CLI path to send a package/version outcome. The
notification is **best-effort**: when `2fado` is missing from the runner or its
daemon socket is unreachable, the workflow and helper log a warning and still
stage and upload the tarballs. Duplicate skips and failed staging attempts do
not notify; the human runs `npm stage approve <stage-id>` (2FA).

## Native npm acquisition support

Published plugins are tested with Node.js **18 or later** by
`npm run test:npm-acquisition`: each package is packed, installed into a new
consumer with production dependencies only and lifecycle scripts disabled, and
then only its `paseo-plugin.json` build commands run.

## Storage Namespace

Plugin persistent storage converges on `~/.paseo/plugin-data/xpufx/<pluginId>/`, managed canonically by `paseo-plugin-helper`.

## Branch & Backport Policy

- **`main`** — Current SDK mainline. Feature work targets here.
- **Maintenance branch** — Preserved baseline; only necessary bug and security
  fixes belong here.

Normal PRs target `main`; only bug and security fixes are backported to the
maintenance branch, generally landing on `main` first. Milestones distinguish
maintenance fixes from current feature and migration work.

See [`docs/branch-policy.md`](docs/branch-policy.md) for details.

## Deepwiki Link

[xpufx/paseo](https://deepwiki.com/xpufx/paseo)

## License

MIT
