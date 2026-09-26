# Daemon Mesh: Presence, Injection, and Visibility

How Paseo daemons find each other, how agents get tools without being asked,
and how the fleet stays observable. Three mechanisms, each independent,
composable in that order.

This mirrors `docs/mesh.md` in `paseo-plugin-helper` (0.8 line): both repos
tell the same story and share one vocabulary (announce/retract, tombstones,
intended vs actual). The helper doc is the vision; this file records what
x-comms implements and what is still ahead.

## Thesis

Presence RPCs plus link-identity is the foundation; reliable agent messaging
rides on top of it. Conversation (`x_comms_send` and friends) is the top
layer. Nothing below it ever speaks in chat messages.

## Layer 0: Link identity

Every peer link is authenticated. Sender identity (serverId) comes from the
link itself, never from message payloads.

What x-comms does today:
- Outbound: after `DaemonClient.connect()`, the handshake identity from
  `getLastServerInfoMessage()` is checked against the expected serverId
  embedded in the registry relay offer. A mismatch aborts before any
  payload is sent (`server/peer-channel.ts`).
- Inbound: RPC handlers have no link context, so the receiver accepts only
  entries whose serverId matches an explicitly paired peer (seed links
  stay explicit). Anything else is dropped and counted as rejected.
- Own identity is read locally (`~/.paseo/server-id`, falling back to a
  local `paseo daemon status` probe), never from agent config or payloads.

Known gap: true receiver-side link verification needs daemon support; the
known-peer check is the approximation until then.

## Layer 0.5 Envelope attribution

