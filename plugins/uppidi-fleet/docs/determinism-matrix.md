# uppidi-fleet determinism matrix

<!-- GENERATED FILE. Do not edit by hand. Run `node scripts/fleet-determinism-matrix.mjs` -->
<!-- from the repository root; `--check` verifies the committed copy. Source: #705. -->

Every moving part of `plugins/uppidi-fleet`, classified as **deterministic**, **AI/LLM-based**,
**hybrid**, or **contested** where the evidence does not settle it. The file inventory, line
counts, export lists and runner attributions below are read from the tree by the generator;
only the labels and their evidence citations are human judgement. A part whose anchor symbol has
been renamed fails the generator instead of being described from memory — see
`scripts/fleet-determinism-matrix.mjs`.

## Legend

| Label | Meaning |
| --- | --- |
| `deterministic` | No model in the causal path. Same inputs, same output, modulo external state. |
| `ai-llm` | This part's own output is produced by model inference. |
| `hybrid` | A deterministic control plane whose correctness depends on, or whose action lands in, a model session it does not control. |
| `contested` | The honest answer depends on the lens, or the code is deterministic while the claim it encodes is not. Reported with the reason rather than forced into a bucket. |

**Observing a model is not being one.** Telemetry that reads an LLM session's token counts,
cost and turn state is arithmetic over counters, and is `deterministic`. Three rows below —
`server/metrics.ts` rollups, `server/agents.ts` state derivation, and the client gauges that
render them — exist only to make that distinction explicit, because the opposite reading is
the easy mistake.

## Distribution

| Label | Parts |
| --- | ---: |
| `deterministic` | 43 |
| `hybrid` | 3 |
| `ai-llm` | 0 |
| `contested` | 2 |
| **total** | **48** |

Inventory: 41 tracked source files in scope — 33 described above as source (26 files, some carrying several parts) and 15 test suites, which are described by the inventory itself rather than by hand.

**The `ai-llm` column is empty, and that is the finding rather than a gap.** Nothing in this
plugin performs model inference: there is no completions call, no provider SDK, no temperature
or sampling parameter anywhere under `plugins/uppidi-fleet`. The plugin's entire AI surface is
indirect — it spawns model-backed sessions and steers messages into them, and the model's
behaviour is whatever the model does. Every row that touches that behaviour is therefore
`hybrid`: deterministic machinery on the near side, unconstrained inference on the far side.
See *What this table does not cover* below for the sessions themselves.

## Plugin entry points

| Moving part | File | File exports | File loc | Classification | Anchors | Evidence |
| --- | --- | ---: | ---: | --- | --- | --- |
| RPC registration and plugin lifecycle | `index.server.ts` | 1 | 146 | `deterministic` | `server.handle`, `startHookRouter`, `registerSettingsRpc` | index.server.ts:81-103 — 23 `server.handle(contract, handler)` bindings, one per RPC contract<br>index.server.ts:133 — `startHookRouter(server)` starts the HTTP listener<br>index.server.ts:142-145 — teardown returns a disposer, no model call |
| Sidebar surface, workspace panel, helper settings screen registration | `index.client.tsx` | 8 | 84 | `deterministic` | `registerSidebarSurface`, `addWorkspacePanel`, `registerHelperSettingsScreen` | index.client.tsx:26-62 — three registrations, each returning a disposer<br>index.client.tsx:64-83 — teardown calls each disposer, tolerating either shape |

- **RPC registration and plugin lifecycle** (`index.server.ts`) — Binds contracts to handlers and owns load/unload. Every handler it registers is classified on its own row below.
- **Sidebar surface, workspace panel, helper settings screen registration** (`index.client.tsx`) — Client lifecycle. All three registrations render over server data classified below.

## Server

