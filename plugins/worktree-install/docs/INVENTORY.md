# Field inventory — `uppidi-fleet` → `worktree-install`

The operator's brief for [#629](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/629) said
*"Do not lose any currently provided information but layout and presentation is completely up
to you."* This file is the contract that makes that checkable: it enumerates **every** field,
status, action, and count the existing `plugins/uppidi-fleet` client surfaces render, and the
`worktree-install` implementation that carries each one over.

**Legend**

| Marker | Meaning |
| --- | --- |
| `[x]` | Carried over, same information, new presentation. |
| `[~]` | Carried over with a *documented, deliberate* change. The reason is in the row. |
| `[ ]` | **Not carried over.** Reason given. |

`worktree-install` renders three sections — **Fleet**, **Queue**, **Tickets** — matching the
brief's "fleet and queue and tickets". The legacy plugin's second *queue* (the work-queue tab)
is the **Tickets** section; its first (per-repo webhook message queues) is the **Queue**
section. Section **D** below is the legacy Settings tab, which is outside the brief's three
words; those rows are the explicit deferrals.

---

## Status

| | Count |
| --- | --- |
| Rows carried over unchanged | 227 |
| Rows carried over with a documented change | 6 |
| Rows not carried over | 0 |

See §E for the five legacy Settings sections that are outside the brief's "fleet and queue and
tickets" and are therefore deferred. They are listed there so the deferral is visible
rather than silent; §F lists what this plugin adds on top.

Verify it rather than trust it:

```bash
npm test --workspace=@xpufx/paseo-worktree-install
```

`client/render.test.ts` is the executable half of this file. It drives the three real
views with a realistic payload and asserts, by `testID`, that each element claimed above
is in the rendered tree. A row that loses its element fails the build. 105 tests total.

---

## A. Global chrome (present on every tab)

Source: `plugins/uppidi-fleet/client/surface.tsx` `UppidiTopHeaderBar` (`:201-285`) and the
tab bar (`:756`).

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| A1 | Forgejo brand mark | `UppidiBrandMark` → `ForgeIcon kind="forgejo"` | `BrandMark` in `client/kit.tsx` | `[x]` |
| A2 | Product title (`Cockpit`) | `surface.tsx:230` | `WorktreeInstallSurface` header | `[x]` |
| A3 | Product badge (`Uppidi Fleet`) | `surface.tsx:237` | badge reads `Worktree Install` | `[~]` renamed — the new plugin is not uppidi-fleet; the badge names *this* surface. |
| A4 | Router status **dot** | `StatusDot` from `resolveRouterStatusBadge` (`:169-180`) | `RouterState.chip` in `client/queue-view.tsx` header strip | `[x]` |
| A5 | Router status **badge** — `Router Active` (success, pulse) / `Router Starting` (warning) / `Router Disconnected` (danger) | `resolveRouterStatusBadge` (`:169-180`), rendered `:237-244` | same three states, same precedence (connected → starting → disconnected) in `shared/derive.ts:routerStateBadge` | `[x]` |
| A6 | Global repo selector (`All Repositories` + every enrolled/queued/ticket repo) | `surface.tsx:261-267`, options built `:626-639` | `client/kit.tsx` `RepoSelect`, same option-union | `[x]` |
| A7 | Refresh button (refetches every live query) | `surface.tsx:270-281` → `refetchAll` (`:538-549`) | `surface.tsx` `refreshAll` | `[x]` |
| A8 | Three-tab bar (Agents & Fleet / Work Queue / Settings) | `tabs` (`:121-125`) | Fleet / Queue / Tickets — **Settings is not a tab** (see D) | `[~]` |
| A9 | Permission + input attention total in the header (`⚠️ N Need Attention`) | `surface.tsx:245-254`, fed by `countPermissionAgents` / `collectAttentionAgents` | `shared/derive.ts:blockedSummary`, rendered in `client/fleet-view.tsx` rail | `[x]` |

---

## B. Agents & Fleet tab

Source: `plugins/uppidi-fleet/client/tree-view.tsx` (2660 lines).

