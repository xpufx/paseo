# forges

Work with Forge/Gitea-family issues from inside Paseo: list open issues for the
repo backing a workspace, read an issue's body and comments (with parsed agent
envelopes), change scoped labels, and post comments — all in plugin surfaces,
no browser.

Pull requests, releases, actions, and everything else are out of scope for now.
GitLab would need a separate API client.

## Highlights

- **No CLI dependency.** All forge access goes through an embedded TypeScript
  `fetch` client (`server/forge-client.ts`) against the Gitea-family
  `/api/v1`. There is no `git`/`fgj`/`fgjx` subprocess and no dependency on any
  host dotfile.
- **Daemon-side tokens.** The API token is stored per host in plugin settings
  and only ever attached to `fetch` calls in the daemon. It never reaches the
  client.
- **Live label vocabulary.** Scopes are derived from the labels actually on the
  board, so a foreign board degrades gracefully instead of failing on an
  unknown scope.
- **Optional label-set install.** Copy our scoped taxonomy
  (`state/`, `priority/`, `attention/`, `spec/`) onto the configured repo with
  an explicit keep-or-replace choice. Nothing is written without your action.
- **Example skills.** Our agent workflow ships under `examples/` as a starting
  point to adapt — see [`examples/README.md`](./examples/README.md).

Supported forges (verified live, anonymous reads): any Forgejo/Gitea-family
host, including Forgejo, Gitea, and Codeberg.

## Install

The plugin uses the Paseo 0.8 layout (`index.client.tsx` / `index.server.ts`
entries, `client/` / `server/` / `shared/` split, manifest
`requirements.paseo >= 0.8.0`). Install it from a checkout of this repository:

```sh
paseo plugin add <your-source-or-remote> --path plugins/forges
```

`<your-source-or-remote>` is wherever you host the plugin (a local path, a git
remote, or a registry reference) — the plugin has no dependency on this
monorepo or on any particular host at runtime.

## Configuration

Open the plugin's **Settings** tab inside a workspace.

- **Active forge.** Each workspace watches one active forge at a time. The
  list holds the workspace's forge remotes (any `parseForgejoRemote` form plus
  a bare `owner/repo`); **Auto** derives the remote from the workspace's git
  `origin`. An explicit selection wins absolutely: an invalid or unreachable
  selection fails loudly instead of silently deriving.
- **API token.** Saved per host in daemon-side plugin settings. Reads work
  anonymously on public repos; labels and comments need an accepted token on
  both public and private repos.
- **Label set.** Optional. Pick **Install label set…** and then **Keep
  existing** (add missing labels only) or **Replace our scopes** (also remove
  labels that share a scope with ours but are not part of the set). Labels in
  other scopes and unscoped labels are never touched. Requires a saved token.

## Development

```sh
npm install --workspace=plugins/forges
npm run typecheck --workspace=plugins/forges
npm test --workspace=plugins/forges
```

The helper audit also applies:

```sh
node packages/paseo-plugin-helper/bin/paseo-plugin-helper.js audit plugins/forges
```

See [`docs/specs/forgejo-workflow-gui.md`](./docs/specs/forgejo-workflow-gui.md)
for the data model, RPC contracts, and UI surfaces.
