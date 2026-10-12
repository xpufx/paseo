# `fleet-mcp-server`: tool reference, safety guards, and registration

Status: implemented. The standalone stdio server
(`plugins/uppidi-fleet/bin/fleet-mcp-server.mjs`) and the 10 tool
implementations in `plugins/uppidi-fleet/server/mcp-tools.ts` are live and
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

All arguments are optional unless the tool lists a `required` entry in its
schema. Every tool accepts `json?: boolean` (default `false`). Markdown is the
default rendering; `json: true` returns a machine-readable payload in the same
`content[0].text` string.

| Tool | Required | Mutates board / host | Needs hook router |
| --- | --- | --- | --- |
| [`fleet_check_board`](#fleet_check_board) | — | only when `dryRun: false` (stale-WIP recovery, state triage) | no |
| [`fleet_watchdog_audit`](#fleet_watchdog_audit) | — | only when `recover: true` | no |
| [`fleet_board_sweep`](#fleet_board_sweep) | — | stale-WIP recovery unless `dryRun` | no |
| [`fleet_prune_orchestrators`](#fleet_prune_orchestrators) | — | deletes registrations unless `dryRun: true` | no |
| [`fleet_queue_inspect`](#fleet_queue_inspect) | — | no | no |
| [`fleet_queue_purge`](#fleet_queue_purge) | `repo`, `confirm` | deletes a queue file | no |
| [`fleet_handoff_generate`](#fleet_handoff_generate) | — | writes `latest-handoff.md` | no |
| [`fleet_rotate_role`](#fleet_rotate_role) | — | spawns/archives agents | **yes** |
| [`fleet_ensure_orchestrator`](#fleet_ensure_orchestrator) | `repo` | spawns/registers an agent | no (daemon required) |
| [`fleet_validate_workspace`](#fleet_validate_workspace) | one of `path`/`workspaceId` | no (pure git inspection) | no |

### `fleet_check_board`

Deterministic Forgejo board check and triage ranking.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `repo` | string | `xpufx/paseo-plugin-helper` | `owner/repo` |
| `hostname` | string | `forge.mrs.uppidi.com` | Forgejo host |
| `role` | enum | `orchestrator` | `orchestrator` \| `coding-agent` \| `worker` \| `coding_worker` |
| `force` | boolean | `false` | re-report candidates whose cache signature is unchanged |
| `all` | boolean | `false` | report every open issue without filtering |
| `staleWipHours` | number | `2.0` | non-negative; stale-WIP threshold |
| `dryRun` | boolean | `false` | calculate triage without mutating labels |
| `json` | boolean | `false` | JSON instead of markdown |

JSON payload: `{ timestamp, stale_wip_recovery, ranked_candidates }`.
Markdown header: `# Forgejo Deterministic Board Ranking`.

### `fleet_watchdog_audit`

Fleet agent health audit (turn locks, zombie turns, amnesia, permission
requests, queues).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `recover` | boolean | `false` | run the conservative recovery pipeline for eligible anomalies |
| `frontDeskId` | string | — | Front Desk agent id to notify |
| `steerMessage` | string | — | wake message used while steering recovered agents |
| `cancellationRecencySeconds` | number | `300` | cancellation-timeout recency bound |
| `runningStaleSeconds` | number | `900` | inactivity before a running turn is a zombie |
| `assumePendingWork` | boolean | `false` | also treat finished idle agents as stalled |
| `json` | boolean | `false` | JSON instead of markdown |

JSON payload: `WatchdogAuditResult` = `{ ok, timestamp, audited: { orchestrators,
agents, queues }, anomalies[] }`. Markdown header: `# Fleet Watchdog Health Audit`.

### `fleet_board_sweep`

Sweep all enrolled repositories (or the `repos` you name).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `repos` | string | all enrolled | comma-delimited `owner/repo` slugs, or a repeated value |
| `json` | boolean | `false` | JSON instead of markdown |

JSON payload: `BoardSweepResult` = `{ ok, swept, actionable[], staleWipRecovered[],
errors[], prunedCount, autoEnsured[], notified }`.

### `fleet_prune_orchestrators`

Audit registered orchestrators against the live daemon roster and prune dead
records.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `dryRun` | boolean | `false` | report without deleting |
| `json` | boolean | `false` | JSON instead of markdown |

When the daemon roster is unreachable the result is `{ ok: false, error:
"daemon unreachable", prunedCount: 0, pruned: [] }` and `isError` is `true`.

### `fleet_queue_inspect`

Inspect buffered webhook payloads and queue status.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `repo` | string | all queues | filter by slug (`owner/repo` or `frontdesk`) |
| `json` | boolean | `false` | JSON instead of markdown |

### `fleet_queue_purge`

Drop stuck/poisoned webhook payloads for one repository queue without filesystem
surgery.

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `repo` | string | **yes** | target slug |
| `confirm` | boolean | **yes** | must be explicitly `true`; otherwise the call is aborted |
| `json` | boolean | no | JSON instead of markdown |

Safety: `repo` missing → `Error: repo parameter is required`; `confirm` not
`true` → `Purge aborted: confirm must be set to true …`. Neither path deletes a
file.

### `fleet_handoff_generate`

Write `latest-handoff.md` (active assignments, open PRs, blocking state).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `json` | boolean | `false` | JSON instead of markdown |

Markdown returns the report body directly. JSON payload: `{ ok, report }`.

### `fleet_rotate_role`

Rotate a long-lived fleet role onto a fresh agent (spawn → verify → brief →
archive incumbent).

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `role` | enum | `orchestrator` | `orchestrator` \| `front-desk` \| `auditor` \| `coding-agent` |
| `repo` | string | — | required for orchestrator rotation |
| `reason` | string | — | recorded in the rotation brief |
| `json` | boolean | `false` | JSON instead of markdown |

Requires a live hook router. Without one it returns `fleet_rotate_role failed:
hook router is not running` with `isError: true`.

### `fleet_ensure_orchestrator`

Ensure an active orchestrator exists for a repository (idempotent).

| Param | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `repo` | string | **yes** | — | `owner/repo` or key |
| `mode` | string | no | `yolo` | resolved against the provider's advertised modes |
| `provider` | string | no | policy/default | provider override |
| `model` | string | no | policy/default | model override |
| `force` | boolean | no | `false` | spawn even if one is active |
| `json` | boolean | no | `false` | JSON instead of markdown |

Without a daemon it fails closed: `fleet_ensure_orchestrator failed: No workspace
found for repository "…"` with `isError: true`.

### `fleet_validate_workspace`

Worktree-only dispatch validator (#918). Call before dispatching a coding agent.

| Param | Type | Notes |
| --- | --- | --- |
| `path` | string | absolute workspace path to validate |
| `workspaceId` | string | resolve the path from the daemon registry instead |
| `json` | boolean | JSON instead of markdown |

A refusal is hard: `isError: true`, and the JSON payload is `{ ok: false, path,
workspaceId, reason, error }` naming the corrective provisioning action. A path
that is not a git checkout abstains (allowed) because absence of evidence is not
proof of a primary checkout.

---

## 3. Invocation guidelines

- **Verify before you mutate.** Prefer `dryRun: true` on `fleet_check_board`,
  `fleet_prune_orchestrators`, and `fleet_board_sweep` until you have read the
  dry-run report.
- **Purge is two-step by design.** Never set `confirm: true` on
  `fleet_queue_purge` unless the stuck/poisoned queue was identified from a
  `fleet_queue_inspect` call.
- **`json: true` for machines, markdown for humans.** Use JSON when another tool
  or agent consumes the result; use markdown in an issue/PR comment.
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
| `json: true` | all 10 | JSON payload instead of markdown in `content[0].text` |
| `dryRun: true` | `fleet_check_board`, `fleet_prune_orchestrators` | no board/registry mutation |
| `dryRun` (default false) | `fleet_board_sweep` | stale-WIP recovery only when not dry |
| `confirm: true` | `fleet_queue_purge` | required; otherwise aborts before any file I/O |
| `recover: false` (default) | `fleet_watchdog_audit` | audit only; no recovery actions |
| Hard refusal | `fleet_validate_workspace` | primary-checkout / local-isolation dispatch is refused |
| Fail-closed daemon errors | `fleet_prune_orchestrators`, `fleet_ensure_orchestrator`, `fleet_rotate_role` | explicit `isError: true` text, never a silent success |

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
exposed.

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
handshake, `tools/list`, dispatch of all 10 tools, `json`/markdown formatting,
`dryRun`/`confirm` guards, and unreachable router/daemon error responses.