| Moving part | File | File exports | File loc | Classification | Anchors | Evidence |
| --- | --- | ---: | ---: | --- | --- | --- |
| Agent record normalisation, metrics projection, deterministic-state derivation | `server/agents.ts` | 49 | 2000 | `deterministic` | `normalizeRawAgent`, `normalizeAgentMetrics`, `deriveDeterministicState`, `categorizeAgent` | agents.ts:227-253 — copies token/cost/turn counters off the record, no inference<br>agents.ts:255-348 — `deriveDeterministicState` is ordered `if`/`includes` matching over status and error text<br>agents.ts:281-296 — quota/spawn/timeout classification is literal substring matching |
| Fleet topology, workspace mapping, permission scope, on-disk metadata | `server/agents.ts` | 49 | 2000 | `deterministic` | `buildAgentTree`, `getWorkspaceProjectMap`, `findScopeMatchingPermission`, `getAgentDiskMetadataMap`, `checkRepoMainDirty` | agents.ts:425-543 — `buildAgentTree` links parents to children from ids<br>agents.ts:689-707 — `checkRepoMainDirty` shells `git status` and parses the result<br>agents.ts:758 — `fetchPaseoAgents` reads `paseo ls --json` |
| Agent session spawning, front-desk and orchestrator lifecycle, spawn-authority guard | `server/agents.ts` | 49 | 2000 | `hybrid` | `spawnPaseoAgent`, `handleUppidiCreateFrontDesk`, `handleUppidiAddOrchestrator`, `evaluateSpawnAuthority` | agents.ts:1519 — `context.paseo.agents.create(createPayload)` creates a model-backed session<br>agents.ts:1563 — CLI fallback `paseo run -d ... <prompt>` — the prompt is the agent's task<br>agents.ts:1652-1654 — default front-desk prompt is a fixed instruction string<br>agents.ts:1380-1428 — spawn-authority guard is deterministic policy over caller id and cwd |
| Forgejo host/token resolution and classified API reads | `server/forgejo-api.ts` | 11 | 123 | `deterministic` | `resolveForgejoHost`, `resolveForgejoToken`, `forgejoApiGet`, `forgejoToken` | forgejo-api.ts:9-11 — host is `process.env.FORGEJO_HOST` or a constant<br>forgejo-api.ts:24-47 — token is read from env or parsed out of `~/.config/tea/config.yml`<br>forgejo-api.ts:88-122 — one GET, three outcomes: ok / http-error / unreachable |
| Issue read and label-derived attention/status projection | `server/issues.ts` | 1 | 103 | `deterministic` | `handleUppidiIssues` | issues.ts:20-32 — single `GET /api/v1/repos/<repo>/issues`<br>issues.ts:55-64 — attention is exact label matching against three known spellings<br>issues.ts:66-73 — status is a fixed precedence over `state/*` and `review/*` labels |
| Hook-service RPC handlers, endpoint resolution, x-comms presence probe | `server/hook.ts` | 11 | 227 | `deterministic` | `resolveHookUrl`, `handleHookStatus`, `handleHookQueues`, `handleHookConfigure`, `handleHookLogTail` | hook.ts:42-78 — ordered fallback: explicit arg, env, live router, settings, persisted config, loopback<br>hook.ts:87-96 — status is a `fetch` with a 4s timeout<br>hook.ts:105-111 — `isPluginInstalled` tolerates absence to `false` and never throws |
| Webhook ingress, event classification, digest and coalesce formatting | `server/hook-router.ts` | 98 | 3716 | `deterministic` | `isBypassEvent`, `sosStateOf`, `eventKind`, `eventHash`, `formatDigest`, `summarize`, +3 more | hook-router.ts:246-267 — bypass is one regex over the event body<br>hook-router.ts:291-300 — `eventKind` maps a fixed event-type table<br>hook-router.ts:358-368 — `formatDigest` is string concatenation<br>hook-router.ts:1489 — `ingestWebhook` classifies then enqueues |
| Queue persistence, pause/resume/mute, drain scheduling, backoff | `server/hook-router.ts` | 98 | 3716 | `deterministic` | `loadRouterConfig`, `saveRouterConfig`, `getFleetRosterInfo`, `drain`, `pause`, `resume`, +2 more | hook-router.ts:2776-2885 — `drain` is guarded by closed/paused/muted/draining sets<br>hook-router.ts:2833 — backoff delay is `min(30000, 3000 * 1.5^attempts)`<br>hook-router.ts:2694-2724 — pause/resume mutate a `Set` |
| Fleet watchdog: health taxonomy detection and recovery planning | `server/hook-router.ts` | 98 | 3716 | `hybrid` | `assessAgentHealth`, `planWatchdogRecovery`, `WATCHDOG_TAXONOMY`, `scanCancellationTimeouts`, `runWatchdogAudit`, `recoverWatchdogAgent` | hook-router.ts:984-1006 — six boolean detectors, each substring or timestamp comparison<br>hook-router.ts:1054-1072 — `planWatchdogRecovery` is set algebra over the taxonomy<br>hook-router.ts:1060 — quota exhaustion is a circuit break: `steer` is forced false<br>hook-router.ts:2154 — the plan is executed by steering a live turn |
| Message delivery into live LLM sessions (steer / no-wait, onboarding, board-sweep notice) | `server/hook-router.ts` | 98 | 3716 | `hybrid` | `deliverMessage`, `runBoardSweep`, `doFrontDeskHandoff` | hook-router.ts:1813 — `agentRef.send(msg, { steer })` hands text to a model-backed session<br>hook-router.ts:1826-1829 — CLI fallback `paseo send --no-wait --steer <id> <msg>`<br>hook-router.ts:2471-2474 — handoff onboarding text is a template, delivered with `steer: true`<br>hook-router.ts:2531-2556 — board sweep summarises candidates deterministically, then steers the notice |
| Hook HTTP service surface: listen, status/info/queues, configure, restart, teardown | `server/hook-router.ts` | 98 | 3716 | `deterministic` | `getHookServiceStatus`, `configureHookService`, `executeHookServiceAction`, `getHookRouterInfo`, `startHookRouter`, `handleHttpRequest`, +1 more | hook-router.ts:2960-3002 — `createServer` + `listen`, EADDRINUSE degrades to disabled rather than throwing<br>hook-router.ts:3047-3088 — `configure` writes config then restarts if listening<br>hook-router.ts:3455-3484 — status is a projection of bound address, pid and uptime |
| Model rollup receipts and candidate derivation from daemon counters | `server/metrics.ts` | 19 | 700 | `deterministic` | `computeModelRollups`, `deriveCandidatesFromReceipts`, `appendRollupReceipt`, `loadFleetMetrics`, `median` | metrics.ts:409-480 — groups by `provider::model`, reduces with a median over per-agent counters<br>metrics.ts:489-532 — candidate rows are sums and a completion rate over stored receipts<br>metrics.ts:559-613 — append is a read-modify-write with a tmp file + rename<br>metrics.ts:483-488 — comment states task-profile attribution is deliberately absent: minimized receipts cannot carry it |
| BASELINE_CANDIDATES seed table | `server/metrics.ts` | 19 | 700 | `contested` | `BASELINE_CANDIDATES`, `DEFAULT_TASK_PROFILES`, `METRICS_PRIVACY_NOTICE` | metrics.ts:44-281 — four hand-authored models with pass rates, trial counts and latency figures<br>metrics.ts:624-628 — but `loadFleetMetrics` no longer serves it: the baseline is 'retired as served data'<br>metrics.test.ts:223 — its one remaining consumer asserts it is *not* served (`assert.notEqual`) |
| Role-to-model assignment, persistence, and available-model discovery | `server/role-models.ts` | 6 | 167 | `contested` | `DEFAULT_ROLE_MODELS`, `loadSavedRoleModels`, `saveRoleModels`, `discoverAvailableModels`, `handleUppidiSetRoleModel` | role-models.ts:18-54 — defaults are a literal role -> model map<br>role-models.ts:56-69 — load merges saved JSON over defaults<br>role-models.ts:98-101 — discovery shells `paseo provider list --json`<br>agents.ts:1455-1468 — but the consumer uses this to pick the model a spawned session runs on |
| CI runner discovery across repo/org/user scopes plus local containers | `server/runners.ts` | 6 | 273 | `deterministic` | `runnerScopeEndpoints`, `normalizeForgejoRunners`, `fetchLocalContainers`, `handleUppidiRunners` | runners.ts:58-71 — three endpoint paths derived from `owner/repo`<br>runners.ts:78-118 — projection counts entries lacking id/name as skipped rather than inventing labels<br>runners.ts:145-148 — local runners are `podman ps --format json`<br>runners.ts:232-241 — fleet status is a fixed decision table over per-scope outcomes |
| Plugin settings storage, legacy router-config migration | `server/settings.ts` | 5 | 152 | `deterministic` | `getLegacyRouterConfig`, `migrateLegacyConfigIfNeeded`, `getUppidiFleetSettingsStorage` | settings.ts:18-63 — first existing candidate path wins; malformed files are skipped<br>settings.ts:65-119 — migration is a key-by-key patch of undefined fields<br>settings.ts:123-148 — storage is a singleton over `PluginStorage` with a schema |

