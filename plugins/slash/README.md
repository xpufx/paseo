<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/slash-logo-for-dark-bg.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/slash-logo-for-light-bg.svg">
    <img alt="S/ash Logo" src="docs/screenshots/slash-logo-adaptive.svg" width="360">
  </picture>
</p>

<p align="center">
  <strong>Slash-command console for <a href="https://github.com/getpaseo/paseo">Paseo</a>.</strong>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/slash/docs/screenshots/slash-console.jpg" alt="S/ash console — command repository, prefix, and shipped catalog" width="380">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/slash/docs/screenshots/slash-autocomplete.jpg" alt="S/ash command autocomplete in the composer" width="480">
</p>

Adds a **S/ash console** sidebar surface for managing the slash commands offered
in the composer, and keeps those commands registered as the repository changes.
A command carries one of three actions:

- **send** -- interpolate `{args}` into a prompt template and send it to the agent.
- **open** -- open a named plugin surface.
- **rpc** -- run a settings-defined operation on the daemon host (built-in primitives,
  or arbitrary HTTP operations declared as data) and append output directly to the active session timeline.

Built on [paseo-plugin-helper](https://github.com/xpufx/paseo/tree/main/packages/paseo-plugin-helper), the shared Paseo plugin runtime.

> [!NOTE]
> **Prerequisites & Platform Support**:
> - Developed and tested primarily on **Linux**.
> - Commands that manage multi-account AI routing (`/agent-mux`, `/agent-mux-status`, `/agent-mux-probe`, `/agent-mux-cooldowns`) require the [agent-mux](https://github.com/xpufx/agent-mux) CLI installed on the daemon machine (`~/.local/bin` or on `PATH`).
> - Orchestration role handover (`/orchestrate`) interacts with [Uppidi Fleet](https://fleet.uppidi.com/) or any compatible webhook daemon.

## What it does

- **Command repository.** The console lists enabled commands with their action
  summary and supports add / edit / remove through helper form primitives.
- **Shipped catalog.** Pre-bundled seed commands are listed separately so missing ones can be added with one tap:
  - `/review` -- template prompt asking the agent to review current git diffs.
  - `/console` -- open the S/ash management console sidebar.
  - `/whoami` and `/who-are-you` -- query deterministic agent identity, model, mode, workspace, and working directory.
  - `/agent-mux` -- execute [agent-mux](https://github.com/xpufx/agent-mux) subcommands (`status`, `probe`, `cooldowns`, `help`, etc.) directly from chat with safe argument forwarding.
  - `/orchestrate` -- hand the orchestrator role to the calling agent via the [Uppidi Fleet](https://fleet.uppidi.com/) webhook hook.
  - `/ping` -- test daemon RPC round-trip.
- **Prefix.** An optional shared prefix (default `slash-`, clearable to render
  bare command names) is applied to every command name.
- **Argument Forwarding.** Arguments typed after slash commands in chat are safely passed to prompt templates (`{args}`) or parsed and forwarded as array arguments to backend RPC execution.
- **Bundle import/export.** Enabled commands round-trip through a versioned
  `slash-commands` document, so a command set can be shared between machines.

## RPC contracts (`shared/resources.ts`)

- `slash.settings`: persisted `prefix`, command repository, `operationBindings`,
  and the `hookUrl` / `hookSecretFile` endpoint fields.
- `slash.commands.list`: enabled commands with the prefix applied.
- `slash.catalog.list`: the shipped seed catalog, without touching settings.
- `slash.operations.list`: the allowlisted rpc operation names and known
  open-surface ids.
- `slash.commands.run`: run one command by name; `send`/`open` resolve
  client-side, `rpc` executes daemon-side with output forwarded to the agent timeline.
- `slash.bundle.export` / `slash.bundle.import`: share command sets as a
  versioned bundle.

## RPC operations: primitives vs bindings

The **catalog is data**. An operation binding is either a named built-in
primitive (`kind: "primitive"`) or an arbitrary HTTP request (`kind: "http"`):

- `kind: "primitive"` - names a built-in code handler: `slash.ping`, `slash.echo`,
  `slash.agent.identity`, `slash.agent-mux`, `slash.orchestrate`. Use this only for operations that need code semantics.
- `kind: "http"` - declares `method` (`GET`/`POST`), `path`, optional static
  `headers`, and the names of call-time `bodyParams` allowed into a POST body.
  Every http binding runs through one generic handler, so adding a callable rpc
  is a settings change, never a code change.

```json
{
  "operationBindings": [
    {
      "name": "notes.create",
      "kind": "http",
      "http": {
        "method": "POST",
        "path": "/notes",
        "headers": { "x-tenant": "acme" },
        "bodyParams": ["title"]
      },
      "auth": true,
      "target": "http://10.20.30.24:8099"
    },
    { "name": "fleet.orch", "kind": "primitive", "primitive": "slash.orchestrate", "target": "http://10.20.30.24:8099" }
  ]
}
```

Bindings are merged over the seed bindings (`slash.ping`, `slash.echo`,
`slash.orchestrate`), so a new rpc slash command needs no plugin code change; a
binding with the same name as a seed overrides it. `slash.operations.list` and the
console rpc-operation picker both reflect the merged catalog.

Endpoint resolution is shared by primitives and http bindings: binding `target`,
then settings `hookUrl`, then `PASEO_FORGEJO_HOOK_URL`, then the loopback default.
A binding with `"auth": true` attaches the hook bearer secret; the secret path
resolves from settings `hookSecretFile`, then `PASEO_FORGEJO_HOOK_SECRET_FILE`,
then `~/.paseo/forgejo-hook.secret`. The secret value is never stored in settings,
never logged, and request headers are redacted in any preview. Only `http(s)`
targets are allowed; responses are capped at 64KB with a 10s timeout.

## Install

Install from npm:

```sh
paseo plugin add npm:@xpufx/paseo-slash
```

Or install directly from the Git repository:

```sh
paseo plugin add xpufx/paseo --path plugins/slash
```

## Development

```sh
npm run typecheck --workspace=plugins/slash
npm test --workspace=plugins/slash
```
