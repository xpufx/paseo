# s/ash

Slash-command console for [Paseo](https://github.com/getpaseo/paseo).

<p align="center">
  <img src="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/slash/docs/screenshots/slash-console.jpg" alt="S/ash console — command repository, prefix, and shipped catalog" width="380">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/slash/docs/screenshots/slash-autocomplete.jpg" alt="S/ash command autocomplete in the composer" width="480">
</p>

Adds a **S/ash console** sidebar surface for managing the slash commands offered
in the composer, and keeps those commands registered as the repository changes.
A command carries one of three actions:

- **send** — interpolate `{args}` into a prompt template and send it to the agent.
- **open** — open a named plugin surface.
- **rpc** — run an allowlisted daemon operation (shipped: `slash.ping`, `slash.echo`).

Built on [paseo-plugin-helper](https://github.com/xpufx/paseo/tree/main/packages/paseo-plugin-helper), the shared Paseo plugin runtime.

> [!NOTE]
> **Prerequisites & Platform Support**:
> - Developed and tested primarily on **Linux**.

## What it does

- **Command repository.** The console lists enabled commands with their action
  summary and supports add / edit / remove through helper form primitives.
- **Shipped catalog.** The seed commands (`review`, `console`, `ping`) are
  listed separately so a missing one can be added back with one tap.
- **Prefix.** An optional shared prefix (default `slash-`, clearable to render
  bare command names) is applied to every command name.
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
  client-side, `rpc` executes daemon-side.
- `slash.bundle.export` / `slash.bundle.import`: share command sets as a
  versioned bundle.

## RPC operations: primitives vs bindings

Built-in primitive handlers (`slash.ping`, `slash.echo`, `slash.orchestrate`) are
code. User-visible operations are **data** in settings:

```json
{
  "operationBindings": [
    { "name": "fleet.orch", "primitive": "slash.orchestrate", "params": {}, "target": "http://10.20.30.24:8099" }
  ]
}
```

Custom bindings are merged over the seed bindings, so a new rpc slash command
targeting a different endpoint needs no plugin code change. A binding with the
same name as a seed overrides it. The hook endpoint resolves from the binding
`target`, then the settings `hookUrl`, then `PASEO_FORGEJO_HOOK_URL`, then the
loopback default. Secret paths resolve from settings `hookSecretFile`, then
`PASEO_FORGEJO_HOOK_SECRET_FILE`, then `~/.paseo/forgejo-hook.secret`; the secret
value is never stored in settings.

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
