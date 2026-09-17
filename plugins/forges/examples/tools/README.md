# `fgjx` (vendored example)

`fgjx` is the Forgejo CLI wrapper the example Skills use for their "rich CLI"
variant. It is a **sanitized copy of the `fgjx` wrapper** — the
platform stays the source of truth, and this copy is synced by hand. Edit
upstream first, then re-copy.

It is an example, not a supported tool. Adapt it or ignore it: the plugin itself
needs neither `fgjx` nor `fgj` (see [`../skills/coding-agent/SKILL.md`](../skills/coding-agent/SKILL.md)
for the zero-dependency, embedded-`/api/v1` path).

## Why `fgjx` needs `fgj` (the split)

`fgj` is the **authenticated transport and config provider**. It owns the host
URL and the token (its `config.yaml`, or `--hostname` / `--config` on the
command line) and performs the raw Gitea-family `/api/v1` HTTP calls. Anything
`fgj` can do — including `fgj api ...` — works directly.

`fgjx` is a thin **passthrough shim** on top of `fgj`. It adds only
board-shaped conveniences that the raw CLI lacks:

- a `LABELS` column and sorting filters for `issue list`, a labels header +
  formatted comment history for `issue view`;
- **label resolution** — `issue edit --add-label/--remove-label` looks label
  *names* up to ids and writes them via the API;
- **envelope stamping** — `--envelope` appends an agent attribution footer;
- `--format` body wrapping for comments.

None of that can work without `fgj`, because every call it makes is ultimately
`fgj api ...` against a host and token only `fgj` knows. That is the whole
reason this is a wrapper and not a standalone tool: **the adopter supplies
`fgj`, pointed at their own forge, and `fgjx` decorates it.** `fgjx` fails
loudly (exit 127) if `fgj` is not on `PATH`.

Point it at your forge with `fgj`'s own `config.yaml`, or per-invocation:

```sh
fgjx --hostname forge.example.com -R your-org/your-repo issue list
fgjx issue view 42 --hostname forge.example.com -R your-org/your-repo
fgjx issue edit 42 --hostname forge.example.com -R your-org/your-repo \
  --add-label state/1-wip
```

## Requirements

- `fgj` on `PATH` (or in `$HOME/bin/.lib`, which the wrapper prepends). Required.
- `bash` and `python3` (the wrapper shells python for JSON rendering/label id
  resolution). Required.
- An **envelope tool** — optional, only for `--envelope`. Resolution order:
  `$ENVELOPE_TOOL`, then `envelope-tool` on `PATH`, then `$HOME/bin/envelope-tool`,
  else a generic `<sub>🤖 agent · <timestamp></sub>` fallback. The plugin does
  not ship one; the core wrapper never needs it.

## Sanitized for publication

Relative to the platform source, this copy:

- drops every absolute `/home/...` fallback (only `command -v` and
  `$HOME`-relative paths remain) and names the optional envelope tool
  generically;
- **fails loudly when `fgj` is missing** instead of half-running;
- carries the label-resolver fix from upstream #197: the label fetch **pages**
  (`?limit=50&page=N`), comma-joined `--add-label`/`--remove-label` values are
  **split**, and an **unknown label name fails non-zero** rather than being
  silently skipped (and nothing is written unless every name resolves).

Anything host-specific that remains is a placeholder — replace it with your own
forge, repo, and tooling.
