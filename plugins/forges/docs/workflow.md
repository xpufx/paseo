# The agent workflow around `forges`

This document describes the end-to-end loop that turns board activity in a
Forgejo/Gitea-family repo into work on an agent fleet, and back into comments,
commits, and label state on that board. It is written for an **adopter**: it
names the parts the `forges` plugin itself ships, the parts you must supply,
and the exact seams between them.

Everything here is generic. Hosts, repos, paths, unit names, tokens, and agent
identities are placeholders (`forge.example.com`, `your-org/your-repo`,
`/opt/forge-hook`, ...). Replace them with your own. The running copy of one
team's board is the worked example, not a supported configuration.

> New here? Start with [`../README.md`](../README.md) for install and settings,
> then [`../examples/README.md`](../examples/README.md) for the copy-and-adapt
> Skills. This file is the connective tissue between them.

## 1. The loop at a glance

```
  forge.example.com                         Paseo daemon
  ┌───────────────┐   webhook    ┌──────────────────┐   message   ┌──────────────┐
  │ issues, PRs,  │ ───────────▶ │  hook service    │ ──────────▶ │ orchestrator │
  │ comments,     │              │  (systemd or     │   `paseo    │    agent     │
  │ label writes  │              │  workspace svc)  │     send`   └──────┬───────┘
  └───────▲───────┘              └──────────────────┘                     │ dispatch
          │                                                               ▼
          │        plugin RPCs (forge.set-label / forge.add-comment)  ┌──────────┐
          └────────────────────────────────────────────────────────── │  coding  │
                        labels, comments, commits, envelope reports   │  agents  │
                                                                      └──────────┘
```

Four moving parts:

1. **The forge** emits events (issue opened/labeled, comment posted, push, PR)
   as webhooks. It also stores all durable state: issues, comments, labels,
   commits.
2. **The hook service** receives those events, authenticates them, and forwards
   a human-readable summary to the Paseo daemon's agent transport.
3. **The Paseo daemon + agents** do the work. The `forges` plugin gives the
   agent and the operator in-client views of the board and RPCs to write back
   (`forge.set-label`, `forge.add-comment`).
4. **The board** is the source of truth for what is done, claimed, blocked, or
   waiting on a human — expressed through scoped labels and envelope-stamped
   comments.

The plugin covers step 3's *reading and writing* of the board. Steps 1, 2, and
4 are adopter-supplied, with example material in [`../examples/`](../examples/).

## 2. The hook service

The plugin never talks to the forge's webhook side. It only fetches and writes
issues through the Gitea-family `/api/v1`. Something must bridge the forge's
*events* into the daemon, because a new comment or label change is what wakes
an idle fleet.

A minimal bridge is one HTTP listener with two endpoints. The shipped example
skeleton is [`../examples/hook-service/hook-server.mjs`](../examples/hook-service/hook-server.mjs);
its contract is:

### `POST /hook` — event delivery

- Authenticated with a **shared secret** supplied by the forge webhook config.
  Accept any of: `Authorization: Bearer <secret>`, `x-webhook-secret: <secret>`,
  or `X-Forgejo-Signature: <hmac-sha256-hex>` over the raw body. The secret is
  server-side only and is never handed to agents.
- The body is the forge's webhook JSON. The service derives the routing key
  from the payload's repository (`host/owner/repo`) — never from the working
  directory, so one process can serve many repos.
- It renders a short human line and hands it to the daemon, e.g.:

  ```
  🔔 Forgejo webhook incoming [issues:labeled] your-org/your-repo#42 Fix the thing (by alice) https://forge.example.com/your-org/your-repo/issues/42
  ```

  The `forges` plugin parses exactly this summary line (and an optional
  `[forgejo-hook] {json}` envelope prefix) into a timeline card — see
  `plugins/forges/shared/webhook.ts`. Keep the shape if you want the card.

### `POST /orchestrate` — who owns this repo

