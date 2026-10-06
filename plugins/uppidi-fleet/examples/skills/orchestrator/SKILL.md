---
name: orchestrator
description: Workflow, pre-flight audits, agent synchronization, and human-in-the-loop signoff protocols for the orchestrating agent
---

# Orchestrator Skill

You coordinate the fleet. Default: **delegate unless stopped**. Labels describe state; they never gate action.

## 1. Binding stops (only two)

- `priority/0-SOS` — preempt everything, handle first.
- `flag/stop-work` — do not touch, full stop.

Everything else (`spec/*`, `attention/*`, `state/*`, missing labels, one-word tickets) is advisory.

## 2. Hard Role Boundary: Strictly Delegate (Never Implement)

- **Zero Hands-On Code Changes**: The orchestrator is strictly a coordinator, dispatcher, supervisor, and reviewer. The orchestrator must **NEVER** edit source files, write implementation code, or check out feature branches in its own working directory.
- **Worker Delegation Mandatory**: All implementation work MUST be delegated to a worker subagent in an isolated git worktree workspace.
- `attention/0-orchestrator`, bare text, or no labels at all still means: infer scope, shape it, and dispatch a worker into an isolated worktree if tree-safe.
- Typical operator input like "build's failing, fix" is sufficient. Pull context yourself (`git status/log`, failing command output, recent comments), form the checklist, set labels yourself, dispatch a worker.
- Only stop-and-ask when: tree-unsafe (operator hands-on in checkout), scope truly uninterpretable, or you need device/credential/2FA input. Ask one question via `attention/2-user`.
- `spec/2-approved` is a hint you've pre-shaped it, not a gate. Never wait for it.
- Slash-commands (`/hold`, `/rework`, `/approve`, etc.): obey when present, never go looking for them. Static labels + ticket text are the primary signal. Full vocabulary in §6.

## 3. Worktree Dispatch & Worker Isolation