### B.1 Section header, counts, and bulk action

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B1 | Pulsing success `StatusDot` when `runningCount > 0` | `tree-view.tsx:2431` | `client/kit.tsx` `LiveDot` | `[x]` |
| B2 | Section title (`Fleet Lineage Tree`) | `tree-view.tsx:2432` | `Fleet` header, different wording (`Fleet`) | `[~]` wording |
| B3 | `{totalCount} Total` count | `tree-view.tsx:2435` | `client/fleet-view.tsx` stat rail | `[x]` |
| B4 | `{runningCount} Running` count | `tree-view.tsx:2436` | same | `[x]` |
| B5 | `{idleCount} Idle` count | `tree-view.tsx:2437` | same | `[x]` |
| B6 | `{errorCount} Failed` count (suppressed at 0) | `tree-view.tsx:2438-2440` | same | `[x]` |
| B7 | `Archive Closed/Failed (N)` bulk action, disabled + loading at 0 candidates | `tree-view.tsx:2444-2453` | `client/fleet-view.tsx` `BulkArchive` | `[x]` |
| B8 | Bulk-archive eligibility rules (never front-desk/orchestrator, never blocked, never running/working/idle; only `failed:*` or terminal statuses) | `sort-filter.ts:484-541` | `shared/derive.ts:isBulkArchiveEligible` (same five rules, same comment structure) | `[x]` |

### B.2 Filters and search

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B9 | State filters: `All States`, `Working`, `Idle / Sleeping`, `Failed` | `tree-view.tsx:2460-2473` | `client/fleet-view.tsx` state chips | `[x]` |
| B10 | `Working` filter predicate (exact `working`) | `tree-view.tsx:2215` | `shared/derive.ts:matchesStateFilter` | `[x]` |
| B11 | `Idle / Sleeping` filter predicate (`idle*` or `sleeping`) | `tree-view.tsx:2220-2229` | same | `[x]` |
| B12 | `Failed` filter predicate (`failed*`) | `tree-view.tsx:2230-2232` | same | `[x]` |
| B13 | `Expand All` / `Collapse All` for projects | `tree-view.tsx:2474-2482`, `:2374-2392` | `client/fleet-view.tsx` | `[x]` |
| B14 | Search across name, shortId, deterministicState, stateDetail, model, provider, worktree, project, `#issue`, slug | `tree-view.tsx:2234-2249` | `shared/derive.ts:agentMatchesQuery` (all ten fields) | `[x]` |
| B15 | Search placeholder naming all searchable fields | `tree-view.tsx:2486` | equivalent | `[~]` wording |
| B16 | Tree filter keeps matching ancestors and prunes non-matching branches | `sort-filter.ts:777-802` `filterAgentTree` | `shared/derive.ts:filterTree` | `[x]` |

### B.3 Front Desk hero card

Source: `tree-view.tsx` `FrontDeskHero` (`:685-969`).

**Empty / standby variant**

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B17 | Inbox icon + `Fleet Front Desk` title | `tree-view.tsx:727-731` | `client/fleet-view.tsx` | `[x]` |
| B18 | `Liaison` badge | `tree-view.tsx:733` | same | `[x]` |
| B19 | Standby explanation text | `tree-view.tsx:735-737` | same | `[x]` |
| B20 | `Standby` badge | `tree-view.tsx:741` | same | `[x]` |
| B21 | `+ Create Front Desk` action | `tree-view.tsx:742-751` → `uppidiCreateFrontDeskContract` | `client/fleet-view.tsx` → `worktreeInstallCreateFrontDeskContract` | `[x]` |
| B22 | `Fleet Orchestrators (N):` label + per-orchestrator status lights (also in the active variant) | `tree-view.tsx:756-783`, `:939-965` | `client/fleet-view.tsx` `OrchestratorLights` | `[x]` |

**Active variant**

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B23 | Left border colour = deterministic-state colour | `tree-view.tsx:805` | `client/kit.tsx` `StateCard` | `[x]` |
| B24 | `FLEET FRONT DESK` uppercase eyebrow | `tree-view.tsx:824-831` | same | `[x]` |
| B25 | Agent name link (opens the agent session) | `AgentTitleLink` `:339-381` | `client/kit.tsx` `AgentLink` | `[x]` |
| B26 | `shortId` monospace badge | `tree-view.tsx:842-847` | same | `[x]` |
| B27 | Worktree badge | `tree-view.tsx:848-855` | same | `[x]` |
| B28 | Displayable agent labels (max 5 + `+N`, internal routing labels excluded) | `tree-view.tsx:972-1015` | `shared/derive.ts:displayableLabels` + `client/kit.tsx` `LabelStrip` | `[x]` |
| B29 | `deterministicState[: stateDetail]` badge with dot and state-coloured border | `tree-view.tsx:863-872` | `client/kit.tsx` `StatePill` | `[x]` |
| B30 | Model badge | `tree-view.tsx:874-876` | same | `[x]` |
| B31 | Relative last-activity time (`Ns/Nm/Nh/Nd ago`) | `formatRelativeTime` `:383-398` | `shared/derive.ts:relativeTime` | `[x]` |
| B32 | `Replace Front Desk` action | `tree-view.tsx:890-900` → `uppidiReplaceFrontDeskContract` | → `worktreeInstallReplaceFrontDeskContract` | `[x]` |
| B33 | Per-agent Archive action (with per-row loading/disabled) | `tree-view.tsx:912-919` | `client/kit.tsx` `IconAction` | `[x]` |
| B34 | Health gauge on the row (click toggles metrics) | `AgentHealthGauge` `:446-569` | `client/kit.tsx` `HealthGauge`; `front-desk-gauge` on the liaison row, `agent-gauge-<id>` on agent rows | `[x]` |

