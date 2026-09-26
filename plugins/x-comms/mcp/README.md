# paseo-x-comms

> This repo closely follows stable releases of paseo in order to benefit
> from new features in the plugin system. Expect breaking changes between
> versions.

[paseo](https://paseo.sh) is an agent orchestrator: AI coding agents run on
paseo daemons, each managing its own workspaces, tools, and permissions.

paseo-x-comms is an MCP server that lets agents on one paseo daemon
(remote or local) talk to agents on another paseo daemon, even across hosts,
through the daemon's relay (WebSocket + E2EE) or directly over TCP.

## How it works

```
pi / opencode --MCP stdio--> paseo-x-comms (our server)
                                   │  execFile("paseo", [cmd, "--host", <target>, "--json", …])
                                   ▼
                             paseo CLI --relay (E2EE) or direct TCP--> daemon
```

- The MCP server is just a **client** of daemons: it never runs a
  daemon, and it only *talks* to agents; each agent does its own work on its
  own local daemon.
- `--host` is an **opaque string**: paseo classifies it automatically: a value
  containing `#offer=` is a relay connection (E2EE); anything else is a direct
  host target. Our registry maps a short name to that string.
- Every MCP response and every tool result flows through the official SDK, so
  framing, JSON-RPC, schema validation, and cancellation are protocol-correct
  by construction.
- The server also announces its behavioral contract to clients via the MCP
  `instructions` field (initialize result), so every model using it gets the
  envelope format and behavior notes below automatically.

## Install

### As a standalone MCP server

```sh
npm install -g @xpufx/paseo-x-comms
```

Requires the `paseo` CLI on PATH. Node ≥ 18.

### As a paseo plugin (recommended)

This repo also ships a paseo plugin that embeds the MCP server and adds the
x-comms UI (composer pill, agent panel, timeline rendering, and the
"Inject MCP into context" system-prompt toggle). The plugin is at the repo
root, so install without `--path`:

```sh
paseo plugin add <owner>/paseo-x-comms
```

paseo runs a single `npm install` at the repo root, which pulls both the
plugin dependencies and the embedded server's dependencies (`@modelcontextprotocol/sdk`,
`zod`) into one `node_modules`. The server is spawned from `./mcp` and resolves
its deps from that shared tree; no separate server install or PATH entry is
required.

## Quick start

1. On the **target** host, get its pairing offer:

   ```sh
   paseo daemon pair --json
   # → { "relayEnabled": true, "url": "https://app.paseo.sh/#offer=<b64>", ... }
   ```

   (Or, if that daemon is directly reachable over TCP, e.g. LAN, Tailscale, VPN,
   use its address, e.g. `10.0.0.5:6767`, instead of an offer.)

2. On **this** host, write the registry file with a name for that daemon
   (see `paseo-x-comms.example.json` for the format):

   `~/.paseo/paseo-x-comms/registry.json`:

   ```json
   { "hsi": "https://app.paseo.sh/#offer=<b64>" }
   ```

   The registry is credentials; write it yourself and do not paste offers
   into agent contexts.

3. Discover and talk:

   ```
   x_comms_list_agents(daemon="hsi")
   x_comms_send(daemon="hsi", agentId="…", prompt="…")
   ```

## Tools

> Tool names are `x_comms_*`. When a client (pi, opencode)
> loads this MCP server, it may prefix tool names with its own server
> registration (for example `paseo_2d_cross_2d_daemon_2d_comms_...` in pi).
> Match the tool names the client actually exposes in its tool list; the
> documented names below are the server's own, without any client prefix.

| Tool | Purpose |
|------|---------|
| `x_comms_list_daemons` | List registered daemons (names only) |
| `x_comms_add_daemon` | Register a daemon: pairing link or direct host |
| `x_comms_remove_daemon` | Forget a registered daemon |
| `x_comms_list_agents` | List agents on a daemon |
| `x_comms_inspect` | Inspect an agent on a daemon |
| `x_comms_send` | Send a message/task to an agent on a daemon. Starts a turn if the target is idle; **queues** it if the target is mid-turn (`delivery`, `queueDepth`, `expiresAt`). Optional `notifyOnFinish` (default `true`) queues a notice back to you when it lands |
| `x_comms_logs` | View an agent's activity/timeline on a daemon |
| `x_comms_wait` | Block until an agent on a daemon is idle; returns `permission` the moment it stalls on a prompt |
| `x_comms_list_permissions` | List pending permission requests on a daemon |
| `x_comms_allow_permission` | Allow an agent's permission request (`reqId` or `all`) |
| `x_comms_deny_permission` | Deny an agent's permission request (`reqId` or `all`, optional `message`/`interrupt`) |

