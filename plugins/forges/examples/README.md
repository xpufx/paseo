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
- `skills/coding-agent/SKILL.md` — workflow, issue conventions, and reporting
  standards for a coding agent that picks up and delivers issues from the
  board. Uses the team's `fgjx` Forgejo CLI wrapper and an envelope self-stamp
  (`envelope-tool`) so comment attribution survives across many agents sharing
  one account.
- `skills/orchestrator/SKILL.md` — dispatch, pre-flight, and
  human-in-the-loop signoff rules for the agent coordinating the others.

Every file carries an `EXAMPLE` warning at the top. To use the Skills, copy a
`SKILL.md` into your own skills directory (for Paseo: `.agents/skills/<name>/`)
and rewrite the placeholders (`forge.example.com`, `your-org/your-repo`,
`fgj`/`fgjx`, `envelope-tool`) to match your tooling. If you do not have
equivalent tooling, replace the CLI steps with direct Forgejo API calls.

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

## Working without our tooling

The skills assume `fgj`/`fgjx` and `envelope-tool` exist. They are not part of
the plugin. If you use the plugin's own surfaces instead, the equivalent
operations are: the issues pill/modal for listing and detail, the Labels tab
for scoped label changes, and the quick-comment composer for steering. Map the
skill's CLI steps onto those.