- **Agent record normalisation, metrics projection, deterministic-state derivation** (`server/agents.ts`) — THE TELEMETRY ROW. It reads token counts, cost and turn state produced by an LLM session, and it is fully deterministic: same record in, same state out. Observing a model is not being one. The substring table at 281-296 is a fixed vocabulary, not a learned judgement.
- **Fleet topology, workspace mapping, permission scope, on-disk metadata** (`server/agents.ts`) — Subprocess and filesystem reads. Same inputs, same tree; nothing here consults a model.
- **Agent session spawning, front-desk and orchestrator lifecycle, spawn-authority guard** (`server/agents.ts`) — The spawn call is deterministic -- the same request yields the same agent record. What that session then does is model inference, and nothing in this file constrains it. The guard half is deterministic policy and is cited as such.
- **Forgejo host/token resolution and classified API reads** (`server/forgejo-api.ts`) — Deterministic given host state, and it says so when unauthenticated rather than substituting data (22-23).
- **Issue read and label-derived attention/status projection** (`server/issues.ts`) — Issues are labelled by humans and agents, so the input is not reproducible, but the projection is: same payload, same counts.
- **Hook-service RPC handlers, endpoint resolution, x-comms presence probe** (`server/hook.ts`) — These handlers are a transport shim over the hook router. None of them touches a model; the router they call is classified on its own rows.
- **Webhook ingress, event classification, digest and coalesce formatting** (`server/hook-router.ts`) — The ingress path is a pure function of the webhook payload.
- **Queue persistence, pause/resume/mute, drain scheduling, backoff** (`server/hook-router.ts`) — Scheduling is deterministic; the message it eventually hands to `deliverMessage` is not, and is classified separately below.
- **Fleet watchdog: health taxonomy detection and recovery planning** (`server/hook-router.ts`) — Detection is deterministic. Recovery is not: `planWatchdogRecovery` returns `steer: true` and the caller turns that into a wake message inside a running model session, whose response is unconstrained. Deterministic decision, nondeterministic remedy.
- **Message delivery into live LLM sessions (steer / no-wait, onboarding, board-sweep notice)** (`server/hook-router.ts`) — The send itself is a deterministic API call. What the recipient model does with it -- whether the wake actually revives the turn, whether the notice is acted on -- is the part that cannot be asserted. Hybrid for that reason, not because the delivery code guesses.
- **Hook HTTP service surface: listen, status/info/queues, configure, restart, teardown** (`server/hook-router.ts`) — Lifecycle and transport. Deterministic given the same host state.
- **Model rollup receipts and candidate derivation from daemon counters** (`server/metrics.ts`) — THE ROW THAT IS EASY TO GET WRONG, and it is deterministic. It measures LLM sessions -- token use, cache ratio, turn duration, cost -- and every number is arithmetic over counters the daemon already computed. Nothing here is a model. The privacy posture is explicit too (34-35): no transcripts, prompts or code are stored.
- **BASELINE_CANDIDATES seed table** (`server/metrics.ts`) — Deterministic as code -- a literal is the most reproducible thing in the repo -- but the numbers are unsourced claims about how models behave, and nothing in the tree measures them. It is a hardcoded fixture that reads like a measurement, which is why it is reported rather than filed under either neighbouring bucket. Worth knowing that it is now dead: the declaration and that one assertion are its only references in the repository, so it survives solely as the fixed side of a regression guard.
- **Role-to-model assignment, persistence, and available-model discovery** (`server/role-models.ts`) — Performs no inference and takes no decision that depends on one, so by the test used everywhere else in this table it is deterministic. It is contested because it is the plugin's only surface whose entire purpose is choosing which model other rows spawn -- the AI/LLM character of the fleet is set here and executed in `agents.ts`. The bucket depends on whether you classify a control surface or the thing it controls.
- **CI runner discovery across repo/org/user scopes plus local containers** (`server/runners.ts`) — CI capacity, not model capacity. A runner executes jobs; nothing here invokes a model.
- **Plugin settings storage, legacy router-config migration** (`server/settings.ts`) — Key-presence migration. No inference, no timing dependence.