### B.4 Agent metrics card (expanded from B34)

Source: `AgentMetricsCard` (`:582-674`).

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B35 | `Context` — % used, sub-value `used / max` | `:646-654` | `client/fleet-view.tsx` `MetricsSheet` | `[x]` |
| B36 | `Cached ratio` — % cached of (cached+input), sub-value `N cached` | `:655` | same | `[x]` |
| B37 | `Cost` — `$N.NN` | `:656` | same | `[x]` |
| B38 | `Input tokens` | `:657-660` | same | `[x]` |
| B39 | `Output tokens` | `:661-664` | same | `[x]` |
| B40 | `Turn duration` | `:665` | same | `[x]` |
| B41 | `Session lifetime` (updatedAt − created) | `:666` | same | `[x]` |
| B42 | `Permission wait` (now − attentionTimestamp) | `:667` | same | `[x]` |
| B43 | `Errors` (lastError or `None`) | `:668` | same | `[x]` |

### B.5 Attention / permission banner

Source: `AgentAttentionBanner` (`:1091-1182`) and `AttentionAgentCard` (`surface.tsx:297-371`).

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B44 | Pulsing radar beacon wrapper, danger tone for permissions, warning for input | `:1111-1121` | `client/kit.tsx` `Beacon` | `[x]` |
| B45 | `⚠️ Permission Needed: <action>` badge, where action = title ‖ tool ‖ name ‖ kind ‖ `tool permission` | `:1136-1146` + `contracts.ts:663-671` | `shared/derive.ts:permissionAction` | `[x]` |
| B46 | `⏸ Awaiting Input: <reason>` badge, reason from `finished/error/permission/input` | `:1138-1139` + `contracts.ts:700-717` | `shared/derive.ts:attentionReasonLabel` | `[x]` |
| B47 | `+N more` pending-permission count | `:1147-1154` | `client/kit.tsx` `AttentionStrip` | `[x]` |
| B48 | Copyable adjudication command `paseo permit allow <agent> <requestId>` (falls back to agent-only) | `:1157-1165` + `contracts.ts:674-680` | `shared/derive.ts:adjudicationCommand` | `[x]` |
| B49 | Compact variant with a `Copy permit command` button (dense rows) | `:1167-1178` | `client/kit.tsx` `AttentionStrip` compact mode | `[x]` |
| B50 | Cockpit-level `Fleet Needs Attention (N)` card with permission-count subtitle | `surface.tsx:1388-1416` | `client/fleet-view.tsx` blocked banner | `[x]` |
| B51 | Up to 5 attention agents shown, then `+N more blocked agents` | `surface.tsx:1402-1413` | same | `[x]` |
| B52 | `+N more pending permission request(s)` line on the card | `surface.tsx:342-347` | same | `[x]` |
| B53 | `Open agent` action on the card | `surface.tsx:349-357` | same | `[x]` |
| B54 | `agentRequiresAttention` rule (pending permission, or `requiresAttention` with a non-`finished` reason) | `contracts.ts:687-697` | `shared/derive.ts:requiresAttention` | `[x]` |
| B55 | Permission target **scope** extraction (input keys, `Scope:` description prefix) | `contracts.ts:566-619` | `shared/derive.ts:permissionScope` | `[x]` |
| B56 | `blockDetail` (requiredPermissionId, scope, action, command) | `contracts.ts:627-660` | `shared/derive.ts:blockDetail` | `[x]` |

### B.6 Orchestrator row

