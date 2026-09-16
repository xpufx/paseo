# Native Forgejo Workflow GUI Plugin for Paseo

**Status:** specification (implements [Issue #56 (forge.mrs)](https://forge.mrs.aager.de/xpufx/paseo/issues/56))
**Scope:** `plugins/forges` (`paseo-forges`) server + client, built only on
`paseo-plugin-helper` primitives — no Paseo host/SDK changes
**Constraint:** Strictly pre-code shaping. No implementation files are modified
by this spec; it defines data models, RPC interfaces, component layouts, and a
phased roadmap only.

---

## 1. Problem statement

The operator (`@oktay`) and the Orchestrator must leave the Paseo
desktop/mobile client and open an external web browser to inspect issues,
review agent deliverables, advance label state, or cross-reference agent IDs
and commit hashes. Every context switch breaks the orchestration loop:
triage happens in the browser, steering happens in chat, and neither side sees
the other.

A native GUI plugin keeps the whole loop inside Paseo: the issue queue, the
issue detail (with parsed Agent Envelope telemetry), one-click scoped label
toggles, and quick comments all live in plugin surfaces powered by
`paseo-plugin-helper`.

### What already exists (reuse, do not duplicate)

`plugins/forges` (`paseo-forges`) already ships the thin end of this wedge:

- Server: `forgejo.open-issues` contract (`shared/issues.ts`) + `handleOpenIssues`
  (`server/issues.ts`) — resolves owner/repo from the workspace directory's
  git `origin` remote, shells out to `fgjx` (falling back to `fgj`), never
  throws (failures surface as an `error` field so the pill renders a
  placeholder).
- Shared: `parseForgejoRemote`, `extractForgejoIssueUrls` (timeline
  linkifier), `formatIssueCountLabel` (null count renders `"issues --"`
  placeholder, never a false zero).
- Client: composer pill (`GitPullRequest` icon, 15 s label poll / 30 s query
  poll) + issues modal (`Tabs`, `SearchInput`, `Card`, `EmptyState`, copy the
  `[#N title](url)` markdown ref — push-to-composer is unavailable on the v8
  SDK, so copy-and-paste remains the handoff).

This spec extends that plugin with four new RPC contracts and three new UI
surfaces. All shared parsing helpers (`parseForgejoRemote`,
`extractForgejoIssueUrls`) are reused as-is.

---

## 2. Goals / non-goals

### Goals

1. **Board overview in-client.** Searchable queue of open issues sorted by the
   deterministic priority tuple (§4.3), with quick-filters for `state/*` and
   `priority/*` buckets — no browser required for triage.
2. **Issue detail in-client.** Full markdown body, comment thread, and parsed
   Agent Envelope cards (agent id, provider/model, branch, commit SHAs,
   `paseo://` session link) in one inspection modal.
3. **One-click label state toggles.** Scoped `state/`–`priority/`–`attention/`–`spec/`
   selectors that rely on Forgejo native exclusive auto-eviction (apply the new
   label; the old one in the same scope evicts itself — zero `--remove-label`
   calls).
4. **Quick comments from the client.** Operator steering posted straight into
   the issue thread without leaving Paseo.
5. **Zero-config auth.** Reuse the host's existing `~/.config/fgj/config.yaml`
   token; the plugin never asks the user for credentials.
6. **Deep links.** Agent IDs resolve to `paseo://h/<serverId>/agent/<agentId>`
   sessions; commit SHAs resolve to local `git log` / web viewer.

### Non-goals

- No new Paseo SDK surface (`initClientHelpers` four-field shape unchanged;
  `registerComposerPill` / `registerSidebarSurface` used as documented).
- No push-to-composer (v8 SDK exposes no composer-insert API — same
  limitation the current issues modal already documents).
- No actionable toasts (see the
  [toast-to-approval spec](./toast-to-approval.md) for the split-surface
  approval pattern if a signoff flow is needed later).
- No plugin-specific logic in `paseo-plugin-helper` — any generally reusable
  parsing (envelope regex, priority-rank comparator) ships in the helper only
  if a second consumer needs it; until then it lives in `plugins/forges`.
- No implementation in this spec phase — schemas, method names, and layouts
  only.

---

## 3. Authentication & data path

### 3.1 Token source (zero extra user config)

The daemon reuses the existing `fgj` credential store, exactly as
`handleOpenIssues` already does: the server shells out to `fgjx` (fallback
`fgj`) via `safeSpawn` (no shell, 15 s timeout, `SIGTERM`→`SIGKILL`
escalation). `fgj` reads `~/.config/fgj/config.yaml` itself, so the plugin
never handles, stores, or logs the token:

1. Resolve repo coordinates: `git -C <directory> remote get-url origin` →
   existing `parseForgejoRemote` (handles `git@host:owner/repo`,
   `https://host/owner/repo`, `ssh://git@host/...`).
2. Run `fgjx issue list -R <owner/repo> --hostname <host> --json`
   (fallback `fgj ...`); run `fgjx api repos/<owner/repo>/issues/<N>[...]`
   (fallback `fgj api ...`) for detail, labels, and comments.
3. All outbound data passes through `redactSecrets()` before logging
   (existing `createPluginLogger` behavior); issue bodies may quote tokens in
   exotic cases, so redaction is applied to cached payloads too.
4. Handlers never throw: failures return a typed `error` field and the client
   renders `EmptyState` + Retry (per `docs/surfaces.md` — data absent with a
   live source renders the empty state, never a crash).

Why subprocess over direct HTTPS: zero credential handling (the token never
enters plugin memory), automatic support for every host the user already
configured, and battle-tested parity with `fgjx` display semantics (label
columns, envelope footers). Cost is one short-lived process per fetch —
amortized by the polling cache (§3.2).

### 3.2 Caching & polling

- Daemon-side: `PluginStorage("paseo-forges", "board-cache.json", { schema })`
  holds the last good board snapshot + per-issue detail cache with `fetchedAt`
  timestamps. Atomic temp-file + rename writes; Zod-validated reads with
  defaults — same guarantees as all helper server state.
- Refresh loop: `createPeriodicTask` (existing server helper, exponential
  backoff on consecutive failures) polls the board every 60 s; detail entries
  refresh on open + every 60 s while the inspection modal is open.
- Client-side: `useRpcQuery` for reads (30 s `refetchInterval`, matching the
  current issues modal), `useAutoRefreshQuery` with `isOpen` gating for the
  inspection modal so background polling halts when it closes (battery-safe,
  existing helper behavior). Writes go through `useRpcMutation` and
  invalidate the board/detail query keys on success.

---

## 4. Data models

All schemas are Zod, defined in `plugins/forges/shared/` (importable by both
server and client), built with `defineContract` from
`paseo-plugin-helper/shared`.

### 4.1 Scoped label vocabularies (verified against the live board)

Forgejo scoped labels are exclusive: applying one label in a scope evicts the
previous label in that scope at the DB level. The client therefore only ever
sends "add", never "remove". Canonical scopes and ranks:

```ts
export const StateRank = {
  "state/0-triage": 0,
  "state/1-wip": 1,
  "state/2-review": 2,
  "state/3-verify": 3,
  "state/4-done": 4,
} as const;

export const PriorityRank = {
  "priority/0-SOS": 0,
  "priority/1-high": 1,
  "priority/2-normal": 2,
  "priority/3-low": 3,
  "priority/4-backburner": 4,
} as const;

export const AttentionScope = [
  "attention/0-orchestrator",
  "attention/1-agent",
  "attention/2-user",
  "attention/3-ignore",
] as const;

export const SpecScope = [
  "spec/0-needed",
  "spec/1-checklist",
  "spec/2-approved",
] as const;
```

> [!NOTE]
> Label-name discrepancy: the issue body §2 cites shorthand names
> (`state/wip`, `state/ready-for-review`, `state/verify`,
> `state/confirmed-done`, `attention/0-agent`, `attention/1-user`). The live
> board (verified via API at spec time) uses the numbered forms above
> (`state/1-wip`, `state/2-review`, `state/3-verify`, `state/4-done`;
> `attention/0-orchestrator` … `attention/3-ignore`). This spec norms on the
> live names; the client renders short display aliases (`WIP`, `Review`,
> `Verify`, `Done`) so the UI stays compact.

### 4.2 Board item

```ts
export const BoardIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  labels: z.array(z.string()),
  priorityRank: z.number().int().min(0).max(4),
  stateRank: z.number().int().min(0).max(4).nullable(),
  attention: z.string().nullable().default(null),
  updatedAt: z.string().optional(),
  commentCount: z.number().int().nonnegative().default(0),
});
export type BoardIssue = z.infer<typeof BoardIssueSchema>;
```

- Issues carrying **no** `priority/*` label sort as `priority/2-normal`
  (rank 2); issues with no `state/*` label carry `stateRank: null` and sort
  after ranked states within the same priority band.
- Closed issues are excluded from the overview (the `state/4-done` filter
  shows open issues labeled done; true closed state is a separate query
  flag — see `includeClosed` in §5.1).

### 4.3 Sort tuple

The overview is sorted by the deterministic tuple
`(priorityRank, stateRank ?? 99, updatedAt desc)`:

1. `priorityRank` ascending (`0-SOS` preempts everything).
2. `stateRank` ascending within a band — `3-verify` (needs a human) surfaces
   above `1-wip` (already owned), so operator attention lands where it
   unblocks work. `null` ranks last.
3. `updatedAt` descending (most recently active first) as the final tiebreak.

`size/*` (`0-cheap` … `3-chunk`) and `dep/blocker` are exposed on the card as
badges but do **not** enter the sort key in v1 (open question §10.3).

### 4.4 Agent Envelope (parsed telemetry)

Every agent comment ends with the envelope footer stamped by
`fgjx issue comment --envelope` (see coding-agent skill):

```markdown
---
<sub>🤖 **<SessionTitle>** (`<shortId>`) · `<model>` · `<repo>:<branch>` · _<UTC timestamp>_</sub>
```

Verified live example (`#77`):

```markdown
<sub>🤖 **Update legacy react-native specifier to client** (`d705b95`) · `muse-spark-1.3-contributor` · `paseo:main` · _2026-09-12 12:13 UTC_</sub>
```

Parsed schema (server-side, pure function, unit-tested):

```ts
export const AgentEnvelopeSchema = z.object({
  commentId: z.number(),
  sessionTitle: z.string(),
  agentShortId: z.string(),
  model: z.string().nullable().default(null),
  repo: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  postedAt: z.string().nullable().default(null),
  commitShas: z.array(z.string().regex(/^[0-9a-f]{7,40}$/)).default([]),
  paseoLinks: z.array(z.string().url().or(z.string().startsWith("paseo://"))).default([]),
  serverId: z.string().nullable().default(null),
});
export type AgentEnvelope = z.infer<typeof AgentEnvelopeSchema>;
```

- `commitShas`: full 40-char and short 7+ char hex hashes found in the comment
  body (code-fenced blocks included — agents report SHAs in both prose and
  `commit:` lines).
- `paseoLinks`: `paseo://h/<serverId>/agent/<agentId>` deep links found in
  the body; `serverId` is extracted from the first one when present.
- Unparseable footers are skipped (the comment still renders as plain
  markdown); envelope parsing never fails the detail RPC.

### 4.5 Issue detail

```ts
export const IssueCommentSchema = z.object({
  id: z.number(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  body: z.string(),
  envelope: AgentEnvelopeSchema.nullable().default(null),
});

export const IssueDetailSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  labels: z.array(z.string()),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  webUrl: z.string().url(),
  comments: z.array(IssueCommentSchema),
  envelopes: z.array(AgentEnvelopeSchema),
});
```

---

## 5. Server RPC interface

Four contracts, namespaced `forgejo.*`, registered on the daemon
`PluginContext` next to the existing `forgejo.open-issues` handler (which
stays untouched for backward compatibility — the pill keeps working during
migration).

```ts
import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";
```

### 5.1 `forgejo.board-overview` (read)

```ts
export const boardOverviewContract = defineContract({
  name: "forgejo.board-overview",
  description: "Open issues sorted by the (priority, state, recency) tuple",
  input: z.object({
    directory: z.string().optional(),
    stateFilter: z.enum(["all", "state/0-triage", "state/1-wip",
      "state/2-review", "state/3-verify", "state/4-done"]).default("all"),
    priorityFilter: z.enum(["all", "priority/0-SOS", "priority/1-high",
      "priority/2-normal", "priority/3-low",
      "priority/4-backburner"]).default("all"),
    query: z.string().max(200).default(""),
    includeClosed: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  output: z.object({
    repo: z.string().nullable(),
    issues: z.array(BoardIssueSchema),
    verifyCount: z.number().int().nonnegative(),
    wipCount: z.number().int().nonnegative(),
    fetchedAt: z.string().datetime(),
    error: z.string().optional(),
  }),
});
```

- Filtering is server-side (single fetch, cheap in-memory partition) so the
  pill's `verifyCount` and the dashboard always agree — same predicates, same
  data (per `docs/surfaces.md`).
- `query` matches issue number (`"56"` / `"#56"`), title substring, or label
  substring (case-insensitive) — the same matcher the current modal uses
  client-side, moved server-side so sidebar and modal share it.
- `verifyCount` = open issues with `state/3-verify`; `wipCount` = open issues
  with `state/1-wip`. Returned on every call so the pill never needs a second
  round-trip.

### 5.2 `forgejo.issue-detail` (read)

```ts
export const issueDetailContract = defineContract({
  name: "forgejo.issue-detail",
  description: "Full body, comments, and parsed Agent Envelopes for one issue",
  input: z.object({
    directory: z.string().optional(),
    number: z.number().int().positive(),
  }),
  output: z.object({
    repo: z.string().nullable(),
    issue: IssueDetailSchema.nullable(),
    fetchedAt: z.string().datetime(),
    error: z.string().optional(),
  }),
});
```

- Unknown number → `{ issue: null, error: "Issue #N not found in <repo>" }`
  (typed null, never a throw — the modal renders `EmptyState`).
- Envelopes are parsed server-side (Node regex) so the client receives
  structured cards with zero parsing logic.

### 5.3 `forgejo.set-label` (write)

```ts
export const setLabelContract = defineContract({
  name: "forgejo.set-label",
  description: "Apply one scoped label; Forgejo exclusive scope evicts the rest",
  input: z.object({
    directory: z.string().optional(),
    number: z.number().int().positive(),
    label: z.string().min(1),
  }),
  output: z.object({
    number: z.number(),
    labels: z.array(z.string()),
    error: z.string().optional(),
  }),
});
```

- Implemented as `fgjx issue edit <N> -R <repo> --add-label <label>` — no
  `--remove-label`, ever: exclusivity evicts the prior scope mate at the DB
  level (verified behavior for `state/`, `priority/`, `attention/`, `spec/`).
- `label` is validated against the known scope vocabularies (§4.1) before
  spawning; unknown scopes return `{ error }` without touching the API.
- On success returns the fresh label list and invalidates the board/detail
  query keys client-side.

### 5.4 `forgejo.add-comment` (write)

```ts
export const addCommentContract = defineContract({
  name: "forgejo.add-comment",
  description: "Post a quick comment (or steering note) to the issue thread",
  input: z.object({
    directory: z.string().optional(),
    number: z.number().int().positive(),
    body: z.string().min(1).max(10000),
  }),
  output: z.object({
    number: z.number(),
    commentId: z.number().nullable(),
    error: z.string().optional(),
  }),
});
```

- Implemented as `fgjx issue comment <N> -R <repo> -b <body>` (100-col wrap
  is applied by `fgjx`, not the plugin). The plugin does **not** append an
  agent envelope — quick comments are operator steering, stamped with the
  operator's identity by the host.
- Empty/whitespace-only bodies are rejected client-side (button disabled) and
  server-side (`min(1)` after trim).

---

## 6. Client UI surfaces

All components use only documented helper primitives. Entry point calls
`initClientHelpers({ Icon, Modal, useRpc, useToast })` once (unchanged).

### 6.1 Status count pill (composer trackbar)

Extends the existing `forgejo-issues` pill; no second pill:

- Wide label: `"3 verify · 12 open"` (verify-first — the operator's most
  valuable glance). Compact label: `"3v"`.
- Data: `useRpcQuery(boardOverviewContract, { directory })`, reusing the
  existing 15 s label poll / 30 s query poll cadence.
- Visibility rule (per `docs/surfaces.md`): `verifyCount > 0` → label as
  above; zero verify but live source → `"12 open"`; source dead/unknown →
  existing `"issues --"` placeholder. Never a `0 verify` chip.
- Tap opens the Queue Dashboard modal (§6.2) pre-filtered to
  `state/3-verify` when `verifyCount > 0`, else unfiltered.

### 6.2 Queue Dashboard (modal + sidebar)

Registered **twice** from one shared component tree:

- Modal: `registerComposerPill(..., { renderModal: (props) =>
  <ForgejoBoardModal {...props} /> })` — replaces the current
  `ForgejoIssuesModal` list tab, keeping `SearchInput` + copy-ref behavior.
- Sidebar: `registerSidebarSurface(plugin, { id: "forgejo-board",
  title: "Board", icon: "KanbanSquare", Component: ForgejoBoardSurface })` —
  full-height surface for sustained triage (desktop split-pane friendly).

Layout (shared `<BoardView>` used by both, responsive via `useResponsive()`):

```
┌──────────────────────────────────────────────┐
│ Card.Header: "Board · owner/repo"            │
│   badge: "3 verify" (warning dot) / hidden   │
├──────────────────────────────────────────────┤
│ Tabs: [Queue] [Verify n] [WIP n] [Search]    │
│   shortLabels: Queue/Verify/WIP/Search       │
├──────────────────────────────────────────────┤
│ (Search tab) SearchInput "Filter #number…"   │
│ Priority filter row: [SOS][High][Normal]…    │
│   (ghost Buttons, single-select, All reset)  │
├──────────────────────────────────────────────┤
│ DataTable (desktop) / card list (compact):   │
│   #N │ Title + label Badges │ 💬n │ updated  │
│   via <Responsive desktop card-list>         │
├──────────────────────────────────────────────┤
│ ActionBar: [Refresh secondary] [Close ghost] │
│   (modal only; sidebar omits Close)          │
└──────────────────────────────────────────────┘
```

- Rows: `DataTable` with `keyExtractor={(i) => String(i.number)}` on desktop;
  automatic card-list reflow on compact (built into `DataTable`). Row tap →
  opens Issue Inspection (§6.3) with `{ number }` payload. Copy-ref button
  per row (existing `issueMarkdownRef` behavior preserved).
- State/priority badges: `Badge` per label (`priority/0-SOS` → `danger`,
  `state/3-verify` → `warning`, `state/1-wip` → `info`, rest `neutral`).
- Filters are `Tabs` (state scope) + single-select ghost `Button` row
  (priority scope) + `SearchInput` (query) — all three map 1:1 onto the
  `board-overview` input, so sidebar and modal can never disagree.
- Empty states: `EmptyState` (`"CheckCircle2"` / `"No open issues"`;
  `"Search"` / `"No matches"` with query echo) — same copy as today.

### 6.3 Issue Inspection modal

`renderModal` payload `{ number }` (from board row tap or pill shortcut).
`useAutoRefreshQuery(issueDetailContract, { directory, number },
{ defaultRate: "30s", isOpen })`.

```
┌──────────────────────────────────────────────┐
│ Card.Header: "#56 Title…" (truncate helper)  │
│   badges: state Badge + priority Badge       │
├──────────────────────────────────────────────┤
│ Tabs: [Overview] [Comments n] [Envelopes m]  │
│       [Labels]                               │
├─ Overview ───────────────────────────────────┤
│ KeyValueGroup(2): Author │ Updated │ State…  │
│ Markdown body (RN text; fenced blocks via    │
│   CodeBlock w/ copy; issue URLs linkified    │
│   via extractForgejoIssueUrls)               │
│ Envelopes preview: latest AgentEnvelopeCard  │
├─ Comments ───────────────────────────────────┤
│ Comment cards (author, timestamp, body)      │
│ Quick-comment composer: TextInput (multiline)│
│   + Button "Post" (useRpcMutation add-       │
│   comment; disabled when empty/pending)      │
├─ Envelopes ──────────────────────────────────┤
│ AgentEnvelopeCard × m:                       │
│   Card + Card.Header (session title, agent   │
│     ShortId Badge mono copyable, model       │
│     Badge)                                   │
│   KeyValue: Branch (copyable mono) │ Posted  │
│   Commit SHAs: one CommandBox per SHA        │
│     (copy button; tap → §7.2)                │
│   paseo:// link Button "Open agent session"  │
│     (ghost w/ ExternalLink icon; tap → §7.1) │
│   EmptyState "Cpu"/"No agent activity yet"   │
│     when m = 0                               │
├─ Labels ─────────────────────────────────────┤
│ Scoped toggle groups (one row per scope):    │
│   State:    [Triage][WIP][Review][Verify]…   │
│   Priority: [SOS][High][Normal][Low][Parked] │
│   Attention:[Orches.][Agent][User][Ignore]   │
│   Spec:     [Needed][Checklist][Approved]    │
│ Active label per scope: primary Button; rest │
│   ghost. Tap → useRpcMutation set-label;     │
│   isPending disables the group.              │
│ Signoff row: Button "Post verify request"    │
│   (add-comment w/ canned "Ready for human    │
│   verification" template — operator opt-in)  │
└──────────────────────────────────────────────┘
```

- Markdown rendering: plain React Native `Text` + `CodeBlock` for fenced
  sections + pressable link spans for issue URLs / `paseo://` / SHAs. No new
  markdown dependency (zero native modules).
- Optimistic label UI: the tapped button shows `loading` until the mutation
  settles, then query invalidation repaints the group from server truth — no
  client-side label prediction (exclusivity edge cases stay server-side).
- The Labels tab is the Orchestrator Approval Panel's v1: state promotion
  (`1-wip` → `2-review` → `3-verify`) and review-verdict comments cover the
  Agent-vs-Operator handoff the issue asks for, without inventing a new
  approval primitive (defer full signoff flow to the toast-to-approval
  pattern if needed).

---

## 7. Deep linking & telemetry

### 7.1 Agent session links (`paseo://h/<serverId>/agent/<agentId>`)

- Tap handler: `Linking.openURL("paseo://h/<serverId>/agent/<agentId>")`
  (same `Linking` mechanism the current row-tap uses for `https://` URLs).
- Fallback: on failure, `copyToClipboard(link)` + toast (`"Session link
  copied"`) so the operator can paste it into a connected client.
- Envelopes without a `paseo://` link (older comments, e.g. `#77`) render
  the agent ShortId as a copyable mono `KeyValue` instead of a dead button —
  surfaces rule: absent data with a live source renders the copyable value,
  never a broken action.

### 7.2 Commit SHA links

Tap on a SHA `CommandBox`:

1. Preferred: open the repo web commit view
   `https://<host>/<owner>/<repo>/commit/<sha>` via `Linking.openURL`
   (coordinates already known from `resolveRepo`).
2. Long-press (or secondary button): copy the full SHA to clipboard.
3. v2 (Phase 3): `git -C <directory> show --stat <sha>` via a new
   `forgejo.commit-stat` read contract — specified but not required for v1.

### 7.3 Worktree / branch display

Branch names from envelopes render as copyable mono text (`CommandBox`
single-line variant). No checkout action in v1 — branch teleportation stays
with the agent harness (open question §10.4).

---

## 8. Lifecycle state machine (label transitions)

```
                    set-label                 set-label
  0-triage ───────────────────▶ 1-wip ───────────────────▶ 2-review
     │                             │                             │
     │ attention/1-agent           │ agent posts completion      │ orchestrator approves /
     │ (claim)                     │ envelope + sets             │ requests changes
     ▼                             ▼                             ▼
  (operator triage)              2-review ◀────────────────── 1-wip (rework)
                                        │
                                        │ operator verifies / approves
                                        ▼
                                     3-verify ── human closes ──▶ (closed)
                                        │
                                        │ changes requested
                                        ▼
                                      1-wip
```

Invariants:

1. Client sends only `set-label` adds; Forgejo exclusive scopes guarantee
   single-occupancy per scope — the client never issues removes.
2. Agents and the Orchestrator never close issues (coding-agent skill §6):
   `state/4-done` is an open label; closing is the human operator's word.
3. `flag/stop-work` short-circuits everything: when present, the Labels tab
   disables all toggle groups and renders a `danger` banner (circuit breaker
   is board-global, not per-transition).
4. `attention/3-ignore` suppresses the issue in the default Queue tab
   (server-side exclusion unless `query` matches — deterministic triage
   parity), unless `priority/0-SOS` is also present (SOS outranks ignore).

---

## 9. Error handling matrix

| Situation | Behavior |
|---|---|
| No git remote / unparseable origin | `{ repo: null, error }` → `EmptyState` "No Forgejo repo for this workspace" (existing behavior, kept) |
| `fgjx`/`fgj` missing or non-zero exit | `{ error: "Issue list unavailable" }` → `EmptyState` + Retry; pill falls back to `"issues --"` placeholder |
| Unknown issue number | `{ issue: null, error }` → `EmptyState` "Issue #N not found in repo" |
| `set-label` with out-of-vocabulary label | Rejected before spawn; `{ error }` surfaced via mutation `onError`; toggle group re-enables |
| `set-label` race (two operators, same scope) | Last write wins at Forgejo; query invalidation repaints from server truth — no client prediction to unwind |
| `add-comment` empty body | Button disabled client-side; `min(1)` server-side rejects as typed error |
| `add-comment` failure (network/auth) | Mutation `onError` → toast; composer text preserved (never cleared on failure) |
| Envelope footer unparseable | Comment renders as plain markdown; `envelopes` omits it; detail RPC still succeeds |
| `paseo://` open fails (no handler) | Copy link to clipboard + toast; never a dead tap |
| Storage write fails (board cache) | Serve last good cache with stale `fetchedAt`; `Card.Header` subtitle shows "updated Xm ago" via `formatDuration` |

---

## 10. Phased roadmap

### Phase 0 — This spec (done when merged)

Spec file + board review. Labels advance `spec/1-checklist` →
`spec/2-approved`, `state/1-wip` → `state/2-review` on the tracking issue.
No code touched.

### Phase 1 — Architecture & data path

- [ ] `shared/forgejo-board.ts`: label vocabularies + ranks, `BoardIssueSchema`,
      `IssueDetailSchema`, `AgentEnvelopeSchema`, envelope parser, sort-tuple
      comparator, four contracts (§4–§5).
- [ ] `server/board.ts`: `resolveRepo` reuse, `listIssuesJson` reuse, detail
      fetch (`.../issues/<N>` + `.../issues/<N>/comments`), `set-label` /
      `add-comment` runners via `safeSpawn(fgjx→fgj)`, `PluginStorage`
      board-cache, `createPeriodicTask` 60 s refresh.
- [ ] Unit tests: envelope parser (live `#77` footer + link/SHA variants),
      sort tuple (SOS-first, verify-before-wip, recency tiebreak),
      scope-vocabulary guard, query matcher (`#N` / title / label).
- [ ] Keep `forgejo.open-issues` untouched; new contracts register alongside.

### Phase 2 — Client UI surfaces

- [ ] `<BoardView>` shared tree (`Card`, `Tabs`, `SearchInput`, `DataTable`,
      `Badge`, `EmptyState`, `ActionBar`) + `ForgejoBoardModal` (replaces list
      tab content) + `ForgejoBoardSurface` via `registerSidebarSurface`.
- [ ] Pill upgrade: verify-first label (`"3 verify · 12 open"` / `"3v"`),
      tap-through to pre-filtered dashboard.
- [ ] `<IssueDetailModal>` with four tabs + `<AgentEnvelopeCard>` +
      `<ScopedLabelGroup>` + quick-comment composer (`TextInput` multiline +
      `useRpcMutation`).
- [ ] Compact-portrait pass (`useResponsive` / `select`: table → cards,
      full labels → `shortLabel`, `touchTargetMin` 44pt on toggles).

### Phase 3 — Deep linking & telemetry

- [ ] `paseo://` tap-through with clipboard fallback (§7.1).
- [ ] Commit SHA → web commit view + long-press copy (§7.2).
- [ ] Optional `forgejo.commit-stat` read contract (`git show --stat`) if
      operator review needs diff summaries in-client.

### Phase 4 — Hardening & parity

- [ ] `flag/stop-work` banner + toggle-group disable; `attention/3-ignore`
      exclusion rule (§8.4).
- [ ] Closed-app honesty: board cache renders instantly with "updated Xm ago"
      subtitle while the 60 s refresh runs (mirrors the toast-to-approval
      durable-queue principle).
- [ ] Gap suite: every new badge/count renders through shared predicates on
      both pill and dashboard (per `docs/surfaces.md` rules for new metrics).

### Open questions (implementation phase)

1. Should the envelope parser / sort comparator move into
   `paseo-plugin-helper/shared` for reuse by other plugins (e.g. an
   Orchestrator dashboard)? Recommendation: keep in `plugins/forges` until
   a second consumer exists.
2. Should `forgejo.commit-stat` be part of v1? Recommendation: no — web-view
   link + copy covers review; diff-in-client is Phase 3 stretch.
3. Should `size/*` (effort) and `dep/blocker` enter the sort key?
   Recommendation: badges only in v1; revisit after operator feedback.
4. Branch teleportation (tap branch → open/attach workspace)? Recommendation:
   explicitly out of scope — stays with the agent harness.

---

## 11. Testing plan

- **Server:** temp-dir `PluginStorage`; mocked `safeSpawn` returning canned
  `fgjx --json` payloads. Assert board sort order, scope-vocabulary rejection,
  detail null-form for unknown numbers, comment/commentId passthrough, cache
  fallback serving stale snapshot on spawn failure.
- **Parser:** envelope footer fixtures (live `#77` footer, multi-SHA body,
  `paseo://` body, malformed footer → skipped, no footer → `null`).
- **Client:** mock `useRpc` doubles. Assert pill label variants
  (`"3 verify · 12 open"` / `"12 open"` / `"issues --"`), tab filters map to
  contract input, row tap opens detail payload, label tap fires
  `set-label { number, label }` with group disabled while pending, empty
  comment disables Post, failed comment preserves composer text.
- **Surfaces:** pill and dashboard fed by the same mocked overview payload;
  assert counts agree (gap-suite style, per `docs/surfaces.md`).

---

## 12. Acceptance criteria

- [ ] Board overview renders the open queue sorted by
      `(priorityRank, stateRank, updatedAt desc)` with state/priority filters
      and `#N`/title/label search — no browser needed for triage.
- [ ] Issue detail shows body, comment thread, and structured Agent Envelope
      cards (agent id, model, branch, SHAs, `paseo://` link) in-client.
- [ ] Scoped label toggles advance `state/`–`priority/`–`attention/`–`spec/`
      with single taps and no client-side remove calls; UI repaints from
      server truth after each mutation.
- [ ] Quick comments post operator steering into the thread; composer text
      survives failures.
- [ ] Auth uses the existing `fgj` config with zero user-facing setup; the
      token never enters plugin memory or logs (`redactSecrets` on all
      cached payloads).
- [ ] Pill shows verify-first counts (`"3 verify · 12 open"` / `"3v"`) and
      deep-opens the pre-filtered dashboard; zero-verify hides the verify
      chip (never `0 verify`).
- [ ] Agent ID taps resolve to `paseo://` sessions (clipboard fallback);
      SHA taps open the web commit view (long-press copies).
- [ ] Built only from documented helper primitives; `initClientHelpers`
      shape unchanged; zero new SDK imports; client uses no Node
      built-ins.
- [ ] `forgejo.open-issues` contract and current pill behavior preserved
      throughout migration.