## Client

| Moving part | File | File exports | File loc | Classification | Anchors | Evidence |
| --- | --- | ---: | ---: | --- | --- | --- |
| Barrel re-export for surface, tree-view and panel | `client/index.ts` | 0 | 3 | `deterministic` | whole file | client/index.ts:1-3 — three `export *` statements, no code |
| Workspace panel wrapper, flair, panel registration | `client/panel.tsx` | 7 | 46 | `deterministic` | `UPPIDI_FLEET_FLAIR`, `UppidiFleetPanel`, `registerWorkspacePanel` | panel.tsx:10-18 — flair is a static `VisualFlair` literal<br>panel.tsx:20-30 — the panel delegates to the tree view<br>panel.tsx:37-46 — registration wraps `client.addWorkspacePanel` |
| Fleet surface: tabs, router status badge, attention card, role-model and metrics dashboards | `client/surface.tsx` | 10 | 1998 | `deterministic` | `UppidiFleetSurface`, `UppidiBrandMark`, `UppidiTopHeaderBar`, `AttentionAgentCard`, `resolveRouterStatusBadge` | surface.tsx:295-306 — router badge is a three-way branch on two booleans<br>surface.tsx:499 — the surface reads every dataset over `useRpc`<br>surface.tsx:1281-1300 — model selection is a `Select` writing the role-model RPC<br>surface.tsx:682-685 — the write reports the server's own message, not a local guess |
| Agent tree rendering: status lights, health gauges, metrics cards, rows, project groups | `client/tree-view.tsx` | 37 | 2817 | `deterministic` | `UppidiFleetTreeView`, `AgentStatusLight`, `AgentStateDot`, `AgentHealthGauge`, `AgentMetricsCard`, `OrchestratorRow`, +3 more | tree-view.tsx:387-403 — relative time is arithmetic on a timestamp<br>tree-view.tsx:450 — health gauge reads thresholds computed server-side<br>tree-view.tsx:2042 — the tree view is a pure function of the agents array |
| Static fleet fixtures for client tests | `client/testing/fleet-fixtures.ts` | 8 | 387 | `deterministic` | `agentsPayload`, `issuesPayload`, `metricsPayload`, `runnersPayload`, `hookQueuesPayload` | fleet-fixtures.ts:222-370 — seven payload builders returning fixed records<br>fleet-fixtures.ts:32 — one wide-worktree geometry constant |
| Render harness: host element stubs, rpc stubs, provider wrapper | `client/testing/fleet-harness.ts` | 27 | 219 | `deterministic` | `getFleetHarness`, `useToast`, `Icon`, `useRevealedText` | fleet-harness.ts:28-58 — host components stubbed to inert React elements<br>fleet-harness.ts:70-80 — toast, icon, scroll/flatlist and copyText stubs<br>fleet-harness.ts:111 — the harness is assembled once and awaited |
| Layout measurement double for mobile/zebra assertions | `client/testing/flex-measure.ts` | 5 | 438 | `deterministic` | `measureText`, `resolveStyle`, `findHorizontalOverflows` | flex-measure.ts:153 — text width is computed from the style, not a real layout pass<br>flex-measure.ts:371 — overflow findings are walked off the resolved style tree |