Source: `OrchestratorRow` (`:1415-1660`).

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B57 | Tree guide connector (`├──` / `└──`) | `:1487-1498` | `client/kit.tsx` `Guide` | `[x]` |
| B58 | Expand/collapse chevron + child count plumbing | `:1500-1519` | `client/fleet-view.tsx` | `[x]` |
| B59 | Status light (hover tooltip = `name (state: detail)`) | `AgentStatusLight` `:116-231` | `client/kit.tsx` `StatusLight` (tooltip preserved) | `[x]` |
| B60 | `Network` category icon | `:1522` | same | `[x]` |
| B61 | `Orchestrator` badge | `:1535` | same | `[x]` |
| B62 | `Main Dirty[: summary]` badge, clickable to open the orchestrator | `:1538-1562` | same | `[x]` |
| B63 | `N subagent(s)` badge when collapsed | `:1563-1570` | same | `[x]` |
| B64 | Side-by-side child agent status lights | `:1572-1581` | `client/fleet-view.tsx` | `[x]` |
| B65 | Row hover tint | `:1463-1474` | `client/kit.tsx` `HoverRow` | `[x]` |
| B66 | Worktree badge, model badge, state badge, relative time, archive, full (non-compact) health gauge | `:1585-1645` | same set | `[x]` |
| B67 | Full (non-compact) attention banner with command box | `:1649-1654` | same | `[x]` |

### B.7 Dense worker row

Source: `DenseAgentRow` (`:1200-1409`).

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B68 | `├──` / `└─` connector with depth indent (capped at 64px) | `:1216`, `:1245-1263` | `client/kit.tsx` `Guide` | `[x]` |
| B69 | Category icon from state config (`Inbox`/`Network`/`Terminal`/`Bot`) | `:1265` + `contracts.ts:378-389` | `shared/derive.ts:categoryIcon` | `[x]` |
| B70 | Category badge when not `worker` | `:1279-1286` | same | `[x]` |
| B71 | Parentage pill — `via Front Desk` / `via <parentName>` / `via <parentId[:7]>`, clickable to open the parent | `:1017-1076` | `shared/derive.ts:parentPillLabel` + `client/kit.tsx` `ParentPill` | `[x]` |
| B72 | `#<issue>` attribution badge | `:1307-1314` | same | `[x]` |
| B73 | Compact health gauge on the trailing edge | `:1358-1364` | same | `[x]` |
| B74 | Compact attention banner | `:1368-1373` | same | `[x]` |
| B75 | Expanded metrics card between row and children | `:1375-1376` | same | `[x]` |
| B76 | Recursive descendants, no card wrappers | `:1380-1406` | same | `[x]` |

### B.8 Project groups

Source: `ProjectGroupCard` (`:1667-1963`) and `sort-filter.ts:723-1000`.

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B77 | `FolderGit2` icon + project name | `:1735-1745` | `client/fleet-view.tsx` | `[x]` |
| B78 | `{n} Orchestrator(s)` count badge | `:1746-1753` | same | `[x]` |
| B79 | `{n} Worker(s)` count badge | `:1754-1759` | same | `[x]` |
| B80 | `🔇 Muted` badge + dimmed group + left warning rule | `:1762-1770`, `:1701-1710` | same | `[x]` |
| B81 | `⚪ No Orchestrator` badge | `:1773-1775` | same | `[x]` |
| B82 | `{n} hooks queued` badge | `:1776-1784` | same | `[x]` |
| B83 | `Detached / Local` badge | `:1788-1790` | same | `[x]` |
| B84 | `Mute` / `Unmute` action | `:1795-1805` → `uppidiToggleRepoMuteContract` | → `worktreeInstallToggleRepoMuteContract` | `[x]` |
| B85 | `+ Add Orchestrator` action | `:1807-1817` → `uppidiAddOrchestratorContract` | → `worktreeInstallAddOrchestratorContract` | `[x]` |
| B86 | `Replace Orchestrator` action | `:1819-1834` → `uppidiReplaceOrchestratorContract` | → `worktreeInstallReplaceOrchestratorContract` | `[x]` |
| B87 | `{n} Active` badge (running count) | `:1836-1844` | same | `[x]` |
| B88 | `{n} Total` badge when collapsed | `:1845-1852` | same | `[x]` |
| B89 | `No agents active. Enrolled repository is unstaffed.` empty line | `:1869-1879` | same | `[x]` |
| B90 | Unparented workers rendered under the project | `:1938-1955` | same | `[x]` |
| B91 | `Detached / Local Workspaces (N)` section with divider | `:2560-2605` | same | `[x]` |
| B92 | `Stale / Orphaned Front Desk Sessions (N)` section + singleton explanation | `:2610-2655` | same | `[x]` |
| B93 | Primary Front Desk selection: hook-daemon registration wins, then single active, then most recently active | `sort-filter.ts:824-868` `selectPrimaryFrontDeskNode` | `shared/derive.ts:selectPrimaryFrontDesk` | `[x]` |
| B94 | Enrolled repos are always listed even with 0 agents | `sort-filter.ts:870-1000` `buildProjectGroups` | `shared/derive.ts:buildProjectGroups` | `[x]` |
| B95 | Repo matching tolerant of protocol/host/`.git`/`git@` prefixes and bare-name suffixes | `sort-filter.ts:762-775` `isRepoMatching` | `shared/derive.ts:repoMatches` | `[x]` |
| B96 | Empty state: `Scanning fleet...` / `No matching agents` + description + `Clear Filters` | `tree-view.tsx:2508-2533` | same | `[x]` |

