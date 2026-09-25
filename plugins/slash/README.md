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
- **rpc** — run a settings-defined operation (built-in primitives, or arbitrary
  HTTP operations declared as data).

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

The **catalog is data**. An operation binding is either a named built-in
primitive (`kind: "primitive"`) or an arbitrary HTTP request (`kind: "http"`):

- `kind: "primitive"` — names a built-in code handler: `slash.ping`, `slash.echo`,
  `slash.orchestrate`. Use this only for operations that need code semantics.
- `kind: "http"` — declares `method` (`GET`/`POST`), `path`, optional static
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