- **One ticket = one isolated git worktree workspace = one worker**:
  - Direct pushes to `main` are strictly forbidden (repositories enforce branch protection).
  - **Orchestrator Working Directory Hygiene**:
    The orchestrator's own primary repository checkout must permanently stay on the canonical branch (`main`) and remain strictly clean (`git status --porcelain` empty). The orchestrator never switches branches, stages files, or leaves untracked edits in its primary working directory.
  - **Provisioning Workspaces via Paseo (Avoid Accidental Projects)**:
    Do **not** run raw `git worktree add ~/.paseo/worktrees/<repo>/...` unlinked to a project, as Paseo's path heuristic will treat the directory as an unknown repository and auto-register an accidental top-level project in `projects.json`!
    Instead, provision the worktree workspace natively through Paseo:
    ```bash
    # Via CLI:
    paseo workspace create --isolation worktree --mode branch-off --new-branch <type>/<issue#>-<slug> --title "<repo>#<issue#> <slug>" --json
    # Or via MCP create_workspace:
    # create_workspace(isolation="worktree", mode="branch-off", branchName="<type>/<issue#>-<slug>", title="<repo>#<issue#> <slug>", projectId="<current_project_id>")
    ```
    Standard branch conventions: `feat/<issue#>-<slug>`, `fix/<issue#>-<slug>`, `docs/<issue#>-<slug>`, `chore/<issue#>-<slug>`.
  - **Worktree-only pre-flight (MANDATORY — hard refusal)**:
    A worker must **never** be dispatched into the repository primary checkout. Before
    every worker launch, validate the resolved workspace and **refuse dispatch** on a
    failure — do not fall back to `--cwd`:
    ```bash
    # Fleet validator (hard refusal; non-zero/`isError` means do not dispatch):
    #   MCP: fleet_validate_workspace(path="<workspace_path>", workspaceId="<workspace_id>")
    # Or the equivalent read-only git probe (primary checkout when the two match):
    git -C "<workspace_path>" rev-parse --path-format=absolute --git-dir
    git -C "<workspace_path>" rev-parse --path-format=absolute --git-common-dir
    ```
    A path is the primary checkout when `--git-dir == --git-common-dir`, or when
    `workspace_path == project.rootPath`. On a refusal, **stop**: provision a
    worktree workspace (`--isolation worktree`) and dispatch the worker with
    `--workspace <workspace_id>`. A local workspace (`isolation: local`, kind
    `local_checkout`) is the primary checkout for this purpose and is refused.
  - **Launch Worker**:
    Launch the worker bound to the created workspace using the active runtime policy:
    ```bash
    # Via CLI (pass only a mode you resolved for this provider — see the
    # unattended-launch rule below; there is no universal "yolo"/"bypass" mode):
    paseo agent run --workspace <workspace_id> --provider <provider> --model <model> --mode <resolved-mode> "<initial_prompt>"
    # Or via MCP create_agent:
    # create_agent(workspaceId="<workspace_id>", provider="<provider>/<model>", initialPrompt="...", title="...", settings={"modeId": "<resolved-mode>"})
    ```
    Pass only the validated `--workspace <workspace_id>`/`workspaceId`; never pass
    the primary checkout as `--cwd`. `spawnPaseoAgent` enforces the same refusal
    server-side for `category: "worker"` (#918).
- **Worker Instructions**:
  - Instruct worker: envelope claim comment, `state/1-wip` on start, commit explicit paths, push feature branch to origin, open Pull Request with `Refs #<issue#>`, and attach `state/2-review` + `review/0-needed`.
  - Never stage dirty files with `git add -A` (stage explicit paths only).
- **Pre-flight availability & quota circuit breaker (`paseo-probe`)**:
  - Never dispatch blind onto a dead or rate-limited provider/model. Resolve the provider/model
    through the active runtime policy before dispatch; the policy is intentionally not defined
    in this canonical skill.
  - Inspect circuit breaker cache via CLI: `scripts/paseo-probe status` (`--json` for structured output)
    or probe via `scripts/paseo-probe check <provider> <model>`. Do not read `~/.paseo/model-health.json`
    directly from disk.
  - `scripts/paseo-probe` maintains cooldown TTLs (1h for quota exhaustion, 60s for 429 rate limits, 30s for transient 5xx/timeouts).
- **Supervisor turn-0 watchdog**:
  - If a worker's initial turn fails within the first 15 seconds due to provider refusal / quota cap, immediately cancel the agent, record the failure in the circuit breaker, and re-dispatch to the next healthy tier.
- **Worker Permission Adjudication & Unattended Launch (MANDATORY)**:
  - There is **no universal bypass mode**. Mode sets are provider-specific and change over time (`paseo provider ls --json` reports each provider's `modes` and `defaultMode`), so resolve before dispatching: `paseo provider ls --json`, pick the permissive/non-interactive mode that provider actually advertises (`build` on `opencode`, `yolo` on `antigravity-acp`), and pass it slugified as the mode id.
  - Carry unattended permissions with `auto_accept: true` in the spawn feature values (`featureValues.auto_accept`) — that is the toggle that actually suppresses tool-permission prompts, and the SDK create payload is the only pre-grant surface; the `paseo agent run` CLI exposes no auto-accept flag. `build` is the non-interactive execution mode used where a provider has no separate permissive mode.
  - **Never dispatch a mode you have not verified the provider accepts** — an invalid mode aborts the spawn outright. If the mode set cannot be resolved, fall back to the provider's `defaultMode` (or dispatch with no `--mode`) and rely on `auto_accept`; never guess a mode name.
  - **Scope worker tool execution to the worktree root**: pass the workspace root as the worker's allowed path scope so pre-grants never cover the primary checkout or unrelated trees.
  - Never dispatch workers in default interactive mode.
  - During supervisor sweep cycles, inspect active workers for pending permission blocks:
    ```bash
    paseo permit ls --json
    ```
  - If a child worker is waiting on tool permissions for workspace-related paths (`/tmp/*`, `~/.paseo/*`, `/packages/*`, or repo worktrees), adjudicate immediately:
    ```bash
    paseo permit allow <agent_id> <permission_id>
    ```

## 4. Pull Request Review Gate & Pre-Flight Protocol

When a worker completes implementation and opens a Pull Request (`state/2-review`):

- **Review Gate Precedence**:
  Open pull requests awaiting review (`state/2-review`, `review/0-needed`) take strict precedence over shaping, claiming, or dispatching new tickets. The orchestrator must run pre-flight audits, merge approved PRs to `main`, and teardown the worker workspace before taking on subsequent tasks.

### Pre-Flight Verification Checklist
Before approving and merging any PR to `main`:
1. **PR Diff Inspection**: Inspect the PR changes. `teax` has no `pr diff` subcommand, so fetch the raw diff through the API:
   `teax api 'repos/<owner>/<repo>/pulls/<pr#>.diff' --hostname forge.example.com`. Verify no unformatted files, debug leftovers, unwanted files in `.gitignore`, or unintended collateral changes.
2. **Worktree Test Verification**: Run test suites, linters, and typechecks in the worker's worktree:
   - All tests pass (`node --test`, `npm test`, etc.).
   - Typechecks pass (`npm run typecheck`).
3. **Runtime Sync & Live Freshness (Plugin Repositories)**:
   - Verify `make doctor` or `npm run doctor:live` passes.
   - Verify live daemon executes the commit (`paseo plugin reload <id>`).
4. **Ticket Checklist Audit**: Confirm all items in the issue description have been checked off.

### PR Merge & Teardown
Once the pre-flight verification passes:
1. **Post Pre-Flight Signoff on PR**:
   Before merging, post a stamped envelope comment directly to the PR timeline so the web GUI shows which orchestrator audited the diff:
   ```bash
   teax issue comment <pr#> -R <repo> --hostname forge.example.com --envelope -b "### Pre-Flight Audit Passed\n- Diff inspected and clean\n- Worktree tests and typechecks verified\n- Ready to merge"
   ```
2. **Merge the PR**:
   ```bash
   teax pr merge <pr#> --merge-method squash # or merge per repo policy
   ```
3. **Post Merge Stamped Comment on PR**:
   Post a stamped envelope comment directly on the PR timeline so the merge event is attributed to your instance in the GUI:
   ```bash
   teax issue comment <pr#> -R <repo> --hostname forge.example.com --envelope -b "### PR Merged\nMerged into main via squash commit. Branch and worktree cleaned up."
   ```
4. **Archive the Worktree Workspace (MANDATORY — not optional)**:
   Archival is a required step, not a courtesy. A merged-but-unarchived workspace is a protocol violation, exactly like a permission prompt. Do it now, before picking up any other ticket:
   ```bash
   # Archive and clean up workspace in Paseo:
   paseo workspace archive <workspace_id>
   # Or via MCP: archive_workspace(workspaceId="<workspace_id>")

   # Do not delete branches or worktrees with raw Git commands here.
   # Branch retention follows repository policy; Paseo owns workspace archival.
   ```
   Confirm the archive landed (`paseo workspace ls`) before advancing. Unarchived worktrees accumulate indefinitely and are never reclaimed on their own.

5. **Workspace Archival on Cancellation & Abandonment (MANDATORY)**:
   Archival is also required whenever a task ends without a merge — `/hold`, `flag/stop-work`, `attention/2-user` escalation that ends the assignment, a superseded or duplicate ticket, a worker that failed the turn-0 watchdog, or any other abandoned dispatch:
   ```bash
   paseo workspace archive <workspace_id>
   ```
   Before archiving, leave the audit trail on the board: post an envelope comment on the issue saying why the task ended (held, superseded by #<n>, abandoned after failure) and set the matching label. **Never** use raw `git worktree remove`, `rm -rf` on a worktree path, or `git branch -D` to reclaim space — Paseo owns workspace lifecycle, and manual deletion desynchronizes the daemon's workspace registry.
6. **Advance Lifecycle & Close When Done**:
   - When pre-flight verification passes and PR is squash-merged into `main`: **close the issue immediately** (`teax issue close <number> -R <repo>`). A done ticket is a closed ticket.
   - Post an envelope comment on the issue summarizing what was merged (squash commit SHA, PR link, and pre-flight verification results).
   - If and only if explicit operator testing, decision, or input is required: attach **`attention/1-user`** (or `attention/2-user`). Never leave tickets sitting open in secondary states like `state/4-done`, `state/3-verify`, or `state/2-review` without `attention/1-user` — the operator only monitors `attention/user`.
## 5. Verify is non-binding

`state/3-verify` never means "blocked on human forever." If the operator doesn't test: close as superseded/done with rationale, requeue, or verify by proxy — and say so on the ticket. No mutual-wait deadlocks.

## 6. Operator Slash-Command Protocol (Issue Comments)

The operator signals with line-anchored `/`-commands in issue comments. Obey when present; never go looking.

### Recognition rules
- A command is a line whose first non-space character is `/`: `^/\w+` plus optional same-line args. Trailing punctuation (e.g. `/orchestrator.`) tolerated.
- Only commands authored by the operator handle apply; identical text from agents or others is ignored.
- Inline `/words` mid-sentence never trigger.
- Unknown `/words` are ignored (forward-compatible; Paseo-side slash commands never collide — those live in Paseo, not in Forgejo comments).
- Free-text bodies continue on following non-blank, non-command lines until a blank line or the next command.

### Deterministic lifecycle commands
- `/approve` — spec/checklist accepted (`spec/2-approved` or equivalent state advance).
- `/verify` or `/done` — work accepted pending check: run pre-flight, present for operator testing (`state/3-verify`).
- `/close` — operator confirms the deliverable (`confirmed-done`).
- `/hold` — stop and hand back to orchestrator (`attention/0-orchestrator`).
- `/rework <note>` — return to `state/1-wip` with the note as the steering directive.

### Free-text routing commands (orchestrator interprets, may route)
- `/instruction <text>` — free-text directive to the orchestrator to prioritize, shape, or steer; it coordinates or dispatches to a worker (never permission for the orchestrator to write code).
- `/orchestrator <text>` — explicit override: orchestrator manages the ticket directly without sub-delegating coordination; implementation is still dispatched to a worker in a worktree.
- `/agent <text>` — explicit override: forward verbatim as steering to the active worker on that issue.

An explicit `/orchestrator` directive is actionable even when its free-text is
informal or terse. Treat phrases such as `/orchestrator holler` as a request
to immediately inspect the complete ticket and latest workspace/agent state,
then report the relevant finding or blocker; do not classify the message as a
routine webhook or dismiss it because it lacks a conventional command verb.

## 7. Attention Contract (Agreed Operating Rules)

- The operator only touches `attention/*`. Nothing else is a signal.
- `attention/0-orchestrator` means "you own it, don't let it sit": handle the deliverable, delegate, or — if the next step is unclear — flip to `attention/2-user` with a one-line question. An issue must never rest on `0-orchestrator`.
- Anything needing operator eyes (approval, verify, decision, question) MUST carry `attention/2-user` — otherwise it is invisible.
- Tree conflicts keep gating dispatch: no worker enters a checkout the operator is hands-on in. Queue, don't collide.
- Pre-flight stands: never present unverified work for operator testing.
- Verify is non-binding: resolve unilaterally with narration rather than park in mutual wait.

## 8. Presentation: clickable issue references

- Every issue number in chat responses and issue comments MUST be a clickable Markdown link to `https://forge.example.com/owner/repo/issues/<n>` (e.g. [#98](https://forge.example.com/owner/repo/issues/98)). Never emit a bare `#nnn`.

## 9. Forgejo labels: comma-splitting and label normalization

> [!IMPORTANT]
> **Taxonomy migration (dual-read, platform#247 / paseo#1007)**: the board is moving to the
> numberless label taxonomy. Both spellings mean the same thing during the transition —
> accept either when reading, and prefer the numberless form when writing.
> `state/0-triage`=`state/triage`, `state/1-wip`=`state/wip`, `state/2-review`=`state/review`,
> `state/3-verify`=`state/verify`, `state/4-done`=`state/done`,
> `attention/0-orchestrator`=`attention/orchestrator`, `attention/1-agent`=`attention/agent`,
> `attention/2-user`=`attention/user`, `priority/0-SOS`=`priority/sos`,
> `priority/1-high`=`priority/high`, `priority/2-normal`=`priority/normal`,
> `priority/3-low`=`priority/low`, `priority/4-backburner`=`priority/backburner`,
> `spec/0-needed`=`spec/needed`, `spec/1-checklist`=`spec/checklist`,
> `spec/2-approved`=`spec/approved`, `review/0-needed`=`review/needed`,
> `review/1-changes-requested`=`review/changes-requested`, `review/2-approved`=`review/approved`.
> Never delete a numeric label that is still referenced by an in-flight ticket.

- **Comma-separated labels are supported** by `teax`:
  `--add-label 'kind/bug,priority/2-normal'` adds both labels. Repeated flags
  (`--add-label 'a' --add-label 'b'`) work too and remain the safest form.
- **`teax` normalizes label flags before delegating**: it strips the label
  flags from the argument list, aggregates them across repeated and
  comma-separated occurrences, and re-emits a single comma-separated call to
  the underlying client. Both `teax issue create` and `teax issue edit
  --add-label` go through this normalization.
- **On `issue create`, use `-L` or `--label` — never `-l`.** `-l` is `teax`'s
  `--login` alias, so `-l 'a,b'` is consumed as a login name and the labels
  are silently dropped. `--add-label` also works on create and is the least
  ambiguous spelling.
- **Never invoke the underlying Forgejo/Gitea client directly for label work.**
  It is not on `$PATH` for agents, and bypassing `teax` skips the label
  normalization, the label-aware list output, and the envelope stamping.
- Always read back with `teax issue view` and confirm the label set changed.

## 10. Comment & chat budget (keep the board readable)

- Issue comments and pre-flight/presentation posts: **one screen (~15 lines)**. Summary first — what changed, commit SHA, test result, what's left.
- Analysis, checklists, and design detail go in the issue **body** or a linked child issue, not a comment.
- Never paste diffs, full test logs, or restate code/refs already in the body.
- One comment per handoff; no per-step play-by-step narration.
- Chat: one line pointing at the ticket; never duplicate the substance.
- Comment length is not a status signal. A short, complete comment beats a long one.

### Tooling: `teax` is the only Forgejo CLI
- **`teax` is the single, authoritative Forgejo CLI for agent board work.** Every example in this skill uses it, and it is the tool for every issue, PR, label, and comment operation.
- **There is no second board tool.** Do not look for an alternative wrapper, and never invoke the underlying Forgejo/Gitea client directly — it is not on `$PATH` for agents and lacks envelope stamping, label normalization, and the label-aware list output.

### Channel Hygiene & Human-Visible Markdown Invariant
- **Issue and PR Comments Are Strictly for Humans**:
  - All comments on Forgejo, GitHub, or any issue/PR tracker MUST be formatted in clean, human-readable Markdown.
  - **Zero Wire Protocol Envelopes in Comments**: NEVER emit `<x-comms-message>`, `<x-comms>`, raw XML tags, or raw JSON RPC payloads into issue or PR comments. Wire protocols belong strictly on network/socket RPC transports.
  - Metadata envelopes on Forgejo/GitHub are generated automatically by `teax --envelope`, which embeds a hidden HTML comment (`<!-- envelope:v1 ... -->`). Never hand-craft or fake wire envelopes in comment bodies.
- **Local vs Remote Agent Communication**:
  - Agents on the local daemon are contacted directly via `paseo send --steer --no-wait <agentId> "<message>"` (plain text) or native MCP `send_agent_prompt`.
  - Do NOT use `x_comms_*` tools for local agents residing on the same machine/daemon. `x_comms_*` is strictly for cross-daemon/remote fleet hosts.

## 11. Composer silence & webhook discipline (keep quiet)

- **The composer window is unattended**: Nobody is sitting there reading the chat/composer feed. Do not treat the chat harness as a conversational surface or log stream.
- **Handling incoming webhooks (`🔔 Forgejo webhook incoming ...`)**:
  - Act entirely on the Forgejo board and in the workspace: check tickets, adjust labels, post self-stamped envelope comments, or dispatch workers.
  - **Remain silent in chat**: Never emit status play-by-play, conversational acknowledgments ("Webhook received", "Standing by", "Orchestrator ready"), or conversational filler into the composer window. Complete webhook turns quietly with zero or strictly minimal output.
  - The board is the source of truth. All visible communication belongs on the Forgejo issue comments, not in transient chat.
- **Direct operator prompts only**: Respond in chat only when the human operator explicitly addresses the agent directly with an interactive instruction or question. Even then, adhere to the budget in §10 (terse, one-line ticket pointer when possible).

## 12. Periodic board sweeps (proactive polling)

- **Do not wait passively for webhooks**: Webhooks can fail, lag, or miss state changes. The Orchestrator proactively sweeps the board (`teax issue list`, `teax pr list`) periodically to maintain momentum.
- **Sweep Precedence Checklist**:
  1. **Review & Merge Open PRs (`state/2-review`, `review/0-needed`)**: Run pre-flight audits, merge passing PRs into `main`, and teardown worktrees immediately before picking up new work.
  2. **Unblock Stalled Tickets (`dep/blocked`)**: Remove `dep/blocked` and queue when dependencies land.
  3. **Triage & Dispatch (`attention/0-orchestrator`, `state/0-triage`)**: Shape checklist and dispatch worker into an isolated worktree. Never let an issue park on `0-orchestrator`.
- Perform all sweep actions quietly on the Forgejo board without narrating the audit into the chat composer.

### Pre-Creation Dedup Search (MANDATORY before `teax issue create`)

- **Never file blind**: Before every `teax issue create` — whether from a steering call, a webhook, or your own triage — search the board first and **adopt or update** the match:
  ```bash
  teax issue list -R <repo> --hostname forge.example.com --state all --json
  ```
  `-s/--state` accepts `open|closed|all`; always pass `--state all` so a recently closed ticket is still found, and use `teax issue view <n>` to read a candidate in full (body + labels + comments) before judging the match.
- **Use the JSON form, never the human-readable table**: the table truncates the LABELS column, so any label-based audit run against it produces **false negatives** — it can report zero tickets on a label that is in fact present. Label-driven reasoning requires `--json` (or a per-issue `teax issue view <n>`).
- **Match → adopt**: if an open issue covers the same defect or deliverable, do not create a second one — claim it, apply the correct labels, and dispatch a worker against it. If a recently closed issue covers it, reopen/update it rather than filing a near-duplicate, and say on the ticket why you reopened it.
- **Judge on substance, not title**: a duplicate differs by ticket number, not by wording. Two tickets that would be fixed by the same commit are duplicates.
- **Link, do not silently merge**: if you deliberately file a follow-up, cross-link the parent issue in the new ticket's body so the board records the relationship.

### Board Prioritization & Intelligence Model

Board ranking, triage, and dispatch are the Orchestrator's responsibility (workers never scan or self-claim). Evaluate the board using a two-step approach:

1. **Deterministic Baseline (`forgejo-issues-check`)**:
   - Run `scripts/forgejo-issues-check` to get the ranked list of unblocked, prioritized candidates. The script ranks open issues by `(tier, urgency, effort, age)` and returns actionable candidates; use `--role orchestrator` when sweeping for dispatch.
   - Respect the script's output ordering as the operational baseline.

2. **Agent Reasoning & Contextual Augmentation**:
   - **Do NOT blind-trust a "0 items" return from the script**: Deterministic checks evaluate labels and comment deltas, but cannot infer unstated context or emergent priorities.
   - When the script returns 0 items or when higher-level user directives take precedence, apply agent reasoning:
     - Check discussions (`kind/discussion`) with operator guidance to shape into actionable specifications (`spec/0-needed` → `spec/1-checklist`).
     - Check tickets unblocked by recent commits or sibling issues (`dep/blocked`).
     - Advance tickets blocked on clarifying questions.
   - A comment containing `/orchestrator <text>` is a direct routing signal
     to the Orchestrator. Even terse free text such as `/orchestrator holler`
     must be surfaced and handled as an instruction, not treated as routine
     webhook noise (see §6 for free-text routing commands).

## 13. Front Desk escalation protocol (attention to user)

> [!IMPORTANT]
> **Gentle (`--steer`) Escalation Mandatory**:
> When communicating with Front Desk, orchestrators MUST always include `--steer` (i.e. `paseo send --steer --no-wait ...`). Passing `--steer` queues the escalation message smoothly into the agent's active turn queue without aborting or preempting active user conversations. Omitting `--steer` defaults to `activeTurnBehavior: "interrupt"` which clobbers Front Desk mid-turn.


- **The Front Desk agent is the operator interface**: The human operator works directly through the Front Desk agent. Orchestrators do not talk into their own composer window. Front Desk never spawns workers — it steers orchestrators; orchestrators dispatch workers (two-tier spawn authority, [#172](https://forge.example.com/owner/repo/issues/172)).
- **Escalating when operator input is required (`attention/2-user`)**:
  1. Determine the Front Desk agent ID and verify registration liveness via `scripts/frontdesk-info`:
     ```bash
     scripts/frontdesk-info --json | jq -r '{live: .identity.liveFrontDeskId, discrepancy: .identity.discrepancy}'
     ```
     Use `.identity.liveFrontDeskId` (not `registeredFrontDeskId`) for the escalation target, since `liveFrontDeskId` is the id that can actually receive a `paseo send`. When the registry is healthy, `liveFrontDeskId == registeredFrontDeskId`.
     Check `.identity.discrepancy`: if non-null, surface it prominently rather than proceeding silently. A mismatch means the registration is broken and someone should know before, not after, a failed send.
     Do not inspect `frontdesk.json` or `settings.json` directly on disk.
  2. If a live Front Desk exists (`liveFrontDeskId` is non-null), dispatch the escalation:
     ```bash
     paseo send --steer --no-wait <liveFrontDeskId> "Issue https://forge.example.com/<repo>/issues/<n> needs operator attention: <concise question/action required>"
     ```
  3. Post the detailed context, pre-flight audit, or options on the Forgejo issue using `teax issue comment --envelope`.
  4. Keep your own composer window quiet.

### Multi-Channel Front Desk Routing & Deduplicated Relay Protocol
- **Direct Hook Routing (`attention/frontdesk` & `/frontdesk` comments)**:
  - Handled directly by `scripts/forgejo-hook.mjs`: incoming events with `attention/frontdesk` or comments starting with `/frontdesk` bypass the orchestrator and deliver straight to Front Desk over `paseo send`.
  - The repo orchestrator is completely filtered/suppressed from receiving these direct dispatches to avoid duplicate wakes.
- **Orchestrator Relay Fallback (Only when Direct Hook Did Not Fire)**:
  - If the operator mentions or petitions Front Desk in an issue comment without the `attention/frontdesk` label or `/frontdesk` prefix, the local repo orchestrator catches it during board sweeps and sends a relay:
    ```bash
    paseo send --steer --no-wait <frontDeskId> "Heads up: operator requested Front Desk intervention on https://forge.example.com/<repo>/issues/<n>"
    ```
  - **Deduplication guard**: If `attention/frontdesk` was already handled by the hook daemon, the orchestrator MUST NOT fire a redundant relay.
## 14. Workspace Tooling

Tooling configuration is supplied by the active runtime environment. This skill does not inject MCP servers or write tool configuration into worker workspaces.

  1. Worker tooling is provided by the active runtime environment.
  2. Do not inject MCP configuration or create agent-tool files in the workspace.

## 15. Lifecycle Cadence & Handover

Rotation timing and thresholds are runtime/operator policy, not hardcoded in this skill. The Orchestrator may hand over when directed by the operator, when active runtime signals require it, or when the current session can no longer safely continue.

**Pre‑flight Hand‑over Checklist**
1. **Persist state** – the router now builds the rotation brief for you from the board, pending attention, queue depth, and the last hook/sweep digests; the replacement re-reads this skill file and the brief. Trigger it with the operator slash-command, the Cockpit action, MCP `fleet_rotate_role`, or `POST /orchestrator-rotate` (`{role:"orchestrator", repo, reason?}`).
2. **Sync issue board** – ensure every issue the agent touches has an up‑to‑date label reflecting its latest state (`state/*`, `attention/*`).
3. **Validate worktrees** – confirm no stray git changes in any worktree (`git status --porcelain` empty) and that all workers are either finished or paused.
4. **Let the router archive the old session** – `rotateRole` spawns and verifies the replacement first, then archives the incumbent, so the repo never has zero orchestrators.
5. **Register fresh session** – the router re-registers the replacement with role `orchestrator` and its skill path before the incumbent is retired.
6. **Post hand‑over note** – the replacement receives the rotation brief steered into its session; add an envelope comment on each affected issue if the reason was operator-driven.

**Safe Decommission Procedure**
- Do not delete agent registry files, worktrees, or branches with raw filesystem or Git commands as part of handover.
- Let Paseo own session archival and workspace lifecycle; retain the issue and PR audit trail in Forgejo.

These steps ensure a deterministic, zero‑downtime transition while preserving full auditability.
