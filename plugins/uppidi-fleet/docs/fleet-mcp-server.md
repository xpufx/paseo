# `fleet-mcp-server`: tool reference, safety guards, and registration

Status: implemented. The standalone stdio server
(`plugins/uppidi-fleet/bin/fleet-mcp-server.mjs`) and the 33 tool
implementations in `plugins/uppidi-fleet/server/mcp.ts` are live and
exercised end-to-end by `plugins/uppidi-fleet/test/fleet-mcp-server.test.mjs`.

The per-class injection of this server into autonomously spawned agents is
designed in [`docs/mcp-agent-injection.md`](../../../docs/mcp-agent-injection.md);
the registration contract is documented in
[Registration in `AgentSessionConfig.mcpServers`](#registration-in-agentsessionconfigmcpservers)
below. The hook is not yet wired into `index.server.ts`; until it is, the server
is reachable directly (stdio) and through the plugin RPC contracts
(`uppidiFleetToolListContract` / `uppidiFleetToolExecuteContract`).

---

## 1. Transport and protocol

| Property | Value |
| --- | --- |
| Transport | stdio — newline-delimited JSON, one JSON-RPC 2.0 message per line |
| Entrypoint | `node plugins/uppidi-fleet/bin/fleet-mcp-server.mjs` |
| Protocol version | `2024-11-05` |
| Server name / version | `uppidi-fleet` / `0.1.0` |
| Capabilities | `{ tools: {} }` |
| Methods | `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call` |

Every response is `{"jsonrpc":"2.0","id":<id>,"result":…}` or
`{"jsonrpc":"2.0","id":<id|null>,"error":{"code":…,"message":…}}`.

| Error | Code | Trigger |
| --- | --- | --- |
| Parse error | `-32700` | a line starting with `{` that is not valid JSON; `id` is `null` |
| Invalid params | `-32602` | `tools/call` without a string `params.name` |
| Method not found | `-32601` | any other method with a non-null `id` |
| Tool failure | n/a | `tools/call` returns `result.isError: true` with a text explanation — never a JSON-RPC fault |

Tool dispatch failures are deliberately data, not protocol faults: an
unreachable daemon, an unconfirmed purge, or a bad role is reported inside
`content[0].text` with `isError: true` so the calling model can read and react
to it.

### 1.1 Handshake

```jsonc
// → initialize
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"agent","version":"1.0.0"}}}
// ← result
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"uppidi-fleet","version":"0.1.0"},"instructions":"…"}}
// → notification (no response)
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
```

### 1.2 Call a tool

```jsonc
// → tools/call
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fleet_check_board","arguments":{"repo":"xpufx-org/paseo","dryRun":true,"json":true}}}
// ← result
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"…"}],"isError":false}}
```

---

## 2. Tool catalog

The catalog contains 33 tools in four groups:

- **Fleet management** (22): `fleet_*` — board triage, watchdog health, queues,
  role rotation, orchestrator provisioning, workspace validation, dead-session
  pruning, status, control mode, repositories, playbook stages, audit receipts.
- **Tickets** (5): `ticket_*` — list/view/create/comment/edit Forgejo issues.
- **Pull requests** (5): `pr_*` — list/view/create/diff/merge pull requests.
- **CI** (1): `ci_logs` — retrieve Forgejo action run status and step logs.

All arguments are optional unless the tool lists a `required` entry in its
schema. Fleet tools additionally accept `json?: boolean` (default `false`);
markdown is the default rendering and `json: true` returns a machine-readable
payload in the same `content[0].text` string. Ticket, PR, and CI tools always
return a JSON payload in `content[0].text`.

| Tool | Group | Required | Mutates |
| --- | --- | --- | --- |
| `fleet_check_board` | Fleet | — | only when `dryRun: false` |
| `fleet_watchdog_audit` | Fleet | — | only when `recover: true` |
| `fleet_board_sweep` | Fleet | — | stale-WIP recovery unless dry |
| `fleet_prune_orchestrators` | Fleet | — | deletes registrations unless `dryRun: true` |
| `fleet_queue_inspect` | Fleet | — | no |
| `fleet_queue_purge` | Fleet | `repo`, `confirm` | deletes a queue file |
| `fleet_handoff_generate` | Fleet | — | writes `latest-handoff.md` |
| `fleet_rotate_role` | Fleet | — | spawns/archives agents |
| `fleet_ensure_orchestrator` | Fleet | `repo` | spawns/registers an agent |
| `fleet_validate_workspace` | Fleet | one of `path`/`workspaceId` | no (pure git inspection) |
| `fleet_prune_dead_sessions` | Fleet | — | kills/prunes only when `apply`/`kill` |
| `fleet_status_get` | Fleet | — | no |
| `fleet_queue_pause` | Fleet | — | pauses queue delivery |
| `fleet_queue_resume` | Fleet | — | resumes queue delivery |
| `fleet_queue_drain` | Fleet | `key` | triggers a drain |
| `fleet_control_mode` | Fleet | `mode` | sets fleet control mode |
| `fleet_repos_list` | Fleet | — | no |
| `fleet_stage_evaluate` | Fleet | `repo`, `issue`, `targetStage`, `actor` | no |
| `fleet_stage_transition` | Fleet | `repo`, `issue`, `targetStage`, `actor` | applies labels when allowed |
| `fleet_audit_record` | Fleet | `repo`, `pr`, `headCommit`, `verdict`, `summary` | appends audit receipt |
| `fleet_audit_check` | Fleet | `repo`, `pr`, `commit` | no |
| `fleet_audit_summary` | Fleet | — | no |
| `ticket_list` | Ticket | — | no |
| `ticket_view` | Ticket | `issueNumber` (or `number`) | no |
| `ticket_create` | Ticket | `title` | creates an issue |
| `ticket_comment` | Ticket | `body` (+ issue) | posts a comment |
| `ticket_edit` | Ticket | `label` (+ issue) | updates labels |
| `pr_list` | PR | — | no |
| `pr_view` | PR | `pullRequestNumber` (or `number`) | no |
| `pr_create` | PR | `title`, `headBranch`, `baseBranch` | creates a PR |
| `pr_diff` | PR | `pullRequestNumber` (or `number`) | no |
| `pr_merge` | PR | `pullRequestNumber` (or `number`) | merges a PR |
| `ci_logs` | CI | `runId` | no |

### Fleet management tools

#### `fleet_check_board`

Deterministic Forgejo board check and triage ranking. Scans open issues, sweeps
stale WIP, and returns ranked candidates.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `repo` | string | `xpufx/paseo-plugin-helper` | `owner/repo` |
| `hostname` | string | `forge.mrs.uppidi.com` | Forgejo host |
| `role` | enum | `orchestrator` | `orchestrator` \| `coding-agent` \| `worker` \| `coding_worker` |
| `force` | boolean | `false` | re-report candidates whose cache signature is unchanged |
| `all` | boolean | `false` | report every open issue without filtering |
| `staleWipHours` | number | `2.0` | non-negative; stale-WIP threshold |
| `sweepStaleWip` | boolean | `true` | sweep and recover stale WIP issues |
| `dryRun` | boolean | `false` | calculate triage without mutating labels |
| `json` | boolean | `false` | JSON instead of markdown |
| `stage` | string | — | canonical playbook stage filter (e.g. `stage/spec`) |
| `profile` | string | — | playbook profile name (e.g. `Light`, `Medium`) |
| `trace` | boolean | `false` | include per-issue decision traces |
| `diagnosticComment` | boolean | `false` | post decision breakdown comments to issues |

Guards: invalid `role` → `Invalid role "…"`. Negative `staleWipHours` →
`staleWipHours must be a non-negative number`.

#### `fleet_watchdog_audit`

Fleet agent health audit (turn locks, zombie turns, permission requests,
queues) with optional auto-recovery.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `recover` | boolean | `false` | run the conservative recovery pipeline |
| `frontDeskId` | string | — | Front Desk agent id to notify |
| `steerMessage` | string | — | wake message used while steering recovered agents |
| `cancellationRecencySeconds` | number | `300` | cancellation-timeout recency bound |
| `runningStaleSeconds` | number | `900` | inactivity before a running turn is a zombie |
| `assumePendingWork` | boolean | `false` | also treat finished idle agents as stalled |
| `repetitiveToolLoopThreshold` | number | — | repetitive tool-loop threshold before flagging |
| `childWakeups` | boolean | — | audit child wakeup cascades and stall detection |
| `json` | boolean | `false` | JSON instead of markdown |

#### `fleet_board_sweep`

Sweep all enrolled repositories (or the `repos` you name).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `repos` | string | all enrolled | comma-delimited `owner/repo` slugs, or a repeated value |
| `json` | boolean | `false` | JSON instead of markdown |
| `stage` | string | — | canonical playbook stage filter |
| `profile` | string | — | playbook profile name |
| `trace` | boolean | `false` | include per-issue decision traces |
| `diagnosticComment` | boolean | `false` | post decision breakdown comments to issues |

#### `fleet_prune_orchestrators`

Audit registered orchestrators against the live daemon roster and prune dead
records.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `dryRun` | boolean | `false` | report without deleting |
| `graceSweeps` | number | `3` | consecutive closed sweeps before pruning |
| `json` | boolean | `false` | JSON instead of markdown |

Guard: unreachable daemon → `{ ok: false, error: "daemon unreachable" }` with
`isError: true`.

#### `fleet_queue_inspect`

Inspect buffered webhook payloads and queue status.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `repo` | string | all queues | filter by slug (`owner/repo` or `frontdesk`) |
| `json` | boolean | `false` | JSON instead of markdown |

#### `fleet_queue_purge`

Drop stuck/poisoned webhook payloads for one repository queue without
filesystem surgery.

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `repo` | string | **yes** | target slug |
| `confirm` | boolean | **yes** | must be explicitly `true`; otherwise aborted |
| `json` | boolean | no | JSON instead of markdown |

Safety: missing `repo` → `Error: repo parameter is required`; `confirm` not
`true` → `Purge aborted: confirm must be set to true …`. Neither path deletes
a file.

#### `fleet_handoff_generate`

Write `latest-handoff.md` (active assignments, open PRs, blocking state).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `json` | boolean | `false` | JSON instead of markdown |

Markdown returns the report body directly. JSON payload: `{ ok, report }`.

#### `fleet_rotate_role`

Rotate a long-lived fleet role onto a fresh agent (spawn → verify → brief →
archive incumbent).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `role` | enum | `orchestrator` | `orchestrator` \| `front-desk` \| `auditor` \| `coding-agent` |
| `repo` | string | — | required for orchestrator rotation |
| `reason` | string | — | recorded in the rotation brief |
| `force` | boolean | `true` | bypass cooldowns and activity thresholds |
| `json` | boolean | `false` | JSON instead of markdown |

Guard: requires a live hook router; otherwise returns
`fleet_rotate_role failed: hook router is not running` with `isError: true`.

#### `fleet_ensure_orchestrator`

Ensure an active orchestrator exists for a repository (idempotent).

| Param | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `repo` | string | **yes** | — | `owner/repo` or key |
| `mode` | string | no | `yolo` | resolved against the provider's advertised modes |
| `provider` | string | no | policy/default | provider override |
| `model` | string | no | policy/default | model override |
| `force` | boolean | no | `false` | spawn even if one is active |
| `json` | boolean | no | `false` | JSON instead of markdown |

Guard: missing `repo` → `repo is required`. Without a daemon/workspace fails
closed: `fleet_ensure_orchestrator failed: No workspace found for repository
"…"`.

#### `fleet_validate_workspace`

Worktree-only dispatch validator (#918). Call before dispatching a coding agent.

| Param | Type | Notes |
| --- | --- | --- |
| `path` | string | absolute workspace path to validate |
| `workspaceId` | string | resolve the path from the daemon registry instead |
| `json` | boolean | JSON instead of markdown |

Guard: missing both → `path or workspaceId is required`. A refusal is hard:
`isError: true`, JSON payload `{ ok: false, path, workspaceId, reason, error }`
naming the corrective provisioning action. A path that is not a git checkout
abstains (allowed).

#### `fleet_prune_dead_sessions`

Prune dead fleet sessions using the 5-predicate health-canary verdict
(orphaned disk records, terminal fatal errors, wedged running turns,
registry-orphan processes, superseded retries).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `dryRun` | boolean | `true` | report without mutating state |
| `apply` | boolean | `false` | de-register dead agents from fleet registries |
| `kill` | boolean | `false` | kill dead agents via paseo (requires `apply`) |
| `json` | boolean | `false` | JSON instead of markdown |

Guard: `kill` without `apply` → `kill requires apply=true to also
de-register from fleet registries`.

#### `fleet_status_get`

Query HookRouter operational status overview (mode, front desk, queues,
totalQueued, capabilities).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `json` | boolean | `false` | JSON instead of markdown |

#### `fleet_queue_pause`

Pause webhook delivery for a specific repository queue or all queues.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `key` | string | `all` | target slug or queue key to pause |
| `repo` | string | — | alias for `key` |
| `json` | boolean | `false` | JSON instead of markdown |

#### `fleet_queue_resume`

Resume webhook delivery for a specific repository queue or all queues.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `key` | string | `all` | target slug or queue key to resume |
| `repo` | string | — | alias for `key` |
| `json` | boolean | `false` | JSON instead of markdown |

#### `fleet_queue_drain`

Trigger immediate webhook queue drain for a repository queue.

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `key` | string | **yes** | target slug or queue key to drain |
| `repo` | string | no | alias for `key` |
| `json` | boolean | no | JSON instead of markdown |

Guard: missing `key` → `Error: key parameter is required for queue drain`.

#### `fleet_control_mode`

Set fleet control mode (RUN, DRAIN, HALT, STOP) per unified fleet control
doctrine (#1034).

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `mode` | enum | **yes** | `RUN` \| `DRAIN` \| `HALT` \| `STOP` |
| `json` | boolean | no | JSON instead of markdown |

Guard: invalid mode → `Invalid mode "…". Must be one of: RUN, DRAIN, HALT, STOP`.

#### `fleet_repos_list`

List enrolled repositories with automation tier status (full-active, paused,
kanban-only).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `json` | boolean | `false` | JSON instead of markdown |

#### `fleet_stage_evaluate`

Evaluate playbook stage transition rules, preconditions, and human gates for an
issue before attempting transition (#1404).

| Param | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `repo` | string | **yes** | — | `owner/repo` |
| `issue` | number | **yes** | — | positive integer |
| `targetStage` | string | **yes** | — | canonical stage (e.g. `stage/spec`, `stage/code`, `stage/review`, `stage/verify`, `stage/done`) |
| `toStage` | string | no | — | alias for `targetStage` |
| `fromStage` | string | no | — | source stage if known |
| `actor` | string | **yes** | — | agent id or operator username |
| `profile` | string | no | `Medium` | playbook profile name |
| `prNumber` | number | no | — | associated PR number |
| `headCommit` | string | no | — | head commit SHA of the PR |
| `json` | boolean | no | `false` | JSON instead of markdown |

Guards: missing `repo` → `Error: repo parameter is required`;
non-positive `issue` → `Error: issue parameter must be a positive integer`;
missing `targetStage` → `Error: targetStage parameter is required`; unknown stage
→ `Error: "…" is not a canonical playbook stage`; missing `actor` →
`Error: actor parameter is required`.

#### `fleet_stage_transition`

Execute stage transition guard and apply labels for an issue (#1404).

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `repo` | string | **yes** | `owner/repo` |
| `issue` | number | **yes** | positive integer |
| `targetStage` | string | **yes** | canonical target stage |
| `toStage` | string | no | alias for `targetStage` |
| `fromStage` | string | no | source stage if known |
| `actor` | string | **yes** | agent id or operator username |
| `prNumber` | number | no | associated PR number |
| `headCommit` | string | no | head commit SHA of the PR |
| `json` | boolean | no | JSON instead of markdown |

Same guards as `fleet_stage_evaluate`.

#### `fleet_audit_record`

Append signed audit receipt to the durable JSONL log (Platform #348).

| Param | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `repo` | string | **yes** | — | `owner/repo` |
| `pr` | number | **yes** | — | PR number |
| `issue` | number | no | — | associated issue number |
| `headCommit` | string | **yes** | — | head commit SHA audited |
| `verdict` | enum | **yes** | — | `approved` \| `changes_requested` \| `rejected_duplicate` \| `rejected_spec_flaw` \| `adhoc_bypass` |
| `summary` | string | **yes** | — | auditor evaluation summary |
| `auditorAgentId` | string | no | `auditor` | auditor agent id |
| `auditorRole` | enum | no | `reviewer` | `orchestrator` \| `reviewer` \| `operator` |
| `auditorModel` | string | no | `unknown` | auditor model name |
| `authorAgentId` | string | no | — | author agent id |
| `authorRole` | enum | no | `worker` | `coding-agent` \| `worker` \| `orchestrator` \| `operator` |
| `authorModel` | string | no | — | author model name |
| `iteration` | number | no | `1` | review iteration |
| `taxonomy` | string[] | no | `[]` | defect taxonomy tags |
| `workerClaimed` | enum | no | `passed` | `passed` \| `failed` \| `unverified` |
| `auditorVerified` | enum | no | `passed` | `passed` \| `failed` \| `skipped` |
| `checksRun` | string[] | no | `[]` | verification checks executed |
| `isolatedEnv` | boolean | no | `true` | verification ran in isolated environment |
| `json` | boolean | no | `false` | JSON instead of markdown |

Guards: missing `repo` → `Error: repo parameter is required`; non-positive `pr`
→ `Error: pr parameter must be a positive integer`; missing `headCommit` →
`Error: headCommit parameter is required`; invalid `verdict` →
`Error: verdict must be one of: …`; missing `summary` →
`Error: summary parameter is required`.

#### `fleet_audit_check`

Query audit receipt validity for a repository PR and commit (Platform #348).

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `repo` | string | **yes** | target repository slug |
| `pr` | number | **yes** | PR number (positive integer) |
| `commit` | string | **yes** | commit SHA to verify |
| `json` | boolean | no | JSON instead of markdown |

Guards: missing `repo` → `Error: repo parameter is required`; non-positive `pr`
→ `Error: pr parameter must be a positive integer`; missing `commit` →
`Error: commit parameter is required`.

#### `fleet_audit_summary`

Project audit summary metrics across repositories (compliance rate,
first-pass rate, taxonomy breakdown, model scorecard) (Platform #348).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `repo` | string | — | filter by repository slug |
| `since` | string | — | ISO timestamp lower bound |
| `json` | boolean | `false` | JSON instead of markdown |

### Ticket tools

Ticket tools are backed by `@xpufx/backend-tickets` and operate on the
configured Forgejo repository (derived from `directory` or `remoteUrl` when
provided). They always return a JSON payload.

#### `ticket_list`

List open forge issues for the configured repository with pagination.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `directory` | string | — | local workspace/repo path to derive forge context |
| `remoteUrl` | string | — | explicit git remote URL |
| `page` | number | `1` | page number for pagination |

#### `ticket_view`

Fetch full details including body, comments, and parsed agent envelopes for a
single issue.

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `issueNumber` | number | **yes** (or `number`) | target issue number |
| `number` | number | alias | alias for `issueNumber` |
| `directory` | string | no | local workspace/repo path |
| `remoteUrl` | string | no | explicit git remote URL |

Guard: missing/invalid → `issueNumber is required and must be a positive
integer`.

#### `ticket_create`

Create a new issue on the configured forge repository.

| Param | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `title` | string | **yes** | — | title (1–200 characters) |
| `body` | string | no | `""` | markdown body |
| `labels` | string[] | no | — | initial labels |
| `directory` | string | no | — | local workspace/repo path |
| `remoteUrl` | string | no | — | explicit git remote URL |

Guard: missing title → `title is required and cannot be empty`.

#### `ticket_comment`

Post a comment or steering note to an existing issue thread.

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `issueNumber` | number | **yes** (or `number`) | target issue number |
| `number` | number | alias | alias for `issueNumber` |
| `body` | string | **yes** | markdown comment text |
| `directory` | string | no | local workspace/repo path |
| `remoteUrl` | string | no | explicit git remote URL |

Guards: missing/invalid issue → `issueNumber is required and must be a positive
integer`; missing body → `body is required and cannot be empty`.

#### `ticket_edit`

Update an issue's labels (applies one scoped label, evicting peers in the same
exclusive scope).

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `issueNumber` | number | **yes** (or `number`) | target issue number |
| `number` | number | alias | alias for `issueNumber` |
| `label` | string | **yes** | scoped label (e.g. `state/wip`, `review/needed`) |
| `directory` | string | no | local workspace/repo path |
| `remoteUrl` | string | no | explicit git remote URL |

Guards: missing/invalid issue → `issueNumber is required and must be a positive
integer`; missing label → `label is required and cannot be empty`.

### Pull request tools

PR tools are backed by `@xpufx/backend-tickets` and operate on the configured
repository. They always return a JSON payload.

#### `pr_list`

Query open, closed, or merged pull requests with filtering.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `state` | enum | `open` | `open` \| `closed` \| `merged` |
| `author` | string | — | filter by PR author username |
| `branch` | string | — | filter by head branch name |
| `page` | number | `1` | page number |
| `directory` | string | — | local workspace/repo path |
| `remoteUrl` | string | — | explicit git remote URL |

#### `pr_view`

Retrieve pull request metadata, review comments, mergeability status, and
head/base branches.

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `pullRequestNumber` | number | **yes** (or `number`) | target PR number |
| `number` | number | alias | alias for `pullRequestNumber` |
| `directory` | string | no | local workspace/repo path |
| `remoteUrl` | string | no | explicit git remote URL |

Guard: missing/invalid → `pullRequestNumber is required and must be a positive
integer`.

#### `pr_create`

Open a new pull request specifying title, body, head branch, and base branch.

| Param | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `title` | string | **yes** | — | PR title |
| `headBranch` | string | **yes** | — | head branch with changes |
| `baseBranch` | string | **yes** | — | target base branch (default `main` per schema) |
| `body` | string | no | `""` | markdown PR description |
| `draft` | boolean | no | `false` | create as draft |
| `directory` | string | no | — | local workspace/repo path |
| `remoteUrl` | string | no | — | explicit git remote URL |

Guards: missing title → `title is required and cannot be empty`; missing
`headBranch` → `headBranch is required and cannot be empty`; missing
`baseBranch` → `baseBranch is required and cannot be empty`.

#### `pr_diff`

Fetch raw patch/diff of a pull request for pre-flight diff auditing.

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `pullRequestNumber` | number | **yes** (or `number`) | target PR number |
| `number` | number | alias | alias for `pullRequestNumber` |
| `directory` | string | no | local workspace/repo path |
| `remoteUrl` | string | no | explicit git remote URL |

Guard: missing/invalid → `pullRequestNumber is required and must be a positive
integer`.

#### `pr_merge`

Execute squash merge on approved pull requests.

| Param | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `pullRequestNumber` | number | **yes** (or `number`) | — | target PR number |
| `number` | number | alias | — | alias for `pullRequestNumber` |
| `title` | string | no | — | squash commit title |
| `commitMsg` | string | no | — | squash commit message body |
| `squash` | boolean | no | `true` | squash merge flag |
| `directory` | string | no | — | local workspace/repo path |
| `remoteUrl` | string | no | — | explicit git remote URL |

Guard: missing/invalid → `pullRequestNumber is required and must be a positive
integer`.

### CI tools

#### `ci_logs`

Retrieve and unpack Forgejo action run status and step logs for automated
debugging.

| Param | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `runId` | number | **yes** | — | Forgejo action run ID |
| `stepId` | number | no | — | optional step ID within the run |
| `page` | number | no | `1` | log page number |
| `directory` | string | no | — | local workspace/repo path |
| `remoteUrl` | string | no | — | explicit git remote URL |

Guard: missing/invalid → `runId is required and must be a positive integer`.

---

## 3. Invocation guidelines

- **Verify before you mutate.** Prefer `dryRun: true` on `fleet_check_board`,
  `fleet_prune_orchestrators`, `fleet_prune_dead_sessions`, and
  `fleet_board_sweep` until you have read the dry-run report.
- **Purge is two-step by design.** Never set `confirm: true` on
  `fleet_queue_purge` unless the stuck/poisoned queue was identified from a
  `fleet_queue_inspect` call.
- **`json: true` for machines, markdown for humans.** Use JSON when another tool
  or agent consumes the result; use markdown in an issue/PR comment. (Fleet
  tools only; ticket/PR/CI tools always return JSON.)
- **Respect the class matrix.** Workers only need `fleet_validate_workspace`;
  read-only triage roles get the board/watchdog/queue/handoff reads; only
  orchestrators get the mutating tools. See §5.
- **`fleet_rotate_role` and `fleet_ensure_orchestrator` are daemon operations.**
  They fail closed with a readable error when the router/daemon is unreachable;
  surface that error rather than retrying in a loop.
- **One tool, one call.** The server executes calls as they arrive; do not
  pipeline a purge behind an inspect you have not read.

---

## 4. Output and safety guard summary

| Guard | Tool(s) | Behaviour |
| --- | --- | --- |
| `json: true` | all 22 fleet tools | JSON payload instead of markdown in `content[0].text` |
| `dryRun: true` | `fleet_check_board`, `fleet_prune_orchestrators`, `fleet_prune_dead_sessions` | no board/registry mutation |
| `dryRun` (default false) | `fleet_board_sweep` | stale-WIP recovery only when not dry |
| `confirm: true` | `fleet_queue_purge` | required; otherwise aborts before any file I/O |
| `recover: false` (default) | `fleet_watchdog_audit` | audit only; no recovery actions |
| `apply`/`kill` opt-in | `fleet_prune_dead_sessions` | kill requires `apply=true` |
| Hard refusal | `fleet_validate_workspace` | primary-checkout / local-isolation dispatch is refused |
| Fail-closed daemon errors | `fleet_prune_orchestrators`, `fleet_ensure_orchestrator`, `fleet_rotate_role` | explicit `isError: true` text, never a silent success |
| Enum validation | `fleet_control_mode`, `fleet_stage_*`, `fleet_audit_record` | invalid enum → `isError: true` text |
| Required-arg validation | `ticket_*`, `pr_*`, `ci_logs`, `fleet_queue_*`, `fleet_stage_*`, `fleet_audit_*` | missing/invalid arg → `isError: true` text |

---

## 5. Registration in `AgentSessionConfig.mcpServers`

Paseo normalizes MCP servers once, in the daemon, from
`AgentSessionConfig.mcpServers` (`@getpaseo/protocol` `agent-types.d.ts`). The
fleet server is a **stdio** server, so it uses the `McpStdioServerConfig` arm:

```ts
interface McpStdioServerConfig {
  type: "stdio";
  command: string;              // "node"
  args?: string[];              // ["/abs/path/to/plugins/uppidi-fleet/bin/fleet-mcp-server.mjs"]
  env?: Record<string, string>;
  alwaysLoad?: boolean;         // Claude provider: never defer behind tool search
}
```

Canonical registration (server name `uppidi-fleet`, which satisfies the
`^[A-Za-z0-9_-]+$` constraint Pi and Gemini enforce):

```jsonc
{
  "mcpServers": {
    "uppidi-fleet": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/plugins/uppidi-fleet/bin/fleet-mcp-server.mjs"],
      "env": { "NODE_ENV": "production" }
    }
  }
}
```

### 5.1 Injection seam

The designed seam is the plugin lifecycle hook `server.before("agent.create")`
plus `registerMcpInjection` from `paseo-plugin-helper/server`, applied once
before config normalization so every provider maps the same canonical struct:

```ts
import { registerMcpInjection } from "paseo-plugin-helper/server";

registerMcpInjection(server, {
  serverName: "uppidi-fleet",
  config: { type: "stdio", command: "node", args: [stableServerPath] },
  filter: ({ request }) => classOf(request) === "orchestrator",
});
```

`registerMcpInjection` merges the server into `request.config.mcpServers` and
optionally appends `config.systemPrompt` instructions. The class is carried by
the `PASEO_FLEET_ROLE` env marker stamped by `spawnPaseoAgent` and stripped by
the hook (env is part of the hook contract; labels are not — see
`docs/mcp-agent-injection.md` §2.3, §3 Option A).

### 5.2 Class → tool matrix

Injected server set per autonomous agent class. `✅` = tool exposed, `—` = not
exposed. (Mutating tools are orchestrator-only; read-only triage tools are
shared with front-desk and auditor.)

| Tool | front-desk | orchestrator | coding worker | auditor |
| --- | :-: | :-: | :-: | :-: |
| `fleet_check_board` | ✅ | ✅ | — | ✅ |
| `fleet_watchdog_audit` | ✅ | ✅ | — | ✅ |
| `fleet_queue_inspect` | ✅ | ✅ | — | ✅ |
| `fleet_handoff_generate` | ✅ | ✅ | — | ✅ |
| `fleet_board_sweep` | ✅ | ✅ | — | — |
| `fleet_prune_orchestrators` | — | ✅ | — | — |
| `fleet_queue_purge` | — | ✅ | — | — |
| `fleet_ensure_orchestrator` | — | ✅ | — | — |
| `fleet_rotate_role` | — | ✅ | — | — |
| `fleet_validate_workspace` | — | ✅ | ✅ | — |
| `fleet_prune_dead_sessions` | — | ✅ | — | — |
| `fleet_status_get` | ✅ | ✅ | — | ✅ |
| `fleet_queue_pause` | — | ✅ | — | — |
| `fleet_queue_resume` | — | ✅ | — | — |
| `fleet_queue_drain` | — | ✅ | — | — |
| `fleet_control_mode` | — | ✅ | — | — |
| `fleet_repos_list` | ✅ | ✅ | — | ✅ |
| `fleet_stage_evaluate` | — | ✅ | — | — |
| `fleet_stage_transition` | — | ✅ | — | — |
| `fleet_audit_record` | — | ✅ | — | — |
| `fleet_audit_check` | ✅ | ✅ | — | ✅ |
| `fleet_audit_summary` | ✅ | ✅ | — | ✅ |
| `ticket_list` | ✅ | ✅ | — | ✅ |
| `ticket_view` | ✅ | ✅ | — | ✅ |
| `ticket_create` | — | ✅ | — | — |
| `ticket_comment` | — | ✅ | — | — |
| `ticket_edit` | — | ✅ | — | — |
| `pr_list` | ✅ | ✅ | — | ✅ |
| `pr_view` | ✅ | ✅ | — | ✅ |
| `pr_create` | — | ✅ | — | — |
| `pr_diff` | ✅ | ✅ | — | ✅ |
| `pr_merge` | — | ✅ | — | — |
| `ci_logs` | ✅ | ✅ | — | ✅ |

Rationale: Front Desk and auditor are read-only triage/health consumers;
orchestrators own fleet mutation; workers only need the workspace validator.

### 5.3 Preapproval caveat

Do not rely on `toolPolicy.preapproved` for cross-harness parity: only `claude`,
`codex`, and `opencode` declare `supportsExactMcpPreapproval`. On the other
harnesses the injected tools surface as ordinary permission prompts unless the
agent already runs in an auto-accept mode.

---

## 6. Verification

```sh
npm --prefix plugins/uppidi-fleet run typecheck
npm --prefix plugins/uppidi-fleet test -- test/fleet-mcp-server.test.mjs
```

The E2E suite spawns the real server over stdio and asserts the full JSON-RPC
handshake, `tools/list`, dispatch of all 33 tools, `json`/markdown formatting,
`dryRun`/`confirm` guards, and unreachable router/daemon error responses.
