# Uppidi Fleet

**An opinionated, full-lifecycle autonomous engineering fleet for Paseo, driven by a Forgejo/Gitea-family board.**

`uppidi-fleet` turns a Forgejo issue tracker into the control plane for a small
fleet of AI agents. A human operator files and steers tickets on the board; a
**Front Desk** agent talks to the operator; one **orchestrator** per repository
triages, decomposes, and dispatches; ephemeral **coding workers** implement;
and a **Cockpit** surface inside Paseo shows the whole thing — queues, agents,
boards, and router health — in one place.

> [!IMPORTANT]
> **Uppidi Fleet is a work in progress.** It requires manual install of some
> components and occasional intervention by humans. All features may not work
> 100% reliably.

This README is written for a **third party** who has never used the system and
wants to stand one up for their own forge, repositories, models, and team
rules. It explains the architecture, how the skills work and how to rewrite
them, how the bundled webhook router receives Forgejo events, how to set up the
webhooks and action workflows, how to seed the board labels, and — importantly —
which pieces you must supply because the plugin does not ship them ([§10](#10-gap-analysis--what-the-plugin-does-not-ship)).

> **Placeholders everywhere.** Hosts, repos, paths, agent identities, and model
> names below are examples (`forge.example.com`, `your-org/your-repo`). Replace
> them with your own. Everything here is generic; nothing is a supported
> configuration.

---

## Table of contents

1. [The concept in one picture](#1-the-concept-in-one-picture)
2. [Prerequisites](#2-prerequisites)
3. [Install the plugin](#3-install-the-plugin)
4. [The Cockpit surface](#4-the-cockpit-surface)
5. [Board labels: taxonomy and install](#5-board-labels-taxonomy-and-install)
6. [Skills: how the fleet thinks](#6-skills-how-the-fleet-thinks)
7. [The webhook router (backend daemon)](#7-the-webhook-router-backend-daemon)
8. [Configuring webhooks on the Forgejo side](#8-configuring-webhooks-on-the-forgejo-side)
9. [Forgejo Actions & automated board hygiene](#9-forgejo-actions--automated-board-hygiene)
10. [Gap analysis — what the plugin does not ship](#10-gap-analysis--what-the-plugin-does-not-ship)
11. [End-to-end walkthrough](#11-end-to-end-walkthrough)
12. [Runtime state & file map](#12-runtime-state--file-map)
13. [Development](#13-development)
14. [License](#14-license)

---

## 1. The concept in one picture

```
  Forgejo board (source of truth)
  ┌───────────────────────────────────────────────────────────────┐
  │ issues · PRs · comments · scoped labels                       │
  │   state/  priority/  attention/  spec/  target/  verify/      │
  └───────────────────────────────┬───────────────────────────────┘
                                  │ webhooks (POST /forgejo)
                                  ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ bundled hook router  (server/hook-router.ts)                  │
  │   classify: routine repo events → that repo's Orchestrator    │
  │             frontdesk events    → Front Desk                  │
  └───────────────┬───────────────────────────────┬───────────────┘
                  │ per-repo queue                │ frontdesk queue
        routine repo events            frontdesk-directed events
        (attention/*, comments,        (attention/frontdesk,
         labels, PRs, pushes)           attention/2-user, /frontdesk)
                  │                               │
                  ▼                               ▼
  ┌───────────────────────────────┐   ┌───────────────────────────┐
  │ Orchestrator (one per repo)   │   │ Front Desk (operator      │
  │ triage · shape · dispatch ·   │   │ liaison + triage intake)  │
  │ review · merge                │   └─────────────▲─────────────┘
  └───────────────┬───────────────┘                 │ operator chat
                  │ dispatch                        │
                  ▼                             operator
  ┌───────────────────────────────┐
  │ coding workers (ephemeral)    │
  │ one isolated worktree each    │
  └───────────────────────────────┘

  Cockpit UI (Paseo sidebar + workspace panel): agent tree, board, queues, router
  health, role models, and Front Desk / orchestrator spawn controls.
```

Four moving parts:

1. **The forge** stores all durable state (issues, comments, labels, commits)
   and emits webhook events when that state changes.
2. **The bundled hook router** receives those events, classifies them, queues
   them per repository, and delivers them over Paseo's transport: routine
   repository events go **directly to that repository's orchestrator**, while
   frontdesk-directed events (`attention/frontdesk`, `attention/2-user`, a
   `/frontdesk` comment) go to the **Front Desk**. This is the piece that wakes
   an idle fleet.
3. **The agents** do the work. Three roles: **Front Desk** (the operator-facing
   liaison and triage intake — it only receives frontdesk-directed events),
   **orchestrator** (one per repo; triage + dispatch + review), and **coding
   workers** (ephemeral, one worktree each). Their behaviour is encoded in
   *Skills*, not in the plugin.
4. **The Cockpit** is the Paseo surface that renders the board, the agent tree,
   the router queues, and controls for spawning Front Desk/orchestrators,
   muting repos, and editing role models.

### The roles

| Role | How many | Owns | Never does |
| --- | --- | --- | --- |
| **Front Desk** | 0–1 per fleet | Operator-facing liaison and triage intake; takes frontdesk-directed events; routes escalations; registers with the router | Implement code; receive routine per-repo webhooks |
| **Orchestrator** | one per enrolled repo | Triage, shaping, dispatch, PR pre-flight/merge, board hygiene | Edit source files or check out feature branches itself |
| **Coding worker** | one per ticket (ephemeral) | Implements in an isolated git worktree, opens a PR | Touch a checkout the operator is using; scan/self-claim |

### The board lifecycle

A ticket's life is expressed entirely through scoped labels (see
[§5](#5-board-labels-taxonomy-and-install)):

```
 state/0-triage → state/1-wip → state/2-review → state/3-verify → state/4-done
 attention/0-orchestrator ↔ attention/1-agent ↔ attention/2-user ↔ attention/3-ignore
```

`attention/*` is the operator's steering channel; `state/*` is the execution
lifecycle; `priority/*` orders the queue; `spec/*` is pre-code shaping.
Applying a label inside a scope evicts the previous one **if the label was
created with `exclusive: true`** — that is the whole mechanism, and it is why
the label seed in [§5](#5-board-labels-taxonomy-and-install) matters.

> [!IMPORTANT]
> **Operator Attention Policy**: Only `attention/2-user` (or `attention/user`) signals
> that human operator intervention is required. `state/3-verify` or `state/2-review`
> represent execution milestones and **never** imply operator attention or suppress
> orchestrator sweeps unless explicitly paired with `attention/2-user`.

---

## 2. Prerequisites

| Requirement | Notes |
| --- | --- |
| **Paseo** ≥ 0.8.0 | The plugin manifest requires it (`paseo-plugin.json`). |
| **A Forgejo or Gitea-family host** | Any `forgejo`/`gitea` instance; the API used is `/api/v1`. |
| **Repository access token** | A PAT with issue write scope (see below). |
| **An agent provider + model** | Any provider Paseo supports, per role. |
| **A host runner** | **Required** for label triage and repository sweeps (the Forgejo Actions workflows in [§9](#9-forgejo-actions--automated-board-hygiene)). A Forgejo Actions runner with the host backend is preferred. |
| **A git host remote named for your forge** | The CLI wrappers resolve board context from `origin`. |

Minimum Forgejo/Gitea PAT scopes for the write surfaces:
`read:user`, `read:repository`, and `write:issue` (add `write:repository` if
label management still returns 403). A token that is accepted but under-scoped
is reported as *"token lacks write scope"* rather than silently failing.

---

## 3. Install the plugin

From a local checkout (the reliable path in this monorepo):

```sh
paseo plugin add xpufx/paseo --path plugins/uppidi-fleet
```

After install, the plugin appears as a sidebar item and a workspace panel named
**Uppidi Fleet**, plus a settings screen. The server entry
([`index.server.ts`](./index.server.ts)) registers all RPC handlers and starts
the bundled webhook router automatically via `startHookRouter(server)`.

---

## 4. The Cockpit surface

The plugin registers one primary surface with three tabs:

| Tab | What it shows |
| --- | --- |
| **Agents & Fleet** (tree) | Hierarchical view: projects → orchestrators → workers, with deterministic state badges (working / running / permission-prompt / attention-required / sleeping / idle / quota / failed), worktree names, parentage, and per-repo enrolment/mute flags. Hosts the `+ Create Front Desk`, `+ Add Orchestrator`, `Replace`, archive, and repo-mute controls. |
| **Work Queue** (dashboard) | Open issues from the board with status, owner, and labels; a **Fleet Needs Attention** board at the top surfaces blocked agents, filter presets (Needs Attention, Triage/Review, In Progress, Verify). Also the collapsible Hook Service, Hook Queues, log tail, Agent Role Models, CI Runner fleet, and fleet-metrics sections. |
| **Settings** | Hook service management (start/stop/restart, listen host + port), links into role-model editing. |

Key behaviours:

- **Blocked agents are surfaced prominently (#534)**: an agent sitting at a
  pending permission prompt (`pendingPermissions.length > 0`) renders a pulsing
  `AttentionBeacon` warning (`⚠️ Permission Needed: <tool/action>`) with a
  copyable Front Desk adjudication command (`paseo permit allow <agent> <req>`);
  an agent flagged   `requiresAttention` (e.g. an interactive ask question)
  renders an `Awaiting Input` badge carrying the daemon reason. The Cockpit
  header shows a fleet-wide `⚠️ N Need Attention` badge and the **Fleet Needs
  Attention** board lists every blocked agent with one-click access. The
  canonical subagent lifecycle state (`waiting_for_input`, …) and its structured
  `blockDetail` (required permission id + scope) ride the same payload — see
  [§13.6](#136-subagent-lifecycle-contract-reactive-wakeups--capability-grants).
- **Router health** is shown in the header (`Router Active` / `Router Starting` / `Router Disconnected`).
- **Dispatch is handled via the orchestrator protocol**, not from the UI: the
  orchestrator Skill creates and drives each worker's isolated worktree.
- The issue list is fetched by `uppidi-fleet.issues` from the forge API — see
  the host/repo caveat in [§10](#10-gap-analysis--what-the-plugin-does-not-ship).

---

## 5. Board labels: taxonomy and install

The plugin and the Skills both assume a **scoped label vocabulary**: a label
whose name contains `/`, where the last `/` separates `scope` from `value`
(`state/1-wip`). Labels created with `exclusive: true` are single-occupancy per
scope — applying one evicts the other at the forge DB level.

### 5.1 Scopes the workflow uses

| Scope | Values | Meaning |
| --- | --- | --- |
| `state/` | `0-triage`, `1-wip`, `2-review`, `3-verify`, `4-done` | Execution lifecycle (non-binding; does not signal human attention) |
| `attention/` | `0-orchestrator`, `1-agent`, `2-user`, `3-ignore` (+ optional `frontdesk`) | Who acts next (`attention/2-user` is the sole human operator signal) |
| `priority/` | `0-SOS`, `1-high`, `2-normal`, `3-low`, `4-backburner` | Queue ordering |
| `spec/` | `0-needed`, `1-checklist`, `2-approved` | Pre-code shaping |
| `target/` | one per managed component, e.g. `target/daemon`, `target/uppidi-fleet` | Which subsystem a ticket concerns |
| `verify/` | `automated-ok`, `needs-device` | Verification classification |
| `flag/` | `stop-work` (circuit breaker) | Binding stop |

Additional scopes seen on a mature board (`kind/`, `dep/`, `linked/`, `size/`,
`review/`, `upstream/`, `format/`) are optional and team-specific.

### 5.2 The shipped seed

A generic, apply-able seed for the four core scopes plus `flag/stop-work`
already exists at
[`plugins/forges/examples/labels/label-base.yaml`](../forges/examples/labels/label-base.yaml).
It is a YAML label template in the format Forgejo/Gitea read.

**Important:** the plugin does **not** install labels for you. The former
in-UI label-set installer was removed as operator-gated (see
[§10](#10-gap-analysis--what-the-plugin-does-not-ship)). You seed them
yourself.

### 5.3 Install approaches

**A. As an instance label template (Forgejo ≥ 1.19).** Copy the YAML into the
instance's custom label directory so it is selectable when creating repos:

```sh
sudo cp plugins/forges/examples/labels/label-base.yaml \
        "$FORGEJO_CUSTOM/options/label/agent-workflow.yaml"
```

Label templates apply at **repository creation time** only.

**B. To an existing repo via the API.** This is the practical path. The
following loop reads a local `labels.yaml` (with `labels:` list, each item
`name` / `color` / `exclusive` / `description`) and creates each label:

```sh
FORGEJO_URL=https://forge.example.com
OWNER=your-org
REPO=your-repo
TOKEN=<your-personal-access-token>

jq -c '.labels[]' plugins/forges/examples/labels/label-base.yaml | while read -r label; do
  curl -sS -X POST \
    -H "Authorization: token ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --argjson l "$label" \
          '{name:$l.name,color:$l.color,description:$l.description,exclusive:$l.exclusive}')" \
    "${FORGEJO_URL}/api/v1/repos/${OWNER}/${REPO}/labels"
done
```

To seed `target/` and `verify/` (not in the shipped file), extend the YAML or
add them ad hoc, e.g. `verify/automated-ok`, `verify/needs-device`, and one
`target/<component>` per subsystem you manage. Keep `exclusive: true` on every
scoped label.

**C. By hand.** The UI's **Labels → New Label** accepts a `scope/value` name
and an **Exclusive** checkbox. Slowest, but needs no token.

### 5.4 Verify

```sh
curl -sS -H "Authorization: token ${TOKEN}" \
  "${FORGEJO_URL}/api/v1/repos/${OWNER}/${REPO}/labels?limit=50&page=1" | jq -r '.[].name'
```

**Page every label read.** The default page size is server-defined and can
change; an unpaged `fgj label list` has already returned 30 of 59 labels on the
maintainers' board, producing false "label not found" errors. Follow
`limit`/`page` (or `Link`/`X-Total-Count`) until a short page comes back.

---

## 6. Skills: how the fleet thinks

Skills are Markdown instruction sets living in a **skills directory** that
Paseo/opencode loads on demand. **The plugin does not contain the fleet's
Skills.** In this repository they live at the repository root under
`.agents/skills/`, *outside* the plugin package. Alongside them, the repository
ships **adapted example Skills** you can copy and rewrite for your own
environment, under [`plugins/forges/examples/skills/`](../forges/examples/skills/):

| Example file | Role | Style |
| --- | --- | --- |
| [`coding-agent/SKILL.md`](../forges/examples/skills/coding-agent/SKILL.md) | coding worker | zero-dependency (plugin surfaces + embedded `/api/v1`) |
| [`coding-agent-fgjx/SKILL.md`](../forges/examples/skills/coding-agent-fgjx/SKILL.md) | coding worker | CLI wrapper (`teax`/`fgjx`) |
| [`orchestrator/SKILL.md`](../forges/examples/skills/orchestrator/SKILL.md) | orchestrator | zero-dependency |
| [`orchestrator-fgjx/SKILL.md`](../forges/examples/skills/orchestrator-fgjx/SKILL.md) | orchestrator | CLI wrapper |

> [!NOTE]
> **CLI tooling ships `teax` (over `tea`).** The fleet's rich CLI variant drives
> the board through **`teax`**, an enhanced wrapper around the Gitea/Forgejo
> `tea` CLI. `tea` is the authenticated transport (it owns the host URL and
> token, and performs the raw `/api/v1` calls); `teax` adds board-shaped verbs
> (label-name resolution, formatted issue/PR views, optional agent-envelope
> stamping). If the underlying CLI is not found, `teax` prints a download link —
> `https://gitea.com/gitea/tea/releases` — so you can install it. The
> zero-dependency example needs no CLI at all.

There is **no shipped Front Desk example** — the live `front-desk` skill is one
team's, and you must author your own (see [§10](#10-gap-analysis--what-the-plugin-does-not-ship)).

### 6.1 The three roles

**Orchestrator** — delegates, never implements. Its contract, in short:

- Only two binding stops exist: `priority/0-SOS` and `flag/stop-work`.
  Everything else — missing labels, vague one-liners, `spec/*` — is advisory.
- On any signal (`attention/0-orchestrator`, a webhook summary, bare text, or no
  labels), infer scope, shape a checklist, set labels yourself, and dispatch
  **one worker in one isolated worktree**.
- Hard role boundary: it must not edit source files or check out feature
  branches in its own directory; that directory stays on `main` and clean.
- Pre-flight every PR before the operator sees it: diff inspected, tests and
  typechecks green, live daemon executing the new commit.
- `state/3-verify` is non-binding: never park in a mutual-wait deadlock.
- Keep the composer window quiet; all communication is on the board or through
  Front Desk.

**Front Desk** — the operator-facing liaison and triage intake:

- The operator talks only to Front Desk. Orchestrators reach it with
  `paseo send --steer --no-wait <frontDeskId> "..."`
  (`--steer` is mandatory so it never clobbers an active turn).
- It registers itself with the router via `POST /frontdesk`
  ([§7.4](#74-control-endpoints)).
- It receives only **frontdesk-directed events** — `attention/frontdesk`,
  `attention/2-user`, or a `/frontdesk` comment — not the routine per-repo
  webhooks, which go straight to each repository's orchestrator.
- It shields the operator from routine chatter and surfaces only decisions,
  approvals, credentials/2FA requests, and completed deliverables.

**Coding worker** — the hands:

- Reads the *entire* ticket and comment thread (scope is often amended in
  comments), pages every list read, claims with a stamped comment and
  `state/1-wip`, works quietly in its own worktree, stages explicit paths only
  (never `git add -A`), then commits, pushes, opens a PR referenced to the
  issue, and advances state.

### 6.2 How to modify them for your environment

1. **Copy** the closest example into your loaded skills directory:
   `.agents/skills/<name>/SKILL.md` for Paseo.
2. **Rewrite the placeholders** — host, `owner/repo`, provider/model names, CLI
   tool names, issue-link format, and the escalation target's agent id.
3. **Align the vocabulary.** Match every label and slash-command the Skill
   mentions to the set you actually seeded in [§5](#5-board-labels-taxonomy-and-install).
   If you seeded fewer scopes, delete the references to the missing ones.
4. **Choose a board-access style.** The zero-dependency examples need nothing
   installed and use the plugin's surfaces and a direct `/api/v1` client. The
   `-fgjx` examples assume the shipped `teax` (the board CLI wrapper) over
   *your* `tea` (the authenticated transport), plus an optional envelope tool;
   the plugin never loads either.
5. **Pick your models per role** and record them (Cockpit → Agent Role Models,
   or `~/.paseo/uppidi-fleet-role-models.json`). See
   [§12](#12-runtime-state--file-map).
6. **Write the Front Desk skill.** Give it: how to register with the router, how
   to ingest escalations (`attention/2-user`, `attention/frontdesk`,
   `/frontdesk`), and the operator's hand-off/hand-over protocol.
7. **Cross-link** the adapted Skills back to your board conventions so the next
   agent inherits them.

> [!WARNING]
> Two facts the examples rely on and you must decide about:
> **paged reads** (never treat one unpaged call as the whole board) and
> **comment attribution** — many agents may share one forge account, so the
> live setup self-stamps every comment with an agent envelope. Envelope tooling
> is external to the plugin; without it, adopt a zero-dependency Skill variant.

---

## 7. The webhook router (backend daemon)

The router is **bundled into the plugin** at
[`server/hook-router.ts`](./server/hook-router.ts) and started by
[`index.server.ts`](./index.server.ts). It is a plain Node `http` server; you
do not need a systemd unit or a separate bridge for the plugin's own queueing.

### 7.1 Listen address

- Default: `127.0.0.1:8099`.
- Configurable three ways, in precedence order: RPC options → plugin settings
  (`hookHost` / `hookPort`, edited in the Cockpit **Settings** tab) → legacy
  file (`~/.config/uppidi-fleet/router-config.json`) → environment
  (`FORGE_HOOK_HOST`, `FORGE_HOOK_PORT` / `HOOK_PORT`).
- On `EADDRINUSE` the router logs a warning and stands down, assuming an
  external service owns the port. Do not run two listeners on the same port and
  secret — events would be double-delivered.

> [!NOTE]
> Because the router has no built-in TLS or authentication (see
> [§7.5](#75-security-notes)), keep it on loopback unless you terminate TLS and
> authenticate in front of it. To accept remote webhooks, either bind to a
> reachable interface and front it with a reverse proxy, or expose it through a
> tunnel.

### 7.2 Ingress and classification

Ingress endpoints are `POST /forgejo` and `POST /hook` (aliases). Behaviour:

1. Read the event name from the `X-Forgejo-Event` header.
2. `ping` events return `200 {ping:true}` — use Forgejo's **Test delivery**.
3. Derive the repository key from the payload (`repository.html_url`, then
   `clone_url`, then `ssh_url`, then `full_name`), normalized to
   `host/owner/repo`.
4. Classify:
   - **Front Desk events** → the special `frontdesk` queue. True when the
     changed label is `attention/frontdesk` or `attention/2-user`, or a comment
     body starts with `/frontdesk`.
   - **Bypass / SOS events** → jumped to the head of the queue. True when the
     changed label is `priority/0-SOS` (matched case-insensitively),
     `flag/stop-work`, `ping/*`, or any `attention/*`, or a comment starts with
     `/orchestrator`, `/hold`, `/rework`, `/approve`, `/verify`, `/done`,
     `/close`, `/instruction`, `/agent`, `/sos`, or `/stop`.
   - **Routine comments stamped by the registered orchestrator** are suppressed
     so an orchestrator cannot wake itself with its own envelope footer.
   - **Everything else** → the repo's normal queue via **event coalescing**
     (see [§7.6](#76-event-coalescing--digest)).
5. Format a human-readable message and enqueue it (or buffer it for coalescing).

The delivered message has this shape (the URL is appended so chat linkifiers can
pick it up):

```
[forgejo-hook] {"forgejo":{"version":1,"event":"issues","action":"opened", ...}}

🔔 Forgejo webhook incoming [issues:opened] your-org/your-repo#42 Fix the thing (by alice)
https://forge.example.com/your-org/your-repo/issues/42
```

### 7.3 Queues, turn locking, and drain

- Queues are **persisted to disk** (`~/.config/uppidi-fleet/queues/<key>.json`),
  deduplicated by a hash of `(key, message)`, and capped at **50 entries** per
  repo (overflow is dropped and counted).
- Delivery targets the agent registered for the key: the `frontdesk.json`
  record for the `frontdesk` queue, or `<key>.json` in the orchestrator state
  dir for a repo. With **no registered target, messages are held, not dropped**
  — this is the most common "nothing happened" cause.
- **Turn locking:** before delivering, the router checks the target agent's
  status. If the agent is `running` or has an active turn, it marks the queue
  busy and schedules an exponential backoff retry (3 s → 30 s). It also
  subscribes to Paseo's `agent.turn_ended` lifecycle event and drains the
  matching queue immediately when that agent's turn ends, so a missed retry
  self-corrects.
- Delivery uses the SDK (`paseo.agents.ref(id).send`) when available and falls
  back to `paseo send --no-wait <agentId> <msg>`. SOS messages are delivered
  without steering; normal messages steer into the active turn queue.
- **Muting** a repo is a circuit breaker: drains for that key are suppressed
  until unmuted. Toggle it from the Cockpit or `uppidi-fleet.toggle-repo-mute`.

### 7.4 Control endpoints

Beyond ingress, the router exposes:

| Method & path | Purpose |
| --- | --- |
| `GET /health` | Liveness + port. |
| `GET /status` | Front desk record, paused queues, totals, repo count. |
| `GET /queues` | Per-repo queue depth, busy state, orchestrator, message previews. |
| `GET /frontdesk` · `POST /frontdesk` | Read / register the Front Desk (`{agentId, instruction?}`); notifies orchestrators. |
| `GET /handoff` · `POST /handoff` (alias `/frontdesk-handoff`) | Front Desk rotation: seed `latest-handoff.md`, project role labels, retire the previous agent, persist `frontdesk.json`, notify orchestrators. |
| `GET /orchestrators[/:repo]` | Read one or all orchestrator registrations. |
| `POST /orchestrator` (alias `/orchestrate`) | Register `{repo, agentId}`. |
| `POST /orchestrators/prune` | Delete registrations whose agent no longer exists on the daemon. |
| `POST /board-sweep` | Run `~/bin/forgejo-issues-check` (`{repos?: string[]}`); notify Front Desk of actionable tickets. |
| `POST /queues/:key/pause` · `/resume` · `/drain` | Per-queue control (also `POST /queue/{pause,resume,drain}` with `{repo}`). |

Example registration (loopback, no secret needed):

```sh
curl -s -X POST http://127.0.0.1:8099/frontdesk \
  -H 'Content-Type: application/json' -d '{"agentId":"<YOUR_FRONT_DESK_ID>"}'
curl -s -X POST http://127.0.0.1:8099/orchestrator \
  -H 'Content-Type: application/json' \
  -d '{"repo":"forge.example.com/your-org/your-repo","agentId":"<YOUR_ORCH_ID>"}'
curl -s -X POST http://127.0.0.1:8099/handoff \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"<NEW_FRONT_DESK_ID>","handoffText":"# Handoff\n\nOperator context."}'
```

### 7.5 Security notes

- `FORGE_HOOK_SECRET` is **read but not enforced** by the bundled router —
  `HookRouter` stores `this.secret` and never verifies an inbound signature.
  Until that is fixed, treat the listener as unauthenticated: bind to loopback
  or put an authenticating proxy in front. (Tracked in
  [§10](#10-gap-analysis--what-the-plugin-does-not-ship).)
- Config uses atomic writes (temp file + rename) for queues, state, and config.

### 7.6 Event coalescing & digest

Rapid webhook bursts on the same `(repo, issue)` are buffered for
`HOOK_DEBOUNCE_MS` (default `7000`) and flushed as one
`🔔 Forgejo digest <repo>#<issue> … (N events: …)` card — the `forges` plugin
renders that prefix as a presentation card. Identical deliveries are dropped;
a burst is flushed early at `HOOK_COALESCE_MAX` (default `20`) events or once it
has been open for `HOOK_COALESCE_WINDOW_MAX_MS` (default `30000`). Bypass events
skip the buffer and are queued ahead of any pending digest, but a repeated SOS
state is deduplicated so a single label flip does not re-interrupt per delivery.
Set `HOOK_COALESCE_DISABLE=1` (or `coalesceDisable: true`) to enqueue every
event directly.

### 7.7 Fleet watchdog & auto-recovery

A zero-token background loop audits the fleet every `WATCHDOG_INTERVAL_MS`
(default `60000`, 1 min; `0` disables the loop) by fusing the daemon view with
persisted `~/.paseo/agents/*/<id>.json` metadata and the `~/.paseo` daemon
logs. Classifiers and recovery are deterministic — no model calls. Source of
truth: [`server/hook-router.ts`](./server/hook-router.ts) — the taxonomy
constants (`WATCHDOG_TAXONOMY`, `WATCHDOG_SEVERITIES`), the `detect*`
classifiers, `assessAgentHealth`, `planWatchdogRecovery` /
`recoverWatchdogAgent`, and the audit loop `runWatchdogAudit`.

#### 7.7.1 Anomaly taxonomy

Every live, non-archived agent is classified against six taxonomy types
(severity drives nothing on its own — it is reported in the anomaly payload):

| Type | Sev | Trigger |
| --- | --- | --- |
| `TURN_CONCURRENCY_LOCK` | high | Lifecycle `error` whose `lastError` matches a turn-concurrency marker (`foreground turn is already active`, `concurrent turn`, …). The legacy spelling — ACP attention with `attentionReason="error"` and no disk error — also matches. |
| `TURN_CANCELLATION_TIMEOUT` | high | Daemon logs contain the `cancelagentrun: acknowledged turn still active after timeout` force-cancel for this agent (within the 24 h recency window) while the lifecycle is `error` or `idle`. |
| `IDLE_POST_ERROR_AMNESIA` | medium | `idle`, zero running children, and a stall signal: attention reason in {`error`, `stalled`, `interrupted`, `failed`}, a ghost `lastError`, or `requiresAttention` with pending work assumed. Plain `attentionReason="finished"` is normal completion and is **not** flagged. |
| `ZOMBIE_HUNG_TURN` | high | `running` with no recorded activity for ≥ 1800 s (`DEFAULT_RUNNING_STALE_SECONDS`). |
| `STALE_ERROR_GHOSTING` | medium | Lifecycle `idle`/`running` (healthy) while disk metadata still carries a `lastError`. |
| `PROVIDER_QUOTA_EXHAUSTION` | high | `lastError` matches a quota marker (quota, rate limit, 429, usage limit, insufficient credit, …) and no transient marker (fetch failed, econnreset, etimedout, …). Circuit-break: alert-only, never auto-steered. |

Legacy (pre-taxonomy) findings are still raised alongside:

| Type | Trigger |
| --- | --- |
| `AGENT_PERMISSION_REQUIRED` | Agent has `pendingPermissions`. |
| `AGENT_ATTENTION_REQUIRED` | `requiresAttention` with a reason other than `error`/`finished` (which the taxonomy owns). |
| `AGENT_ERROR` | Registered orchestrator is `status: error` and the taxonomy pass did not already handle it. |
| `ORCHESTRATOR_MISSING` | A `<key>.json` state file references an agent id that no longer exists on the daemon. |
| `QUEUE_WEDGED` | A queue has accumulated `WATCHDOG_BUSY_THRESHOLD` (default `10`) failed delivery attempts. |
| `CHILD_WAKEUP` | A worker labelled `paseo.parent-agent-id` transitioned into a block / error / completion; a reactive pulse is steered into the parent (#537). See [§13.6](#136-subagent-lifecycle-contract-reactive-wakeups--capability-grants). |

#### 7.7.2 Alert message formats

All alerts are single-line strings delivered to Front Desk. `<name>` is the
agent title (falling back to the 7-char id), `<id7>` is the first 7 chars of
the agent id, `<key>` is the enrolled repo key:

| Anomaly | Alert string |
| --- | --- |
| `AGENT_PERMISSION_REQUIRED` | `[Fleet Watchdog] Agent <name> (<id7>) requires permission: <action>. Front Desk adjudication command: paseo permit allow <agentId> <requestId>` — `<action>` is the pending permission's title/tool; the command drops `<requestId>` when the request carries none. |
| `AGENT_ATTENTION_REQUIRED` | `[Fleet Watchdog] Agent <name> (<id7>) requires attention (<attentionReason \| "stalled">). Operator or Front Desk triage required.` |
| Quota circuit-break | `[Fleet Watchdog] Agent <name> (<id7>) hit provider/quota exhaustion: "<lastError>". Circuit-break: no auto-steer; operator required.` |
| Taxonomy auto-recovered | `[Fleet Watchdog] Auto-recovered agent <name> (<id7>) [<TYPE, TYPE>] via <actions joined by " -> ">.` — actions read `stop:ok`, `clear_error:ok`, `clear_attention:noop`, `steer:ok`. |
| Taxonomy unhealthy (not steered) | `[Fleet Watchdog] Agent <name> (<id7>) unhealthy [<TYPE, TYPE>]. Operator attention may be required.` |
| `AGENT_ERROR` auto-recovered | `[Fleet Watchdog] Auto-recovered orchestrator for <key> (<id7>) by clearing foreground turn lock.` or `… by reloading agent.` |
| `AGENT_ERROR` escalated | `[Fleet Watchdog] Orchestrator for <key> (<id7>) is in status error: "<error>". Operator attention may be required.` |
| `ORCHESTRATOR_MISSING` | `[Fleet Watchdog] Registered orchestrator for <key> (<id7>) was not found on daemon.` |
| `QUEUE_WEDGED` (reloaded) | `[Fleet Watchdog] Auto-recovered wedged queue for <key> (<N> pending, <M> failed attempts) by reloading orchestrator <id7>.` |
| `QUEUE_WEDGED` (stuck) | `[Fleet Watchdog] Queue for <key> has <N> pending message(s) and has failed delivery <M> times.` |

#### 7.7.3 Recipient routing & delivery

- The recipient is resolved by `readFrontDesk()` from the **first existing**
  file, in order: `<stateDir>/frontdesk.json`
  (default `~/.paseo/forgejo-hook/orchestrators/frontdesk.json`),
  `dirname(stateDir)/frontdesk.json`
  (default `~/.paseo/forgejo-hook/frontdesk.json` — where registration and
  handoff actually write), then `<queueDir>/frontdesk.json`
  (default `~/.config/uppidi-fleet/queues/frontdesk.json`). The filename is
  `frontdesk.json` (no hyphen). The first file with a non-empty `agentId`
  wins; corrupt JSON is ignored.
- **No resolvable Front Desk ⇒ no alerts are sent.** Auto-recovery still runs,
  but the watchdog is silent — register one via `POST /frontdesk` (§7.4).
- Every alert is delivered with `{noWait: true, steer: true}`: SDK
  `paseo.agents.ref(id).send(msg, {steer: true})`, falling back to
  `paseo send --no-wait --steer <id> <msg>`. The alert lands immediately and
  steers into (interrupts) the Front Desk's active turn.

#### 7.7.4 Configuration & throttling

| Env | Default | Purpose |
| --- | --- | --- |
| `WATCHDOG_INTERVAL_MS` | `60000` | Audit loop cadence (`0` disables the loop; test mode starts at `0`). |
| `WATCHDOG_ALERT_COOLDOWN_MS` | `900000` (15 min) | Per-subject deduplication cooldown. |
| `WATCHDOG_BUSY_THRESHOLD` | `10` | Failed delivery attempts before `QUEUE_WEDGED`. |

Cooldown semantics (`canWatchdogAlert`): each alert subject is keyed —
`permission:<agentId>:<reqId>`, `attention:<agentId>:<reason>`,
`taxonomy:<agentId>:<types>`, `missing:<agentId>`, `error:<agentId>`,
`recovered:<agentId>`, `queue_wedged:<key>`, `child_waiting:<child>:<reqId|reason>`,
`child_errored:<child>`, `child_completed:<child>` (the `child_*` keys gate the
reactive parent wakeups of [§13.6](#136-subagent-lifecycle-contract-reactive-wakeups--capability-grants)) — and fires when
`now - last >= cooldown`. First sighting stamps the key and fires immediately;
repeat alerts (and repeat recovery) are suppressed until the cooldown elapses.
**Alerts and recovery share the same key and gate:** a finding that is not
cooldown-eligible is neither re-alerted nor re-recovered, so a persistently
wedged agent is not stop/steered on every tick. The taxonomy key embeds the
full type list, so a materially different finding re-keys (and re-alerts)
immediately.

#### 7.7.5 Operator runbook

**Reading watchdog logs.** The router keeps a 1000-line in-memory ring buffer;
tail it with the `uppidi-fleet.hook-log-tail` plugin tool. Watchdog lines:

- `[info] watchdog: stop <id7> -> ok` — recovery step 1 executed.
- `[info] watchdog: steer wake pulse <id7> -> ok|failed` — recovery step 4.
- `[warn] watchdog: provider/quota exhaustion requires operator circuit-break for <id7>` — recovery refused.
- `[info] watchdog: successfully reloaded <id7>` / `attempting auto-recovery reload` — legacy `AGENT_ERROR` path.

Silence in the log means the audit found nothing. Front Desk alerts are the
primary operator surface.

**Manual adjudication.** Permission alerts embed the exact command — run it
verbatim: `paseo permit allow <agentId> <requestId>` (or approve from the
Cockpit's pending-permission surface). An alert repeating after the cooldown
means the request is still pending.

**What the 4-step recovery pipeline does per taxonomy.** For cooldown-eligible
findings, `recoverWatchdogAgent` executes the ordered conservative pipeline,
skipping steps the plan does not call for:

| Taxonomy | 1 stop | 2 clear_error | 3 clear_attention | 4 steer |
| --- | --- | --- | --- | --- |
| `TURN_CONCURRENCY_LOCK` | ✓ | ✓ | — | ✓ |
| `TURN_CANCELLATION_TIMEOUT` | ✓ | ✓ | — | ✓ |
| `ZOMBIE_HUNG_TURN` | ✓ | ✓ | — | ✓ |
| `IDLE_POST_ERROR_AMNESIA` | — | — | ✓ | ✓ |
| `STALE_ERROR_GHOSTING` | — | ✓ | — | — |
| `PROVIDER_QUOTA_EXHAUSTION` | — | — | — | — (blocked) |

Concretely: `paseo agent stop <id>` → delete `lastError` from
`~/.paseo/agents/*/<id>.json` (atomic rewrite) → delete
`requiresAttention` / `attentionReason` / `attentionTimestamp` → steer a wake
pulse with the canned health-check message ("Health check: your previous turn
ended without resuming work. Sweep the board for triage and continue
dispatching pending work."). The delivered auto-recovery alert records which
steps ran (`via stop:ok -> clear_error:ok -> clear_attention:ok -> steer:ok`).
Legacy `AGENT_ERROR` (orchestrator `status: error` not owned by the taxonomy)
instead runs a single `paseo agent reload <id>`; `QUEUE_WEDGED` reloads the
registered orchestrator and drains the queue.

**When operator intervention is required.**

- **`PROVIDER_QUOTA_EXHAUSTION` is a hard circuit-break.** `planWatchdogRecovery`
  refuses the entire pipeline (no stop, no wipe, no steer — steering a
  quota-dead turn only burns more of an exhausted budget). The alert repeats
  every cooldown with the raw `lastError` inline. Fix the cause (top up
  credits, wait out the rate limit, or switch model), then wake the agent with
  `paseo send --no-wait --steer <id> <msg>` or restart it from the Paseo UI.
- **`AGENT_ERROR` escalation**: the auto-reload failed (or the error text
  matched a quota pattern) — triage the error string in the alert, then reload
  manually.
- **`AGENT_ATTENTION_REQUIRED`**: inspect with `paseo ls --json` / the Cockpit,
  resolve the stall (interrupted/failed/stalled), steer or archive the agent.
- **`ORCHESTRATOR_MISSING`**: re-register with `POST /orchestrator`, or remove
  the orphaned state file with `POST /orchestrators/prune`.
- **`QUEUE_WEDGED` (stuck variant)**: no reloadable orchestrator is registered
  — register one (`POST /orchestrator`) and drain (`POST /queues/<key>/drain`).

### 7.8 Deterministic board sweep

`BOARD_SWEEP_INTERVAL_MS` (default `900000`, 15 min) runs
`~/bin/forgejo-issues-check --json` across enrolled repos and alerts Front Desk
when new actionable tickets surface. Run it on demand with `POST /board-sweep`.
Override the script path with `FORGEJO_ISSUES_CHECK`.

---

## 8. Configuring webhooks on the Forgejo side

Do this per repository whose events should wake the fleet.

1. Open the repo → **Settings → Webhooks → Add Webhook → Forgejo**.
2. **Target URL:** the router's ingress, e.g.
   `http://<daemon-host>:8099/forgejo` (or `/hook`).
3. **HTTP Method:** `POST`. **Post Content Type:** `application/json`.
4. **Secret:** set one to match `FORGE_HOOK_SECRET`. (Forgejo will then send
   `X-Forgejo-Signature`, an HMAC-SHA256 over the raw body. The bundled router
   does not verify it — configure it anyway so you can add verification or an
   authenticating proxy later.)
5. **Trigger On:** choose **Custom Events** and select at minimum:
   - **Issues** (opened, labeled, closed, reopened, edited)
   - **Issue Comment** (created, edited)
   - **Pull Request** (opened, closed, merged)
   - **Push** (optional)
   - **Issue Label** / **Release** (optional)
6. Click **Add Webhook**, then **Test Delivery** (a `ping` event). A healthy
   router returns `{"ok":true,"ping":true}` and logs
   `Webhook ping received on POST /forgejo`.

Verify end-to-end from the router:

```sh
curl -s http://127.0.0.1:8099/status | jq .
curl -s http://127.0.0.1:8099/queues | jq '.queues[] | {key, depth, isBusy}'
```

If events arrive but nothing reaches an agent, the queue has **no registered
orchestrator** (or the repo is muted). Register one ([§7.4](#74-control-endpoints))
or enrol the repo from the Cockpit's `+ Add Orchestrator`.

---

## 9. Forgejo Actions & automated board hygiene

Two kinds of automation live in `.forgejo/workflows/` in this monorepo. They are
**monorepo-level files**, not part of the plugin package — a third party copies
and adapts them.

### 9.1 Human-activity triage → `attention/0-orchestrator`

[`.forgejo/workflows/issue-label-triage.yml`](../../.forgejo/workflows/issue-label-triage.yml)
does exactly what the operator directive asked for: when a **human** (any actor
other than the shared `xpufx` agent identity) opens an issue or posts an issue
comment, it adds `attention/0-orchestrator` so the orchestrator lane sees it.

Key design points, all worth copying:

- **Trigger:** `issues: [opened]` and `issue_comment: [created]`.
- **Human vs agent:** all agents share one forge account, so
  `github.actor == xpufx` means automated and the job exits 0. Change `xpufx`
  to **your** agent account.
- **Exclusivity does the rest:** because `attention/*` is exclusive, adding
  `attention/0-orchestrator` alone evicts `attention/1-agent`,
  `attention/2-user`, or `attention/3-ignore`. No `--remove-label` needed.
- **Idempotent:** it no-ops if `attention/0-orchestrator` is already present, and
  adding a label emits `issues:labeled` — which is not a trigger here — so it
  cannot loop.
- **Pull-request guard:** it fetches the issue and skips when `pull_request` is
  non-null, since a PR comment shares the issue-comment event shape.
- **Write-back confirmation:** after POSTing the label it reads the labels back
  and fails loudly if the label did not land (usually because the label is not
  defined on the repo — see [§5](#5-board-labels-taxonomy-and-install)).

**Runner choice.** The workflow runs on a **host runner** (`runs-on:
runner-local-shell`, no `container:` block) because it is a handful of HTTP
calls. The runner label is environment-specific — register your own runner and
change `runs-on`. The workflow probes the host for `curl`/`wget` and
`jq`/`grep`, preferring `curl` + `jq` and falling back gracefully, so a minimal
runner still works.

**Adapting it:** change the agent account name, the runner label, and — if your
agent identity is not a single shared user — the human/agent discrimination
logic. The token comes from Forgejo's auto-injected `secrets.GITHUB_TOKEN`.

### 9.2 Stale-WIP sweep

[`.forgejo/workflows/stale-wip-sweep.yml`](../../.forgejo/workflows/stale-wip-sweep.yml)
runs hourly and, for `state/1-wip` tickets idle past a timeout, posts one
reminder then flips to `attention/0-orchestrator` + `state/0-triage` (whose
exclusivity evicts `state/1-wip`). It invokes a **reusable workflow in an
external repo** (`xpufx-org/platform`). If you want this, host your own
reusable base and point the caller at it, or inline the logic.

---

## 10. Gap analysis — what the plugin does not ship

This section is deliberately blunt: adopting the system today means filling
these gaps yourself.

### 10.1 No label installer or seed inside the plugin

- The plugin has **no** label-install RPC or UI. The forges plugin's optional
  label-set installer was operator-gated and excluded from the release surface.
- The only shipped seed is
  [`plugins/forges/examples/labels/label-base.yaml`](../forges/examples/labels/label-base.yaml),
  and it covers only `state/`, `priority/`, `attention/`, `spec/`, and
  `flag/stop-work`. There is **no seed** for `target/*` or `verify/*`.
- **Action:** copy/adapt the seed (see [§5.3](#53-install-approaches)). Consider
  adding a small `seed-labels.sh` to your fork.

### 10.2 The fleet's Skills live outside the plugin

- The live `orchestrator`, `front-desk`, and `coding-agent` skills live in this
  repository at the root, under `.agents/skills/` — **in the repository, but
  outside the plugin package**. The plugin itself ships no Skills.
- The repository ships **adapted example Skills** under
  [`plugins/forges/examples/skills/`](../forges/examples/skills/)
  ([§6](#6-skills-how-the-fleet-thinks)), and there is **no Front Desk example**.
- **Action:** copy the forges examples into your own `.agents/skills/`, adapt
  them, and author a Front Desk skill.

### 10.3 Action workflow YAML is monorepo-level, host-specific

- `issue-label-triage.yml` and `stale-wip-sweep.yml` live in the monorepo's
  `.forgejo/workflows/`, not under the plugin. The runner label
  (`runner-local-shell`) and the reusable sweep base (`xpufx-org/platform`) are
  one team's environment. The hardcoded agent account (`xpufx`) must change.
- **Action:** copy both into your repo and rewrite the runner label, agent
  account, and reusable-workflow reference.

### 10.4 The issues surface is hardcoded to one host/repo

- [`server/issues.ts`](./server/issues.ts) falls back to
  `FORGEJO_HOST=forge.mrs.uppidi.com` and repo `xpufx-org/paseo`, resolving the
  token from `FORGEJO_TOKEN` / `GITEA_TOKEN` or `~/.config/tea/config.yml`.
  There is no settings UI for the issues host/repo/token.
- **Action:** export `FORGEJO_HOST` and `FORGEJO_TOKEN`, and pass the desired
  repo (or patch the defaults) until a settings field is added.

### 10.5 The webhook secret is not verified

- The router stores `FORGE_HOOK_SECRET` but never validates
  `X-Forgejo-Signature` or an auth header ([§7.5](#75-security-notes)).
- **Action:** keep the listener on loopback or front it with an authenticating
  proxy until signature verification lands.

### 10.6 The Front Desk hand-off endpoint exists

- `POST /frontdesk-handoff` (legacy alias `POST /handoff`) implements the
  rotation protocol: it seeds `latest-handoff.md`, projects the `Front Desk`
  role label, retires the previous agent, persists `frontdesk.json`, and
  notifies orchestrators. `GET /frontdesk-handoff` (`/handoff`) reports the
  active registration and snapshot summary, matching the live Front Desk
  skill. Full rotation contract: [§13.5](#135-front-desk-singleton--rotation-protocol).

### 10.7 Role models, metrics, and runners are mock / coming-soon

- The bundled defaults are **mock / coming-soon**. Role models
  ([`server/role-models.ts`](./server/role-models.ts)) and fleet metrics
  ([`server/metrics.ts`](./server/metrics.ts)) ship one team's placeholder model
  ids and benchmark numbers. Runner discovery
  ([`server/runners.ts`](./server/runners.ts)) shells `podman ps` / `tea whoami`
  and contains a hardcoded runner id. None of this is wired to a real provider
  fleet yet.
- **Action:** override role models from the Cockpit or
  `~/.paseo/uppidi-fleet-role-models.json`; treat metrics and runners as
  mock/coming-soon stubs. Metrics specifically still serves a seeded baseline
  matrix when the metrics file is absent — the empty-by-default contract is
  not yet implemented ([§13.4](#134-fleet-metrics-baseline-not-empty)).

### 10.8 Adoption checklist

- [ ] Seed the scoped labels on every enrolled repo ([§5](#5-board-labels-taxonomy-and-install)).
- [ ] Create a PAT with issue write scope and export it where the plugin reads it.
- [ ] Install the plugin and confirm the Cockpit renders your board ([§3](#3-install-the-plugin)–[§4](#4-the-cockpit-surface)).
- [ ] Start the router (Cockpit → Settings) and confirm `GET /health`.
- [ ] Add the Forgejo webhook(s) and send a test `ping` ([§8](#8-configuring-webhooks-on-the-forgejo-side)).
- [ ] Adapt the Skills and load them; author a Front Desk skill ([§6](#6-skills-how-the-fleet-thinks)).
- [ ] Copy/adapt the action workflows and register a runner ([§9](#9-forgejo-actions--automated-board-hygiene)).
- [ ] Register a Front Desk and one orchestrator; enrol the repo ([§7.4](#74-control-endpoints)).
- [ ] Decide on comment self-stamping (shared account) or a zero-dependency skill variant.
- [ ] Put an authenticating proxy in front of the router until the secret is enforced.

---

## 11. End-to-end walkthrough

1. **Operator files a ticket** on Forgejo. The triage workflow (or the operator
   manually) sets `attention/0-orchestrator`.
2. **Forgejo fires a webhook.** The router derives the repo key, enqueues the
   event, and — because an orchestrator is registered — delivers a summary over
   `paseo send`.
3. **The orchestrator** reads the full ticket, seeds the labels
   (`state/0-triage` → `state/1-wip` as work starts), shapes a checklist, and
   dispatches **one coding worker** into a new isolated worktree, instructing it
   to claim, implement, test, commit, push, and open a PR.
4. **The worker** advances the board (`state/2-review`), posts a stamped report
   with the commit SHA and PR link, and stands by.
5. **The orchestrator** runs pre-flight on the PR (diff, tests, typecheck, live
   freshness), merges, tears down the worktree, and moves the issue to
   `state/3-verify` with `attention/2-user`.
6. **Front Desk** surfaces the completed deliverable to the operator. The
   operator verifies and closes the issue.
7. **The Cockpit** reflects every step live: agent states in the Fleet tree,
   queue depth and router health in the Work Queue, and board labels in the
   issue table.

---

## 12. Runtime state & file map

| Path | What lives there |
| --- | --- |
| `~/.config/uppidi-fleet/router-config.json` | Legacy/compat router host, port, enrolled & muted repos. |
| `~/.config/uppidi-fleet/queues/` | Persisted per-repo webhook queues. |
| `~/.paseo/forgejo-hook/orchestrators/<key>.json` | Repo → orchestrator agent id. |
| `~/.paseo/forgejo-hook/frontdesk.json` | Front Desk agent id (watchdog recipient; resolved via fallbacks — see [§7.7.3](#773-recipient-routing--delivery)). |
| `~/.paseo/forgejo-hook/latest-handoff.md` | Active Front Desk hand-off snapshot. |
| `~/.paseo/uppidi-fleet-role-models.json` | Per-role primary model + fallback group. |
| `~/.paseo/uppidi-fleet-metrics.json` | Fleet capability metrics. |
| `~/.paseo/plugin-data/xpufx/uppidi-fleet/settings.json` | Plugin settings (`hookHost`, `hookPort`, `enrolledRepos`, `mutedRepos`). |
| `<repo-root>/.agents/skills/` | The fleet's operational skills, at the repository root (outside the plugin package). |

Environment variables: `FORGE_HOOK_HOST`, `FORGE_HOOK_PORT`/`HOOK_PORT`,
`FORGE_HOOK_SECRET` (stored, unenforced), `FORGE_HOOK_CONFIG`,
`HOOK_QUEUE_DIR`, `HOOK_STATE_DIR`, `FORGE_HOOK_URL`, `FORGEJO_HOST`,
`FORGEJO_TOKEN`/`GITEA_TOKEN`, `HOOK_COALESCE_DISABLE`, `HOOK_DEBOUNCE_MS`,
`HOOK_COALESCE_MAX`, `HOOK_COALESCE_WINDOW_MAX_MS`, `WATCHDOG_INTERVAL_MS`,
`WATCHDOG_BUSY_THRESHOLD`, `WATCHDOG_ALERT_COOLDOWN_MS`,
`BOARD_SWEEP_INTERVAL_MS`, `FORGEJO_ISSUES_CHECK`.

---

## 13. Development

```sh
# Typecheck
npm run typecheck --workspace=plugins/uppidi-fleet

# Tests (typecheck + unit suite)
npm test --workspace=plugins/uppidi-fleet
```

The plugin is built on
[`paseo-plugin-helper`](../../packages/paseo-plugin-helper/). UI changes should
use helper primitives (`Button`, `Card`, `FormRow`, `KeyValueGroup`, …) rather
than raw React Native, and can be checked with:

```sh
node packages/paseo-plugin-helper/bin/paseo-plugin-helper.js audit plugins/uppidi-fleet
```

See [`docs/remote-repos.md`](./docs/remote-repos.md) for the design notes on
supporting repositories without persistent local clones.

## 13.1 Daemon workspace scoping & orchestrator spawning

Two CLI contract details matter whenever a fleet component (or you, by hand)
spawns a long-lived agent for a specific repository.

**`paseo run -d` needs an explicit target.** A detached daemon-mode agent does
not magically bind itself to a repository: pass `--workspace <workspaceId>` to
run inside an existing Paseo workspace, or `--cwd <path>` as the fallback. If
neither is given, the daemon inherits the *caller's* working directory — which
is usually the wrong repo. Source of truth:
[`server/agents.ts`](./server/agents.ts) (`spawnPaseoAgent`): the SDK path
(`context.paseo.agents.create`) forwards `workspaceId` as `workspaceId` +
`workspace`, and the CLI fallback appends `--workspace <id>` when known, `--cwd`
otherwise. Workspace resolution (`resolveRepoWorkspace`) prefers, in order:

1. `paseo workspace ls --json` — the **keys are `workspaceId`, not `id`**
   (older builds also tolerate `id`; do not rely on it). Repos are matched by
   `project`, workspace `name`, or the repo basename, preferring
   `isolation === "local"` over ephemeral worktrees.
2. an existing agent whose `cwd` matches the repo,
3. a bare `~/code/<repoBasename>` path if it exists.

**Orchestrator spawn prompt-init contract.** `handleUppidiAddOrchestrator`
spawns with title `Orchestrator · <repo>` and a default prompt pointing the new
agent at its SKILL.md and the board CLI conventions:

```text
You are the project orchestrator for <repo>.
Follow the orchestrator skill at <home>/code/platform/skills/orchestrator/SKILL.md.
Coordinate tasks, supervise worker agents, and manage pull requests and issues
for this repository using the forge CLI (fgjx) and Paseo conventions.
```

If you pass a custom `prompt`, keep the same contract: name the repo, point at
the skill file (`fgjx`-flavoured Skills assume `fgjx`/`teax` over `tea`; the
zero-dependency variant assumes neither), and state the coordinate/supervise
mandate — see [§6](#6-skills-how-the-fleet-thinks) for the example skills this
references. The spawn also registers the agent with the router
(`writeOrchestrator` + `enrollRepo`) so webhooks route to it.

`spawnPaseoAgent` also accepts an optional `capabilities` grant (spawn `mode`
plus `allowPaths` auto-allow seeds) and emits reactive lifecycle wakeups back to
the parent — both covered in
[§13.6](#136-subagent-lifecycle-contract-reactive-wakeups--capability-grants).

**Two-tier spawn authority (front desk spawns orchestrators only).** The fleet
topology is a strict two-tier authority chain, enforced deterministically in
`spawnPaseoAgent` (`evaluateSpawnAuthority`, [#573]):
[platform#172](https://forge.mrs.uppidi.com/xpufx-org/platform/issues/172).

1. The **front desk may spawn discrete orchestrators** — but each desk-spawned
   orchestrator must carry an explicit repo workspace (`workspaceId` or a
   repo-local `cwd`). The desk's own working directory (`~/code/meta`, or the
   desk agent's recorded cwd) is rejected, so a child never inherits the desk's
   root context (the workspace-root bug class behind
   [paseo#530](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/530)).
2. The **front desk must never spawn workers**. Worker spawning is
   orchestrator-exclusive; the desk's dispatch paths are steering a registered
   orchestrator (`paseo send --steer --no-wait <orchId>`), the router API
   (`POST <hook-host>:<port>/orchestrator`, `/board-sweep`), or operator
   escalation.

Attribution is positive-only: the guard reads the caller agent id from the spawn
request (`callerAgentId`, forwarded by the `add-orchestrator` /
`replace-orchestrator` RPCs) and compares it against the router's registered
front desk (`readFrontDesk()`, falling back to `frontdesk.json`). If no caller id
resolves or no desk is registered, the guard abstains rather than guess, so
orchestrator self-registration and legitimate worker spawns never regress. Every
decision is logged through the plugin log (`spawn-authority: allowed|rejected`),
and rejections name both remediation paths verbatim. Callers that spawn through
the RPC surface should pass their own agent id as `callerAgentId` to be
attributed.

## 13.2 Test state isolation

Tests that touch hook-router state, Front Desk/orchestrator registrations, or
the fleet manager **must run against an isolated state dir**, not the live one:

```sh
HOOK_STATE_DIR=/tmp/test-hook-state npm test --workspace=plugins/uppidi-fleet
```

Why: the router resolves its state dir as
`options.stateDir ?? HOOK_STATE_DIR ?? ~/.paseo/forgejo-hook/orchestrators`
([`server/hook-router.ts`](./server/hook-router.ts)), and the fleet handlers
resolve persisted state via `getPersistedStateDir()` with the same
`HOOK_STATE_DIR` override (falling back to a per-pid tmpdir only when
`NODE_ENV=test`). A test that registers a mock Front Desk or orchestrator
(`agent-created-1`, synthetic UUIDs, …) **writes real JSON registration files**
(`frontdesk.json`, `orchestrators/<key>.json`). Without the override those land
in the live `~/.paseo/forgejo-hook/` tree and hijack real webhook routing until
pruned by hand. The shipped suite already sets
`HOOK_STATE_DIR=$TMPDIR/paseo-fleet-test-<pid>` when unset — keep that pattern
in any new test that imports these modules. Test runs also skip router-config
enrollment persistence unless `FORGE_HOOK_CONFIG` is set.

## 13.3 Watchdog cross-reference & the `finished` exclusion

The watchdog taxonomy, alert formats, cooldowns, and the recovery pipeline are
documented in the runbook — see [§7.7](#77-fleet-watchdog--auto-recovery) — and
are not repeated here.

One classifier detail has evolved since it was first specced and is worth
calling out next to `detectIdlePostErrorAmnesia`
([`server/hook-router.ts`](./server/hook-router.ts)): a plain
`attentionReason: "finished"` on an idle agent is **normal completion and is
excluded**. `IDLE_POST_ERROR_AMNESIA` fires only when the agent is `idle` with
zero active children *and* a real stall signal: an attention reason of
`error` / `stalled` / `interrupted` / `failed`, or a ghost `lastError`. There
is one explicit opt-in beyond that: passing `assumePendingWork: true` to the
audit options additionally treats a finished idle agent with
`requiresAttention` set as stalled ("aggressive amnesia detection"). The
production loop does not set it; tests inject it. Do not "fix" a finished-idle
orchestrator by removing this exclusion — it exists precisely to stop
false-positive spam on idle orchestrators.

## 13.4 Fleet metrics: baseline, not empty

The Platform #18 audit expectation was "no hardcoded metrics — empty until
`~/.paseo/uppidi-fleet-metrics.json` has empirical receipts". The shipped code
does **not** currently match that: [`server/metrics.ts`](./server/metrics.ts)
falls back to a checked-in `BASELINE_CANDIDATES` benchmark matrix (four
placeholder models, four task profiles) whenever the metrics file is absent or
unparsable, and the unit suite asserts that fallback. The client renders an
explicit `No benchmark candidate data available.` empty state only when the
candidate list is genuinely empty.

So the present contract is:

- `~/.paseo/uppidi-fleet-metrics.json` present ⇒ those receipts are served
  verbatim (candidates, task profiles, trial totals, privacy notice).
- File absent ⇒ **seeded baseline data**, not an empty state. Treat the matrix
  as illustrative/placeholder until the empty-by-default change lands; the
  gap is tracked in [§10.7](#107-role-models-metrics-and-runners-are-mock--coming-soon).

## 13.5 Front Desk singleton & rotation protocol

**Front Desk is a singleton per daemon.** All Front Desk-directed traffic is
read from a single `frontdesk.json` registration (resolved through the
fallback chain in [§7.7.3](#773-recipient-routing--delivery)), so registering a
second Front Desk replaces — not joins — the recipient of every watchdog
alert, board-sweep notice, and frontdesk queue drain. Keep at most one active
agent in the role; the Cockpit's Replace control and the rotation protocol
below both retire the incumbent for you.

**Rotation endpoint: `POST /frontdesk-handoff`** (the legacy short alias
`POST /handoff` is also routed; `GET /frontdesk-handoff` / `GET /handoff`
report the active registration plus a snapshot summary). Body:
`{"agentId": "<new-front-desk-id>", "handoffText": "..."}` — or `handoffFile`
(pointing at a file) instead of `handoffText`. Behavior
(`doFrontDeskHandoff` in [`server/hook-router.ts`](./server/hook-router.ts)):

1. Seed the handoff snapshot: `handoffText`/`handoffFile` is written to
   `~/.paseo/forgejo-hook/latest-handoff.md` (atomic write; the file lives
   next to `frontdesk.json`). With no snapshot supplied, the existing file is
   reused; with no snapshot available, the request is rejected (400).
2. Rename the new agent to `Front Desk` with role label `front-desk`.
3. **Retire the previous agent**: it is renamed `Front Desk (retired)` with
   role `retired-front-desk`.
4. Persist `frontdesk.json` (`by: "frontdesk-handoff"`) and drain the
   `frontdesk` queue.
5. Steer an onboarding message to the new agent (handoff path + snapshot
   excerpt) and notify every registered orchestrator with the handover notice
   and the escalation route (`paseo send --no-wait <id> <msg>`).

## 13.6 Subagent lifecycle contract, reactive wakeups & capability grants

The deterministic subagent contract from #537. It **extends** the #534 blocked
states — nothing is renamed — and lives on the server `UppidiAgent` payload and
in [`shared/contracts.ts`](./shared/contracts.ts).

**Canonical lifecycle states.** Alongside the finer-grained
`deterministicState`, every normalized agent carries a first-class
`lifecycleState` projected by `deriveLifecycleState`:

| `lifecycleState` | Source `deterministicState` | Meaning |
| --- | --- | --- |
| `running` | `working`, `running` | Active turn |
| `waiting_for_input` | `permission-prompt`, `attention-required` | Blocked on a permission or operator input |
| `idle` | `idle:waiting`, `sleeping`, `idle:quota-exhausted`, `unknown` | Alive, waiting for a turn |
| `errored` | `failed:spawn` / `failed:timeout` / `failed:error` / `failed:quota-exhausted` | Terminal failure |
| `completed` | (observed as idle + `attentionReason: "finished"`) | Finished a turn |

Read it defensively with `resolveAgentLifecycleState(agent)`, which falls back to
the deterministic projection for legacy/partial payloads. `lifecycleState` is
optional on `UppidiAgentSchema` (so old payloads still parse); the server always
populates it.

**Structured block detail.** When `lifecycleState === "waiting_for_input"`, the
agent also carries `blockDetail`:

```json
{
  "requiredPermissionId": "per_0d5f…",
  "scope": "/home/user/code/paseo/*",
  "action": "access external dir",
  "command": "paseo permit allow <agentId> <requiredPermissionId>"
}
```

`requiredPermissionId` is the request id for `paseo permit allow <agent> <req>`;
`scope` is extracted from the request `input` (a `path`/`directory`/… key) and
falls back to a daemon `description` of the form `Scope: <path>` (the
`external_directory` shape). `stateDetail` also folds the scope in
(`<action> (<scope>)`). Source: `normalizePendingPermissions` +
`buildAgentBlockDetail`.

**Reactive child wakeups.** The watchdog tick (§7.7, same
`WATCHDOG_INTERVAL_MS` cadence — no new polling thread) also acts as a bounded
watcher over workers labelled `paseo.parent-agent-id`. When such a child
transitions:

- into a block → `agent.child_waiting_for_input`
  (`… is waiting for input: <action> scope=<scope>. Adjudicate: paseo permit allow <child> <req>`)
- into error → `agent.child_errored`
- into idle/`finished` completion → `agent.child_completed`

…the pulse is delivered **directly to the parent** with
`paseo send --steer --no-wait <parentId>` (the same `deliver()` primitive as
Front Desk alerts; no Front Desk routing). Dedup reuses `canWatchdogAlert` with
per-`(child,event)` keys — `child_waiting:<id>:<reqId|reason>`,
`child_errored:<id>`, `child_completed:<id>` — so a persistently blocked child
is not re-pinged every tick, and a **changed** permission request re-keys and
re-notifies immediately. Each pulse also raises a `CHILD_WAKEUP` anomaly with
`parentAgentId`, `event`, `permissionId`, and `scope`. Disable with
`childWakeups: false` in the audit options.

**Capability grants at spawn.** `spawnPaseoAgent` accepts an optional
`capabilities` grant. Where the daemon CLI/SDK supports it, `mode` is forwarded
to declared `modeProviders` (default `["antigravity-acp"]` → `yolo`); other
providers ignore it. `allowPaths` seeds a bounded, best-effort auto-allow:
after spawn the plugin polls `pendingPermissions` (SDK `ref()`, falling back to
`paseo permit ls --json`) and allows **exactly one** request whose scope falls
under a declared prefix, logging the outcome. This is a plugin-surface shim —
**the daemon has no pre-grant/permission-inheritance surface today**, so
capability inheritance is best-effort, not enforced (daemon-side gap tracked in
[#537](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/537)). Cross-ref:
[§13.1](#131-daemon-workspace-scoping--orchestrator-spawning) for the spawn
target contract this builds on.

---


## 14. License

MIT © 2026 xpufx