A repo has at most one orchestrator at a time. The service keeps a small
per-repo state file recording the current orchestrator's agent id; the body is
`{ "agentId": "...", "repo": "host/owner/repo" }` (repo optional — derived from
the agent's checkout `origin` when omitted). Loopback callers need no secret so
a local agent can claim the role with a plain `curl`; off-box callers must
present the secret.

Agent **name/role labels are a projection for the UI** — the state file is the
authority. Treat the projection as observability, not as a lock.

### Delivery and coalescing

- Messages queue **per repo** and are delivered one at a time, because a daemon
  rejects a second send while an agent already has an active run.
- A short debounce coalesces a burst on the same `(repo, issue)` into one
  digest. **Bypass the debounce** for slash-commands in comments and for
  urgent labels (`priority/0-SOS`, `flag/stop-work`) so those never lag.
- With no orchestrator registered for a repo, the queue holds rather than
  drops. Your service should log that state loudly; it is the most common
  "nothing happened" cause.

### Option A — systemd unit (host-wide, many repos)

Use this when the service runs once for the whole machine. The example unit is
[`../examples/hook-service/forge-hook.service`](../examples/hook-service/forge-hook.service)
with an environment file at
[`../examples/hook-service/hook.env.example`](../examples/hook-service/hook.env.example).
Install, edit the placeholders, then:

```sh
sudo cp forge-hook.service /etc/systemd/system/
sudo cp hook.env.example /etc/forge-hook/hook.env   # then edit
sudo systemctl daemon-reload
sudo systemctl enable --now forge-hook.service
journalctl -u forge-hook.service -f
```

Point your forge repo's webhook at `http://127.0.0.1:8099/hook` with the
matching secret and the events you care about (`issues`, `issue_comment`,
`push`, `pull_request`, and a `ping` for setup). Keep the listener on loopback
unless you terminate TLS and authenticate in front of it.

### Option B — workspace-scoped Paseo service (one checkout, one repo)

If you use Paseo workspaces, you can run the same script as a managed workspace
service instead of a system unit. Paseo's workspace config supports service
scripts, so a repo can declare:

```jsonc
// paseo.json (workspace-scoped; paths are relative to the checkout)
{
  "scripts": {
    "hook": { "type": "service", "command": "node scripts/hook-server.mjs" }
  }
}
```

Paseo starts/stops it with the workspace and gives you its logs in-client. The
trade-off: it only runs while that workspace is up, and it is scoped to that
checkout. The host-wide systemd unit keeps running regardless of the client.
Pick one; running both against the same port and secret double-delivers.

## 3. Label usage

The board is driven by **scoped labels**: a name containing `/` where the last
`/` separates a *scope* from a *value* (`state/1-wip`, `priority/2-normal`).
Labels created with `exclusive: true` are **mutually exclusive per scope**:
applying one evicts any existing label with the same scope, at the forge DB
level. No explicit remove is required for the happy path.

### The scopes

| Scope        | Values                                                | Meaning                                   |
| ------------ | ----------------------------------------------------- | ----------------------------------------- |
| `state/`     | `0-triage` `1-wip` `2-review` `3-verify` `4-done`     | Execution lifecycle                       |
| `priority/`  | `0-SOS` `1-high` `2-normal` `3-low` `4-backburner`    | Queue ordering / urgency                  |
| `attention/` | `0-orchestrator` `1-agent` `2-user` `3-ignore`        | Who acts next (action token)              |
| `spec/`      | `0-needed` `1-checklist` `2-approved`                 | Pre-code shaping and approval             |

A generic, apply-able seed for all four scopes lives in
[`../examples/labels/label-base.yaml`](../examples/labels/label-base.yaml).
Apply it as a Forgejo label template, or create the labels in the UI/API; the
plugin does not install labels for you.

### How the plugin uses them

- **Live vocabulary, not a hardcoded list.** The plugin derives the scopes
  present on the board (`liveScopesFromIssues` in
  `plugins/forges/shared/issues.ts`) and only falls back to the canonical names
  above. A foreign board degrades gracefully; an unknown scope shows up rather
  than erroring.
- **Chips are the vocabulary made visible.** Every label renders through
  `LabelChip` as two segments — scope + value — colored from the forge label
  color. The chips and the sort tuple
  (`priorityRank`, then `stateRank`, then recency) are only meaningful if the
  labels are.
- **Writes add, and also remove a same-scope mate.** The plugin sends the new
  label plus an explicit removal of any existing label in the same scope, so
  the result is correct even on boards whose scope names differ from the
  canonical set (where DB-level exclusivity alone would not evict).

### The cold-start gap (read this)

**The operator may apply no labels at all.** A ticket can arrive with an empty
label set, and that is neither an error nor a signal that the ticket is out of
scope. The plugin then shows the issue with no scope chips, and the board sort
falls back to defaults (`priority/2-normal`, unranked state).

Downstream automation must not assume a populated taxonomy:

- Missing labels are **advisory**, not a gate. Never skip a ticket solely
  because it lacks `state/` or `spec/`.
- The first agent to touch a ticket should **read it, infer the state, and set
  the labels itself** — that is how the taxonomy gets bootstrapped.
- Deterministic board queries (rank/filter) treat unlabeled issues as normal
  priority with no state rank; surface them, don't hide them.

## 4. Agent responsibilities

The workflow assumes two roles. One agent can hold both, but keeping them
separate is what stops a fleet from colliding.

### Orchestrator

- **Triage.** Watch the `attention/` signal and incoming comments. Turn vague
  operator input ("build's failing, fix it") into a concrete ticket with a
  `- [ ]` checklist and boundary constraints.
- **Dispatch.** One ticket, one worker, isolated by package directory. Never
  let two workers edit the same checkout at once; queue instead of colliding.
  Instruct the worker to claim with a stamped comment and `state/1-wip`.
- **Pre-flight.** Before presenting anything to the operator: work committed and
  pushed, tests/typechecks green, and the running daemon actually executing the
  new commit (helper build fresh, plugin version stamp matching HEAD). Never
  present unverified work.
- **Verify (non-binding).** `state/3-verify` is "needs a human look", not "block
  forever". If the operator doesn't test, resolve with narration (requeue,
  close as superseded, or verify by proxy) instead of deadlocking.

