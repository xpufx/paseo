# slash

S/ash-command console for [Paseo](https://github.com/getpaseo/paseo) (v0.8+).

<p align="center">
  <img src="docs/screenshots/slash-console.jpg" alt="S/ash console — command repository, prefix, and shipped catalog" width="380">
</p>

Adds a **S/ash console** sidebar surface for managing the slash commands offered
in the composer, and keeps those commands registered as the repository changes.
A command carries one of three actions:

- **send** — interpolate `{args}` into a prompt template and send it to the agent.
- **open** — open a named plugin surface.
- **rpc** — run an allowlisted daemon operation (shipped: `slash.ping`, `slash.echo`).

> [!NOTE]
> **Prerequisites & Platform Support**:
> - Zero install requirements: the helper runtime is vendored
>   (`client|server|shared/vendor/paseo-plugin-helper/`, pinned helper
>   `0.4.0-beta.12`), so Paseo installs this plugin with no build step and no
>   npm/registry access. For local development (`typecheck`/`test`), Node.js
>   (v18+) is enough.
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

- `slash.settings`: persisted `prefix` and command repository.
- `slash.commands.list`: enabled commands with the prefix applied.
- `slash.catalog.list`: the shipped seed catalog, without touching settings.
- `slash.commands.run`: run one command by name; `send`/`open` resolve
  client-side, `rpc` executes daemon-side.
- `slash.bundle.export` / `slash.bundle.import`: share command sets as a
  versioned bundle.

## Install

```sh
paseo plugin add xpufx/paseo --path plugins/slash
```

## Development

```sh
npm run typecheck --workspace=plugins/slash
npm test --workspace=plugins/slash
```