## Message envelope

`send` prepends a structured sender-meta envelope:

```
<x-comms-message>{"xComms":{"version":6,"type":"x-comms.message","sender":{…},"target":{…},"messageId":"…","sentAt":"…","auth":{…}}}</x-comms-message>
```

- `sender`: agentId, agentName, host, daemonServerId, cwd: who is talking and
  from where. Sources: `agentId`/`cwd` from the environment
  (`PASEO_AGENT_ID` / `PASEO_AGENT_CWD`), `host`/`daemonServerId` from
  `paseo daemon status --json`, `agentName` from `paseo inspect <agentId> --json`.
- `target`: daemon name + recipient agentId.
- `messageId`: stable delivery key passed to Paseo's native send path. Reuse it
  only for a retry of the same logical message; the target daemon deduplicates it.
- `sentAt`: ISO timestamp.
- `auth`: the sending daemon's signature — see [Envelope
  authentication](#envelope-authentication).
- The prompt text itself stays prose: the meta is for machines, the prompt is
  for humans.

Recipients may parse the envelope and reply to `sender.agentId` on the
sender's daemon. The envelope is versioned (`version: 6`), with backward-compatible
support for v5 `[x-comms]`, so the format can evolve without breaking older readers.

For best results, run the same version on each daemon: the envelope format,
tool names, and parameters evolve between releases, so a mismatched pair still
works, but the older side answers in its older format.

### Envelope authentication

Everything above the `auth` field is plain text inside an agent's turn, so on its
own it proves nothing: **any agent that can write to a timeline can hand-write
the `<x-comms-message>` tag and claim any `sender.agentId`.** `auth` is what makes
the claim checkable.

```
"auth": { "v": 1, "alg": "ed25519", "keyId": "xck1:<fingerprint>", "sig": "<base64url>" }
```

- **What is signed.** A canonical, field-ordered payload: `version`, `type`, every
  `sender.*` and `target.*` field, `messageId`, and `sentAt`. `direction` is
  excluded (every sender stamps `"outgoing"`; readers derive it themselves) and
  so is the prose body — this authenticates *who sent this*, not *what they said*.
  Editing any attribution field invalidates the signature.
- **Who signs.** Each daemon holds an ed25519 keypair, generated on first use and
  stored `0600` in `~/.paseo/paseo-x-comms/mesh-key.json`. `keyId` is the
  fingerprint of the signing public key.
- **Who checks.** The receiving daemon fetches the peer's public key over the
  **existing** authenticated peer link (relay E2EE, with the handshake serverId
  checked against the pairing offer) and **pins** it. A later key with a
  different `keyId` for an already pinned peer is refused, not adopted.
- **What a receiver does with an unsigned or unverifiable envelope.** Nothing
  good: it is dropped, so it never becomes a conversation, an unread count, or a
  peer identity that other agents are told to reply to. The x-comms UI marks such
  a message as unsigned.
- **You cannot forge your own sender.** Inside an agent session, `x_comms_send`
  takes the sender identity from the daemon-injected `PASEO_AGENT_ID` and
  **ignores any `fromAgentId` you pass**. `fromAgentId` is honored only for the
  plugin server's own subprocess, which runs without that variable and needs it to
  send on a local agent's behalf.

Deliberate limits, so the guarantee is not oversold:

- A **direct `host:port` peer has no authenticated identity**, so its envelopes
  cannot be verified and are never attributed. Use a pairing offer for any peer you
  intend to trust.
- Key distribution rides the same channel as presence, and a presence handler has
  no link context, so **pairing remains the trust root** (see
  `docs/mesh.md`, "Known gap"). The signature prevents an agent on a paired mesh
  from impersonating anyone; it does not defeat an attacker who controls a
  direct link.
- `auth` is **optional in the schema**: an unsigned or unrecognized auth block
  still parses, it is simply never trusted. Version skew degrades to
  "unattributable", never to a lost message.

## Behavior notes

- **Send never interrupts a running turn.** This used to be preemptive: a
  message to a busy agent replaced its current run (paseo's
  `replaceRunning: true` in `startAgentRun`, see
  `packages/server/src/server/agent/agent-prompt.ts`). Now a send to a
  mid-turn target is **queued** and delivered when that target is next observed
  idle. You no longer need `x_comms_wait` first to avoid preemption; wait only
  when you actually want a result. See "Delivery contract" below for exactly
  what "queued" does and does not promise.
- **Permission loop.** An agent may block on a permission prompt; `send`
  returns `permission`, `wait` surfaces it, `list_permissions` shows details,
  and `allow_permission`/`deny_permission` answer. The loop:
  `send` → `wait` → on `permission`: `list_permissions` + allow/deny →
  `wait` … → `idle`.
- **Preflight.** A target alias is resolved before dispatch: an unknown alias
  fails with the exact string and a `pairing is required` hint, not a generic
  failure.
- **Self-message.** Sending to your own agent (`agentId` equals the sender)
  fails with the fixed `x-comms self-message` label. Same-daemon routing for a
  *different* agent is the locality rule (#9), which is still open.

## Host forms

The registry value is passed to paseo as an **opaque** `--host` string; paseo
classifies it:

- `https://app.paseo.sh/#offer=<b64>` : relay connection (E2EE)
- `host:port`, `tcp://host:port?ssl=true&password=secret`, `unix:///path`,
  IPC paths, bare port: direct connection to a reachable daemon

Only these canonical forms are accepted. Anything else (e.g. a raw base64
payload) is passed through untouched and paseo fails visibly on it. (Note:
paseo's own `--host` help text lists only `host:port` and `tcp://…`; bare
ports and `unix://` also work but are not documented in the CLI help.)

## Extensions

> [!WARNING]
> **Extensions are trusted, unsandboxed server-tier code.** They run in this
> MCP server's process with full Node privileges: filesystem, network, child
> processes. There is no sandbox, no permission prompt, and no isolation
> boundary — the same trust level as an installed paseo plugin. Only drop in
> `.mjs` files you would run yourself.

Drop `*.mjs` files into the extension dir (default
`~/.paseo/paseo-x-comms/extensions`, override with `PASEO_X_COMMS_EXTENSIONS`).
Each exports `register(api)` (default or named) and is loaded in filename
order at startup. Extensions can add filters and register their own tools on
the same MCP server:

```js
export default function register(api) {
  // payload + context -> transform (return new payload), block, or passthrough
  api.onSend((message, context) => ({ ...message, prompt: message.prompt.trim() }));
  api.onReceive((data, context) => data);            // response from a daemon
  api.onToolCall((args, context) => args);           // every tool invocation

  api.registerTool(
    "x_comms_hello",
    { title: "Hello", description: "Demo tool", inputSchema: {} },
    () => ({ content: [{ type: "text", text: "hi" }] }),
  );
}
```

- `api.version` is the extension API version (currently `1`); it is bumped on
  any breaking change to the surface above.
- A filter returns `undefined`/`null`/`{action:"pass"}` to pass through, a new
  payload (or `{action:"transform", value}`) to transform, or
  `{action:"block", reason}` to block. A block stops the chain and surfaces the
  reason as the tool error.
- A file that throws while loading is skipped, and a hook that throws is logged
  and treated as passthrough. One bad extension cannot take down the server or
  the other extensions.

## Security

The registry (default `~/.paseo/paseo-x-comms/registry.json`) holds live
pairing offers (serverId, daemon public keys, relay endpoints): it is
**credentials**. Never publish it. Configure it as a plain JSON file yourself
(see the example); do not paste offers into agent contexts and do not share
the file.

`~/.paseo/paseo-x-comms/mesh-key.json` is this daemon's x-comms **private**
signing key (see [Envelope authentication](#envelope-authentication)). It is
written `0600`, never travels, and is not something to paste into an agent
context. Losing it only means this daemon's envelopes stop verifying under its
previous `keyId`; peers pin, so rotate by re-pairing rather than by editing the
file.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `PASEO_X_COMMS_REMOTES` | `~/.paseo/paseo-x-comms/registry.json` | registry file path |
| `PASEO_X_COMMS_PASEO` | `paseo` | paseo binary |
| `PASEO_X_COMMS_TIMEOUT_MS` | `120000` | per paseo call timeout |
| `PASEO_X_COMMS_EXTENSIONS` | `~/.paseo/paseo-x-comms/extensions` | extension dir (trusted, unsandboxed) |
| `PASEO_X_COMMS_MESH_KEY` | `~/.paseo/paseo-x-comms/mesh-key.json` | daemon signing key for `xComms.auth` |

## Registering with clients

Example configs live in this repo: `mcp-config.example.json` (pi-style
registration) and `paseo-x-comms.example.json` (registry format:
never commit your real registry).

pi (`~/.config/mcp/mcp.json`): the stdio form supports `env` (pi needs MCP
enabled for this to be picked up):

```json
{
  "mcpServers": {
    "paseo-x-comms": {
      "command": "node",
      "args": ["/path/to/paseo-x-comms.mjs"],
      "type": "stdio",
      "env": { "PASEO_X_COMMS_REMOTES": "/path/to/paseo-x-comms.json" }
    }
  }
}
```

opencode (`~/.config/opencode/opencode.jsonc`): note the key is `environment`
(per opencode's schema):

```jsonc
{
  "mcp": {
    "paseo-x-comms": {
      "type": "local",
      "command": ["node", "/path/to/paseo-x-comms.mjs"],
      "enabled": true,
      "environment": { "PASEO_X_COMMS_REMOTES": "/path/to/paseo-x-comms.json" }
    }
  }
}
```

## Scope

Communication only. The toolset covers discovery (`list_agents`, `inspect`),
messaging (`send`), listening (`logs`, `wait`), answering (`allow_permission`,
`deny_permission`, `list_permissions`), and the daemon registry
(`list_daemons`, `add_daemon`, `remove_daemon`). It deliberately does not
operate resources on other daemons: no schedules, terminals, workspaces, or
agent creation.

### Pairing offers are never disclosed

`x_comms_list_daemons --detailed` returns each daemon's target so a caller can
see *where* a daemon is. For a **relay** daemon that target embeds its pairing
offer after `#offer=`, and the offer is a control token: it authenticates a dial
to that peer. Handing it back in a tool result would let any agent that can call
the tool obtain a token for a peer it was never given — including one an operator
added by hand, whose offer was never in that agent's context to begin with.

So the offer token is replaced with `[REDACTED]` and the surrounding URL is kept.
Direct `tcp://host:port` targets carry no token and are returned in full.

Redaction keys on `#offer=` rather than on the `app.paseo.sh` host, because a
pairing URL is accepted on any https host and a self-hosted relay must not be the
exemption that leaks.

## Development

```sh
npm install
npm test          # hermetic: fake paseo CLI + temp registry, no live daemons
```

## License

MIT

## Delivery contract

> **Decision: a queued send is best-effort within a bounded window. It is NOT
> guaranteed to land before the target's next turn ends.** Read this before
> relying on `delivery: "queued"`. This is a deliberate product call, and the
> one thing here most worth revisiting — see "Why best-effort" and "If you want
> a stronger guarantee".

### Which routes this covers

**All of them, with no route exception.** Every x-comms send on this daemon goes
through one gated entry point and gets one of the four results below:

- an agent's `x_comms_send` (MCP/relay, direct peer, or `paseo send --host`)
- the plugin server's `conversation.send` — the registry/relay path **and** the
  Desktop configured-host path, which address a target by `serverId` rather than
  by registry name but are gated identically

The Desktop surface is not an exception. It used to be one: it borrowed a
`PaseoApi` and sent directly, which preempted a mid-turn target and then reported
`dispatched` unconditionally. That was disclosed inline in the client rather than
papered over, and is now closed (#611). A message typed into the Desktop
conversation to a busy agent waits, exactly as the same message sent by an agent
would.

The gate is a property of the *send*, not of the caller, so it holds for a
human-driven send and an agent-driven one alike. If you find a route that reports
`dispatched` for a target you believe is mid-turn, that is a bug in that route,
not a documented exception.

### What the sender is told

Every send returns exactly one of these. There is no silent case.

| `delivery`  | Meaning | `ok` |
|-------------|---------|------|
| `dispatched` | The target was observed idle and the message was sent. It starts a turn. | `true` |
| `queued`     | The target is mid-turn. The message is held. `queueDepth` is its position (1 = next up) and `expiresAt` is when it gives up. | `true` |
| `outbox`     | The send failed at the transport level and is in the outbox for retry (`error` has the reason). Unrelated to a busy target. | `false` |
| `dropped`    | A bound was hit and this message was refused (see below). `error` says which. | `false` |

**`ok: true` with `delivery: "queued"` does not mean delivered.** It means
accepted for deferred delivery. If you need confirmation, either read the
target's timeline or set `notifyOnFinish` and wait for the notice.

### When the gate itself is unavailable

A target whose lifecycle **cannot be read** is treated as idle and the message is
dispatched (see "Why best-effort, not guaranteed" — failing closed would turn
"cannot tell" into "silently swallow the message"). That fail-open is deliberate
and unchanged.

A queue that **cannot accept** the message is different, and never falls through
to a preempting send:

- **At a bound** (8 per target, 200 fleet-wide): the new message is refused with
  `delivery: "dropped"`, or an older one is evicted, and the sender is told. The
  message is not delivered late instead.
- **The plugin server is unreachable** (only reachable from a Desktop send, which
  has no other route to a configured host): the send **fails visibly** and
  nothing is sent. The Desktop surface shows *Not sent* and the underlying error.
  It does **not** fall back to a direct preempting send — that is the exact
  behaviour this contract exists to prevent, and reintroducing it as a fallback
  would make the guarantee conditional on the server being up, which is worse than
  a visible failure. The trade is deliberate: a configured-host send needs the
  plugin server, the same as every other gated send.

### Why best-effort, not guaranteed

A guarantee ("your message lands before the target's next turn ends") would
require knowing when a *remote* agent's next turn ends. Nothing in the protocol
provides that:

- There is no cross-daemon turn subscription. A busy check for a peer is a
  `paseo inspect --host` probe — a sample, not a stream.
- Even locally, `agent.turn_ended` tells you a turn ended; it cannot promise one
  is coming. An agent can stay mid-turn indefinitely, and a target that never
  goes idle has no turn for a message to land "before" the end of.
- The only ways to make it deterministic are to preempt (the behaviour this
  queue exists to remove) or to build a cross-daemon turn-completion protocol
  that does not exist.

So the honest contract is: *deferred, bounded, and never silent.*

### The bounds

| Bound | Value | Why that value |
|-------|-------|----------------|
| Depth, per target | **8** | A target consumes one message per turn, so the useful backlog is what still fits before it is stale. 8 is a few round trips of a two-agent exchange — enough that a bursty sender loses nothing it plausibly still wants, small enough that a backlog is one screenful. **Overflow evicts the oldest waiting message** for that target (a superseded leading message is the one the later ones made redundant) and tells its sender. |
| Depth, fleet-wide | **200** | Guards a fan-out across many targets. Every existing message is already somebody's outstanding obligation, so at the ceiling a **new** message is refused outright rather than evicting one. The caller gets `delivery: "dropped"` and can retry. |
| Expiry | **30 minutes** | A turn can legitimately run long, so the outbox's 10-minute *undeliverable* window would kill work that is clearly still wanted. 24 hours is the opposite failure: after a night, a message about yesterday's state is noise. On expiry the message is dropped and the sender is told why. |

The 30-minute expiry is intentionally **not** the outbox's configurable
`outboxExpirySeconds` (default 10 min). Different failure: the outbox holds what
could not be *transmitted*, this holds what could not be *accepted yet*.

### Nothing is ever dropped silently

Every non-delivery path tells the sender, and none of them interrupts it:

- **Expired / evicted / refused** — an `x-comms-delivery-notice` item is appended
  to the sender's timeline. Appending does not start a turn, so the sender reads
  it on a turn it starts itself.
- **Delivered** — with `notifyOnFinish` (default `true`), a notice is queued back
  to the sender when the message lands. The notice goes through **the same
  queue**, so a busy sender has it held until its own idle moment. Paseo's own
  notify-on-finish path *steers* the caller's turn; doing that here would
  reintroduce this feature's bug in the other direction. Neither side ever
  interrupts the other.

### Crash behaviour

A queued message is claimed by renaming its file `.json` → `.sending` *before*
the send. If the process dies mid-send, the claim survives, and the next pass
reports the message to the sender as **"outcome unknown"** and drops it rather
than replaying it — the target may already have it. A stable `messageId` means
Paseo's daemon would dedupe a replay, but a crash is not a place to rely on a
second line of defence. Failed (not crashed) deliveries hand the claim back and
retry on a later pass.

### If you want a stronger guarantee

Do not rely on the queue for it. Use the tool built for it: `x_comms_wait` until
the target reports `idle`, then send. That is synchronous and unambiguous, at the
cost of blocking your turn. The queue exists so you do not have to.
