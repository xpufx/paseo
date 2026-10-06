# MCP tool injection into agent sessions

Status: design / decision (research for #1020)
Scope: how Paseo configures MCP servers per agent, which fleet agent classes
should receive which tools, and the harness-independent injection seam.

This document is grounded in the installed Paseo 0.9.x packages
(`@getpaseo/plugin`, `@getpaseo/protocol`, `@getpaseo/server`) and this repo.
Every claim is cited as `path:line`. Where a capability is not proven, it is
called out under [Unknowns](#7-unknowns--experiments-to-prove-them).

## 1. Problem statement

The Uppidi fleet spawns agents through `spawnPaseoAgent`
(`plugins/uppidi-fleet/server/agents.ts:2200`). Those agents have no MCP tools
of their own: the fleet exposes `FLEET_MCP_TOOLS` (9 tools,
`plugins/uppidi-fleet/server/mcp-tools.ts`) over plugin RPC
(`uppidiFleetToolListContract` / `uppidiFleetToolExecuteContract`) and a
standalone stdio server (`plugins/uppidi-fleet/bin/fleet-mcp-server.mjs`), but
nothing injects that server into spawned agents. Meanwhile the daemon already
injects a built-in host MCP server into every session
(`@getpaseo/server/.../agent/runtime-mcp-config.js`, `withRuntimePaseoMcpServer`).
We need to decide **which agent classes get which MCP tools**, and **how to
inject them without special-casing a provider harness**.

Constraints that fall out of the code:

- The only pre-create seam is the plugin lifecycle hook
  `server.before("agent.create")` (`@getpaseo/plugin/dist/server/contracts.d.ts`
  `PluginServerContext extends PluginLifecycleRegistration`;
  `.../lifecycle.d.ts:82`). It runs inside `AgentManager.createAgentInternal`
  **before** config normalization and provider dispatch
  (`@getpaseo/server/.../agent/agent-manager.js:691`).
- That hook receives only `{ config: AgentSessionConfig; env?: Record<string,string> }`
  (`lifecycle.d.ts:82`; the daemon validates it as
  `CreateAgentRequestMessageSchema.pick({ config: true, env: true }).strict()` at
  `@getpaseo/server/.../plugins/lifecycle/index.js:18`). It does **not** receive
  `labels`, `callerAgentId`, or the fleet's class.
- `AgentSessionConfig` carries `mcpServers?: Record<string, McpServerConfig>`
  and `toolPolicy?: ToolPolicy`
  (`@getpaseo/protocol/dist/agent-types.d.ts:449,464`).
  `McpServerConfig` is a discriminated union of `stdio` / `http` / `sse`
  (`agent-types.d.ts:19-61`), matching `registerMcpInjection`'s helper types
  (`packages/paseo-plugin-helper/src/server/mcp-injection.ts`).
- The provider SDK consumes the normalized config as
  `ProviderSessionConfig.mcpServers`
  (`@getpaseo/plugin/dist/server/provider.d.ts:85`). Each harness maps the same
  canonical struct to its native form.

## 2. How Paseo configures MCP today

### 2.1 The canonical, harness-independent field

`AgentSessionConfig.mcpServers` is normalized once in the daemon and consumed by
every provider:

| Harness | Mapping | Citation |
| --- | --- | --- |
| Claude | `normalizeMcpServers` → `@anthropic-ai/claude-agent-sdk` MCP config | `@getpaseo/server/.../providers/claude/agent.js:2690,2730` |
| Pi | builtin `pi.registerMcpServer` or temp `mcp.json` adapter | `.../providers/pi/agent.js:2024,2250`; capability flips per session at `:99,542` |
| ACP (antigravity, copilot, cursor, …) | `acpMcpServers()` → `normalizeMcpServers` → ACP `session/new` | `.../providers/acp-agent.js:1926,2441` |
| OpenCode / Codex / OMP | native config translation | `.../providers/opencode/v2/configuration.js`, `.../codex/options.js:60`, `.../omp/agent.js:1828` |

The daemon refuses a session that carries external `mcpServers` when the
provider does not advertise support:
`requireExternalMcpSupport` throws `Provider '<x>' does not support MCP servers`
(`agent-manager.js:2500`), also enforced on reload (`:859`). Pi's
client-level flag is `supportsMcpServers: false` (`pi/agent.js:80`) but its
**session** capabilities report `true` whenever an MCP config is present
(`capabilitiesForSession(mcp !== null)`, `pi/agent.js:99,2052`), so Pi sessions
pass the check.

Two provider-name constraints leak through from the harness side:

- Server **names** must match `^[A-Za-z0-9_-]+$` for Pi's builtin registration
  (`pi/agent.js:296`, throws otherwise) and Gemini's ACP validation (documented
  at `plugins/x-comms/server/injection.ts:22-29`, issue #243).
- Exact unattended preapproval (`toolPolicy.preapproved`) is **not**
  harness-independent: only `claude`, `codex`, and `opencode` declare
  `supportsExactMcpPreapproval: true`
  (`@getpaseo/server/.../agent/provider-registry.js:25-29`); everything else
  throws `Provider '<x>' cannot preapprove exact MCP tools…`
  (`agent-manager.js:3635`). Preapproval also requires the referenced server in
  the same request (`agent-manager.js:3646`).

### 2.2 What already gets injected

1. **Paseo built-in host MCP** — `withRuntimePaseoMcpServer` adds an `http`
   server named `paseo` pointing at `/mcp/agents?callerAgentId=<id>` (with auth
   header) to every session, unless paseo tools are disabled daemon-wide
   (`runtime-mcp-config.js`; called from `prepareSessionConfig`,
   `agent-manager.js:3670`). This is the 60+ host control-plane tools reported
   by `plugins/mcp-tools/README.md:25`. It is **not per class**; it is all or
   nothing for the daemon.
2. **mcp-tools gateway** — an opt-in `http` server named `gateway` injected by
   `plugins/mcp-tools/index.server.ts:29` via
   `injectGatewayIntoCreateRequest` (`plugins/mcp-tools/server/inject.ts`),
   gated by `settings.gatewayInject` / `gatewayUrl`.
3. **x-comms** — an opt-in stdio server named `x-comms_<serverId>` injected by
   `plugins/x-comms/server/injection.ts:142-156` through the helper's
   `registerMcpInjection` (`packages/paseo-plugin-helper/src/server/mcp-injection.ts`),
   plus a system-prompt contract at the same gate.

The helper's `registerMcpInjection` is the existing, tested pattern: it merges
a server into `request.config.mcpServers` (and optionally appends
`config.systemPrompt` instructions) and supports a `filter` predicate
(`mcp-injection.ts:20-27,70-108`).

### 2.3 How the fleet marks class today

`spawnPaseoAgent` sets the class in **two places that the `agent.create` hook
cannot see**:

- `createPayload.labels = { role, category, … }` (top-level; e.g.
  `agents.ts:2477-2480`). Labels are in `options`, not `config`
  (`createAgentInternal(config, agentId, options)`, `agent-manager.js:688`), and
  the hook schema selects `config` + `env` only (`lifecycle/index.js:18`).
- `createPayload.role = options.category` — not a field of
  `CreateAgentRequestMessageSchema` at all, so it is stripped.

The class *is* recoverable from `config.title` (the client moves a top-level
`title` into `config.title`, `@getpaseo/client/dist/index.js:30-50`), but titles
are human-editable and only `front-desk` / `orchestrator` / `worker` are
categorized (`categorizeAgent`, `agents.ts:125`). **`auditor` exists only as a
role-model entry** (`plugins/uppidi-fleet/server/role-models.ts:155`) — there is
no spawn path or categorizer that produces it.

Per-harness "features" are already handled separately in the spawner:
`resolveSpawnMode` defaults `antigravity-acp` to `mode: "yolo"`
(`agents.ts:1850`) and `resolveAutoAccept` sets `featureValues.auto_accept` for
`opencode` (`agents.ts:1867`), forwarded through `sdkConfig` (`agents.ts:2293`).
This is exactly the kind of provider divergence a class-gated injection layer
must not repeat.

## 3. Options

### Option A — Central fleet hook + class marker in `env`

`spawnPaseoAgent` stamps `env.PASEO_FLEET_ROLE = <class>` on **both** the SDK
path (`PaseoAgentCreateOptions.env`) and the CLI fallback (`paseo run --env`,
supported per `paseo run --help`). The fleet plugin registers one
`server.before("agent.create")` hook in `index.server.ts` that reads the marker,
merges the class's server set into `config.mcpServers` via `registerMcpInjection`,
and strips the marker from the returned `env`.

- Pros: the marker is visible to the hook (env is explicitly in the hook
  contract), works for both spawn paths, and keeps the now-documented
  harness-independent seam (canonical `mcpServers` → per-provider mapping). No
  provider special-casing.
- Cons: adds an env var to every fleet agent; needs the hook to remove it to
  avoid leaking to child processes; requires a dedicated MCP server binary
  (see §5). Does not help for agents spawned outside the fleet (unmarked → a
  default set must be chosen).

### Option B — In-process fleet hook keyed on `config.title` / name heuristics

Reuse `categorizeAgent` on `config.title` inside the hook.

- Pros: no spawner changes; no marker.
- Cons: fragile, human-editable, and cannot distinguish `auditor`; workers and
  orchestrators may share prefixes. Rejected as a primary mechanism.

### Option C — Inject the same read-only fleet subset into every agent

Register `fleet_check_board` / `fleet_watchdog_audit` for all agents and leave
the mutating tools (`fleet_queue_purge`, `fleet_prune_orchestrators`) to RPC/UI
only.

- Pros: dead simple, matches how the built-in Paseo MCP and x-comms behave
  today, zero class detection.
- Cons: over-provisions workers and gives them dashboard-level context they do
  not need; still needs a server transport.

### Option D — Ask upstream to expose `labels` / `callerAgentId` in `before("agent.create")`

Extend `PluginBeforeRequests["agent.create"]` and the daemon hook input to
include the agent's labels and caller.

- Pros: clean, explicit class detection; no env-channel hack; useful to every
  orchestrator plugin.
- Cons: an upstream SDK + daemon change with a version bump; not available on
  the installed 0.9.x. Record as a follow-up upstream ask, not a dependency.

## 4. Recommendation

**Option A, with Option C as the unmarked default, and Option D filed
upstream.**

1. **Harness-independent seam** = `server.before("agent.create")` mutating
   `config.mcpServers`. This is the single seam that all providers normalize
   from; do not add per-provider branches in the fleet.
2. **Class channel** = a namespaced env marker (`PASEO_FLEET_ROLE`) stamped by
   `spawnPaseoAgent` on both SDK and CLI paths, consumed and stripped by the
   hook. Env is part of the hook contract and survives the CLI fallback, which
   `config`-only markers cannot (`paseo run --help` has no config flag). If no
   marker is present, fall back to the read-only common set (Option C).
3. **Class ↔ tool matrix** (server namespaced `uppidi-fleet_<class>` or a single
   `uppidi-fleet` server with per-class filtering — pick one in the
   implementation; names must satisfy §2.1):

   | Tool | front-desk | orchestrator | worker | auditor |
   | --- | :-: | :-: | :-: | :-: |
   | `fleet_check_board` | ✅ | ✅ | — | ✅ |
   | `fleet_watchdog_audit` | ✅ | ✅ | — | ✅ |
   | `fleet_queue_inspect` | ✅ | ✅ | — | ✅ |
   | `fleet_handoff_generate` | ✅ | ✅ | — | ✅ |
   | `fleet_ensure_orchestrator` | — | ✅ | — | — |
   | `fleet_validate_workspace` | — | ✅ | ✅ | — |
   | `fleet_prune_orchestrators` | — | ✅ | — | — |
   | `fleet_queue_purge` | — | ✅ | — | — |
   | `fleet_board_sweep` | ✅ | ✅ | — | — |

   Rationale: front-desk and auditor are read-only triage/health consumers;
   orchestrators own fleet mutation; workers only need the workspace validator.
   `auditor` gets no mutating tools.
4. **Do not rely on `toolPolicy` preapproval for cross-harness parity.** It
   only works on claude/codex/opencode (§2.1); for the other enabled harnesses
   (pi, antigravity, copilot, omniroute) injected tools surface as normal
   permission prompts, or the agent must run in an auto-accept mode already
   resolved by `resolveSpawnMode`/`resolveAutoAccept`.
5. **Never invent class at spawn time for `auditor`.** The role exists only in
   `role-models.ts:155`; wiring it through `spawnPaseoAgent` is part of the
   checklist, gated by the same env marker.

## 5. Implementation checklist (dispatchable)

1. **Transport**: decide how the fleet MCP tools are served to a child process.
   Preferred: reuse the existing stdio server
   (`plugins/uppidi-fleet/bin/fleet-mcp-server.mjs`). It currently imports
   `../server/mcp-tools.ts` through a TS-extension resolver hook
   (`bin/fleet-mcp-server.mjs:1-9`) and lives in a content-addressed plugin
   checkout, so it needs either (a) a stable installed copy analogous to
   x-comms `syncStableServer` (`plugins/x-comms/server/injection.ts:76`), or
   (b) a bundled single-file build. Prove one with the experiment in §6.2
   before wiring the hook.
2. **Spawner**: in `spawnPaseoAgent` (`agents.ts:2200`), set
   `env.PASEO_FLEET_ROLE = options.category ?? categorizeAgent(options.title)`
   on the SDK payload and add `--env PASEO_FLEET_ROLE=…` on the CLI path.
   Extend the `category` union / `SpawnCapabilities` to admit `auditor` and add
   its role-model-driven spawn entry.
3. **Hook**: add `server.before("agent.create", …)` in
   `plugins/uppidi-fleet/index.server.ts`. The plugin has no `agent.create`
   hook today; the only lifecycle wiring is RPC `server.handle(...)`
   registrations plus the hook router's `this.server.on(...)`
   (`plugins/uppidi-fleet/server/hook-router.ts:6980`). Implement it on top of
   `registerMcpInjection` from `paseo-plugin-helper/server`, selecting servers
   from the matrix in §4 and deleting the marker from `request.env` before
   returning.
4. **Settings**: add a fleet setting (`INJECTION_ENABLED` + optional
   `STABLE_SERVER_PATH`) mirroring `plugins/x-comms/server/injection.ts:136`
   so the hook can be disabled without redeploying, and log injection at
   `agent.create`.
5. **Tests**: unit-test the class→server matrix as a pure function; test that
   unmarked requests get the read-only default; test that the env marker is
   stripped; add an integration test that a hook-mutated `mcpServers` reaches
   each enabled provider without throwing
   `does not support MCP servers` (`agent-manager.js:2500`).
6. **Docs**: update `plugins/uppidi-fleet/README.md` (or `docs/`) with the
   matrix and the marker contract.
7. **Upstream ask**: file an issue to add `labels` / `callerAgentId` to
   `before("agent.create")` (Option D) so the env marker can eventually be
   retired.

## 6. Unknowns / experiments to prove them

1. **Do unknown `providerOptions`/`featureValues` keys survive?** The env
   marker avoids this, but if we ever prefer a config channel, run: for each
   enabled provider, `agents.create({ config: { provider, cwd, providerOptions: { fleetRole: "worker" } } })`
   and confirm `session.opened` (not a schema `parse` failure). Provider option
   schemas are zod objects (`PiProviderOptionsSchema.parse`,
   `pi/agent.js:2013`); unknown-key behaviour is not asserted here.
2. **Can a stable path for `fleet-mcp-server.mjs` be built?** It imports
   `../server/mcp-tools.ts` at runtime. Verify a bundling step or a
   stable-copy + dependency closure works when the plugin checkout is replaced
   on update. This is the main delivery risk.
3. **Does the daemon persist injected servers across reload?** `mcpServers`
   live in the stored agent record (`agent-storage.*`). Confirm a reload
   (`agent-manager.js:845-861`) re-applies the same set and does not lose
   class-specific servers when the hook is not re-run.
4. **Does `paseo run --env` reach the `agent.create` hook `env`?** The env field
   is in the create request (`CreateAgentRequestMessageSchema.env`,
   `messages.d.ts`) and the hook picks `env`, but confirm end-to-end with a
   throwaway logging hook before depending on it for the CLI fallback.
5. **Auditor spawn path** does not exist today. Confirm the intended entry point
   (RPC, schedule, or manual) before implementing its row of the matrix.

## 7. Appendix — primary references

- Helper injection API: `packages/paseo-plugin-helper/src/server/mcp-injection.ts`
- Hook contract: `@getpaseo/plugin/dist/server/lifecycle.d.ts:82`,
  `dist/server/contracts.d.ts` (`PluginServerContext`)
- Canonical config: `@getpaseo/protocol/dist/agent-types.d.ts:449-464`
- Daemon hook + normalization: `@getpaseo/server/.../agent/agent-manager.js:691,2500,3635,3670`
- Runtime built-in MCP: `@getpaseo/server/.../agent/runtime-mcp-config.js`
- Provider mappings: claude `agent.js:2690`, pi `agent.js:296,2024`, acp
  `acp-agent.js:1926,2441`, codex `options.js:60`
- Existing injections: `plugins/mcp-tools/index.server.ts:29`,
  `plugins/x-comms/server/injection.ts:136,150`
- Fleet spawner/classes: `plugins/uppidi-fleet/server/agents.ts:125,1850,1867,2200,2293`;
  `plugins/uppidi-fleet/server/role-models.ts:155`
- Fleet tools: `plugins/uppidi-fleet/server/mcp-tools.ts`,
  `plugins/uppidi-fleet/bin/fleet-mcp-server.mjs`
- Plugin docs: `docs/plugins.md:212-216`
