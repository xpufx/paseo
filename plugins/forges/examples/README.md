# Examples — adapt, do not drop in

This directory ships the maintainers' own agent workflow as **examples** so a
team adopting the `forges` plugin has a working starting point. They are not a
supported configuration and they are not drop-in: every host, repo, CLI tool,
label, and convention below reflects one team's setup.

**You must adjust them to fit your own workflow.** The end-to-end picture — how
webhooks reach the daemon, how labels drive the board, and what each agent role
owns — is in [`../docs/workflow.md`](../docs/workflow.md).

## What is here

- `hook-service/` — a sanitized systemd unit, a generic webhook bridge script
  (`hook-server.mjs`), and an environment-file example. One listener with
  `POST /hook` and `POST /orchestrate`; placeholders only. See its `README.md`.
- `labels/label-base.yaml` — a generic, apply-able seed for the scoped labels
  the workflow uses (`state/`, `priority/`, `attention/`, `spec/`, plus an
  optional `flag/stop-work`). Apply it as a Forgejo label template or create
  the labels via the API/UI.
- `tools/fgjx` — a sanitized, vendored copy of one team's `fgjx` wrapper. It is
  a passthrough shim over the `fgj` CLI (label resolution, table/view niceties,
  optional envelope stamping) and **requires the adopter's own `fgj`**, pointed
  at their forge; it fails loudly without it. `tools/README.md` explains the
  fgj-vs-fgjx split and the optional envelope tool.
- `skills/coding-agent/SKILL.md` — the **zero-dependency** variant: workflow,
  issue conventions, and reporting standards, driving the board through the
  plugin's own surfaces and embedded Gitea-family `/api/v1` client. No forge CLI.
- `skills/coding-agent-fgjx/SKILL.md` — the **CLI** variant of the same
  workflow, using the vendored `fgjx` (hence an adopter-supplied `fgj`) and an
  optional envelope self-stamp so comment attribution survives across many
  agents sharing one account.
- `skills/orchestrator/SKILL.md` and `skills/orchestrator-fgjx/SKILL.md` —
  dispatch, pre-flight, and human-in-the-loop signoff rules for the agent
  coordinating the others, split the same way (plugin + `/api/v1` vs `fgjx`).

Every file carries an `EXAMPLE` warning at the top. To use the Skills, copy a
`SKILL.md` into your own skills directory (for Paseo: `.agents/skills/<name>/`)
and rewrite the placeholders (`forge.example.com`, `your-org/your-repo`,
`fgj`/`fgjx`, `envelope-tool`) to match your tooling. If you have no forge CLI,
start from the `coding-agent`/`orchestrator` variants — they need none.

## The label taxonomy the skills assume

The scoped label set below is what the skills and the plugin's label chips use,
and what `labels/label-base.yaml` seeds. The plugin no longer ships a label-set
install in the UI, so create these labels on your repo yourself (with the seed
file, by hand, or via the Forgejo API):

| Scope       | Labels                                                        |
| ----------- | ------------------------------------------------------------- |
| `state/`    | `0-triage`, `1-wip`, `2-review`, `3-verify`, `4-done`         |
| `priority/` | `0-SOS`, `1-high`, `2-normal`, `3-low`, `4-backburner`        |
| `attention/`| `0-orchestrator`, `1-agent`, `2-user`, `3-ignore`             |
| `spec/`     | `0-needed`, `1-checklist`, `2-approved`                       |

Gitea-family scoped labels are exclusive per scope, so applying one evicts the
previous mate in the same scope. The plugin's label chips rely on this
vocabulary to advance `state/`, `priority/`, `attention/`, and `spec/`.

The operator may apply **no labels at all**; that is the normal starting state,
not an error. Automation must treat missing labels as advisory and bootstrap the
taxonomy on first touch (see `docs/workflow.md` §3).

## Two skill sets, and what they need

The plugin itself assumes no CLI. The Skills come in two variants so you can
pick the one that fits your host:

- **Plugin + embedded `/api/v1`** — `skills/coding-agent` and
  `skills/orchestrator`. Zero external dependencies: list and read issues
  through the issues pill/modal, change scoped labels through the Labels tab /
  label chips, post through the quick-comment composer, all backed by the
  daemon-side `/api/v1` client. Scripting can call the forge API directly with
  your own token.
- **`fgjx` CLI** — `skills/coding-agent-fgjx` and `skills/orchestrator-fgjx`.
  The richer path, using the bundled `tools/fgjx`. That wrapper needs **your**
  `fgj` (the authenticated transport: it owns the host URL + token and does the
  raw `/api/v1` calls) and, **optionally**, an envelope tool for comment
  stamps. Neither ships with the plugin.

Both variants expose the same board: the plugin's equivalents for a CLI step
are the issues pill/modal (list/detail), the Labels tab (scoped label changes),
and the quick-comment composer (steering). Map the CLI steps onto those (or the
plugin's `forge.board-overview` / `forge.issue-detail` / `forge.set-label` /
`forge.add-comment` RPCs) when you have no CLI. See
[`../docs/workflow.md`](../docs/workflow.md) §6 for the full includes-vs-excludes
table.