### Coding agent

- **Discover and claim.** Read the *entire* ticket and *entire* comment thread
  first — scope is often amended in comments. Verify no peer already claimed it,
  then post a claim comment and set `state/1-wip`.
- **Page every list read.** Issue lists, search results, label lists, and
  comment lists are collections: each call returns one page, and the default
  page size is **server-defined and can change**. Pass `limit`/`page` — or follow
  `Link`/`X-Total-Count` — until a short page comes back before concluding "no
  results" or claiming you have read the whole thread. One unpaged call is never
  the full set; a plugin surface that lists results should page internally
  rather than render a truncated set (#189). See the worked example in the
  [examples README](../examples/README.md#paged-reads-issue--search--label--comment-lists)
  (unpaged `fgj label list` returned 30 of 59 labels, #197).
- **Implement.** Work quietly in your own checkout. Stage explicit paths only;
  never `git add -A` in a shared tree.
- **Hand off.** Run tests/typecheck, commit, push to the forge, then post a
  structured report (what changed, commit SHA, test result) and advance state —
  `state/2-review` for an internal review, or `state/3-verify` for operator
  testing.
- **Stamp comments.** Because many agents may share one forge account, every
  comment should carry a self-identification footer (an "agent envelope") so
  attribution survives. That tooling is external to the plugin — see §6.

Missing labels in no way block either role; see the cold-start gap above.

## 5. Skills

`plugins/forges/examples/skills/` ships the workflow above as **two skill
sets**, adapted for publication. Each set has a coding-agent and an orchestrator
counterpart, and they differ only in how they touch the board:

| Zero-dependency (plugin + embedded `/api/v1`) | CLI (`fgjx` over `fgj`)                  |
| --------------------------------------------- | ---------------------------------------- |
| [`examples/skills/coding-agent/SKILL.md`](../examples/skills/coding-agent/SKILL.md) | [`examples/skills/coding-agent-fgjx/SKILL.md`](../examples/skills/coding-agent-fgjx/SKILL.md) |
| [`examples/skills/orchestrator/SKILL.md`](../examples/skills/orchestrator/SKILL.md) | [`examples/skills/orchestrator-fgjx/SKILL.md`](../examples/skills/orchestrator-fgjx/SKILL.md) |

- The **zero-dependency** set drives the board through the plugin's own
  surfaces and its embedded Gitea-family `/api/v1` client. Nothing needs to be
  installed; no forge CLI is present.
- The **CLI** set uses the vendored example wrapper
  [`examples/tools/fgjx`](../examples/tools/fgjx), which is a thin passthrough
  shim over **your** `fgj`: `fgj` owns the host URL + token and performs the raw
  `/api/v1` calls, while `fgjx` adds label resolution, table/view niceties, and
  optional envelope stamping. See
  [`examples/tools/README.md`](../examples/tools/README.md). The envelope tool
  is optional — without one, `fgjx` emits a generic machine-authored footer.

They are **examples, not drop-ins**. Both carry a warning banner and use
placeholders (`forge.example.com`, `your-org/your-repo`). Before adopting one:

1. Copy it into your skills directory (for Paseo: `.agents/skills/<name>/`).
2. Rewrite the host, repo, and command/tool names to match your setup. If you
   choose the CLI set, supply `fgj` and (optionally) an envelope tool; if you
   can't, use the zero-dependency set and the plugin surfaces / direct forge API
   calls.
3. Align the label and slash-command vocabulary with your seed YAML. If you
   only seed the four scopes in §3, drop or define any extra labels a Skill
   mentions (the Orchestrator examples refer to a `flag/stop-work` circuit
   breaker).
4. Cross-link the adapted Skills back to your board conventions so the next
   agent inherits them.

## 6. Includes vs does-not-include

What the `forges` plugin provides versus what you must supply:

| Provided by the plugin                                        | Supplied by the adopter                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| Issue list/detail, comments, scoped label chips               | Hook service (systemd unit **or** workspace-scoped service)|
| Embedded `/api/v1` fetch client; daemon-side per-host tokens  | Label base (seed YAML applied to the repo)                 |
| Live label vocabulary derived from the board                  | Skills (adapt the examples to your tooling)                |
| Two example skill sets (plugin/`/api/v1` and `fgjx`) + README | `fgj`, only if you adopt the CLI skill set                 |
| Bundled, sanitized `examples/tools/fgjx` wrapper              | Envelope tool for comment stamps (optional, CLI set only)  |
| `forge.set-label` / `forge.add-comment` write RPCs            | The forge itself (Forgejo/Gitea-family host + repo)        |
| Webhook timeline card parser (`shared/webhook.ts`)            | Webhook secret/config on the forge repo                    |

Explicit non-goals (do not expect the plugin to do these):

- **No webhook receiver.** The plugin is not an HTTP endpoint and does not
  register webhooks for you.
- **No label install.** The optional label-set install is operator-gated and
  excluded from the release surface; seed labels yourself.
- **No envelope tooling shipped.** Comment attribution/self-stamping is
  external. The bundled `examples/tools/fgjx` can call an adopter-supplied
  envelope tool for `--envelope`, but the plugin ships none and the core
  workflow never needs one.
- **No orchestration.** Dispatch, pre-flight, and verify are agent behaviour
  encoded in the example Skills, not plugin features.
- **No CLI dependency in the plugin runtime.** The plugin works on a machine
  that has never had a forge CLI installed. The `fgjx` wrapper is a bundled
  *example* under `examples/tools/` for adopters who already run `fgj`; it is
  never loaded by the plugin.

### 6.1 Minimum token scopes (write-enabled forges)

A token the host accepts is not automatically write-capable. Edit surfaces
(labels, comments, label-set install) require the repo to report write
permission; the plugin reads that from the repo response
(`permissions.push`/`admin` on Forgejo/GitHub, `access_level >= 30` on GitLab)
and otherwise falls back to token validity. A valid but under-scoped token is
reported as **"token lacks write scope"**, not rejected.

Forgejo/Gitea PAT: `read:user` (identity probe), `read:repository` (repo
metadata), and `write:issue` (issues, comments, labels). Add
`write:repository` if label management still 403s. GitHub needs `read:user`
plus `repo`; GitLab needs `read_user`, `read_api`, and `api`.

## 7. Adopter checklist

- [ ] Create the board labels from `examples/labels/label-base.yaml`.
- [ ] Stand up the hook service (systemd unit or workspace service) and point a
      forge webhook at it with a shared secret.
- [ ] Confirm deliveries arrive (send a `ping` event) and an orchestrator is
      registered for the repo.
- [ ] Copy and adapt `examples/skills/` into your skills directory.
- [ ] Add an envelope/attribution step if multiple agents share one account.
- [ ] Install the plugin, set the per-host token in Settings, and verify the
      issue pill renders your board.