- **Barrel re-export for surface, tree-view and panel** (`client/index.ts`) — Pure re-export barrel.
- **Workspace panel wrapper, flair, panel registration** (`client/panel.tsx`) — Chrome around the tree view. No model.
- **Fleet surface: tabs, router status badge, attention card, role-model and metrics dashboards** (`client/surface.tsx`) — Renders server state and writes back through the deterministic role-model and settings RPCs. The model picker configures another row's spawn; it does not run a model, so it stays deterministic here.
- **Agent tree rendering: status lights, health gauges, metrics cards, rows, project groups** (`client/tree-view.tsx`) — The largest file in the client half and still fully deterministic: it displays whatever the server classified. Displaying an LLM's state is not being one.
- **Static fleet fixtures for client tests** (`client/testing/fleet-fixtures.ts`) — Test data. Deterministic by construction.
- **Render harness: host element stubs, rpc stubs, provider wrapper** (`client/testing/fleet-harness.ts`) — Test scaffolding. Never shipped: package.json `files` excludes `client/testing`.
- **Layout measurement double for mobile/zebra assertions** (`client/testing/flex-measure.ts`) — Test scaffolding for layout assertions. Not shipped.

## Shared

| Moving part | File | File exports | File loc | Classification | Anchors | Evidence |
| --- | --- | ---: | ---: | --- | --- | --- |
| 24 RPC contracts (zod schemas + input/output types) and the fleet settings contract | `shared/contracts.ts` | 164 | 1359 | `deterministic` | `uppidiFleetSettingsContract`, `uppidiFleetSettingsSchema` | contracts.ts:54-1258 — 24 `defineContract`/`defineSettingsContract` objects across the file<br>contracts.ts:1250-1256 — the fleet settings schema is a `z.object`<br>index.server.ts:81-103 — every one of them is bound to a handler there |
| Settings re-export barrel | `shared/settings.ts` | 3 | 5 | `deterministic` | whole file | shared/settings.ts:1-5 — re-exports three names from `contracts.js` |
| Filtering, sorting, health-gauge derivation, project grouping, bulk-archive eligibility | `shared/sort-filter.ts` | 44 | 1070 | `deterministic` | `filterIssues`, `sortIssues`, `filterQueues`, `sortAgents`, `filterRunners`, `filterMetricCandidates`, +4 more | sort-filter.ts:148 — health gauge buckets counters against fixed thresholds<br>sort-filter.ts:484-540 — bulk-archive eligibility is an explicit ordered rule list<br>sort-filter.ts:875 — project grouping is set/dict work over agent records |
| Attention/state label unions and Forgejo issue/repo shapes | `shared/types.ts` | 4 | 49 | `deterministic` | `AttentionLabel`, `StateLabel`, `ForgeIssue`, `ForgeRepoInfo` | types.ts:1-11 — two string-literal unions<br>types.ts:13-49 — two interfaces |
| Generated plugin version stamp | `shared/version.ts` | 1 | 2 | `deterministic` | `PLUGIN_VERSION` | version.ts:1-2 — `0.1.0+<git sha>`, written by the helper's `stampVersion` |
| Declared helper expectation, resolution mode, helper content digest | `shared/helper-version.ts` | 3 | 29 | `deterministic` | `HELPER_VERSION`, `HELPER_SERVED_FROM`, `HELPER_REVISION` | helper-version.ts:19-20 — version and `checkout` resolution mode as literals<br>helper-version.ts:29 — sha256 digest of `packages/paseo-plugin-helper/src`<br>helper-version.ts:10-15 — nothing reads these and believes them; `helper-resolution.test.mjs` and `doctor-live.mjs` re-derive instead |

