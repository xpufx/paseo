# x-comms plugin — features contract

Derived from the code as it stands, not from what it was designed to do. Every
row below was read out of the source named in its *Where* cell; nothing here is
inherited from a design document. Where the shipped docs and the code disagree,
the code wins and the disagreement is recorded in
[`contract-drift.md`](contract-drift.md).

The companion contract for the embedded MCP server is
[`contract-mcp.md`](contract-mcp.md).

## How to read this

Each feature states four things:

* **Does** — the observable behaviour.
* **I/O** — the input shape it accepts and the output shape it returns.
* **Fails** — how it fails, and whether the failure is visible to a caller.
* **Depends on** — `local` (decides on this daemon), `peer` (needs a live peer
  daemon to decide), or `fs` (needs only local filesystem state).

"Deterministic" below means: the same input and the same local state produce the
same output, with no network, clock, or filesystem-race dependence. Everything
marked `peer` is a sample of a remote daemon's state at one instant.

## Inventory

Counted from `index.server.ts`, `index.client.tsx`, and `shared/registry.ts`.

| Surface | Count | Where |
|---|---:|---|
| Server RPC handlers | 20 | `index.server.ts:58-77`, contracts in `shared/registry.ts` |
| `agent.*` daemon events | 4 | `index.server.ts:78-97` |
| `agent.create` injection hooks | 2 | `index.server.ts:98` → `server/injection.ts:168-169` |
| Client surface contributions | 9 | `index.client.tsx:14-70` |
| **Total** | **35** | |

