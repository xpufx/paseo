# 2fado

2fado provides a human-in-the-loop approval gate and interactive notification surface for the `2fado` privileged-command daemon inside Paseo.

The plugin surfaces risky command execution requests intercepted by `2fadod`, allowing human operators to inspect execution parameters, review risk levels, approve or deny requests, answer interactive questions, and configure persistent policy shortcuts.

## Features and Capabilities

- **Pending Approval Queue**: Displays intercepted privileged commands with detailed execution context, including full argv, executing agent, hostname, working directory, expiration time, risk level, and affected path previews.
- **Approve, Deny & Acknowledge**: One-tap decision controls for pending petitions, including two-step confirmations for critical commands and acknowledgement actions for notify-only events.
- **Interactive Questions (`kind: "ask"`)**: Renders questions with single-select, multi-select, or free-form write-in options, forwarding answers directly to waiting agents.
- **Policy Shortcuts**: Create persistent always-approve or always-deny rules directly from pending petitions, scoped to exact command arguments, binary names, or regex patterns.
- **Companion Daemon Supervision**: Automatically acquires and supervises the `2fado` companion daemon when no system service is running, complete with process controls, uptime metrics, and log inspection.
- **Audit History**: Inspect recent decisions, deciding entities (human, policy rule, or timeout), exit codes, and execution output previews.
- **Multi-Channel Notifications**: Configurable alerts through Paseo Desktop notifications and Telegram bot integrations.

## Surfaces and UI

- **Sidebar Surface**: Full queue manager with Pending, History, Rules, and Daemon Supervisor tabs.
- **Workspace Header Item**: Badge counter indicating unresolved privileged requests.
- **Command Palette Entry**: Instant access to the 2fado queue from any workspace.

## Setup and Requirements

- Requires Paseo 0.8.0 or later.
- Connects to `2fadod` over a Unix domain socket (`$TWOFADO_SOCKET`, `$FADO_SOCKET`, or `/tmp/2fado.sock`).
- Bundles an automatic platform binary installer and process supervisor for standalone environments.