Link identity authenticates the *channel*. The conversation layer still needed a
way to authenticate the *claim inside the message*: the wire envelope is plain
text in an agent's turn, so any agent could hand-write the tag and name any
`sender.agentId`, and could even have the trusted server do it by passing a
`fromAgentId` to `x_comms_send` (#594).

Implemented:
- Every envelope the x-comms stack emits carries `xComms.auth`: an ed25519
  signature over a canonical, field-ordered payload of the attribution fields
  (`shared/envelope.ts`, `AUTH_FIELDS`). `direction` and the prose body are
  excluded — this proves who sent, not what they said.
- Each daemon holds a keypair, generated on first use, `0600`, in
  `~/.paseo/paseo-x-comms/mesh-key.json` (`server/mesh-identity.ts`).
- Peers exchange public keys over the Layer 0 channel via the `mesh.key` RPC
  (`server/peer-channel.ts`) and **pin** the first `keyId` they see per peer. A
  changed `keyId` for a pinned peer is refused, which is what stops key
  substitution (`server/mesh-keys.ts`).
- `reconcileTimelines` refuses to attribute an envelope whose auth is missing or
  does not verify. The claim never becomes a thread, an unread count, or a peer
  identity that other agents are told to reply to.
- `x_comms_send` ignores `fromAgentId` inside an agent session: the sender is the
  daemon-injected `PASEO_AGENT_ID`, and only the plugin server's own subprocess
  (no such variable) may set it.

Honest bounds, also in the README:
- Direct `host:port` links have no authenticated identity, so their envelopes are
  unverifiable by construction and never attributed.
- Key distribution rides the presence channel, whose handlers have no link
  context — so pairing is still the trust root. The signature stops an agent on a
  paired mesh from impersonating a peer; it does not defeat an attacker holding a
  direct link.
- `auth` is optional in the schema. Version skew and unsigned legacy envelopes
  parse fine and are simply untrusted, so a message is never lost to a strict
  reader.
- The client renderer holds no keys, so it reports a declared signed/unsigned
  state rather than verifying. The plugin server is the enforcement point.

## Layer 1: Presence (control plane, invisible)

- `presence.announce` (birth batch) and `presence.retract`, keyed by
  `(serverId, agentId)`, carried as plugin RPCs over the authenticated
  peer channel (`server/peer-channel.ts` via `DaemonClient.invokePluginRpc`).
  Never through conversation sends.
- Local hooks only: `on("agent.created")` buffers and announces,
  `on("agent.archived")` retracts immediately (`index.server.ts`).
- Store (`server/presence.ts`, `PluginStorage` pattern, `presence.json`):
  live entries, sticky tombstones, bounded seen-id LRU (1000), queued
  retracts per peer with retry piggybacked on the next outbound pass.
- Anti-loop rules, in order of importance:
  1. Seen-id LRU drops duplicates.
  2. Never forward gossip: only locally-originated events leave the daemon
     (origin tracking plus the transport edge only sends local entries).
  3. Retract-before-reannounce with sticky tombstones (kept 2x the live
     TTL) so delayed births cannot resurrect the dead.
  4. TTL (7 days live) purely as a safety net; firing logs an alert.
- Explicitly deferred: vector clocks, anti-entropy sync, Merkle anything.
- Birth payload is minimal: `(serverId, agentId, name, provider,
  timestamp)`. No cwd, workspace, or project.
- Debug surface: `presence.list` RPC (live, tombstones, pending count).
  No UI.
- Scope flag: daemon-wide `presenceEnabled` in plugin settings (on by
  default). It gates local capture and fan-out; inbound processing
  continues so re-enabling finds warm state.
- Known limitation: births missed while a peer is offline are not
  backfilled in this slice. Retracts are queued and retried.

## Layer 2: Injection (tools by default)

Implemented on this branch (`server/injection.ts`, wired in
`index.server.ts`):
- `registerMcpInjection` from the helper wraps `server.before`
  ("agent.create") with merge-preserving, non-mutating semantics.
- Key scheme `x-comms.<serverId>` (fallback plain `x-comms` with a logged
  warning if the local server id is unreadable).
- Stdio config uses `process.execPath` plus the runtime-resolved bundled
  server path, so it works from git checkouts on foreign hosts.
- No provider filter (all agents). Daemon-wide `injectionEnabled` toggle
  in plugin settings, default on; changes apply on plugin reload.
- Recipient instructions ride the same gate (`server/recipient-instructions.ts`,
  #381): the tools alone left a delivery indistinguishable from chat, so the
  envelope-handling contract (detect/parse/attribute/reply) is folded into the
  agent's `config.systemPrompt` alongside the MCP server. The toggle covers
  both; no envelope-handling contract without the tools that answer it.
- Per-agent opt-out deferred. MCP server, envelope, and presence untouched.

## Layer 3: Visibility (intended vs actual)

Not implemented. Planned: injection snapshot plus diff against live
session configs. Separate slice.

## Layer 4: Conversation reliability (sender-side outbox)

Implemented (`server/outbox.ts` + the plugin server, #12):
- Failed `conversation.send` calls are held in an `outbox.json` store and
  retried over the same `x_comms_send` path: exponential backoff
  (5s doubling to 60s), a 15s periodic sweep, and an immediate retry when a
  peer's reachability flips false -> true (health/snapshot).
- Held messages expire after a configurable window (default 10 min); on
  expiry the sender gets an `x-comms-outbox-notice` timeline item with the
  reason, then the entry is dropped.
- Scope: this covers plugin-server sends (panel/composer). Agent-initiated
  `x_comms_send` calls run in an ephemeral per-session MCP process and are not
  outboxed.
- Delivery path (`conversation.send`): a target that resolves to THIS daemon's
  serverId sends natively through the host `PaseoApi` (`server/local-send.ts`);
  every remote target goes through the bundled MCP server, which stamps the
  envelope and shells out to `paseo send --host`. `PaseoApi.send()` is bound to
  one daemon connection and carries no host/`serverId` (`PaseoAgentSendOptions`
  has only `messageId`/`images`/`attachments`), so there is no host-targeted SDK
  call to replace the remote shell-out with. Both producers stamp the identical
  version-4 envelope, so the wire contract is unchanged.
- Every initial send assigns a UUID messageId, carries it in the version-5
  envelope, and passes it through to Paseo. Held outbox entries retain that
  same id for retries, so native daemon deduplication prevents duplicate agent
  delivery after an ambiguous failure.

## Trust corollary

Any installed plugin can run these hooks, so peering with a daemon means
trusting its plugin list. Daemon-wide kill switches (disable the plugin,
or the `presenceEnabled` flag) must always work instantly.