- **24 RPC contracts (zod schemas + input/output types) and the fleet settings contract** (`shared/contracts.ts`) — The wire vocabulary. Schemas describe model-shaped concepts (agent metrics, model candidates) but a schema is a validator, not a model.
- **Settings re-export barrel** (`shared/settings.ts`) — Pure re-export barrel.
- **Filtering, sorting, health-gauge derivation, project grouping, bulk-archive eligibility** (`shared/sort-filter.ts`) — 44 exports, every one a pure function of its arguments. Shared verbatim by client and server, which is why both halves of the UI agree by construction.
- **Attention/state label unions and Forgejo issue/repo shapes** (`shared/types.ts`) — Type-only. No runtime behaviour at all.
- **Generated plugin version stamp** (`shared/version.ts`) — A generated constant. Re-stamped by `npm run stamp`.
- **Declared helper expectation, resolution mode, helper content digest** (`shared/helper-version.ts`) — The one file in the plugin that is a declaration about a dependency rather than behaviour — and it is explicit that consumers must re-derive rather than trust it.

## Plugin-owned scripts and hooks

| Moving part | File | File exports | File loc | Classification | Anchors | Evidence |
| --- | --- | ---: | ---: | --- | --- | --- |
| ESM resolve-hook registration for `node --test` | `test/register-ts-hooks.mjs` | 0 | 6 | `deterministic` | whole file | register-ts-hooks.mjs:4-6 — `register('./resolve-ts-hooks.mjs', import.meta.url)` |
| TS specifier resolution fallback for the node test runner | `test/resolve-ts-hooks.mjs` | 1 | 64 | `deterministic` | `resolve` | resolve-ts-hooks.mjs:32-63 — calls `next()` first and only falls back on `ERR_MODULE_NOT_FOUND`<br>resolve-ts-hooks.mjs:45 — a real `.json`/`.node` specifier keeps failing loudly<br>resolve-ts-hooks.mjs:48-53 — deliberately no `.tsx` probe: node type-stripping cannot load JSX |

- **ESM resolve-hook registration for `node --test`** (`test/register-ts-hooks.mjs`) — Loaded via `node --import`. A separate file because a hooks module must be registered, not imported.
- **TS specifier resolution fallback for the node test runner** (`test/resolve-ts-hooks.mjs`) — Build-time only. It replaced an `npx tsx` shellout that was in no package.json and absent from the lockfile (12-16) — a silent download of whatever was current that day. Worth recording as the repo's own worked example of the drift class this matrix is generated to prevent.

## Test suites

The suites are moving parts too, and this repo has a scar from forgetting that: #702 found nine
tracked `*.test.*` files that no runner named, merged and reported as delivered coverage while
never executing. Every suite is attributed below to the script that runs it, read from the
plugin's own `package.json` at generation time. `scripts/unreachable-tests.test.mjs` is the guard
that enforces the invariant; this table is the readable view of the same fact.

| Suite | Covers | Runs under | Loc | Classification |
| --- | --- | --- | ---: | --- |
| `client/entry.test.ts` | Surface/panel registration and teardown | `test:tsx` | 1230 | `deterministic` |
| `client/fleet-state-filter-row.test.ts` | Fleet state filter row rendering | `test:node` | 49 | `deterministic` |
| `client/issue-metrics-bar.test.ts` | Issue metrics bar rendering | `test:node` | 64 | `deterministic` |
| `client/metrics-bar-parity.test.ts` | Parity between the metrics bar and its shared source | `test:node` | 81 | `deterministic` |
| `client/mobile-layout.test.ts` | Mobile layout behaviour under the measurement double | `test:tsx` | 270 | `deterministic` |
| `client/role-model-picker.test.ts` | Role-model picker interaction | `test:node` | 62 | `deterministic` |
| `client/tree-zebra.test.tsx` | Tree zebra striping | `test:tsx` | 47 | `deterministic` |
| `server/agents.test.ts` | Agent normalisation, state derivation, spawn-authority and archive paths | `test:node` | 772 | `deterministic` |
| `server/fleet.test.ts` | Cross-surface fleet behaviour | `test:node` | 1196 | `deterministic` |
| `server/hook-router.test.ts` | Webhook classification, coalescing, queueing, watchdog taxonomy, handoff | `test:node` | 2285 | `deterministic` |
| `server/hook.test.ts` | Hook-service handlers, endpoint resolution, unreachable-path shapes | `test:node` | 377 | `deterministic` |
| `server/metrics.test.ts` | Rollup arithmetic, candidate derivation, receipt persistence | `test:node` | 279 | `deterministic` |
| `server/runners.test.ts` | Runner scope merge, normalisation, fleet-status decision table | `test:node` | 357 | `deterministic` |
| `shared/contracts.test.ts` | Contract schema validation | `test:node` | 835 | `deterministic` |
| `shared/sort-filter.test.ts` | Filter, sort, gauge and grouping functions | `test:node` | 1326 | `deterministic` |

