# paseo-permission-logger

Audit logger for Paseo: records tool calls and permission decisions with
agent attribution, and exposes them through a queryable sidebar surface.

Every time an agent hits a permission gate — a tool call, a plan approval, a
mode switch, a question prompt — the daemon emits a request event and later a
resolution event. `permission-logger` correlates the two, normalizes the
verdict to `allow` / `deny`, stamps which agent (id, title, model, provider,
mode, cwd) made the request, and appends the entry to a local JSONL audit log.

Tool calls themselves are captured **post-turn**: `agent.turn_ended` carries
the turn's full `timeline`, whose `tool_call` items hold the tool name, its
parameters, and its outcome. The logger extracts those, reconciles timelines
replayed across later turns, and appends them to the same JSONL log. Real-time
per-call events are upstream work ([xpufx-org/paseo#900](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/900)).

The Permission Log sidebar surface renders every record with search, a
record-type filter (All / Permissions / Tool calls), decision filtering, and
Success / Failed / Canceled outcome badges.

Built on [paseo-plugin-helper](https://github.com/xpufx/paseo/tree/main/packages/paseo-plugin-helper), the shared Paseo plugin runtime.

> [!NOTE]
> **Prerequisites & Platform Support**:
> - Requires **Paseo >=0.9.0** (declared in [`paseo-plugin.json`](paseo-plugin.json)).
> - Server-side storage is plain Node `fs` JSONL — Linux, macOS, and Windows supported.

## Installation

Install from npm:

```sh
paseo plugin add npm:@xpufx/paseo-permission-logger
```

Or install directly from the Git repository:

```sh
paseo plugin add xpufx/paseo --path plugins/permission-logger
```

Then reload the daemon. On load, `index.server.ts` logs:

```
permission-logger plugin contributed: audit log live
```

along with the resolved log file path.

### Opening the Permission Log sidebar

The client half (`index.client.tsx`) registers a single sidebar surface:

| Property | Value |
| --- | --- |
| Surface id | `permission-logger` |
| Title | `Permission Log` |
| Icon | `ShieldCheck` |

In Paseo Desktop, open the **Permission Log** item in the sidebar (the shield
icon). The surface polls `permission-logger.query` every **5 seconds**
(`refetchInterval: 5000`) while mounted and renders:

- A search box (matches tool name, kind, agent id/model, arguments, outcome,
  and turn id).
- **All / Permissions / Tool calls** record-type filter buttons.
- **All / Pending / Allowed / Denied** decision filter buttons (decisions
  apply to permission records only).
- A table with `Time`, `Entry` (name + `kind · agentId · model` +
  summarized input), and `Outcome` (`Allowed` / `Denied` / `Pending` badges
  for permissions, `Success` / `Failed` / `Canceled` for tool calls) columns.
- Loading, error-with-retry, and empty states.

## Configuration

There is no settings UI. The only knob is the log file location:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PASEO_PERMISSION_LOG_PATH` | `~/.paseo/plugin-data/xpufx/permission-logger/permissions.jsonl` | Where audit entries are appended. |

Set the variable on the daemon process before it starts to redirect the log
(e.g. per-host paths, ephemeral test dirs). Parent directories are created on
first write. Resolution lives in `resolveDefaultLogPath`
([`server/storage.ts`](server/storage.ts)).

## RPC methods

All contracts are defined in [`shared/contracts.ts`](shared/contracts.ts)
using `paseo-plugin-helper`'s `defineContract`. Zod schemas validate both
input and output.

### `permission-logger.query`

Query logged permission decisions, filtered by agent, model, date range, or
decision.

**Input** (`PermissionQueryFilter` — all fields optional):

| Field | Type | Description |
| --- | --- | --- |
| `agentId` | `string` | Exact agent id match. |
| `model` | `string` | Exact agent model match. |
| `provider` | `string` | Exact agent provider match. |
| `decision` | `"allow" \| "deny" \| "pending"` | Filter by verdict; excludes tool-call records. |
| `outcome` | `"success" \| "failure" \| "canceled"` | Filter by tool-call outcome; excludes permission records. |
| `recordType` | `"permission" \| "tool_call"` | Restrict to one record kind. |
| `kind` | `string` | Exact permission kind match (e.g. `tool`). |
| `from` | `string` | ISO timestamp lower bound (inclusive). |
| `to` | `string` | ISO timestamp upper bound (inclusive). |
| `search` | `string` | Case-insensitive substring over name, kind, agent id, and serialized input. |
| `limit` | `integer 1–1000` | Max entries returned (default `100`). |

**Output:**

| Field | Type | Description |
| --- | --- | --- |
| `entries` | `AuditRecord[]` | Newest-first, truncated to `limit`. |
| `total` | `integer` | Total matches before truncation. |

`AuditRecord` is the union of a permission entry and a tool-call entry. The two
share the `id`, `timestamp`, agent-attribution, `kind`, `name`, and `input`
fields above; `recordType` distinguishes them on read.

**Permission entry shape** (`PermissionAuditEntry`, no `recordType`):

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Permission request id (correlates request ↔ resolution). |
| `timestamp` | `string` | ISO-8601 time of the original request. |
| `agentId` | `string` | Resolved agent id. |
| `agentTitle` | `string?` | Agent display name, when known. |
| `agentModel` | `string?` | Model id, when known. |
| `agentProvider` | `string?` | Provider id, when known. |
| `agentMode` | `string?` | Session mode, when known. |
| `agentCwd` | `string?` | Working directory, when known. |
| `kind` | `string` | Permission kind (defaults to `"tool"`). |
| `name` | `string` | Permission name (tool / title / `"permission"` fallback). |
| `input` | `unknown` | Original request input. |
| `decision` | `"allow" \| "deny"` | Normalized verdict. |
| `updatedInput` | `unknown?` | Modified input from an allow-with-edits resolution. |
| `denyReason` | `string?` | Denial message / reason, when provided. |

**Tool-call entry shape** (`ToolCallAuditEntry`):

| Field | Type | Description |
| --- | --- | --- |
| `recordType` | `"tool_call"` | Discriminator. |
| `id` | `string` | Tool call id (`callId`); correlates the call within a turn. |
| `timestamp` | `string` | ISO-8601 time the turn ended and the call was captured. |
| `turnId` | `string?` | Turn the call belongs to, when known. |
| `sequence` | `integer?` | Index in the turn timeline; orders calls sharing a timestamp. |
| `agentId` | `string` | Agent id. |
| `agentTitle` | `string?` | Agent display name, when known. |
| `agentModel` | `string?` | Model id, when known. |
| `agentProvider` | `string?` | Provider id, when known. |
| `agentMode` | `string?` | Session mode, when known. |
| `agentCwd` | `string?` | Working directory, when known. |
| `kind` | `string` | Always `"tool_call"`. |
| `name` | `string` | Tool name (e.g. `Bash`, `Read`, `Write`). |
| `input` | `unknown` | Tool parameters (the daemon's structured `detail`, or a raw provider `input`). |
| `outcome` | `"success" \| "failure" \| "canceled"` | Normalized tool status. |
| `error` | `unknown?` | Failure payload, when the tool failed. |
| `result` | `unknown?` | Tool output, when the daemon exposes one. |

## Architecture

```
plugins/permission-logger/
├── index.server.ts        # daemon entry: store, logger, event wiring, query handler
├── index.client.tsx       # client entry: initClientHelpers + sidebar surface registration
├── client/
│   └── surface.tsx        # PermissionLoggerSurface (permissions + tool calls)
├── server/
│   ├── listener.ts        # re-exports the capture/correlation API
│   └── storage.ts         # re-exports the JSONL store
├── shared/
│   └── contracts.ts       # re-exports the Zod schemas + query contract
├── paseo-plugin.json      # plugin id + Paseo version requirement
└── package.json           # workspace package, test/typecheck scripts
```

The contracts, store, capture logic, and audit view live in the shared
[`packages/permission-audit`](../../packages/permission-audit) workspace so the
`top` plugin can reuse the same log and surface; the plugin's `server/` and
`shared/` files are thin re-exports.

### Event flow

1. The daemon emits `agent.permission_requested` (or `permission.requested`).
   `handleRequested` stashes the request by id in a pending map.
2. The daemon later emits `agent.permission_resolved` (or
   `permission.resolved`). `handleResolved` merges the resolution with the
   stashed request (stashed attribution wins on conflict, resolution fills
   gaps), drops events with no id, agent, or recognizable decision, validates
   against `PermissionAuditEntrySchema`, and appends to the store.
3. Pending requests whose provider never emits a resolution are reconciled to
   `allow` on `agent.turn_started` / `agent.turn_ended` by
   `handleTurnActivity`.
4. `agent.turn_ended` also carries the turn `timeline`. `handleTurnEnded`
   walks its `tool_call` items (`splitToolCallTimeline`), maps each item's
   `status` to an outcome and its `detail` to parameters/result, and appends a
   `ToolCallAuditEntry`. Captures are fingerprinted per `(agentId, callId)` and
   seeded from the persisted log, so timelines replayed on every later turn
   append nothing while a still-running call that later settles is updated
   once.
5. `subscribePermissionEvents` attaches to all lifecycle event names when
   `server.on` exists and returns an unsubscribe function called on plugin
   teardown. Unknown event shapes are tolerated — extractors probe several
   key aliases (`id`/`agentId`, `name`/`title`/`tool`, `behavior`/`decision`/
   `verdict`/`approved`/`allowed`, nested `agent`/`session` objects).

### Storage

`PermissionLogStore` (`server/storage.ts`) appends one JSON object per line.
`readAll` skips blank and malformed lines rather than failing the whole read,
and parses each line as the `AuditRecord` union (permission entry or tool-call
entry). `readLatest` dedupes by `(recordType, id)` so an updated tool call or a
pending→allow transition resolves to its newest row. `query` applies
exact-match filters, an inclusive `from`/`to` timestamp window (unparseable
bounds are ignored), and substring search, then sorts newest-first (tool calls
sharing a turn timestamp break ties by timeline `sequence`) and slices to
`limit`.

## Development

```bash
# Typecheck
npm run typecheck --workspace=plugins/permission-logger

# Run test suite
npm test --workspace=plugins/permission-logger
```

Tests cover contract schemas (permission + tool-call records), attribution
extraction, decision normalization, request/resolution correlation, tool-call
extraction/ordering/reconciliation/idempotency, store append/read/query
filtering across both record kinds, the audit view rendering, and a static
check that the client entry injects the required host deps.

## License

MIT — see [LICENSE](LICENSE).