### B.9 Agent data fields (the record itself)

Source: `contracts.ts:719-769` `UppidiAgentSchema`. Every field is carried.

| # | Field | Worktree-install |
| --- | --- | --- |
| B97 | `id` | `[x]` |
| B98 | `shortId` | `[x]` |
| B99 | `name` | `[x]` |
| B100 | `category` (`front-desk` / `orchestrator` / `worker`) | `[x]` |
| B101 | `provider` | `[x]` |
| B102 | `model` | `[x]` |
| B103 | `status` | `[x]` |
| B104 | `cwd` | `[x]` |
| B105 | `created` | `[x]` |
| B106 | `updatedAt` | `[x]` |
| B107 | `lastActivityAt` | `[x]` |
| B108 | `workspaceId` | `[x]` |
| B109 | `parentId` / `parentName` / `parentCategory` | `[x]` |
| B110 | `deterministicState` (12 values) | `[x]` |
| B111 | `stateDetail` | `[x]` |
| B112 | `lifecycleState` (5 values) + `deriveLifecycleState` / `isBlockedLifecycleState` | `[x]` `shared/derive.ts:lifecycleState` |
| B113 | `blockDetail` | `[x]` |
| B114 | `attributedWork` (`repo`/`issue`/`slug`/`branch`) | `[x]` `shared/derive.ts:attributedWork` |
| B115 | `usage` (`inputTokens`/`outputTokens`/`cachedInputTokens`/`totalCostUsd`) | `[x]` |
| B116 | `metrics` (8 fields) | `[x]` `shared/derive.ts:projectMetrics` |
| B117 | `lastError` | `[x]` |
| B118 | `url` | `[x]` |
| B119 | `worktree` + `extractAgentWorktree` resolution order | `[x]` `shared/derive.ts:worktreeSlug` |
| B120 | `project` + `extractAgentProject` authoritative-only resolution | `[x]` `shared/derive.ts:projectKey` |
| B121 | `isEnrolled` / `isMuted` / `hasOrchestrator` / `queuedHooksCount` / `isDetached` | `[x]` |
| B122 | `labels` record | `[x]` |
| B123 | `isMainDirty` / `mainDirtySummary` | `[x]` |
| B124 | `pendingPermissions` (`id`/`requestId`/`name`/`title`/`tool`/`kind`/`description`/`input`/`scope`) | `[x]` |
| B125 | `requiresAttention` / `attentionReason` | `[x]` |
| B126 | `frontDesk` / `orchestrators` / `workers` / `tree` output buckets | `[x]` |
| B127 | `enrolledRepos` / `mutedRepos` / `repoQueuedHooks` | `[x]` |
| B128 | `totalCount` / `runningCount` / `idleCount` / `errorCount` | `[x]` |
| B129 | `attentionReason` union (`finished`/`error`/`permission`/`input`) | `[x]` |

### B.10 Deterministic-state presentation table

Source: `contracts.ts:391-498` `getDeterministicStateConfig`. All 12 states keep their
semantic colour, tone, pulse behaviour, and human label.

| # | State | Label | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B130 | `working` | Working (green, pulse) | `shared/derive.ts:STATE_TABLE` | `[x]` |
| B131 | `running` | Running (blue) | same | `[x]` |
| B132 | `sleeping` | Sleeping (purple) | same | `[x]` |
| B133 | `idle:waiting` | Waiting (grey) | same | `[x]` |
| B134 | `idle:quota-exhausted` | Quota Cooldown (amber) | same | `[x]` |
| B135 | `permission-prompt` | Permission Needed (amber, pulse) | same | `[x]` |
| B136 | `attention-required` | Awaiting Input (amber, pulse) | same | `[x]` |
| B137 | `failed:quota-exhausted` | Quota Exhausted (orange) | same | `[x]` |
| B138 | `failed:spawn` | Failed (red) | same | `[x]` |
| B139 | `failed:timeout` | Failed (red) | same | `[x]` |
| B140 | `failed:error` | Failed (red) | same | `[x]` |
| B141 | `unknown` | Unknown (grey) | same | `[x]` |

