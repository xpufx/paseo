# Daemon Mesh: Presence, Injection, and Visibility

How Paseo daemons find each other, how agents get tools without being asked,
and how the fleet stays observable. Three mechanisms, each independent,
composable in that order.

## Thesis

Presence RPCs plus link-identity is the foundation; reliable agent messaging
rides on top of it. Conversation (`x_comms_send` and friends) is the top
layer. Nothing below it ever speaks in chat messages.

## Layer 0: Link identity

Every peer link is authenticated. Sender identity (serverId) comes from the
link itself, never from message payloads. Any design that trusts a
self-reported sender id is wrong; anything that needs "who am I" reads it
via a `whoami`-style query backed by the local registry, never via injected
config alone.

## Layer 1: Presence (control plane, invisible)

- `presence.announce` (birth batch) and `presence.retract`, keyed by
  `(serverId, agentId)`, carried as plugin RPCs over the existing
  authenticated peer channel. Never through conversation sends: presence
  must not spam agents or pollute timelines.
- Local hooks only: `on("agent.created")` buffers and announces,
  `on("agent.archived")` retracts immediately.
- Anti-loop rules, in order of importance:
  1. Seen-id LRU, bounded (e.g. 1000), drop duplicates.
  2. Never forward gossip: a daemon announces only its own agents. The
     mesh stays linear; transitive discovery still works because every
     daemon announces directly to all its peers.
  3. Retract-before-reannounce with sticky tombstones (keep at least 2x
     the birth batching window) so delayed births cannot resurrect the dead.
  4. TTL purely as a safety net with alerting if it ever fires.
- Explicitly deferred: vector clocks, anti-entropy sync, Merkle anything.
- Birth payload is minimal: `(serverId, agentId, name, provider,
  timestamp)`. No cwd, workspace, or project: topology stays private until
  a conscious later call says otherwise.
- Seed links stay explicit (relay offer, registry). Presence gossip
  discovers everything else transitively: the configured seed is the
  chicken, gossip is the egg.

## Layer 2: Injection (tools by default)

- `server.before("agent.create")` merges the plugin's MCP server entry into
  every new agent config. Unfiltered means all agents on the daemon;
  filter by provider (or anything else) when scoping matters. A provider
  that cannot do MCP must be excluded or creation fails at validation.
- Namespaced keys per daemon (e.g. `x-comms.<serverId>`) make collisions
  impossible by construction instead of resolved.
- Identity env (home daemon, relay endpoint) rides the same hook, since
  `agent.create` also allows `env`. Reads of own identity go through a
  query tool, not config.
- Scope flag is daemon-wide first; per-agent opt-out is a later UI
  decision, not a protocol decision.
- Injection only mutates session config at birth. It never touches the MCP
  transport, the envelope, or any running agent.

## Layer 3: Visibility (intended vs actual)

- The injection wrapper writes every injected server to a shared snapshot
  (same `PluginStorage` pattern as the top/mcp-tools health integration).
- mcp-tools reads the snapshot (intended state) and diffs it against live
  agent session configs from the daemon (actual state). Injected-but-not-
  running is drift worth flagging; it usually means a provider silently
  dropped the server.
- Consumers (top pills, peer pickers, debug RPCs) read; nobody re-probes.

## Trust corollary

Any installed plugin can run these hooks, so peering with a daemon means
trusting its plugin list. Fleet pairing stays a trust decision, now with
sharper teeth. Daemon-wide kill switches (disable the plugin) must always
work instantly; per-agent overrides are optional.

## Slices

1. Presence store + hooks + RPC transport + tests. No MCP, envelope, or
   UI changes. (x-comms v0.8, in progress.)
2. Injection wrapper in `paseo-plugin-helper/server` + adoption with a
   namespaced server key.
3. Visibility diff in mcp-tools + consumers.
4. Anything with a UI (peer pickers, opt-out screens) only after 1-3 are
   green on two daemons.