Every suite is `deterministic` on the same test used for the source rows: a test asserts a fixed
expected value, and an assertion that had to be re-tuned against a model's output would be a
change-detector, not a test.

## What this table does not cover

The spawned agent sessions have no file, so they have no row. They are the thing every
`hybrid` row points at: a model-backed Paseo agent with a prompt, a provider and a model
chosen by `server/agents.ts` from the map in `server/role-models.ts`. Their behaviour is not
reproducible, which is the entire reason those rows are `hybrid` rather than `deterministic`.

Also outside the inventory, because they are not plugin-owned:

- `~/bin/forgejo-issues-check`, invoked by the board sweep at `server/hook-router.ts:2500-2505`.
- The `paseo` CLI and daemon SDK surface, called as a subprocess throughout the server.
- `paseo-plugin-helper`, the UI/storage/logger layer this plugin is built on.

## Appendix: generated export inventory

Read from the tree, uncensored and unedited. This is the inventory half of the document; the
matrix above is the judgement half.

| File | Layer | Loc | Exports | Top-level exported names |
| --- | --- | ---: | ---: | --- |
| `client/entry.test.ts` | client | 1230 | 0 | — |
| `client/fleet-state-filter-row.test.ts` | client | 49 | 0 | — |
| `client/index.ts` | client | 3 | 0 | — |
| `client/issue-metrics-bar.test.ts` | client | 64 | 0 | — |
| `client/metrics-bar-parity.test.ts` | client | 81 | 0 | — |
| `client/mobile-layout.test.ts` | client | 270 | 0 | — |
| `client/panel.tsx` | client | 46 | 7 | `UPPIDI_FLEET_FLAIR`, `UPPIDI_FORGE_FLAIR`, `UppidiFleetPanel`, `UppidiFleetWorkspacePanel`, `UppidiForgePanel`, `UppidiForgeWorkspacePanel`, `registerWorkspacePanel` |
| `client/role-model-picker.test.ts` | client | 62 | 0 | — |
| `client/surface.tsx` | client | 1998 | 10 | `AttentionAgentCard`, `AttentionAgentCardProps`, `RouterStatusBadge`, `SurfaceTab`, `UppidiBrandMark`, `UppidiFleetSurface`, `UppidiForgeSurface`, `UppidiTopHeaderBar`, `UppidiTopHeaderBarProps`, `resolveRouterStatusBadge` |
| `client/testing/fleet-fixtures.ts` | client | 387 | 8 | `WIDE_WORKTREE`, `agentsPayload`, `agentsPayloadNoFrontDesk`, `hookQueuesPayload`, `installPayloads`, `issuesPayload`, `metricsPayload`, `runnersPayload` |
| `client/testing/fleet-harness.ts` | client | 219 | 27 | `ActivityIndicator`, `Animated`, `Appearance`, `Dimensions`, `Easing`, `FlatList`, `FleetRenderHarness`, `Icon`, `Image`, `Linking`, `Modal`, `PanResponder` …+15 more |
| `client/testing/flex-measure.ts` | client | 438 | 5 | `OverflowFinding`, `StyleValue`, `findHorizontalOverflows`, `measureText`, `resolveStyle` |
| `client/tree-view.tsx` | client | 2817 | 37 | `AgentAttentionBanner`, `AgentAttentionBannerProps`, `AgentHealthGauge`, `AgentHealthGaugeProps`, `AgentLabelsRow`, `AgentMetricsCard`, `AgentMetricsCardProps`, `AgentStateDot`, `AgentStatusLight`, `AgentStatusLightProps`, `AgentStatusLightsRow`, `AgentStatusLightsRowProps` …+25 more |
| `client/tree-zebra.test.tsx` | client | 47 | 0 | — |
| `index.client.tsx` | entry | 84 | 8 | `UPPIDI_FLEET_FLAIR`, `UPPIDI_FORGE_FLAIR`, `UppidiFleetPanel`, `UppidiFleetSurface`, `UppidiForgePanel`, `UppidiForgeSurface`, `contribute`, `registerWorkspacePanel` |
| `index.server.ts` | entry | 146 | 1 | `contribute` |
| `server/agents.test.ts` | server | 772 | 0 | — |
| `server/agents.ts` | server | 2000 | 49 | `DEFAULT_AUTO_ACCEPT_PROVIDERS`, `DEFAULT_SPAWN_MODE_PROVIDERS`, `ExecFileAsyncFn`, `RawAgentRecord`, `RawPendingPermissionLike`, `SPAWN_AUTHORITY_WORKER_ERROR`, `SPAWN_AUTHORITY_WORKSPACE_ERROR`, `SpawnAuthorityDecision`, `SpawnCapabilities`, `SpawnCapabilityResult`, `allowPermission`, `applyParentProjectInheritance` …+37 more |
| `server/fleet.test.ts` | server | 1196 | 0 | — |
| `server/forgejo-api.ts` | server | 123 | 11 | `DEFAULT_FORGEJO_HOST`, `FORGEJO_API_TIMEOUT_MS`, `FetchLike`, `ForgejoApiResult`, `TokenResolverFn`, `forgejoApiGet`, `forgejoToken`, `resolveForgejoHost`, `resolveForgejoToken`, `setFetchForTest`, `setTokenResolverForTest` |
| `server/hook-router.test.ts` | server | 2285 | 0 | — |
| `server/hook-router.ts` | server | 3716 | 98 | `BoardCandidate`, `BoardCheckResult`, `BoardSweepResult`, `CANCELLATION_TIMEOUT_MARKER`, `CHILD_WAKEUP_EVENTS`, `ChildWakeupAssessment`, `ChildWakeupKind`, `CoalesceEntry`, `CoalesceEvent`, `CoalesceInput`, `CoalesceResult`, `DEFAULT_CANCELLATION_RECENCY_SECONDS` …+86 more |
| `server/hook.test.ts` | server | 377 | 0 | — |
| `server/hook.ts` | server | 227 | 11 | `handleHookConfigure`, `handleHookDrain`, `handleHookInfo`, `handleHookLogTail`, `handleHookPause`, `handleHookQueues`, `handleHookResume`, `handleHookServiceAction`, `handleHookServiceStatus`, `handleHookStatus`, `resolveHookUrl` |
| `server/issues.ts` | server | 103 | 1 | `handleUppidiIssues` |
| `server/metrics.test.ts` | server | 279 | 0 | — |
| `server/metrics.ts` | server | 700 | 19 | `AppendRollupResult`, `BASELINE_CANDIDATES`, `DEFAULT_TASK_PROFILES`, `FleetMetrics`, `MAX_ROLLUP_RECEIPTS`, `METRICS_PRIVACY_NOTICE`, `ModelRollup`, `RollupAgentInput`, `RollupAgentMetrics`, `appendRollupReceipt`, `computeModelRollups`, `defaultMetricsFilePath` …+7 more |
| `server/role-models.ts` | server | 167 | 6 | `DEFAULT_ROLE_MODELS`, `discoverAvailableModels`, `handleUppidiRoleModels`, `handleUppidiSetRoleModel`, `loadSavedRoleModels`, `saveRoleModels` |
| `server/runners.test.ts` | server | 357 | 0 | — |
| `server/runners.ts` | server | 273 | 6 | `ExecFileAsyncFn`, `fetchLocalContainers`, `handleUppidiRunners`, `normalizeForgejoRunners`, `runnerScopeEndpoints`, `setExecFileAsyncForTest` |
| `server/settings.ts` | server | 152 | 5 | `LegacyRouterConfig`, `getLegacyRouterConfig`, `getUppidiFleetSettingsStorage`, `migrateLegacyConfigIfNeeded`, `resetUppidiFleetSettingsStorageInstance` |
| `shared/contracts.test.ts` | shared | 835 | 0 | — |
| `shared/contracts.ts` | shared | 1359 | 164 | `AgentAttentionReason`, `AgentAttentionReasonSchema`, `AgentBlockDetail`, `AgentBlockDetailSchema`, `AgentLifecycleState`, `AgentLifecycleStateSchema`, `AttentionLabel`, `AttentionLabelSchema`, `CandidateModelMetrics`, `CandidateModelMetricsSchema`, `DEFAULT_PROJECT`, `DeterministicAgentState` …+152 more |
| `shared/helper-version.ts` | shared | 29 | 3 | `HELPER_REVISION`, `HELPER_SERVED_FROM`, `HELPER_VERSION` |
| `shared/settings.ts` | shared | 5 | 3 | `UppidiFleetSettings`, `uppidiFleetSettingsContract`, `uppidiFleetSettingsSchema` |
| `shared/sort-filter.test.ts` | shared | 1326 | 0 | — |
| `shared/sort-filter.ts` | shared | 1070 | 44 | `AgentPreset`, `AgentSortField`, `BuildProjectGroupsOptions`, `BuildProjectGroupsResult`, `DEFAULT_HEALTH_GAUGE_THRESHOLDS`, `HealthGauge`, `HealthGaugeKind`, `HealthGaugeSegment`, `HealthGaugeThresholds`, `HealthGaugeTone`, `IssuePreset`, `IssueSortField` …+32 more |
| `shared/types.ts` | shared | 49 | 4 | `AttentionLabel`, `ForgeIssue`, `ForgeRepoInfo`, `StateLabel` |
| `shared/version.ts` | shared | 2 | 1 | `PLUGIN_VERSION` |
| `test/register-ts-hooks.mjs` | script | 6 | 0 | — |
| `test/resolve-ts-hooks.mjs` | script | 64 | 1 | `resolve` |