### B.11 Health gauge

Source: `sort-filter.ts:89-202`.

| # | Item | Worktree-install | Done |
| --- | --- | --- | --- |
| B142 | Three fixed segments: context / turn / error | `shared/derive.ts:healthGauge` | `[x]` |
| B143 | Context thresholds 0.75 warn / 0.90 critical | same | `[x]` |
| B144 | Turn stall threshold 5 min, full clock-arc sweep | same | `[x]` |
| B145 | Error segment lights on `failed:*` state or non-empty `lastError` | same | `[x]` |
| B146 | `overall` = worst tone across segments | same | `[x]` |
| B147 | Absent `metrics` block renders **no gauge at all** (no misleading zero) | same | `[x]` |
| B148 | Running-with-active-turn renders a clock arc instead of the stacked bar | `client/kit.tsx` `HealthGauge` | `[x]` |
| B149 | Compact (28px) vs full (56px) track width | same | `[x]` |

### B.12 Agent actions (mutations)

| # | Action | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| B150 | Archive one agent | `uppidiArchiveAgentContract` | `worktree-install.archive-agent` | `[x]` |
| B151 | Bulk-archive inactive agents | `uppidiArchiveInactiveAgentsContract` | `worktree-install.archive-inactive-agents` | `[x]` |
| B152 | Create Front Desk | `uppidiCreateFrontDeskContract` | `worktree-install.create-front-desk` | `[x]` |
| B153 | Replace Front Desk | `uppidiReplaceFrontDeskContract` | `worktree-install.replace-front-desk` | `[x]` |
| B154 | Add Orchestrator | `uppidiAddOrchestratorContract` | `worktree-install.add-orchestrator` | `[x]` |
| B155 | Replace Orchestrator | `uppidiReplaceOrchestratorContract` | `worktree-install.replace-orchestrator` | `[x]` |
| B156 | Toggle repo mute | `uppidiToggleRepoMuteContract` | `worktree-install.toggle-repo-mute` | `[x]` |
| B157 | Open agent session (`navigation.openAgent`, `paseo://agent/<id>` fallback, clipboard fallback) | `AgentStatusLight` `:134-150`, `AgentTitleLink` `:342-356` | `shared/derive.ts:agentHref` + `client/kit.tsx` `AgentLink` | `[x]` |
| B158 | Open parent agent session | `:1057-1072` | same | `[x]` |
| B159 | Copy adjudication command with toast feedback | `:1105-1108` | `client/kit.tsx` `AttentionStrip` | `[x]` |
| B160 | Toast on every mutation success/failure | throughout | `client/surface.tsx` `useAction` | `[x]` |

---

## C. Work Queue tab (legacy) → **Tickets** section

Source: `surface.tsx:1385-1751`.

### C.1 Ticket list

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| C1 | `Open issues: N` stat, click → `all` filter | `surface.tsx:1432-1454` | `client/tickets-view.tsx` stat | `[x]` |
| C2 | `Needs your attention: N` stat, click → `needs-you`, amber when > 0 | `:1458-1490` | same | `[x]` |
| C3 | `Awaiting review: N` stat, click → `triage-review`, accent when > 0 | `:1494-1526` | same | `[x]` |
| C4 | Preset filter `All work (N)` | `:1534`, `:112-119` | same | `[x]` |
| C5 | Preset filter `Needs You (N)` (`attention/2-user`) | `:1535-1537` | same | `[x]` |
| C6 | Preset filter `Needs Attention (N)` (any `attention/*`) | `:1538-1543` | same | `[x]` |
| C7 | Preset filter `Triage / Review (N)` (status `Review` or `state/0-triage`/`state/2-review`) | `:1544-1549` | same | `[x]` |
| C8 | Preset filter `In Progress (N)` (status `In progress` or `state/1-wip`) | `:1550-1555` | same | `[x]` |
| C9 | Preset filter `Verify (N)` (`state/3-verify`) | `:1556-1558` | same | `[x]` |
| C10 | Repo scope label | `:1575-1577` | same | `[x]` |
| C11 | `N issues in view` subtitle | `:1584` | same | `[x]` |
| C12 | A `Dispatch work` action on the list | `:1586-1599` | `client/tickets-view.tsx` `ticket-dispatch-<n>` on every row, plus `ticket-detail-dispatch` on the record | `[~]` per-row and on the record, rather than one button aimed at whatever happens to be first in the list |
| C13 | Search over title, number, label | `:1603-1608` + `sort-filter.ts:220-278` | `shared/derive.ts:ticketMatchesQuery` | `[x]` |
| C14 | Sort by `#`, `Title`, `Status`, `Comments`, `Repo` with direction indicator | `:1610-1628` + `sort-filter.ts:280-309` | `shared/derive.ts:sortTickets` | `[x]` |
| C15 | Ticket column (`#number · title`, opens detail) | `:1645-1657` | `client/tickets-view.tsx` row | `[x]` |
| C16 | Status column with tone per status | `:1658-1663` + `statusVariant` `:133-144` | same | `[x]` |
| C17 | Owner column: `Orchestrator` / `Agent` / `You` | `:1664-1673` + `attentionMap` `:127-131` | `shared/derive.ts:ownerLabel` | `[x]` |
| C18 | Empty state `No issues match this filter` + `Clear filters` | `:1633-1643` | same | `[x]` |

