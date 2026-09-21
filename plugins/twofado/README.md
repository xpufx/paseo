# twofado

> **⚠️ WIP — use at your own risk.** Not release-ready; APIs and behavior may change without notice.

Approval-gate UI for the **2fado** privileged-command daemon, for
[Paseo](https://github.com/getpaseo/paseo).

Surfaces pending risky command requests from `2fadod` and lets a human
approve, deny, or acknowledge them without leaving Paseo. The plugin also
registers a sidebar item, a workspace header button, and a command-center
entry so the queue is one tap away.

Built on [paseo-plugin-helper](https://github.com/xpufx/paseo/tree/main/packages/paseo-plugin-helper), the shared Paseo plugin runtime.

> [!NOTE]
> **Prerequisites & Platform Support**:
> - Requires a running `2fadod`; the daemon is reached over a unix socket.
>   The socket path is configurable and otherwise falls back to
>   `$TWOFADO_SOCKET`, `$FADO_SOCKET`, then `/tmp/2fado.sock`.
> - Developed and tested primarily on **Linux**.

## What it does

- **Pending queue.** Each request shows the argv, caller, host, working
  directory, expiry, and (when provided) a code preview with resolved binary,
  risk level, affected path count, and sample paths.
- **Approve / deny.** A decision is submitted for the request id; two-step
  confirmations are distinguished, and notify-only petitions expose an
  **Ack** action instead of a binding verdict.
- **Policy shortcuts.** From a pending item, save an always-approve or
  always-deny rule scoped to the exact argv, the resolved binary's base, or a
  custom matcher.
- **History.** Recently decided requests are listed with decision, decided-by,
  exit code, and a truncated output preview.
- **Health.** The header reports daemon reachability and a down state when
  the socket cannot be probed.
- **Notification target.** Choose whether notifications go to Telegram, the
  Paseo client, or both; Telegram bot token, chat id, and approver list are
  configurable in settings.

## RPC contracts (`shared/approval.ts`)

- `approval.list` / `approval.recent`: pending and recently decided requests.
- `approval.verdict` / `approval.ack`: record a decision, or acknowledge a
  notify-only petition.
- `approval.status` / `approval.health`: per-request status and daemon probe.
- `approval.telegram_info` / `approval.telegram_set_config`: read and sync the
  daemon-side notification configuration.
- `approval.policy_add_rule`: persist a policy rule derived from a request.
- `twofado.settings`: socket path, notification target, and Telegram config.

## Install

Install from npm:

```sh
paseo plugin add npm:@xpufx/paseo-twofado
```

Or install directly from the Git repository:

```sh
paseo plugin add xpufx/paseo --path plugins/twofado
```

## Development

```sh
npm run typecheck --workspace=plugins/twofado
```