Plus a shared wire substrate (`shared/envelope.ts`, `server/busy.ts`,
`server/defer-queue.ts`, `server/outbox.ts`, `server/mesh-identity.ts`,
`server/mesh-keys.ts`) that the MCP server mirrors in standalone form. It is
described once, in [§6](#6-shared-wire-substrate), and not counted in the 35
because it has no registration site of its own.

---

## 1. Server RPC handlers (20)

Contracts and zod schemas: `shared/registry.ts`. Handlers:
`server/handlers.ts`, except `peer.status` which lives in `server/peer-status.ts`.

### 1.1 Registry management (4)

| RPC | Does | I/O | Fails | Depends on |
|---|---|---|---|---|
| `registry.read` | Reads the registry file **merged with Paseo's configured hosts**, validates every host form, and attaches `serverId` + `hostname` per entry. | in `{}` → `{ registryPath, exists, validJson, parseError, daemons[] }`, each daemon `{ name, value, valid, error, source?, serverId, hostname }` | Never throws. A missing file is `exists: false` with configured hosts still listed; corrupt JSON is `validJson: false` + `parseError` and an empty `daemons`. | fs |
| `daemon.add` | Validates the name, refuses a duplicate, validates every entry, then writes. | in `{ name, value }` → `{ saved, error, registryPath, daemons }` | Returns `saved: false` + `error` (never a thrown RPC) for: bad name charset, duplicate name, any entry failing `validateDaemonHost`, two names sharing one host value, unparseable existing registry, write failure. On any of these the file is untouched. | fs |
| `daemon.update` | Renames and/or re-values an entry atomically. | in `{ name, rename?, value? }` → same shape as add | `saved: false` + `error` for unknown name, rename collision, or a value that fails host validation. An update with neither `rename` nor `value` is a no-op that still reports `saved: true`. | fs |
| `daemon.remove` | Deletes an entry. | in `{ name }` → same shape | `saved: false` + `error` for an unknown name. | fs |

Notes that matter and are not in the shipped README:

* **Duplicate host values are rejected** across the whole file, not just at the
  touched entry (`server/registry.ts:366-380`).
* **Name charset** is `^[A-Za-z0-9._-]+$` and is enforced on add, update and
  remove alike (`server/registry.ts:260-267`).
* The file is written `0600` (`server/registry.ts:387`).
* A registry write **never** touches a configured host. Configured hosts appear
  in `registry.read` output with `source: "configured-host"` and are not
  addable/removable through these RPCs.

### 1.2 Reachability and identity (6)

| RPC | Does | I/O | Fails | Depends on |
|---|---|---|---|---|
| `daemon.health` | Returns per-daemon reachability and live agent count from a 60s-stale cache, and records each verdict so a false→true flip can kick an immediate outbox retry. | in `{}` → `{ results: [{ name, reachable, error, agentCount }] }` | Per-entry `error`, never a whole-list failure. One unreachable peer does not fail the list. | peer |
| `agents.introspect` | The agent tree every picker reads: daemon → project → workspace → `{ agentId, shortId, name, status }`. | in `{}` → `{ daemons: [{ name, reachable, error, projects[] }] }` | Per-daemon `error`; an unreachable daemon returns `projects: []`. | peer |
| `daemon.probe` | Validates the *format* of a candidate host, then actually dials it with `paseo ls --host`. | in `{ value }` → `{ valid, formatError, reachable, error }` | Format failure is `valid: false` with `reachable: false` and no dial attempted. An 8s dial timeout is reported as `reachable: false` + `error`. Never throws. | peer |
| `daemon.dump` | The debug surface: 6 parallel CLI probes (`daemon status`, `ls --global`, `workspace ls`, `project ls`, `schedule ls`, `terminal ls`) behind one 20s wrapper each, unwrapped from the CLI's several response shapes, plus offer-derived identity. | in `{ daemon }` → ~30 fields (identity, listen/pid/nodePath/startedAt, relay endpoints, transport, agents, workspaces, projects, providers, permissions, schedules, terminals) | An unknown name returns `reached: false` with the unknown-daemon diagnostic and `transport: ""`. `reached` is `true` if **any** probe succeeded. `permissions` is always `[]` — see [§5.4](#54-permissions-are-always-empty). | peer |
| `identity.sync` | Re-derives each daemon's `serverId` and hostname into plugin state (`daemonIdentities`, `daemonHostnames`) so a peer's id can be mapped back to its registered alias. | in `{}` → `{ identities, hostnames }` | Never throws. An entry with no derivable id is simply omitted. | fs (derivation is local: offer-decode only) |
| `peer.status` | The Peers tab. Dials every registered daemon concurrently over a real `DaemonClient`, checks the handshake `serverId` against the pairing offer, reads the peer's own `daemon.get_status` and `getHubStatus`. | in `{}` → `{ results: [20 fields incl. transport, serverId, hostname, version, pid, listen, relayEnabled/Endpoint, providerCount/Available, hubState/DaemonId/Origin/LastError] }` | Each result carries its own `reachable`/`error`; a thrown prober is converted to a down row. A peer that answers the handshake but not `daemon.get_status` is still `reachable: true` with identity from the handshake only. | peer |

### 1.3 Conversation and sending (1)

`conversation.send` is the single gated send entry point on the plugin side, and
it is the whole delivery contract. Described in full in [§3](#3-the-send-path).

| RPC | Does | I/O | Fails | Depends on |
|---|---|---|---|---|
| `conversation.send` | Busy-gates, then delivers: native SDK for a local target, pre-stamped `paseo send --host` when `stamped: true`, otherwise the bundled MCP server over stdio. Holds a transport failure in the outbox. | in `{ daemon, agentId, prompt, fromAgentId?, fromAgentName?, messageId?, notifyOnFinish?, stamped? }` → `{ daemon, agentId, ok, error, delivery, queueDepth, expiresAt }` where `delivery ∈ dispatched \| queued \| outbox \| dropped` | Never throws for a delivery outcome — every failure is one of the four states with `ok: false`. A thrown RPC means the plugin server itself is unreachable. | peer |

### 1.4 Peer control plane (4)

| RPC | Does | I/O | Fails | Depends on |
|---|---|---|---|---|
| `presence.announce` | Accepts a batch of remote births. | in `{ messageId, entries[] }` (≤500) → `{ accepted, rejected }` | Per-entry: an unknown `serverId`, a duplicate `messageId`, a tombstoned birth, or a stale birth all count as `rejected`. Never throws. | peer |
| `presence.retract` | Applies a retract, then prunes that peer's threads from the conversations snapshot. | in `{ messageId, serverId, agentId, timestamp }` → `{ applied }` | `{ applied: false }` for an unknown `serverId` or a duplicate `messageId`. Still tombstones when no live entry exists, so a delayed birth is refused. | peer |
| `presence.list` | The debug surface. Sweeps TTL first; a non-empty sweep is logged as an **error**, because TTL firing means announcements stopped flowing. | in `{}` → `{ live[], tombstones[], pendingRetracts }` | Never throws. | fs |
| `mesh.key` | Publishes this daemon's x-comms verify key. | in `{}` → `{ serverId, keyId, publicKeyPem }` | `serverId: null` when the local id is unreadable — deliberately, so a peer cannot pin a key to an unownable id. Never throws. | fs |

### 1.5 Settings, snapshot, diagnostics (5)

| RPC | Does | I/O | Fails | Depends on |
|---|---|---|---|---|
| `ui.prefs.get` | Returns the whole preference document. | in `{}` → `{ prereqsCollapsed, presenceEnabled, injectionEnabled, outboxExpirySeconds?, daemonEnabled? }` | A corrupt `plugin.json` is logged and read as `{}`; the RPC still succeeds with defaults. | fs |
| `ui.prefs.set` | Partial merge: undefined fields keep their stored value; `daemonEnabled` merges per key rather than replacing. | in the same fields (all but `prereqsCollapsed` optional) → the same shape, re-read after write | Never throws. | fs |
| `snapshot.refresh` | Re-probes the whole fleet, records reachability, then **reconciles local agent timelines into the conversations snapshot** (see [§5.3](#53-timeline-reconcile-and-attribution)). | in `{}` → `{ updatedAt }` | Timeline reconcile is best-effort and never fails the RPC. | peer + fs |
| `server.status` | Resolves the bundled MCP server path and scrapes its `VERSION` constant. | in `{}` → `{ installPath, installed, configured, version, syntaxOk, error }` | A path that cannot be resolved is `{ installed: false, configured: false, syntaxOk: false, error }` — not a throw. A null scraped version never fails the diagnostic. | fs |
| *(no RPC)* `daemon.update`'s sibling `directHostMismatch` | A pure advisory: flags a direct host whose name does not resemble its URL host. | `(name, value) => string \| null` | Never rejects. It is a warning, because a name may legitimately differ from an IP. | — |

---

## 2. Daemon event hooks (4) and injection (2)

### 2.1 `agent.*` events (4)

All four call `rememberPaseo(context.paseo)` first, so the periodic workers can
append notices to a local timeline with no RPC in flight.

| Event | Does | Fails | Depends on |
|---|---|---|---|
| `agent.created` | Records a local presence birth and announces it to every dialable, enabled peer. Queued retracts for each peer flush first (piggyback). | `presenceEnabled === false` → no-op. An unreadable local `serverId` logs an error and returns. A per-peer announce failure logs; the birth is **not** backfilled later. | peer |
| `agent.archived` | Retracts everywhere now; queues a retry for each peer that failed. Also detaches the local agent from the conversations snapshot. | Same gate. A failed retract is queued with `attempts: 1` and retried on the next outbound pass. | peer |
| `agent.turn_started` | Notes a local turn in the `BusyGate`, and invalidates any cached verdict for it. | Never fails. | local |
| `agent.turn_ended` | Clears the turn, then immediately drains whatever was queued for that agent. | Drain failure is logged; the queue is untouched. | local |

`turn_started` / `turn_ended` are the load-bearing pair for [§3](#3-the-send-path):
without them a local target's run status is unknown and a send would preempt.

### 2.2 `agent.create` hooks (2, registered by one call)

`index.server.ts:98` calls `maybeRegisterInjection(toInjectionServer(server), { enabled: injectionEnabled() })`,
which registers **two** handlers on the same hook name
(`server/injection.ts:168-169`):

1. **MCP tools** — merges `{ type: "stdio", command, args, env }` into
   `config.mcpServers` under the key `x-comms_<localServerId>` (fallback: bare
   `x-comms`). Merge-preserving and non-mutating: existing user servers survive,
   and the caller's request object is not written to.
2. **Recipient standing instructions** — folds the envelope-handling contract
   into `config.systemPrompt` (`server/recipient-instructions.ts`).

**Why the instructions exist at all.** The MCP server advertises its behavioural
contract through the MCP `instructions` field on the initialize result
(`mcp/paseo-x-comms.mjs:1196`). Neither injection transport has anywhere to put
it: `McpStdioInjectionConfig` / `McpHttpInjectionConfig` / `McpSseInjectionConfig`
are `{ type, command|url, args?, headers?, env?, alwaysLoad? }`
(`packages/paseo-plugin-helper/src/server/mcp-injection.ts:1-26`) and
`AgentCreateInjectionConfig` is `{ mcpServers?, [key: string]: unknown }`. There is
no `instructions` field on either, so the plugin cannot forward the server's
instructions into an agent's configuration. The contract therefore has to ride
in the system prompt, or it does not reach the agent at all.

Details:

* **Key scheme** is `x-comms_` + server id, underscore-separated. The separator
  **must not** be a dot: the name is forwarded to provider ACP servers and
  Gemini validates it against `^[a-zA-Z0-9_-]+$`; a dotted name fails
  `session/new` with JSON-RPC `-32602` and breaks every newborn Antigravity
  agent (#243). Pinned by a test that asserts the real pattern, not the constant.
* **Server path** is *not* the checkout path. `syncStableServer()` copies the
  bundled artifact to `~/.paseo/paseo-x-comms/bin/paseo-x-comms.bundled.mjs`,
  refreshing on content change, and injects that. Plugin checkouts are
  content-addressed and replaced on every update, so a checkout path baked into a
  saved agent config rots.
* **Command** is `process.execPath` when its basename looks like `node`/`bun`/
  `deno`, else the literal `"node"` — under Electron `process.execPath` is the
  GUI binary and cannot execute a script.
* **Env** carries exactly one variable, `PASEO_X_COMMS_MESH_KEY`, as an
  **absolute path** to this daemon's private signing key. The injected server is
  spawned by the agent runtime, not by this process, so it cannot inherit our
  environment — and the key must not be something an agent session can set for
  itself.
* **Toggle.** `injectionEnabled` defaults on (absent key means enabled). It
  covers **both** registrations, and a change takes effect only on plugin reload.
  When off, the gate registers nothing and logs
  `injection: disabled by settings, skipping agent.create hook`.
* **Instructions composition** is idempotent on the `[x-comms-recipient]`
  marker: a prompt already carrying it is returned unchanged, so re-registration
  is a no-op rather than a growing prompt. A non-string stored prompt is
  tolerated and replaced by the instructions alone.
* **Wiring is tested, not just the mechanism.** `index.server.test.ts` compiles
  and loads the real entrypoint against a sandboxed `HOME`, then asserts that
  **exactly two** `agent.create` handlers are registered, that one request
  produces both the MCP server entry *and* a system prompt containing the marker,
  that the caller's own server survives, that the request is not mutated, that
  teardown removes both, and that the disabled gate logs its skip. Deleting the
  single `maybeRegisterInjection(...)` line from `index.server.ts` fails this
  test; it did not fail any other test in the package (#689).

---

## 3. The send path

Everything a human or an agent can send on this daemon goes through
`conversation.send`. There is no second gated entry point.

```
conversation.send(daemon, agentId, prompt, …)
  │
  ├─ messageId = input.messageId ?? randomUUID()      ← generated once, at the edge
  │
  ├─ busyGate().isBusy({ daemon, agentId })  ── true ─▶ enqueue defer ─▶ delivery:"queued"
  │                                                          │
  │                                                     (return ok:true, queueDepth, expiresAt)
  │
  └─ deliverConversationMessage()
        ├─ stamped:true          ─▶ safeSpawn paseo send --host <registry value>  (verbatim bytes)
        ├─ local target          ─▶ PaseoApi.agents.ref(id).send(stamped, { messageId })
        └─ otherwise             ─▶ McpStdioClient → x_comms_send  (MCP server stamps)
                │
             throws ─▶ hold in outbox ─▶ delivery:"outbox"   (ok:false)
             ok      ─▶ noteTargetDispatched, recordOutboundSend,
                       queue delivery notice ─▶ delivery:"dispatched"
```

### 3.1 The busy gate

`server/busy.ts` + `server/handlers.ts:1445-1468`.

Paseo's daemon sends with `replaceRunning: true`, so dispatching into a running
target **replaces its turn**. A send therefore always reads the target's
lifecycle first.

* **Local targets** come from the daemon's own `agent.turn_started` /
  `agent.turn_ended` hooks — free and authoritative, and no probe at all. An
  agent the hooks have not seen falls back to `agents.ref(id).refresh()`.
* **Remote and configured-host targets** come from `paseo inspect --host
  <value> --json` with a **5 s** timeout. A peer is a sample, not a stream.
* **Busy is a deny-list**, not `status !== "idle"`:
  `initializing`, `running`, `busy`, `permission`, `awaiting_permission`,
  `waiting_permission`. `error` and `closed` are deliberately *not* busy — they
  have no running turn to replace, and treating them as busy would pin a queue
  against an agent that has already crashed, with no turn ever coming to drain it.
* **Casing is inconsistent across daemons** (`Status` from `inspect`, `status`
  from `ls`), so `readLifecycleStatus` tries `Status`, `status`, `lifecycle`,
  `Lifecycle` and lowercases.
* **Verdicts are cached for 5 s** and that cache is load-bearing, not an
  optimisation: a send starts a turn, so after a successful dispatch the target
  is busy by construction. Without `noteDispatched`, a second send in the same
  burst would re-probe, read the *pre-turn* status off a stale snapshot, and
  preempt the turn the first send just started.
* **The gate fails open.** A probe that errors or reports an unreadable state
  dispatches. Failing closed would turn "cannot tell" into a silently swallowed
  message, which is the worse failure.

### 3.2 The defer queue

`server/defer-queue.ts`. One file per item under
`~/.paseo/paseo-x-comms/pending/`, so two long-lived processes (this plugin
server and one injected MCP server per agent) can both write without a lock.

| Property | Value | Why |
|---|---|---|
| Depth per target | **8** | A target consumes one message per turn. Overflow evicts the **oldest waiting** item and tells its sender. |
| Fleet-wide | **200** | At the ceiling a **new** item is refused (`delivery: "dropped"`) rather than evicting someone else's outstanding obligation. |
| Expiry | **30 min** | Longer than the outbox's 10 min: this holds what could not be *accepted yet*, not what could not be *transmitted*. |
| Items per pass | **3 targets** | Bounds how long one pass can take, so a single stuck peer cannot stall every other target's backlog. |
| Verdicts reused | **15 s** | The drain interval. |
| Claim | `rename .json → .sending` | Succeeds for exactly one caller, so two drainers racing the same target cannot both dispatch it. |
| Poll interval | **15 s**, plus an immediate targeted drain on `agent.turn_ended` | A local target's backlog clears at turn speed, not at the poll interval. |
| Stamp handling | `stamped` is **required** to route | A `stamped: true` item is delivered verbatim over `--host`; a `stamped: false` item is delivered by the route its original send would have taken. Neither side re-stamps, because that would move `sentAt` and invalidate the signature. |

* **At most one item per target per pass.** A delivery starts the target's turn,
  so a second in the same pass would preempt the first. Throughput is therefore
  one message per observed turn.
* **A stale `.sending` claim is reported, never replayed.** A claim still
  present at the start of a later pass belongs to a process that died mid-send;
  the target may already have the message, so it is reported to the sender as
  *outcome unknown* and dropped.
* **A failed (not crashed) delivery hands the claim back** and retries later.
* **Unreadable item files are left in place**, not dropped, and age out on their
  own expiry.
* **Every non-delivery tells the sender** by appending an
  `x-comms-delivery-notice` timeline item (`expired`, `evicted`, `unknown`).
  Appending does not start a turn.

### 3.3 The outbox

`server/outbox.ts`. A different failure from the defer queue: the message was
sendable, the **transport** failed.

| Property | Value |
|---|---|
| Store | `~/.paseo/paseo-x-comms/outbox.json` |
| Backoff | `5s · 2^(attempts-1)`, capped at `60s` |
| Sweep | every `15s`, `runImmediately: true` on plugin load |
| Immediate retry | when a peer's reachability flips `false → true` via `daemon.health` or `snapshot.refresh`. The first observation is not a reconnect. |
| Expiry | default **600 s**, configurable `outboxExpirySeconds`, clamped to **10 s … 86 400 s**. Deliberately *not* the defer queue's 30 min. |
| On expiry | `x-comms-outbox-notice` timeline item with the reason, held duration and attempt count, then dropped |
| Idempotency | the first attempt's `messageId` is retained across every retry, so Paseo's daemon deduplicates a replay before the agent sees it |

The outbox read-modify-write is serialised by an in-process promise chain
(`withOutboxLock`) because a hold can land in the middle of a delivery pass and
would otherwise be clobbered by that pass's write.

### 3.4 Delivery notices

`notifyOnFinish` defaults to **true**. The notice is a `kind: "notice"` item in
the **same** defer queue, addressed to `LOCAL_DAEMON` (`"local"`), delivered
with `agents.ref(senderId).send(...)` on drain.

It goes through the queue on purpose: Paseo's own notify-on-finish path *steers*
the caller's turn, which would reintroduce the preemption the queue removes, in
the other direction. If the queue is at its bound the notice is refused and the
refusal is logged — the message itself is not held up by a notice that cannot be
queued.

Notice text is fixed-shape prose prefixed `[x-comms] delivery notice: …` and it
is **not** an envelope: `parseEnvelope` returns `null` for it. A notice is
local-only and deliberately not an attributable delivery.

---

## 4. Target resolution

One lookup, used by the gate, the drain, the pre-stamped send and the outbox
retry. They must agree: if the drain could resolve a target the gate could not,
the gate would dispatch a busy target; if the gate could resolve a target the
drain could not, a queued message would sit until it expired
(`server/handlers.ts:662-683`).

```
ref (name or srv_… id)
  │
  ├─ daemonNameForServerId(ref)          identity map, inverted
  ├─ findDaemonByRef(daemons, alias)     by name, then by serverId
  └─ chatEnabledDaemon(entry)            resolveDaemonEnabled() === false ─▶ null
```

* `readRegistry` merges the manual registry with Paseo's configured hosts
  (`~/.paseo/hosts.json`), so a configured host is reachable here without ever
  being added to the registry file.
* `findDaemonByRef` matches by name **or** `serverId`. This is what makes a
  configured host addressable: Desktop addresses a host by the `serverId` the
  Paseo host runtime hands it, and a host is free to carry a label, so its
  registry name is not its id.
* **`daemonEnabled` is enforced here.** `resolveDaemonEnabled` existed from the
  start and nothing called it, so the per-daemon toggle in the settings surface
  persisted, round-tripped through its RPC, and changed nothing — the control was
  asserting something false. It is now applied in `targetRegistryEntry`, which
  means it gates the busy gate, the drain, and the pre-stamped send together.
  Matching is by registry **name**, which is the key the settings surface
  persists under; a caller arriving by `serverId` is folded to its alias first,
  so both spellings of one daemon are filtered identically. The same opt-out is
  applied in `validPeerTargets`, so a daemon switched off is not dialled for
  presence either.
* A miss produces the **unknown-daemon diagnostic** (`server/unknown-daemon.ts`),
  which is deliberately not a pairing requirement: it names both registration
  routes, in the order the plain reading suggests, because a direct `--host`
  needs no offer at all. One earlier variant told the reader to use
  `x_comms_add_daemon` while claiming pairing was required, which sent people
  into an E2EE setup for what was a registry lookup.
* Local-vs-remote routing needs all three of a local `PaseoApi` handle, a
  resolved target `serverId`, and a match with this daemon's own id. Anything
  unresolved stays remote, so an unidentifiable direct host conservatively uses
  the CLI path rather than guessing. `PaseoApi.send()` carries no host or
  serverId, so there is no host-targeted SDK call to use instead.

---

## 5. Client surfaces (9)

All registrations are in `index.client.tsx:14-70`. Every row the plugin renders
into a shared Paseo surface carries a `via x-comms` footer
(`client/via-x-comms.tsx`), so plugin output is never mistaken for Paseo core.

### 5.1 Timeline contributions (5)

| # | Contribution | Does |
|---|---|---|
| 1 | `crossDaemonTransformer` (`user_message` → `x-comms-message`) | Parses **every** user message. If the text starts with `<x-comms-message>` (v6) or `[x-comms] ` (v5) it emits a plugin item; otherwise it passes through untouched. The envelope is the only discriminator. |
| 2 | `crossDaemonRenderer` | Draws the message card: direction icon, `Incoming`/`Outgoing`, sender label as `name @ alias (srv_…)`, and a 3-line body that grows to a selectable/copyable block only when measured overflow. |
| 3 | `outboxNoticeRenderer` (`x-comms-outbox-notice`) | Draws the "Delivery failed" card from a local outbox expiry notice. |
| 4 | `crossDaemonToolCallTransformer` (`tool_call` → `x-comms-tool-call`) | Replaces any `x_comms_*` tool call's raw JSON row with a card. Matches on name prefix only — no visibility toggle. Recognises `x_comms_`, `(_|^)x_comms_`, and the legacy `paseo_cross_daemon_` spelling, because clients may prefix tool names. |
| 5 | `crossDaemonToolCallRenderer` | Draws tool, short agent id, status dot + badge, resolved peer label, and the output as a 2000-char-truncated JSON code block. |

The message card marks an **incoming** envelope with no `auth` as
`unsigned sender` in warning colour, and the conversation bubbles do the same
with `[INCOMING · UNVERIFIED SENDER]`. Outgoing is exempt, because the Desktop
client stamps its own envelopes and holds no key.

### 5.2 Surfaces (4)

| # | Surface | Does |
|---|---|---|
| 6 | **Workspace panel** `x-comms` (context `agent`) | `CrossDaemonPanel` → the per-agent conversation view. |
| 7 | **Sidebar surface** `main` | `MainSurface`: three tabs — **Current** (registry list with health, add/edit/remove with a live reachability probe and inline "Add anyway"/"Save anyway", server path, introduce-agents picker, per-daemon debug dump), **Prototype** (the same registry and preferences rebuilt from helper primitives, plus the per-daemon enable toggle and outbox expiry), **Peers** (the live `peer.status` view, polled every 30 s). |
| 8 | **Header button**, one per workspace | Registers lazily for every workspace that has an agent, via an `agents.subscribe` upsert handler **plus** a one-shot `agents.list()` at startup — without the list, the icon is missing after a Paseo restart until the next agent event. Opens surface `main`. Removed on teardown. |
| 9 | **Composer pill**, one per agent | `registerComposerPill` manages the lifecycle; this module supplies the modal: **Chat** (the conversation view), **Settings** (presence + injection toggles, "changes take effect after the plugin reloads"), **About**. |

### 5.3 Timeline reconcile and attribution

`snapshot.refresh` scans every local agent's timeline for envelopes, verifies
each one, and folds the survivors into `~/.paseo/paseo-x-comms/conversations.json`
— a plain-data thread snapshot with unread counts, for cross-plugin readers
(`top`, `mcp-tools`).

* **Verification is the trust gate, and it is required with no permissive
  default.** An envelope whose auth does not verify is dropped; it never becomes
  a thread, an unread count, or a peer identity that other agents will be told to
  reply to. A caller that forgets to pass a verifier must not start trusting
  forgeries.
* Only envelopes with both `sender.agentId` and `sender.daemonServerId` are
  usable as a thread.
* Sending implies caught-up: a send resets `unreadCount` to 0 and advances the
  read watermark to now.
* Prune on retract, detach on local archive, cap at 200 threads.
* Per-agent timeline failures are skipped, never fatal.

### 5.4 Permissions are always empty

`daemon.dump` declares a `permissions` array in its contract and its handler
always returns `[]`. It is a declared field with no implementation behind it.
Recorded here rather than as a defect claim, because the field is required by the
zod contract and removing it would break the client schema.

---

## 6. Shared wire substrate

Described once. The MCP server carries a standalone copy of the parts it needs;
where it does, the two are pinned against each other by a test.

### 6.1 Envelope

`shared/envelope.ts`. Version **6**, tag-delimited, dual-parsed.

```
<x-comms-message>{"xComms":{…}}</x-comms-message>
```

| Field | Type | Notes |
|---|---|---|
| `version` | `6` | `6` for the tagged form. A `[x-comms] ` prefixed envelope with `version: 5` still parses. |
| `type` | `"x-comms.message"` | |
| `direction` | `"outgoing"` | **Always** `"outgoing"` on the wire: every message leaves its sender. Readers derive incoming vs outgoing by comparing `sender.agentId` to their own agent id (`viewerDirection`). It is also excluded from the signature. |
| `sender.agentId` / `agentName` / `host` / `daemonServerId` / `cwd` | `string \| null` | All nullable. |
| `target.daemon` / `agentId` | `string \| null` | Both nullable. |
| `messageId` | `string` (1–128, optional) | The **daemon's delivery key**, not a conversation id. Retained across outbox retries so the daemon can discard a duplicate. Never surfaced to a user. |
| `sentAt` | ISO string | |
| `auth` | `{ v, alg, keyId, sig }` (optional) | See below. |

`parseEnvelope` returns `null` — never a partial parse — when the text does not
start with a known prefix, the closing tag is missing, the JSON is malformed, or
the object fails the schema. Prose may follow the envelope and does not demote
the message to chat. A paste that merely *contains* the tag mid-sentence is not
a delivery.

### 6.2 `auth` — envelope authentication

An ed25519 signature over the attribution fields. It exists because the envelope
is plain text inside an agent's turn: without it any agent that can write to a
timeline can hand-write the tag and claim any `sender.agentId` (#594).

* **Signed payload** is a context line `x-comms/envelope-auth/v1` followed by one
  line per field in a fixed order: `version`, `type`, `sender.agentId`,
  `sender.agentName`, `sender.host`, `sender.daemonServerId`, `sender.cwd`,
  `target.daemon`, `target.agentId`, `messageId`, `sentAt`. Eleven fields. The
  list is exported and pinned by `shared/auth-fields.test.ts`, because it used to
  be module-private, which is exactly why nothing asserted it: a refactor
  dropping an entry would have shipped green.
* **Deliberately not JSON.** A JSON canonicalisation would depend on key order
  and escaping, so a re-serialized but identical envelope would stop verifying.
  A newline inside any signed value is **rejected**, not escaped, because it
  would forge a field boundary.
* **Not signed:** `direction` (every sender stamps the same value) and the prose
  body. This authenticates *who sent this*, not *what they said*, and binding the
  body would make the signature depend on whitespace the delivery path is free to
  normalise.
* **The schema is permissive and the trust decision is strict.** Anything shaped
  like an auth block parses, so a corrupt or future-algorithm block never loses a
  message. `verifyEnvelopeAuth` returns one of `verified` / `missing` /
  `invalid`, and only `verified` may be used for attribution. A verifier that has
  no key for a `keyId` returns `null`, which is an `invalid` verdict, not a pass.
* **Key.** ed25519, generated on first use, stored `0600` at
  `~/.paseo/paseo-x-comms/mesh-key.json`, written atomically. `keyId` is
  `xck1:` + base64url of the DER SubjectPublicKeyInfo — a fingerprint of the key
  **bytes**, so re-wrapping the same key in different PEM armour cannot change its
  identity. A stored key whose fingerprint disagrees with its own bytes is
  treated as corrupt and regenerated.
* **Distribution.** `mesh.key` over the peer channel. The caller **overwrites**
  the response's `serverId` with the link's own verified identity, so a buggy or
  spoofed local id cannot launder a key onto the wrong peer. A relay offer is
  checked against the handshake `serverId`; a mismatch aborts before any payload
  is sent.
* **Pinning is permanent.** The first `keyId` seen for a peer is pinned forever. A
  different `keyId` for an already pinned peer is **refused**, and the refusal is
  logged loudly rather than silently degrading. The declared fingerprint must
  also be the one the key bytes actually produce, so a pinned id cannot be
  pointed at a substituted key.
* **Direct `host:port` peers have no authenticated identity**, so their keys are
  never fetched and their envelopes are unverifiable by construction. Degraded,
  never trusted.
* **A sender cannot choose its own identity.** Inside an agent session,
  `x_comms_send` takes the sender from the daemon-injected `PASEO_AGENT_ID` and
  **ignores any `fromAgentId` passed**. Only the plugin server's own subprocess,
  which runs without that variable, may set it — otherwise any agent could have
  the trusted server stamp a sender block claiming someone else, which is the
  same forgery as hand-writing the tag, one call cheaper.

### 6.3 Constants, in one place

| Constant | Value | Where |
|---|---:|---|
| `DEFER_MAX_DEPTH_PER_TARGET` | 8 | `server/defer-queue.ts` |
| `DEFER_MAX_TOTAL` | 200 | `server/defer-queue.ts` |
| `DEFER_EXPIRY_MS` | 30 min | `server/defer-queue.ts` |
| `DEFER_MAX_TARGETS_PER_PASS` | 3 | `server/defer-queue.ts` |
| `DEFER_DRAIN_INTERVAL_MS` | 15 s | `server/defer-queue.ts` |
| `DEFER_VERDICT_TTL_MS` | 5 s | `server/defer-queue.ts` |
| `BUSY_PROBE_TIMEOUT_MS` | 5 s | `server/handlers.ts` |
| `OUTBOX_EXPIRY` default / min / max | 600 s / 10 s / 86 400 s | `server/settings.ts` |
| `OUTBOX_BACKOFF_BASE_MS` / `MAX_MS` | 5 s / 60 s | `server/outbox.ts` |
| `OUTBOX_POLL_INTERVAL_MS` | 15 s | `server/outbox.ts` |
| `PRESENCE_SEEN_CAP` | 1000 | `server/presence.ts` |
| `PRESENCE_TTL_MS` | 7 days | `server/presence.ts` |
| `PRESENCE_TOMBSTONE_TTL_MS` | 14 days | `server/presence.ts` |
| `CONVERSATIONS_THREAD_CAP` | 200 | `server/conversations-snapshot.ts` |
| `MESH_KEY_REFRESH_MS` | 5 min | `server/handlers.ts` |
| `MESH_KEY_PASS_DEADLINE_MS` | 5 s | `server/handlers.ts` |
| `SNAPSHOT_STALE_MS` | 60 s | `server/snapshot.ts` |
| `AUTH_VERSION` / `AUTH_ALG` | 1 / `ed25519` | `shared/envelope.ts` |
| `AUTH_PAYLOAD_CONTEXT` | `x-comms/envelope-auth/v1` | `shared/envelope.ts` |

The mesh-key pass is rate-limited and deadline-bounded because a snapshot refresh
is a user-visible RPC: dialling every relay peer on each one would put an 8 s
connect timeout per unreachable peer in front of the UI, and whatever it does not
return is picked up next pass.

### 6.4 On-disk state

Everything under `~/.paseo/paseo-x-comms/`, each file created with a
forward-only one-time migration from the old `~/.paseo` root location.

| File | Contents |
|---|---|
| `registry.json` | `name → opaque --host value`, `0600` |
| `plugin.json` | preferences: `prereqsCollapsed`, `presenceEnabled`, `injectionEnabled`, `outboxExpirySeconds`, `daemonEnabled`, `daemonIdentities`, `daemonHostnames`, `serverPath` |
| `outbox.json` | held messages + backoff state |
| `presence.json` | live entries, sticky tombstones, bounded seen-id LRU, queued retracts |
| `mesh-key.json` | this daemon's private signing key, `0600` |
| `mesh-keys.json` | pinned peer verify keys, `serverId → keyId` + PEM |
| `conversations.json` | thread snapshot for cross-plugin readers, capped at 200 |
| `snapshot.json` | last fleet probe, `0600` |
| `pending/` | defer queue, one file per item (`.json` waiting, `.sending` claimed) |
| `bin/paseo-x-comms.bundled.mjs` | the stable copy the injector points agents at |
| `extensions/` | MCP extension `.mjs` files (the MCP server's, read from the same dir) |

`~/.paseo/hosts.json` is **read** for configured hosts and is never written.
Every state reader degrades to an empty document on corruption and logs, so a bad
file cannot take the plugin down; writers rebuild.

### 6.5 Environment

| Variable | Read by | Purpose |
|---|---|---|
| `PASEO_X_COMMS_REMOTES` | plugin registry + MCP server | registry file path |
| `PASEO_HOSTS_FILE` | plugin registry + MCP server | configured-hosts file path |
| `PASEO_X_COMMS_MCP_SERVER` | plugin only | explicit bundled-server path override |
| `PASEO_X_COMMS_MESH_KEY` | MCP server | this daemon's signing key path; the plugin passes it by absolute path in the injected env |

---

## 7. Asymmetries for this surface

Full ledger, including the MCP-side asymmetries, in
[`contract-drift.md`](contract-drift.md). The three that matter most for the
plugin:

1. **`docs/mesh.md` describes the injection key as `x-comms.<serverId>`.** The
   code uses `x-comms_<serverId>`. The dotted form is the pre-#243 form and is
   precisely what breaks Gemini ACP.
2. **`docs/mesh.md` says both producers stamp a "version-4" envelope, and that
   the messageId is carried in the "version-5 envelope".** Both producers stamp
   **version 6**.
3. **The plugin README says the conversation/panel UI wraps
   `send`/`logs`/`wait`/permissions.** The plugin's client calls exactly one send
   RPC; there is no wrapper for `logs`, `wait`, or any permission tool anywhere
   under `client/`. The only other things the UI consumes are the registry,
   health, introspect, prefs, snapshot, dump, identity, server-status, probe,
   introduce and peer-status RPCs.
