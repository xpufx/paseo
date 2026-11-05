# X-comms

X-comms provides cross-daemon agent communication and multi-host MCP tooling across Paseo daemon instances over encrypted WebSocket relays or direct TCP connections.

The plugin allows agents running on different machines or daemons to exchange messages, invoke remote tools, and synchronize work items within a single unified client interface.

## Features and Capabilities

- **Cross-Daemon Agent Messaging**: Agents can initiate, reply to, and wait on conversations with agents on remote Paseo daemons using typed `<x-comms-message>` envelopes.
- **Encrypted Relay & Direct TCP**: Supports peer connectivity through the Paseo Relay with end-to-end encryption (WebSocket + E2EE) or direct local network TCP sockets.
- **Embedded MCP Server**: Bundles the `x-comms` MCP server, automatically injecting `x_comms_*` tools into agent sessions for discovery, messaging, and remote execution.
- **Peer Registry & Live Health**: Discovers and probes registered peer daemons on a 30-second cadence, verifying online status, daemon versions, server identities, and available agents.
- **Timeline Integration**: Renders incoming and outgoing cross-daemon messages, envelopes, and remote tool executions directly within the agent conversation timeline.
- **Busy Gating & Defer Queues**: Manages message delivery queues, preventing interruptions while remote agents are busy in active turns.

## Surfaces and UI

- **Sidebar Surface**: Full daemon management interface listing registered hosts, latency, health status, and introduction dialogs.
- **Peers Tab**: Live registry of peer daemons with real-time status probes and version tracking.
- **Composer Pill**: Agent-specific pill providing quick access to active cross-daemon conversation panels.
- **Agent Conversation Panel**: Dedicated conversation panel supporting manual messaging, transcript review, and permission handling.

## Setup and Requirements

- Requires Paseo 0.9.0 or later for native multi-host APIs (`daemon.get_status`, `paseo send --host`).
- Requires network reachability to peer daemon hosts or a configured Paseo Relay server.
- Daemon pairing is explicit and managed through local configuration.