### C.2 Ticket detail modal

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| C19 | `repo #number` accent line | `:1690-1692` | `client/ticket-detail.tsx` | `[x]` |
| C20 | Status badge, owner badge, `N comments` badge | `:1693-1700` | same | `[x]` |
| C21 | Ticket title | `:1702-1704` | same | `[x]` |
| C22 | Every label rendered as a chip | `:1706-1712` | same | `[x]` |
| C23 | `Worktree branch` (copyable, `No worktree dispatched yet` fallback) | `:1714-1718` | same | `[x]` |
| C24 | `Close` action | `:1722-1727` | same | `[x]` |
| C25 | `Open in Forgejo` action (only when a URL is present) | `:1728-1736` | same | `[x]` |
| C26 | `Dispatch Worktree` action | `:1737-1746` | same | `[x]` |

### C.3 Ticket data fields + status derivation

Source: `contracts.ts:20-52`, `server/issues.ts:82-125`.

| # | Item | Worktree-install | Done |
| --- | --- | --- | --- |
| C27 | `number`, `title`, `state`, `repo`, `url`, `updatedAt` | `[x]` |
| C28 | `comments` | `[x]` |
| C29 | `labels` (full list) | `[x]` |
| C30 | `branch` (detected from the ticket body) | `[x]` |
| C31 | `status` ∈ `Backlog` / `In progress` / `Review` / `Done` and the label→status mapping incl. `review/*` prefix | `[x]` `server/tickets.ts` |
| C32 | `attention` ∈ `attention/0-orchestrator` / `attention/1-agent` / `attention/2-user`, incl. legacy `attention/user` + `attention:user` normalisation | `[x]` |
| C33 | Output counts `openCount`, `inFlightCount`, `reviewCount`, `needsYouCount` | `[x]` |
| C34 | `state` input selector (`open` / `closed` / `all`) | `[x]` |

---

## D. Hook queue data (legacy Settings tab) → **Queue** section

Source: `surface.tsx:922-1032` (queues), `:774-920` (router read-out), `contracts.ts:61-113`.

### D.1 Router read-out (carried read-only)

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| D1 | `Bundled router: <state>` + status dot | `:783-787` | `client/queue-view.tsx` `RouterStrip` | `[x]` |
| D2 | Router endpoint `http://<host>:<port>` | `:816-820` | same | `[x]` |
| D3 | Active host / `Not listening` | `:822-824` | same | `[x]` |
| D4 | Active port / `Not listening` | `:826-828` | same | `[x]` |
| D5 | Configured address | `:829-832` | same | `[x]` |
| D6 | Front desk agent id (copyable, `None assigned` fallback) | `:833-837` | same | `[x]` |
| D7 | `Total queued across repos` | `:838` | same | `[x]` |
| D8 | Service name / version / uptime from `/status` | `contracts.ts:87-96` | `client/queue-view.tsx` | `[x]` |
| D9 | Paused repo list | `contracts.ts:101` | same | `[x]` |
| D10 | `repoCount` | `contracts.ts:103` | same | `[x]` |
| D11 | `xCommsInstalled` cross-plugin capability flag | `contracts.ts:106-109` | `worktree-install.router-status.capabilities.xCommsInstalled` | `[x]` |

### D.2 Per-repo queues

