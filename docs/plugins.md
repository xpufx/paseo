# Paseo Plugins Architecture & Guide

> Complete architecture, lifecycle, runtime boundaries, server capabilities, and UI systems for building trusted Paseo plugins.
>
> **Monorepo context**: This document outlines plugin development within the `xpufx/paseo` monorepo (`~/code/paseo`), integrating the shared [`paseo-plugin-helper`](../packages/paseo-plugin-helper/README.md) runtime library with the core Paseo engine contracts documented in the [upstream Paseo repository](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md).

---

## Table of Contents

1. [Overview & Trust Model](#1-overview--trust-model)
2. [Monorepo Ecosystem & Helper Primitives](#2-monorepo-ecosystem--helper-primitives)
3. [Project Anatomy & Directory Boundaries](#3-project-anatomy--directory-boundaries)
4. [Manifest & Version Requirements](#4-manifest--version-requirements)
5. [Daemon Lifecycle & Management CLI](#5-daemon-lifecycle--management-cli)
6. [Server Runtime (`index.server.ts`)](#6-server-runtime-indexserverts)
   - [Type-Safe RPC Contracts](#type-safe-rpc-contracts)
   - [Atomic Storage & State](#atomic-storage--state)
   - [Structured Logging & Process Execution](#structured-logging--process-execution)
   - [Lifecycle Observers (`server.on`)](#lifecycle-observers-serveron)
   - [Creation & Before Hooks (`server.before`)](#creation--before-hooks-serverbefore)
7. [UI Subsystem Map (`docs/plugin/ui/`)](#7-ui-subsystem-map)
8. [Testing & Conformance](#8-testing--conformance)
9. [Hook Router Discovery & Front Desk Registration](#9-hook-router-discovery--front-desk-registration)
10. [Reference Links & Upstream Documents](#10-reference-links--upstream-documents)

---

## 1. Overview & Trust Model

Paseo plugins allow authors to extend both the Paseo background daemon (Node.js 20+) and connected client applications (Electron desktop, iOS, Android, web browser). Plugins can contribute:
- Native app surfaces and sidebar entries
- Workspace tabs and Explorer sidebar panels
- Command Center items (⌘K) and composer slash commands
- Composer track bar pills and custom metric pills
- Agent timeline item transformers and custom card renderers
- Daemon-appended timeline events
- Composer attachment sources
- Custom light and dark themes
- Settings screens with automatic daemon persistence
- Daemon-side RPC handlers, background tasks, and MCP server injections
- Full custom agent harnesses via Provider registrations

### Trust & Security
> [!CAUTION]
> **Plugins are unsandboxed, highly trusted code.**
> - Server code runs in a daemon subprocess with the local user permissions of the daemon machine (filesystem, network, processes).
> - Client code runs directly inside the Paseo app context across connected devices.
>
> The daemon enforces a global security switch: `pluginsEnabled: true` in `$PASEO_HOME/config.json`. The daemon will **never** execute plugins unless this switch is active. Changing this setting requires `paseo reload`.

---

## 2. Monorepo Ecosystem & Helper Primitives

In this repository (`~/code/paseo`), plugins are authored using [`paseo-plugin-helper`](../packages/paseo-plugin-helper/README.md), a standardized development kit designed to eliminate boilerplate and ensure uniform UX, cross-platform stability, and mobile compatibility across our plugin fleet (`top`, `demo`, `mcp-tools`, `x-comms`, `forges`, `slash`, `twofado`, etc.).

| Area | Raw Upstream API | `paseo-plugin-helper` Advantage |
| :--- | :--- | :--- |
| **Client UI** | Raw React Native primitives + Lucide icon lookup | Complete UI component suite (`Card`, `Badge`, `Tabs`, `Button`, `MetricGauge`, `DataTable`, `ModalBody`, `Grid`) with mobile-first responsiveness and configurable visual flairs (`sharp`, `rounded`, `pill`). |
| **Pill Engine** | Manual agent subscriptions + modal state machines | `registerComposerPill` manages agent tracking, lifecycle cleanup, popovers, and mobile sheet interactions in one call. |
| **RPC & State** | Plain `useRpc` calls with manual React state | `useRpcQuery` / `useRpcMutation` with automatic TanStack Query caching, deduplication, and input hashing. |
| **Server State** | Raw `fs.writeFile` | `PluginStorage`: Atomic JSON temporary-swap storage preventing state corruption on power cuts or crashes. |
| **Processes** | Raw `child_process.spawn` | `safeSpawn`: Process execution with tree-kill safeguards, timeouts, and structured error handling. |
| **Logging** | Bare `console.log` | `createPluginLogger`: Unfragmented JSON logging with plugin identity/version banners in Paseo daemon logs. |
| **Conformance** | Manual code reviews | `npx paseo-plugin-helper audit` CLI checks compliance with runtime boundaries, mobile rules, and token scales. |

---

## 3. Project Anatomy & Directory Boundaries

A Paseo plugin has a strict directory structure that enforces runtime isolation between client and server code:

```text
my-plugin/
├── paseo-plugin.json      # Manifest: plugin ID, supported Paseo versions, optional build steps
├── package.json           # Dependencies for local typechecking & compilation
├── tsconfig.json          # TypeScript configuration (strict, no DOM globals)
├── index.client.tsx       # Entry point for the client app (React Native / UI)
├── index.server.ts        # Entry point for the daemon subprocess (Node.js)
├── client/                # Client-only code (surfaces, panels, components, styles)
│   ├── main.tsx
│   └── web.ts             # Gated DOM/browser APIs (Platform.OS === "web")
├── server/                # Server-only code (RPC handlers, storage, child processes)
│   └── handlers.ts
└── shared/                # Code shared by both runtimes (Zod schemas, RPC contracts, types)
    └── contracts.ts
```

### Strict Compiler Boundaries
The Paseo plugin compiler enforces strict isolation rules:
1. `index.client.tsx` and files under `client/` **cannot** import anything from `server/` or Node.js built-ins (`fs`, `child_process`, `path`, etc.).
2. `index.server.ts` and files under `server/` **cannot** import anything from `client/`, React, or React Native.
3. Code under `shared/` must be pure data types, Zod contracts, and runtime-neutral utility functions. It must never import React, React Native, or Node APIs.
4. No code files other than the manifest, package metadata, and runtime entries may reside in the plugin root.

---

## 4. Manifest & Version Requirements

`paseo-plugin.json` specifies plugin identity, engine compatibility, and optional preparation steps:

```json
{
  "id": "my-plugin",
  "requirements": {
    "paseo": ">=0.8.0"
  },
  "build": [
    ["npm", "ci"],
    ["npm", "run", "build"]
  ]
}
```

- **`id`**: Unique runtime identifier for the plugin. Defaults to the manifest ID upon installation; can be overridden via `paseo plugin install --id <alias>`.
- **`requirements.paseo`**: Semver range of supported Paseo daemon and client versions.
- **`build`**: Optional list of argv arrays executed when installed or updated from a Git repository. Executed directly without a shell from the plugin directory.

---

## 5. Daemon Lifecycle & Management CLI

Plugins are managed per daemon host through the `paseo plugin` CLI or the in-app **Settings → Plugins** panel.

### Basic CLI Commands
```bash
# Initialize a new plugin template
paseo plugin init /path/to/my-plugin

# Install a local directory plugin
paseo plugin install /path/to/my-plugin

# Install from npm
paseo plugin install npm:@xpufx/paseo-top

# Install from Git repository shorthand or URL
paseo plugin add owner/repo
paseo plugin add https://forge.example.com/org/plugin.git --ref main

# List installed plugins and status
paseo plugin ls

# Reload a plugin after code changes
paseo plugin reload my-plugin

# View recent tail logs (stdout/stderr)
paseo plugin logs my-plugin
paseo plugin logs my-plugin --json

# Enable / Disable a plugin without uninstalling
paseo plugin disable my-plugin
paseo plugin enable my-plugin

# Remove an installed plugin
paseo plugin remove my-plugin
```

### Lifecycle Guarantees
- **Reload Teardown**: `paseo plugin reload <id>` immediately halts the old subprocess, calls client and server cleanup hooks, tears down open RPC channels and queries, compiles disk changes, and launches the new version.
- **Dedicated Sessions**: Each plugin subprocess connects to the daemon using an exclusive, internal `plugin:<id>` session that automatically cleans up on process termination.

---

## 6. Server Runtime (`index.server.ts`)

The server entry default-exports a contribution function receiving `PluginServerContext` and returns a cleanup callback:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPluginLogger, PluginStorage } from "paseo-plugin-helper/server";
import { statusRpc } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  const log = createPluginLogger("my-plugin");
  const storage = new PluginStorage("my-plugin", "state.json", { defaultData: { runs: 0 } });

  server.handle(statusRpc, async (input, { paseo }) => {
    log.info("Status RPC invoked", { input });
    const current = await storage.read();
    await storage.write({ runs: current.runs + 1 });
    return { ok: true, runs: current.runs + 1 };
  });

  return () => {
    log.info("Plugin unloading; disposing resources");
  };
}
```

### Type-Safe RPC Contracts
Defined in `shared/` using Zod schemas:
```ts
// shared/contracts.ts
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const statusRpc = defineRpc({
  name: "status.get",
  input: z.object({ target: z.string().optional() }),
  output: z.object({ ok: z.boolean(), runs: z.number() }),
});
```

### Lifecycle Observers (`server.on`)
Plugins can listen to daemon events without interrupting operation:
- `agent.created`, `agent.started`, `agent.stopped`, `agent.deleted`
- `workspace.created`, `workspace.deleted`
- `permission.requested`, `permission.resolved`
- `turn.ended` (inspect final tool outputs or send automated follow-up turns)

### Creation & Before Hooks (`server.before`)
Intercept and mutate configuration before operations execute:
- Mutate agent system prompt, model, or provider options on `agent.create`.
- Dynamically inject custom MCP servers or environment variables into new agent sessions.
- Control workspace isolation (e.g. force git worktrees).

---

## 7. UI Subsystem Map

The complete documentation suite for building UI surfaces, components, forms, pills, timeline renderers, and themes is located under [`docs/plugin/ui/`](ui/README.md):

| Document | Key Concepts & Primitives Covered |
| :--- | :--- |
| [**`ui/README.md`**](ui/README.md) | Architectural index, client design philosophy, SDK vs helper integration, and `initClientHelpers`. |
| [**`ui/surfaces-and-panels.md`**](ui/surfaces-and-panels.md) | Sidebar surfaces (`addSurface`), workspace tabs & Explorer panels (`addWorkspacePanel`), Command Center (⌘K), and slash commands. |
| [**`ui/components-and-forms.md`**](ui/components-and-forms.md) | Upstream Host UI (`Modal`, `Icon`, `useToast`), Settings forms, and `paseo-plugin-helper` components (`Card`, `Badge`, `Button`, `DataTable`, `Tabs`, `Grid`, `ModalBody`). |
| [**`ui/buttons-and-pills.md`**](ui/buttons-and-pills.md) | Composer pills (`registerComposerPill`), header action buttons, menu popovers, and custom metric suites. |
| [**`ui/timeline-items.md`**](ui/timeline-items.md) | Timeline transformers, custom renderers, streaming text pacing (`useRevealedText`), and daemon-appended rows (`timeline.append`). |
| [**`ui/theming-and-styling.md`**](ui/theming-and-styling.md) | Paseo theme tokens, `usePluginTheme()`, `layout.compact` responsiveness, visual flairs, and custom theme contribution (`addTheme`). |
| [**`ui/mobile-and-cross-platform.md`**](ui/mobile-and-cross-platform.md) | Mobile sheet gesture architecture, avoiding double scroll traps, strict React Native rules, `client/web.ts` isolation, and lint audits. |

---

## 8. Testing & Conformance

- **Unit Testing**: Use `paseo-plugin-helper/testing` to test handlers and UI without running a live Paseo daemon. Provides mock `PluginClientContext`, `PluginServerContext`, and mock Paseo APIs.
- **Audit Tool**: Run `npx paseo-plugin-helper audit` across your plugin source tree to identify unrecommended patterns (raw `console.log`, bare `fetch` without timeouts, missing `layout.compact` checks, or raw unstyled text).

---

## 9. Hook Router Discovery & Front Desk Registration

The bundled Forgejo webhook router ([`plugins/uppidi-forge/server/hook-router.ts`](../plugins/uppidi-forge/server/hook-router.ts)) is a plain Node `http` server started by the plugin's daemon subprocess. Agents interacting with the Forgejo fleet must be able to find it and register themselves with it. Full router architecture, queueing, and security notes live in [`plugins/uppidi-forge/README.md` §7](../plugins/uppidi-forge/README.md#7-the-webhook-router-backend-daemon); this section covers only **self-discovery and registration** for agents.

> [!IMPORTANT]
> **Do not assume loopback.** The router binds to whatever `hookHost` is configured, which is frequently a LAN interface, not `127.0.0.1`. Always resolve the bind address first (below). `127.0.0.1:<port>` works **only if** the router is actually bound to loopback (`hookHost` = `127.0.0.1`, or a wildcard bind covering loopback); otherwise curl fails with connection refused.

### 9.1 Locating the router — ask the daemon, don't read state

**Primary (agents): ask the daemon via RPC.** The `uppidi-fleet` plugin resolves the router address **in-process** from the live router singleton — no filesystem reads:

- `uppidi-fleet.hook.info` — the authoritative answer to *"where is the router and who is the front desk"*. Returns:

  ```jsonc
  {
    "ok": true,
    "running": true,
    "hookHost": "10.20.30.24",   // configured bind host (wildcard → "0.0.0.0")
    "hookPort": 8099,            // configured port
    "url": "http://10.20.30.24:8099",
    "isListening": true,
    "frontDeskAgentId": "<uuid-or-null>",
    "registeredRepoKeys": ["forge.mrs.uppidi.com/xpufx-org/paseo"],
    "registeredRepoCount": 1,
    "uptime": 3600
  }
  ```

  When the router has not been started it is null-safe: `running:false`, `url:null`, `frontDeskAgentId:null`, empty repo list.
- `uppidi-fleet.hook-status` — same in-process source; reports the live front desk record, paused queues, and totals. Use it when you also want queue state.

Agents with MCP access should call one of these. Neither handler parses `settings.json` or `router-config.json`.

**HTTP fallback (agents without the plugin's MCP).** Once you know the deployment address (one-time, human-provided at onboarding — see the note below), probe the router directly:

```sh
curl -fsS "http://<hook-host>:<port>/info"     # host, port, url, frontDeskAgentId, uptime, isListening
curl -fsS "http://<hook-host>:<port>/health"   # → {"ok":true,"status":"healthy",...,"port":8099}
curl -fsS "http://<hook-host>:<port>/status"   # front desk record, paused queues, totals
```

`GET /info` is the JSON equivalent of the `hook.info` RPC (same in-process resolver). `GET /health` remains the liveness probe; `GET /status` gives the fuller queue overview.

If `/health` times out on your first guess, do not retry against loopback blindly — **ask the operator** which interface the router binds, or call `uppidi-fleet.hook.info` and use the returned `url`.

> [!NOTE]
> **Operators/debugging only — agents must not parse these files.** The router's bind address *does* originate from `hookHost` / `hookPort` in `~/.paseo/plugin-data/xpufx/uppidi-fleet/settings.json` (migrated from the legacy `~/.config/uppidi-fleet/router-config.json`). These are **writable runtime state**, not a discovery API: reading them races with live reconfiguration, and an agent that can write them can silently redirect the router. The plugin runtime ID is `uppidi-fleet` (declared in `paseo-plugin.json`), so the data directory is `uppidi-fleet` even though the source tree directory is `uppidi-forge`. Environment overrides (`FORGE_HOOK_HOST`, `FORGE_HOOK_PORT` / `HOOK_PORT`) are read by the plugin subprocess at startup. Use the RPC/`GET /info` path instead.

### 9.2 Offline registry files (operator-readable state)

The router persists registration records under `~/.paseo/forgejo-hook/`:

- **Front Desk agent ID**: `~/.paseo/forgejo-hook/frontdesk.json` (`{"version":1,"agentId":"<uuid>",...}`).
- **Repo orchestrator registrations**: one JSON file per repo key under `~/.paseo/forgejo-hook/orchestrators/`, where the filename is the repo key with `/` and `.` mapped to `_` (e.g. `forge.mrs.uppidi.com_xpufx-org_paseo.json` for repo key `forge.mrs.uppidi.com/xpufx-org/paseo`).

These are **operator-readable state files, not an agent discovery mechanism**. They are written atomically by the router on every registration, but a stale mtime means the record may be outdated, and like `settings.json` they are writable. Agents must resolve the live front desk via `uppidi-fleet.hook.info` (or `GET /info` / `GET /frontdesk`) instead of reading these files; they exist so operators can audit registration state without contacting the router.

### 9.3 "You are not the frontdesk" — what to do

When an agent is told *"you are not the frontdesk"* (typically after answering operator chatter routed to the Front Desk queue), the correct reaction is **never to answer operator chatter directly**. Instead, identify your role and register with the router accordingly:

| Your role | Action |
| :--- | :--- |
| **Front Desk** agent (operator liaison) | Register yourself: `POST /frontdesk` with your own `agentId`. This writes `frontdesk.json`, notifies all registered orchestrators, and starts routing frontdesk-directed events to you. |
| **Repo orchestrator** | Register your repo: `POST /orchestrator` with `{repo, agentId}`. This writes `orchestrators/<repo-key>.json` and drains that repo's queue. |
| **Coding worker** (neither of the above) | Do **not** register or answer operator chatter. Route operator-facing matters through your orchestrator; the orchestrator owns board interaction. |

Router endpoints (all unauthenticated, JSON; `GET /frontdesk` reads, `POST /frontdesk` registers):

```sh
# Register as the Front Desk (replaces any previous registration; orchestrators are notified)
curl -fsS -X POST "http://<hook-host>:<port>/frontdesk" \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"<YOUR_AGENT_ID>"}'

# Read the currently registered Front Desk
curl -fsS "http://<hook-host>:<port>/frontdesk"

# Self-register as a repo orchestrator
curl -fsS -X POST "http://<hook-host>:<port>/orchestrator" \
  -H 'Content-Type: application/json' \
  -d '{"repo":"<forge-host>/<owner>/<repo>","agentId":"<YOUR_AGENT_ID>"}'

# List registered orchestrators
curl -fsS "http://<hook-host>:<port>/orchestrators"

# Front Desk handoff (rotation; seeds handoff file, retires previous agent)
curl -fsS -X POST "http://<hook-host>:<port>/frontdesk-handoff" \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"<NEW_FRONT_DESK_ID>","handoffText":"# Handoff\n\nOperator context."}'
```

`<hook-host>` is hostname-neutral on purpose: substitute the address you resolved via `uppidi-fleet.hook.info` (or `GET /info`) in [§9.1](#91-locating-the-router--ask-the-daemon-dont-read-state). Concrete example — on this fleet's current deployment the router binds the daemon host's LAN interface, so `10.20.30.24:8099` answers while `127.0.0.1:8099` does **not**:

```sh
curl -fsS http://10.20.30.24:8099/frontdesk   # loopback fails on this host unless hookHost is 127.0.0.1
```

### 9.3.1 Related but separate: webhook provisioning

- `setup-forgejo.sh` in the **platform** repo (`~/code/platform/scripts/setup-forgejo.sh`, separate repository) provisions native Forgejo webhooks via `WEBHOOK_HOST` / `WEBHOOK_PORT` env vars pointing at the router — related ingress path, separate lifecycle and repo.
- Platform ticket [#135 (forge.mrs)](https://forge.mrs.uppidi.com/xpufx-org/platform/issues/135) tracks webhook URL normalization and is awaiting an operator decision; it affects how webhook URLs are stored/matched, not how agents discover the router.

---

## 10. Reference Links & Upstream Documents

### In this Repository (`xpufx/paseo`)
- [`packages/paseo-plugin-helper/`](../packages/paseo-plugin-helper/README.md) — Shared helper library source and docs.
- [`plugins/top/`](../plugins/top/) — Reference live resource monitor plugin.
- [`plugins/demo/`](../plugins/demo/) — Canonical conformance showcase testbed.
- [`plugins/mcp-tools/`](../plugins/mcp-tools/) — MCP diagnostics and session probe plugin.

### Upstream Paseo Core (`getpaseo/paseo`)
- [Upstream Public Plugin Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md) — Exhaustive specification for SDK methods, types, and DTOs.
- [Upstream Plugin Architecture Guide](file:///home/xpufx/code/3rdparty/paseo/paseo/docs/plugins.md) — Internal daemon architecture and subsystem design.
- [Upstream Provider Plugin Guide](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/providers.md) — Registering custom LLM/agent providers and ACP adapters.
- [Upstream Agent Skills](file:///home/xpufx/code/3rdparty/paseo/paseo/skills/paseo-plugin/SKILL.md) — LLM skill instructions for plugin creation.
- [Upstream Reference Examples](file:///home/xpufx/code/3rdparty/paseo/paseo/plugin-examples/) — Dedicated sample packages (`modal-ui`, `buttons`, `settings`, `timeline-items`, `inline-thinking`, `catppuccin`, `local-plugin`, `linear`).
