# Agent Mux Paseo Plugin (`@xpufx/paseo-agent-mux`)

A Paseo plugin providing metrics, account profile inspection, and live rate-limit quota monitoring for [`agent-mux`](https://forge.mrs.uppidi.com/xpufx-org/agent-mux).

## Overview

`agent-mux` multiplexes multi-account streaming agent sessions (Google Antigravity, OpenCode, Pi) with automatic failover, bubblewrap sandbox containment, and cooldown enforcement. This plugin surfaces all multiplexer state inside Paseo:

- **Dashboard**: At-a-glance quota health indicator (green/yellow/red), isolation mode status, active cooldown lock counts, and per-provider pool health with live connectivity probes.
- **Profiles Tab**: Inventory of all configured account profiles across providers (`antigravity`, `opencode`, `pi`), showing authentication status (`Authenticated`, `Pending login`, `missing directory`), account emails, local directory paths, registration state, and persistent enable/disable toggles.
- **Quota & Cooldowns Tab**: Live countdown timers for active rate-limit locks, cooldown reasons, reset timestamps, and scoped clear functionality.
- **Logs Tab**: Real-time routing decisions, failovers, and cooldown event history with event filtering (`ALL`, `SUPERVISOR`, `ROUTER`, `ERROR`) and adjustable tail depth.
- **Config Tab**: Global settings inspection (routing policy, stream surface account mode, config file path), CLI wrapper verification (`agy`, `opencode`, `pi`), and raw configuration JSON.
- **Settings Panel**: Custom plugin preferences for background refresh intervals, log tail depths, live countdown timers, and startup probes.

## Architecture

This plugin adheres to the standard Paseo v0.9 plugin architecture on `paseo-plugin-helper`:

```text
plugins/agent-mux/
├── paseo-plugin.json      # Manifest (id: "agent-mux", paseo >= 0.9.0)
├── package.json           # Workspace package definition
├── tsconfig.json          # TypeScript compilation configuration
├── index.client.tsx       # Client entry registering sidebar surface & command item
├── index.server.ts        # Server entry registering RPC handlers
├── shared/                # Typed RPC contracts, settings contracts, schemas, and types
│   ├── contracts.ts       # Strict Zod RPC contracts (defineContract)
│   ├── settings.ts        # Plugin settings schema (defineSettingsContract)
│   ├── types.ts           # Domain models
│   ├── helper-version.ts  # Declared helper version and resolution
│   └── version.ts         # Generated plugin version stamp
├── server/                # Server-side CLI execution & output parsers
│   ├── cli.ts             # Process execution wrapper (execFile for agent-mux & bwrap)
│   ├── parser.ts          # Pure functions for ANSI stripping & output parsing
│   ├── parser.test.ts     # Comprehensive parser unit test suite
│   ├── handlers.ts        # RPC handler implementations and PluginStorage
│   └── handlers.test.ts   # RPC server handler tests
└── client/                # React Native UI components
    ├── host-ui.tsx        # Shared UI kit primitives (@xpufx/paseo-plugin-ui)
    ├── agent-mux-surface.tsx # Root surface with tabs, queries, and mutations
    ├── tabs/              # Surface tab components
    │   ├── dashboard-tab.tsx
    │   ├── profiles-tab.tsx
    │   ├── cooldowns-tab.tsx
    │   ├── logs-tab.tsx
    │   ├── config-tab.tsx
    │   └── settings-tab.tsx
    ├── test-utils/        # Test environment stubs
    │   └── react-native.ts
    └── vitest.config.ts   # Vitest runner configuration
```

## Data Sources

All metrics and state are fetched via read-only invocations of the `agent-mux` CLI binary:
- `agent-mux status [--probe]`
- `agent-mux profile list [provider]`
- `agent-mux cooldowns [list]`
- `agent-mux logs [--tail N]`
- `agent-mux config list`
- `agent-mux wrappers`
- `agent-mux probe <provider>`
- Host probes: `bwrap --version`, `AGENT_MUX_PROFILE` environment variable.

All persistent plugin settings and profile toggle states are safely isolated under Paseo's canonical storage root (`~/.paseo/plugin-data/xpufx/agent-mux/`) using `PluginStorage`.

## Verification & Testing

Run the test suite and typechecks locally:

```bash
# In plugins/agent-mux:
npm run typecheck
npm test
```
