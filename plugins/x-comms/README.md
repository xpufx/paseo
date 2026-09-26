# paseo-x-comms

> **⚠️ WIP — use at your own risk.** Not release-ready; APIs and behavior may change without notice.

> Requires **Paseo >=0.9.0**. Cross-daemon agent conversation relies on Paseo 0.9 native multi-host APIs (`daemon.get_status`, `paseo send --host`). Legacy Paseo 0.8 is not supported.

[paseo](https://paseo.sh) is an agent orchestrator: AI coding agents run on paseo daemons, each managing workspaces, tools, and permissions. **paseo-x-comms** lets agents on one daemon talk to agents on another — even across hosts — via the daemon relay (WebSocket + E2EE) or direct TCP.

Scope: x-comms links one owner's daemons through one client UI. Pairing is explicit and local; stranger federation is out of scope (an experimental flag at most, post-1.0).

Built on [paseo-plugin-helper](https://github.com/xpufx/paseo/tree/main/packages/paseo-plugin-helper), the shared Paseo plugin runtime.

This repo ships two things:

* **Paseo plugin** (recommended) — UI + embedded MCP server. (This README is for the plugin. See below)
* **Standalone MCP server** (`mcp/`) — the same server without the paseo plugin. See **[mcp/README.md](mcp/README.md)** for its standalone install, tool reference, and protocol details.

### Features contracts

Two documents record **what each surface actually does now**, derived from the
code rather than from the design, one per shipped surface:

* **[docs/contract-plugin.md](docs/contract-plugin.md)** — the plugin: 20 server
  RPCs, 4 `agent.*` daemon events, 2 `agent.create` injection hooks, 9 client
  surface contributions, and the shared wire substrate (envelope, `auth`, busy
  gate, defer queue, outbox).
* **[docs/contract-mcp.md](docs/contract-mcp.md)** — the MCP server: 11 tools and
  14 further capabilities, each with inputs, outputs, failure modes, and whether
  it is deterministic or depends on a live peer daemon.

**[docs/contract-drift.md](docs/contract-drift.md)** is the companion ledger of
places where the prose in this file, in `mcp/README.md`, in `docs/mesh.md`, and
in the shipped `instructions` strings disagrees with the code — in both
directions. Where the two conflict, the code is the authority.

## Plugin

The plugin embeds the MCP server and adds the X-comms UI. Agents get `x_comms_*` tools automatically; humans get surfaces to manage daemons and conversations.

### What you get

* **Main surface — X-comms** (`client/main.tsx`, surfaced via `index.client.tsx` sidebar item): registered daemons list with health (reachable/unreachable + agent count), add/edit/remove with host-form validation and reachability probe, refresh (identity + snapshot), server version check, introduce-agents picker, debug dump per daemon.
* **Peers surface** (`client/peer-status.tsx`, the "Peers" tab): the known daemon registry rendered with a live per-peer `daemon.get_status` probe — up/down plus identity (`serverId`, `version`, `listen`, relay, provider count, hub relationship). Each host is probed independently (relay or direct), so an unreachable peer shows as down without failing the surface. Polls every 30 s via `peer.status`.
* **Composer pill** (`client/x-comms-pill.tsx`): one `X-comms` pill per agent in the composer; opens the conversation panel for that agent.
* **Agent panel** (`client/x-comms-panel.tsx` / `x-comms-timeline.tsx` / `x-comms-conversation.tsx`, plus `x-comms-tool-call.tsx` and `via-x-comms.tsx`): per-agent conversation view with timeline rendering of the `<x-comms-message>` envelope (with backward-compatible support for v5 `[x-comms]`), send/reply, wait, and permission handling. Timeline transformers/renderers registered in `index.client.tsx` render envelopes and tool calls inline in agent timelines.
* **Server side** (`index.server.ts` + `server/`): registry, health, settings, presence announce/retract/list, and MCP injection handlers.
* **Embedded MCP server** (`mcp/paseo-x-comms.mjs`): spawned via `serverPath()` from `server/server-status.ts` (resolved from `import.meta.url` with plugin-dir fallbacks); shares the repo-root `node_modules` — no separate install or `paseo` on PATH required beyond the daemon itself.

### Install

> **Prerequisite**: Paseo >=0.9.0.

Install the Paseo plugin from npm:

```sh
paseo plugin add npm:@xpufx/paseo-x-comms
```

Or install the plugin directly from the Git repository:

```sh
paseo plugin add xpufx/paseo --path plugins/x-comms
```

The plugin requires **npm** and **Node.js** (v18+) in `$PATH`. It embeds and starts its MCP server automatically; do not install the standalone CLI for a plugin installation.

To update:

```sh
paseo plugin update x-comms
```

### Configure daemons

The registry is at `~/.paseo/paseo-x-comms/registry.json`:

```json
{
  "home": "https://app.paseo.sh/#offer=<b64>",
  "office": "10.0.0.5:6767"
}
```

* Value is an **opaque `--host` string** — paseo classifies it. `https://app.paseo.sh/#offer=…` is a relay connection (E2EE); anything else (`host:port`, `tcp://…`, `unix://…`, IPC path, bare port) is a direct connection. See [mcp/README.md#host-forms](mcp/README.md#host-forms).
* Manage it from the plugin UI (Main surface) or via the MCP tools `x_comms_add_daemon` / `x_comms_remove_daemon` / `x_comms_list_daemons`.
* The file holds live pairing offers (serverId, public keys, relay endpoints) — treat it as credentials, never commit it.

Quick pairing:

1. On the **target** daemon: `paseo daemon pair --json` → copy the `url` (`https://app.paseo.sh/#offer=…`). For a directly-reachable daemon, use its address instead.
2. On **this** daemon: open the X-comms Main surface → *Add daemon* → paste the offer or address. The UI probes reachability before saving (with "Add anyway" for offline hosts).

#### How messaging works

Every `x_comms_send` prepends an envelope block:

```
<x-comms-message>{"xComms":{"version":6,"type":"x-comms.message","sender":{…},"target":{…},"messageId":"…","sentAt":"…","direction":"outgoing"}}</x-comms-message>
```

`sender` (agentId, agentName, host, daemonServerId, cwd) + `target` (daemon, agentId) + `messageId` + `sentAt` + `auth` (the sending daemon's signature over those fields — see [mcp/README.md#envelope-authentication](mcp/README.md#envelope-authentication)). Without a valid `auth` the claimed sender is an unverified claim and the plugin refuses to attribute it (#594). Desktop discovers configured hosts only from Paseo's mounted host runtime and sends to the selected `(serverId, agentId)` with a fresh client; it never pairs hosts or creates agents. Headless agents continue to use the native `paseo send --host` path without Desktop running. Prompt text stays prose after the envelope. Recipients parse the envelope and reply via `x_comms_send` to `sender.agentId` on the sender's daemon. Full envelope + permission loop documented in [mcp/README.md#message-envelope](mcp/README.md#message-envelope) and [mcp/README.md#behavior-notes](mcp/README.md#behavior-notes).

#### Recipient skill (envelope handling)

Injecting the tools alone leaves a delivery indistinguishable from chat, so the recipient answers the prose and never attributes the sender (#379). The plugin therefore injects **standing recipient instructions** at the same `agent.create` gate as the tools (`server/recipient-instructions.ts`): detect a `<x-comms-message>` (v6) or `[x-comms]` (v5) turn, check that it carries an `auth` signature, parse `sender`/`target`/`messageId`/`direction`, attribute the peer sender, and reply through `x_comms_send` to `sender.agentId` on `sender.daemonServerId`. The same contract ships as a skill at [`skills/recipient-envelope/SKILL.md`](skills/recipient-envelope/SKILL.md) for manual installation into `.agents/skills/`. `server/recipient-instructions.test.ts` pins the instructions' content and the injection wiring; `instruction-surfaces.test.ts` pins the two against the MCP server's own `instructions` string, so the three cannot drift into disagreeing about a rule again (#709).

Tools (via the embedded server) are `x_comms_list_daemons`, `x_comms_add_daemon`, `x_comms_remove_daemon`, `x_comms_list_agents`, `x_comms_inspect`, `x_comms_send`, `x_comms_logs`, `x_comms_wait`, `x_comms_list_permissions`, `x_comms_allow_permission`, `x_comms_deny_permission` — see [mcp/README.md#tools](mcp/README.md#tools) for the reference. The plugin's conversation/panel UI wraps `send`/`logs`/`wait`/permissions for interactive use.

### Outbox: retry, expiry, notification

The plugin server keeps an **outbox** (the plugin state dir's `outbox.json`) for messages whose send failed. Held messages are retried over the same `x_comms_send` path with exponential backoff (5s doubling to a 60s cap), swept on a 15s periodic pass, and retried immediately when a peer is observed reconnecting (health/snapshot reachability flip).

A held message expires after **10 minutes** by default (configurable in the settings surface, `outboxExpirySeconds`, clamped to 10s–24h). On expiry the sender is notified by appending an `x-comms-outbox-notice` timeline item with the reason; the message is then dropped.

**Idempotency:** every send receives one stable `messageId`, passed to Paseo's native daemon/client send API and retained in a held outbox entry. A retry therefore presents the same key to the target daemon, which suppresses a duplicate before it reaches the agent.

### Defer queue: sends to a busy target are queued, not preempted

Paseo's daemon sends with `replaceRunning: true`, so an x-comms send into a
running agent **replaced its turn**. The only thing that spared a busy target
was the target voluntarily calling `x_comms_wait` first — agent cooperation as
the sole guard. It is now enforced.

Before any send, the target's run status is read. A mid-turn target gets the
message **queued** instead:

* **Local targets** — the plugin subscribes to `agent.turn_started` /
  `agent.turn_ended` (`index.server.ts`), so a local agent's turn state is known
  without a round trip. An agent the hooks have not seen falls back to an SDK
  snapshot read.
* **Remote targets** — no cross-daemon turn subscription exists, so a peer's
  status comes from `paseo inspect --host`. It is a sample, and a probe that
  fails **dispatches** rather than silently swallowing the message.
* **Configured hosts** — reached by `serverId` rather than by registry name, and
  resolved against Paseo's configured hosts, so a labelled host is probed rather
  than silently treated as unknown. Same gate, same bounds.
* After a successful send the target is recorded busy, so a second send in the
  same burst is queued instead of replacing the turn the first send just started.

`idle` is the only non-busy state. `error` and `closed` are treated as *not*
busy on purpose: they have no running turn to replace, and treating them as busy
would pin a queue against an agent that has already crashed, with no turn ever
coming to drain it.

**Bounds** (never unbounded growth): **8 deep per target** — overflow evicts the
oldest waiting message and tells its sender; **200 across all targets** — at the
ceiling a *new* message is refused (`delivery: "dropped"`) rather than evicting
someone else's obligation; **30-minute expiry**, after which the message is
dropped and its sender told why. Every non-delivery path notifies the sender by
appending to its timeline, which does not start a turn.

**`notifyOnFinish`** (default `true`) queues a notice back to the sender when the
message lands. The notice goes through the **same queue**, so a busy sender has
it held rather than steered — Paseo's own notify-on-finish path steers the
caller's turn, which would reintroduce this bug in the other direction. Neither
side ever interrupts the other.

**Delivery contract: best-effort within a bounded window, *not* guaranteed to land
before the target's next turn ends.** There is no cross-daemon turn-end signal to
build such a guarantee on, and the alternatives are preemption or a protocol that
does not exist. Every send reports `dispatched | queued | outbox | dropped`, and
nothing is ever dropped silently. **Every route is covered** — the MCP/relay path
and the Desktop configured-host path alike (#611); the Desktop surface used to
send directly and preempt, and no longer does. **This is a deliberate product
decision and the thing most worth revisiting** — the full contract, the reasoning,
and what to use if you need a real guarantee are in
[mcp/README.md#delivery-contract](mcp/README.md#delivery-contract).

## Repository layout

```
.
├── index.client.tsx          # Paseo client entry (surfaces, pill, panel, timeline renderers)
├── index.server.ts           # Paseo server entry (RPC + presence + injection handlers)
├── client/
│   ├── main.tsx              # Main surface (daemon registry + health + prompt)
│   ├── x-comms-pill.tsx      # Composer pill → conversation panel
│   ├── x-comms-panel.tsx     # Agent panel host
│   ├── x-comms-timeline.tsx  # Timeline / envelope rendering
│   ├── x-comms-conversation.tsx
│   ├── x-comms-tool-call.tsx # Tool-call timeline rendering
│   ├── via-x-comms.tsx
│   ├── conversations.ts      # Conversation derive (shared with tests)
│   ├── attribution.ts / peer-label.ts / tool-call.ts
│   └── *.test.ts             # Client unit tests
├── server/
│   ├── handlers.ts           # RPC handlers (registry, probe, dump, etc.)
│   ├── registry.ts           # Daemon registry + health
│   ├── settings.ts           # Plugin settings storage
│   ├── presence.ts           # Presence announce/retract/list
│   ├── defer-queue.ts        # Bounded per-target queue for busy targets (+ bounds, claim/notice rules)
│   ├── busy.ts               # Lifecycle classification + verdict cache over turn events and probes
│   ├── mesh-identity.ts      # Daemon ed25519 signing key + envelope sign/verify
│   ├── mesh-keys.ts          # Pinned peer verify keys (substitution-resistant)
│   ├── injection.ts          # MCP + recipient-instruction injection for agents
│   ├── recipient-instructions.ts # Standing envelope-handling instructions
│   ├── snapshot.ts / conversations-snapshot.ts
│   ├── server-status.ts      # Embedded server path resolution
│   ├── mcp-client.ts / peer-channel.ts
│   └── *.test.ts             # Server unit tests
├── skills/
│   └── recipient-envelope/SKILL.md # Distributable form of the recipient instructions
├── docs/
│   ├── contract-plugin.md    # Features contract for this plugin surface
│   ├── contract-mcp.md       # Features contract for the embedded MCP server
│   ├── contract-drift.md     # Documented-vs-actual asymmetry ledger
│   └── mesh.md               # Presence, injection, and visibility layers
├── shared/
│   ├── envelope.ts           # Wire envelope schema (<x-comms-message> parsing, v5 fallback), auth schema + canonical signed payload
│   ├── registry.ts           # RPC definitions (zod)
│   └── conversations-snapshot.ts
├── mcp/
│   ├── paseo-x-comms.mjs      # MCP server (also bin `paseo-x-comms`)
│   ├── README.md              # standalone server docs
│   └── test/protocol.test.mjs
├── paseo-plugin.json         # plugin manifest (id x-comms)
└── package.json               # single install at root for plugin + server
```

## Standalone MCP server CLI (not the plugin)

Use this only when you want the MCP server without the Paseo plugin or its UI:

```sh
npm install -g @xpufx/paseo-x-comms
```

Requires `paseo` CLI on PATH, Node ≥ 18. Full instructions, env overrides (`PASEO_X_COMMS_*`), and client registration examples (pi `mcp.json` vs opencode `opencode.jsonc`) are in **[mcp/README.md](mcp/README.md)**.

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test across mcp, server, and client suites (hermetic protocol tests plus presence, injection, settings, snapshot, and conversation suites)
```

No live daemons, no real `~/.paseo/paseo-x-comms/registry.json` touched in tests (`PASEO_X_COMMS_REMOTES` / `PASEO_X_COMMS_PASEO` overrides).

## License

MIT