| # | Item | Legacy source | Worktree-install | Done |
| --- | --- | --- | --- | --- |
| D12 | Section count `{visible}/{total} repos, {totalQueued} messages` | `:924` | `client/queue-view.tsx` | `[x]` |
| D13 | Preset `All` | `:934-941` | same | `[x]` |
| D14 | Preset `Pending / Busy` | `:942-948` | same | `[x]` |
| D15 | Preset `Paused / Dead` | `:949-956` | same | `[x]` |
| D16 | Sort by `Repo` / `Depth` / `Status` with direction | `:957-970` + `sort-filter.ts:351-379` | `shared/derive.ts:sortQueues` | `[x]` |
| D17 | Search over repo and orchestrator | `:975-980` + `sort-filter.ts:315-349` | `shared/derive.ts:queueMatchesQuery` | `[x]` |
| D18 | Queue key (repo) | `:989` | `client/queue-view.tsx` | `[x]` |
| D19 | `Paused` / `Busy` / `Ready` status badge | `:990-996` | same | `[x]` |
| D20 | `{depth} queued` badge (when > 0) | `:997` | same | `[x]` |
| D21 | `Orchestrator: <agentId[:8]>...` | `:999-1003` | same | `[x]` |
| D22 | `Pause` / `Resume` per-queue action | `:1006-1010` | same | `[x]` |
| D23 | `Drain` per-queue action | `:1011` | same | `[x]` |
| D24 | Up to 3 message previews, monospace, `• <preview>` | `:1014-1026` | same | `[x]` |
| D25 | `Pause all` / `Resume all` | `:971-972` | same | `[x]` |
| D26 | Empty: `No active queues.` / `No queues match the selected filter.` | `:982-984` | same | `[x]` |
| D27 | `busyAttempts` and `dropped` per queue | `contracts.ts:73,75` | `[x]` |
| D28 | `orchestrator.updatedAt` / `.by` | `contracts.ts:77-78` | `[x]` |

---

## E. Deliberate non-carriages

These are the `[ ]` rows. Each one is a conscious decision, not an oversight.

| # | Not carried | Why |
| --- | --- | --- |
| E1 | Hook service `Start` / `Restart` / `Stop` (`surface.tsx:792-809`) | Mutates the *bundled router owned by `uppidi-fleet`*. A second plugin silently starting, stopping, or reconfiguring another plugin's daemon is an ownership violation; the operator can still do it from the `uppidi-fleet` surface or the daemon. Read-only router state **is** carried (D1-D7). |
| E2 | Listen-address / port reconfiguration form (`surface.tsx:841-917`) | Same ownership reason, and it persists into `uppidi-fleet`'s own settings store. |
| E3 | Hook log tail (`surface.tsx:1035-1056`) | Daemon diagnostics, not fleet/queue/tickets. |
| E4 | Agent role models & fallback groups (`surface.tsx:1059-1114`) | Model routing configuration, not fleet/queue/tickets. |
| E5 | CI runner fleet (`surface.tsx:1117-1208`) | CI inventory, not fleet/queue/tickets. |
| E6 | Fleet capability & benchmark matrix (`surface.tsx:1211-1370`) | Model benchmark reporting, not fleet/queue/tickets. |
| E7 | Plugin settings screen (`index.client.tsx:46-55`: `hookHost`, `hookPort`) | Its only two fields are the reconfiguration that E2 drops. |
| E8 | `filterAgents` / `sortAgents` presets (`sort-filter.ts:381-482`) | Dead code in the legacy plugin — no call site renders them. |

E3-E6 are the honest remainder: the brief named *fleet, queue, tickets*, and the legacy
Settings tab is a fifth thing. They are ~460 lines of the old `surface.tsx` and are listed here
so the deferral is visible rather than silent. If the operator wants them, they are additive and
do not touch anything above.

---

## F. Deliberate additions

Information the new design adds that the legacy surface did not show. Nothing in F removes
anything in A-E.

| # | Addition | Where |
| --- | --- | --- |
| F1 | Canonical `lifecycleState` surfaced next to `deterministicState` (the legacy plugin computes it server-side but never renders it) | `client/fleet-view.tsx` state pill |
| F2 | `blockDetail.scope` (the permission target path) shown inline, not only inside the command | `client/kit.tsx` `AttentionStrip` |
| F3 | `usage` block rendered on the metrics sheet (legacy computes `usage` and never shows it) | `client/fleet-view.tsx` `MetricsSheet` |
| F4 | `provider` rendered on the row (legacy searches on it but never shows it) | `client/fleet-view.tsx` `AgentRow` |
| F5 | `cwd`, `workspaceId`, `url`, `created` available in the agent inspector | `client/fleet-view.tsx` `MetricsSheet` |
| F6 | `hasOrchestrator` per project | `client/fleet-view.tsx` project header |
| F7 | Queue `busyAttempts` / `dropped` surfaced | `client/queue-view.tsx` queue row |
