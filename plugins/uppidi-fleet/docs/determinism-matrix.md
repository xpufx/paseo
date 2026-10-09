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
| `deterministic` | 97 |
| `hybrid` | 3 |
| `ai-llm` | 0 |
| `contested` | 1 |
| **total** | **101** |

Inventory: 93 tracked source files in scope — 56 described above as source (48 files, some carrying several parts) and 45 test suites, which are described by the inventory itself rather than by hand.

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
| RPC registration and plugin lifecycle | `index.server.ts` | 1 | 232 | `deterministic` | `server.handle`, `startHookRouter`, `registerSettingsRpc` | index.server.ts:146-189 — 44 `server.handle(contract, handler)` bindings, one per RPC contract<br>index.server.ts:219 — `startHookRouter(server)` starts the HTTP listener<br>index.server.ts:228-231 — teardown returns a disposer, no model call |
| Sidebar surface, workspace panel, helper settings screen registration | `index.client.tsx` | 10 | 108 | `deterministic` | `registerSidebarSurface`, `addWorkspacePanel`, `registerHelperSettingsScreen` | index.client.tsx:26-62 — three registrations, each returning a disposer<br>index.client.tsx:64-83 — teardown calls each disposer, tolerating either shape |

- **RPC registration and plugin lifecycle** (`index.server.ts`) — Binds contracts to handlers and owns load/unload. Every handler it registers is classified on its own row below.
- **Sidebar surface, workspace panel, helper settings screen registration** (`index.client.tsx`) — Client lifecycle. All three registrations render over server data classified below.

## Server

| Moving part | File | File exports | File loc | Classification | Anchors | Evidence |
| --- | --- | ---: | ---: | --- | --- | --- |
| Persistent rotating hook log writer in plugin storage (#1115) | `server/disk-logger.ts` | 6 | 184 | `deterministic` | `DEFAULT_LOG_FILE_NAME`, `DEFAULT_MAX_LOG_BYTES`, `DEFAULT_MAX_LOG_FILES`, `DiskLogger`, `defaultScopedLogDir` | disk-logger.ts:50-80 — pure file append and size-bounded rename rotation<br>disk-logger.ts:90-120 — deterministic rotation index shifting without external models |
| Agent record normalisation, metrics projection, deterministic-state derivation | `server/agents.ts` | 64 | 3360 | `deterministic` | `normalizeRawAgent`, `normalizeAgentMetrics`, `deriveDeterministicState`, `categorizeAgent` | agents.ts:227-253 — copies token/cost/turn counters off the record, no inference<br>agents.ts:255-348 — `deriveDeterministicState` is ordered `if`/`includes` matching over status and error text<br>agents.ts:281-296 — quota/spawn/timeout classification is literal substring matching |
| Fleet topology, workspace mapping, permission scope, on-disk metadata | `server/agents.ts` | 64 | 3360 | `deterministic` | `buildAgentTree`, `getWorkspaceProjectMap`, `findScopeMatchingPermission`, `getAgentDiskMetadataMap`, `checkRepoMainDirty` | agents.ts:425-543 — `buildAgentTree` links parents to children from ids<br>agents.ts:748-765 — `checkRepoMainDirty` resolves the primary checkout, shells `git status`/`git rev-parse` and parses the result<br>agents.ts:767 — `fetchPaseoAgents` reads `paseo ls --json` |
| Agent session spawning, front-desk and orchestrator lifecycle, hook-context injection, spawn-authority guard | `server/agents.ts` | 64 | 3360 | `hybrid` | `spawnPaseoAgent`, `buildFrontDeskIntroPrompt`, `handleUppidiCreateFrontDesk`, `handleUppidiAddOrchestrator`, `evaluateSpawnAuthority` | agents.ts:2075 — `context.paseo.agents.create(createPayload)` creates a model-backed session<br>agents.ts:2130-2147 — CLI fallback `paseo run -d ... <prompt>` — the prompt is the agent's task<br>agents.ts:2238-2256 — `buildFrontDeskIntroPrompt` appends the resolved hook endpoint and auth posture (#903)<br>agents.ts:2265 — `handleUppidiCreateFrontDesk` uses the intro prompt at spawn<br>agents.ts:1966-2014 — spawn-authority guard is deterministic policy over caller id and cwd |
| Forgejo host/token resolution and classified API reads | `server/forgejo-api.ts` | 12 | 180 | `deterministic` | `resolveForgejoHost`, `resolveForgejoToken`, `forgejoApiGet`, `forgejoToken` | forgejo-api.ts:9-11 — host is `process.env.FORGEJO_HOST` or a constant<br>forgejo-api.ts:24-47 — token is read from env or parsed out of `~/.config/tea/config.yml`<br>forgejo-api.ts:88-122 — one GET, three outcomes: ok / http-error / unreachable |
| Issue read and label-derived attention/status projection | `server/issues.ts` | 6 | 262 | `deterministic` | `handleUppidiIssues` | issues.ts:20-32 — single `GET /api/v1/repos/<repo>/issues`<br>issues.ts:55-64 — attention is exact label matching against three known spellings<br>issues.ts:66-73 — status is a fixed precedence over `state/*` and `review/*` labels |
| Repo enrollment surface: Forgejo listing, roster/pause/queue/orchestrator projection, enroll/unenroll | `server/repos.ts` | 3 | 211 | `deterministic` | `handleUppidiRepos`, `handleUppidiEnrollRepo`, `handleUppidiUnenrollRepo` | repos.ts:39-60 — one classified GET (`/repos/search`) with a `/user/repos` 404 fallback; 401 maps to a fixed message and an empty list<br>repos.ts:73-95 — each row is built by matching the roster (enrolled, paused, summed queue depth) and the active router's orchestrator record<br>repos.ts:127-150 — enroll canonicalises the key, delegates to the router, or patches the persisted config when no router is active<br>repos.ts:177-195 — unenroll is the same shape with a membership filter |
| Hook-service RPC handlers, endpoint resolution, auth posture, x-comms presence probe | `server/hook.ts` | 16 | 325 | `deterministic` | `resolveHookEndpoint`, `resolveHookAuthPosture`, `resolveHookUrl`, `handleHookStatus`, `handleHookQueues`, `handleHookConfigure`, +1 more | hook.ts:88-121 — `resolveHookEndpoint` ordered fallback: explicit arg, env, live router, settings, loopback<br>hook.ts:148-166 — `resolveHookAuthPosture` reports the secret location, never the value<br>hook.ts:169-187 — status is a `fetch` with a 4s timeout<br>hook.ts:194-200 — `resolveXCommsInstalled` tolerates absence to `false` and never throws |
| Webhook ingress, event classification, digest and coalesce formatting | `server/hook-router.ts` | 208 | 10359 | `deterministic` | `isBypassEvent`, `sosStateOf`, `eventKind`, `eventHash`, `formatDigest`, `summarize`, +3 more | hook-router.ts:247-261 — bypass is one regex over the event body<br>hook-router.ts:292-301 — `eventKind` maps a fixed event-type table<br>hook-router.ts:359-369 — `formatDigest` is string concatenation<br>hook-router.ts:1600 — `ingestWebhook` classifies then enqueues |
| Queue persistence, queue/repo pause, drain scheduling, backoff | `server/hook-router.ts` | 208 | 10359 | `deterministic` | `loadRouterConfig`, `saveRouterConfig`, `getFleetRosterInfo`, `drain`, `pause`, `resume`, +2 more | hook-router.ts:2939-3048 — `drain` is guarded by closed, queue-paused, repo-paused, and draining sets<br>hook-router.ts:2996 — backoff delay is `min(30000, 3000 * 1.5^attempts)`<br>hook-router.ts:2857-2885 — pause/resume mutate a `Set` |
| Fleet watchdog: health taxonomy detection and recovery planning | `server/hook-router.ts` | 208 | 10359 | `hybrid` | `assessAgentHealth`, `planWatchdogRecovery`, `WATCHDOG_TAXONOMY`, `scanCancellationTimeouts`, `runWatchdogAudit`, `recoverWatchdogAgent` | hook-router.ts:591-714 — six boolean detectors, each substring or timestamp comparison<br>hook-router.ts:1161-1181 — `planWatchdogRecovery` is set algebra over the taxonomy<br>hook-router.ts:1157-1181 — quota exhaustion is a circuit break: `steer` is forced false<br>hook-router.ts:2153 — the plan is executed by steering a live turn |
| Message delivery into live LLM sessions (steer / no-wait, onboarding, board-sweep notice) | `server/hook-router.ts` | 208 | 10359 | `hybrid` | `deliverMessage`, `runBoardSweep`, `doFrontDeskHandoff` | hook-router.ts:1924 — `agentRef.send(msg, { steer })` hands text to a model-backed session<br>hook-router.ts:1929-1939 — CLI fallback `paseo send --no-wait --steer <id> <msg>`<br>hook-router.ts:2589-2592 — handoff onboarding text is a template, delivered with `steer: true`<br>hook-router.ts:2703-2712 — board sweep summarises candidates deterministically, then steers the notice (failures included) |
| In-process board checker port: stale-WIP recovery sweep and its regression guard (#733) | `server/issues-check.ts` | 42 | 1123 | `deterministic` | `staleWipAge`, `hasStaleWipReminder`, `recoverStaleWipIssue`, `sweepStaleWipIssues` | issues-check.ts:216 — stale WIP age is a timestamp comparison against a fixed skip-label set<br>issues-check.ts:229 — reminder detection is a substring probe for the marker<br>issues-check.ts:272 — recovery posts one comment (same label edit grammar)<br>issues-check.ts:326 — sweep filtering is bounded by thresholds over issues already fetched |
| Deterministic priority tuple, dispatchability and taxonomy classification | `server/issues-check.ts` | 42 | 1123 | `deterministic` | `calculatePriorityTuple`, `isDispatchableCandidate`, `classifyCandidate`, `isActionable` | issues-check.ts:346 — tier/urgency/effort come from fixed label-weight tables; age sorts lexicographically<br>issues-check.ts:378 — dispatchability is set algebra over blocker and approver labels<br>issues-check.ts:414 — classification is a first-match ladder over label sets producing fixed reason strings |
| Board-check IO: teax transport, cache read/write, human-feedback probe | `server/issues-check.ts` | 42 | 1123 | `deterministic` | `createDefaultIssuesCheckIo`, `runIssuesCheck`, `IssuesCheckTransportError` | issues-check.ts:632 — teax runs via spawn with captured stdout; query failure is an error, not an empty board<br>issues-check.ts:677 — cache is a JSON document under ~/.cache keyed by repo slug<br>issues-check.ts:806-808 — signature diff (updated_at/labels/comments_count against the persisted cache) decides new/changed candidates |
| Hook HTTP service surface: listen, status/info/queues, configure, restart, teardown | `server/hook-router.ts` | 208 | 10359 | `deterministic` | `getHookServiceStatus`, `configureHookService`, `executeHookServiceAction`, `getHookRouterInfo`, `startHookRouter`, `handleHttpRequest`, +1 more | hook-router.ts:3133-3162 — `createServer` + `listen`, EADDRINUSE degrades to disabled rather than throwing<br>hook-router.ts:3210-3236 — `configure` writes config then restarts if listening<br>hook-router.ts:3629-3657 — status is a projection of bound address, pid and uptime |
| Append-only PR audit receipts, merge reconciliation and the summary projection (#1172) | `server/audit-receipts.ts` | 22 | 454 | `deterministic` | `appendAuditReceipt`, `findAuditReceipt`, `auditCheck`, `projectAuditSummary`, `handleUppidiAuditRecord`, `handleUppidiAuditSummary`, +3 more | audit-receipts.ts:193-215 — receipts are immutable JSONL lines appended to a scoped plugin-data file<br>audit-receipts.ts:331-391 — `projectAuditSummary` is arithmetic over stored receipts and reconciliation records<br>hook-router.ts:3920-3981 — `reconcileMergeAudit` tags a merged commit `audited` or `direct_or_adhoc` by SHA match<br>audit-receipts.ts:420-437 — the record-audit RPC handler stamps the envelope and appends |
| Model rollup receipts and candidate derivation from daemon counters | `server/metrics.ts` | 22 | 840 | `deterministic` | `computeModelRollups`, `deriveCandidatesFromReceipts`, `appendRollupReceipt`, `loadFleetMetrics`, `median` | metrics.ts:409-480 — groups by `provider::model`, reduces with a median over per-agent counters<br>metrics.ts:489-532 — candidate rows are sums and a completion rate over stored receipts<br>metrics.ts:559-613 — append is a read-modify-write with a tmp file + rename<br>metrics.ts:483-488 — comment states task-profile attribution is deliberately absent: minimized receipts cannot carry it |
| Role-to-model assignment, persistence, and available-model discovery | `server/role-models.ts` | 14 | 346 | `contested` | `DEFAULT_ROLE_MODELS`, `loadSavedRoleModels`, `saveRoleModels`, `discoverAvailableModels`, `handleUppidiSetRoleModel` | role-models.ts:18-54 — defaults are a literal role -> model map<br>role-models.ts:56-69 — load merges saved JSON over defaults<br>role-models.ts:98-101 — discovery shells `paseo provider list --json`<br>agents.ts:1455-1468 — but the consumer uses this to pick the model a spawned session runs on |
| Long-lived role rotation: layered policy resolution, trigger evaluation, brief rendering, one-at-a-time lock (#1019) | `server/rotation.ts` | 15 | 369 | `deterministic` | `DEFAULT_ROTATION_ROLE_POLICY`, `resolveRotationPolicy`, `evaluateRotationTrigger`, `buildRotationBrief`, `RotationLock` | rotation.ts:18-69 — role defaults are a literal role -> threshold table (2h/50 and 3h/75 per the approved spec)<br>rotation.ts:89-116 — effective policy is a fixed merge of defaults -> global role -> per-repo role<br>rotation.ts:177-268 — trigger evaluation is timestamp/turn arithmetic over fixed thresholds; manual/in-flight/cooldown guards are literal branches<br>rotation.ts:304-341 — the rotation brief is string concatenation over caller-supplied board state<br>rotation.ts:343-364 — the one-at-a-time guard is a Set keyed by role+repo |
| Fleet skill effective resolution, canonical platform root, override persistence, and Settings RPC handlers | `server/skills.ts` | 25 | 528 | `deterministic` | `FLEET_SKILL_DEFINITIONS`, `resolveEffectiveSkill`, `getEffectiveSkillPath`, `getEffectiveSkillContent`, `renderSkillDirective`, `canonicalSkillsRootCandidates`, +6 more | skills.ts:149-183 — the canonical `platform/skills` root is explicit-option, env override, then the sibling checkout of each plugin root<br>skills.ts:198-221 — the three fleet skills are a literal id/title/bundled-path table<br>skills.ts:254-261 — override storage is a PluginStorage path under plugin-data, never the checkout or ~/.agents<br>skills.ts:304-341 — canonical path/content reads are filesystem existence checks under `platform/skills/<id>/SKILL.md`<br>skills.ts:359-408 — effective text is override-else-canonical-else-bundled, a filesystem existence check with no model<br>skills.ts:428-450 — renderSkillDirective inlines the effective bytes for a spawn prompt instead of a permission-gated path<br>skills.ts:462-490 — save writes raw Markdown with a tmp-file rename; null unlinks the override |
| Conservative safe-pattern allowlist, shell scanner, fleet detection, and durable permission-decision log (#1084) | `server/permission-adjudication.ts` | 16 | 886 | `deterministic` | `SAFE_PERMISSION_RULES`, `scanShellCommand`, `classifySafeCommand`, `extractPermissionCommandText`, `isFleetAgent`, `appendAdjudicationDecision`, +2 more | permission-adjudication.ts:57-84 — the allowlist rules are a literal, documented id/description table<br>permission-adjudication.ts:262-490 — the scanner is quote/heredoc-aware character arithmetic: quoted heredoc bodies are inert data, unquoted delimiters and redirections are refused<br>permission-adjudication.ts:607-630 — `classifySafeCommand` returns a match only when every segment and substitution matches<br>permission-adjudication.ts:659-681 — fleet detection is label/id membership, never a guess<br>permission-adjudication.ts:713-742 — the durable log is a JSONL append and a line-by-line read<br>permission-adjudication.ts:776-885 — adjudication is a fixed branch tree: non-fleet, no-match, no-id, or no-seam escalate; only a match plus a successful seam allow auto-allows |
| CI runner discovery across repo/org/user scopes plus local containers | `server/runners.ts` | 6 | 273 | `deterministic` | `runnerScopeEndpoints`, `normalizeForgejoRunners`, `fetchLocalContainers`, `handleUppidiRunners` | runners.ts:58-71 — three endpoint paths derived from `owner/repo`<br>runners.ts:78-118 — projection counts entries lacking id/name as skipped rather than inventing labels<br>runners.ts:145-148 — local runners are `podman ps --format json`<br>runners.ts:232-241 — fleet status is a fixed decision table over per-scope outcomes |
| Plugin settings storage | `server/settings.ts` | 2 | 39 | `deterministic` | `getUppidiFleetSettingsStorage`, `resetUppidiFleetSettingsStorageInstance` | settings.ts:11-31 — storage is a singleton over `PluginStorage` with a schema<br>settings.ts:33-35 — the singleton can be dropped for isolated tests |
| Fleet MCP tool declarations, schemas, execution dispatchers, and RPC handlers | `server/mcp-tools.ts` | 16 | 940 | `deterministic` | `FLEET_MCP_TOOLS`, `executeFleetCheckBoard`, `executeFleetWatchdogAudit`, `executeFleetBoardSweep`, `executeFleetPruneOrchestrators`, `executeFleetQueueInspect`, +5 more | mcp-tools.ts:31-218 — typed JSON schemas for daemon operations and diagnostic tools<br>mcp-tools.ts:230-330 — deterministic board-checker execution with argument validation<br>mcp-tools.ts:334-372 — deterministic watchdog audit execution and markdown rendering<br>mcp-tools.ts:375-432 — deterministic board sweep execution and Front Desk notification<br>mcp-tools.ts:434-484 — deterministic orchestrator pruning with dry-run support<br>mcp-tools.ts:486-549 — deterministic queue inspection and filtering<br>mcp-tools.ts:551-614 — deterministic queue purge with confirmation guard<br>mcp-tools.ts:616-646 — deterministic fleet shift handoff generation |
| Deterministic repository workspace resolution and candidate ranking | `server/workspace-lookup.ts` | 12 | 329 | `deterministic` | `resolveWorkspaceForRepo` | workspace-lookup.ts:54-130 — deterministically matches repo slugs against projects/workspaces registry |
| Worktree-only dispatch guard: primary-checkout detection and worker workspace policy | `server/workspace-guard.ts` | 13 | 321 | `deterministic` | `inspectPrimaryCheckout`, `evaluateWorkerWorkspaceGuard`, `evaluateWorkerSpawnWorkspace`, `WORKER_PRIMARY_CHECKOUT_ERROR` | workspace-guard.ts:62-105 — `inspectPrimaryCheckout` shells `git rev-parse --path-format=absolute --git-dir`/`--git-common-dir` and treats equality as the primary checkout<br>workspace-guard.ts:149-215 — `evaluateWorkerWorkspaceGuard` is ordered policy over the inspection, project rootPath and daemon registry record; non-worker categories pass untouched<br>workspace-guard.ts:264-321 — `resolveWorkerWorkspaceContext`/`evaluateWorkerSpawnWorkspace` resolve the workspace record/project rootPath from the daemon registry and apply the guard to worker spawns |

- **Persistent rotating hook log writer in plugin storage (#1115)** (`server/disk-logger.ts`) — Durable hook-router log appender writing to scoped plugin storage with bounded log rotation.
- **Agent record normalisation, metrics projection, deterministic-state derivation** (`server/agents.ts`) — THE TELEMETRY ROW. It reads token counts, cost and turn state produced by an LLM session, and it is fully deterministic: same record in, same state out. Observing a model is not being one. The substring table at 281-296 is a fixed vocabulary, not a learned judgement.
- **Fleet topology, workspace mapping, permission scope, on-disk metadata** (`server/agents.ts`) — Subprocess and filesystem reads. Same inputs, same tree; nothing here consults a model.
- **Agent session spawning, front-desk and orchestrator lifecycle, hook-context injection, spawn-authority guard** (`server/agents.ts`) — The spawn call is deterministic -- the same request yields the same agent record. What that session then does is model inference, and nothing in this file constrains it. The guard half is deterministic policy and is cited as such.
- **Forgejo host/token resolution and classified API reads** (`server/forgejo-api.ts`) — Deterministic given host state, and it says so when unauthenticated rather than substituting data (22-23).
- **Issue read and label-derived attention/status projection** (`server/issues.ts`) — Issues are labelled by humans and agents, so the input is not reproducible, but the projection is: same payload, same counts.
- **Repo enrollment surface: Forgejo listing, roster/pause/queue/orchestrator projection, enroll/unenroll** (`server/repos.ts`) — Reads Forgejo and the hook router's persisted state and does set membership over it; no inference anywhere. Enrolling a repo is a control-plane edit that later gates deliveries, not a spawn.
- **Hook-service RPC handlers, endpoint resolution, auth posture, x-comms presence probe** (`server/hook.ts`) — These handlers are a transport shim over the hook router. None of them touches a model; the router they call is classified on its own rows.
- **Webhook ingress, event classification, digest and coalesce formatting** (`server/hook-router.ts`) — The ingress path is a pure function of the webhook payload.
- **Queue persistence, queue/repo pause, drain scheduling, backoff** (`server/hook-router.ts`) — Scheduling is deterministic; the message it eventually hands to `deliverMessage` is not, and is classified separately below.
- **Fleet watchdog: health taxonomy detection and recovery planning** (`server/hook-router.ts`) — Detection is deterministic. Recovery is not: `planWatchdogRecovery` returns `steer: true` and the caller turns that into a wake message inside a running model session, whose response is unconstrained. Deterministic decision, nondeterministic remedy.
- **Message delivery into live LLM sessions (steer / no-wait, onboarding, board-sweep notice)** (`server/hook-router.ts`) — The send itself is a deterministic API call. What the recipient model does with it -- whether the wake actually revives the turn, whether the notice is acted on -- is the part that cannot be asserted. Hybrid for that reason, not because the delivery code guesses.
- **In-process board checker port: stale-WIP recovery sweep and its regression guard (#733)** (`server/issues-check.ts`) — Ported from platform `scripts/forgejo-issues-check`; forgejo-issues-check.test.py carries the same fixtures.
- **Deterministic priority tuple, dispatchability and taxonomy classification** (`server/issues-check.ts`) — Pure classification carried over from the Python checker; the board sweep consumes it every 15 minutes.
- **Board-check IO: teax transport, cache read/write, human-feedback probe** (`server/issues-check.ts`) — Runs inside the daemon's node context; the transport subprocess is `teax`, one invocation per query like the original.
- **Hook HTTP service surface: listen, status/info/queues, configure, restart, teardown** (`server/hook-router.ts`) — Lifecycle and transport. Deterministic given the same host state.
- **Append-only PR audit receipts, merge reconciliation and the summary projection (#1172)** (`server/audit-receipts.ts`) — Append-only stores and a pure CQRS projection. No input from any live model: the receipts are what the orchestrator reported, read back verbatim.
- **Model rollup receipts and candidate derivation from daemon counters** (`server/metrics.ts`) — THE ROW THAT IS EASY TO GET WRONG, and it is deterministic. It measures LLM sessions -- token use, cache ratio, turn duration, cost -- and every number is arithmetic over counters the daemon already computed. Nothing here is a model. The privacy posture is explicit too (34-35): no transcripts, prompts or code are stored.
- **Role-to-model assignment, persistence, and available-model discovery** (`server/role-models.ts`) — Performs no inference and takes no decision that depends on one, so by the test used everywhere else in this table it is deterministic. It is contested because it is the plugin's only surface whose entire purpose is choosing which model other rows spawn -- the AI/LLM character of the fleet is set here and executed in `agents.ts`. The bucket depends on whether you classify a control surface or the thing it controls.
- **Long-lived role rotation: layered policy resolution, trigger evaluation, brief rendering, one-at-a-time lock (#1019)** (`server/rotation.ts`) — The whole trigger decision is deterministic: same observation and policy, same verdict. It drives a model-backed respawn (classified under `hook-router.ts` / `agents.ts`) but performs no inference of its own.
- **Fleet skill effective resolution, canonical platform root, override persistence, and Settings RPC handlers** (`server/skills.ts`) — Reads and writes skill Markdown on disk and resolves it for spawn prompts. No inference: the operator, the canonical `platform` checkout, or the bundled fallback supplies every byte.
- **Conservative safe-pattern allowlist, shell scanner, fleet detection, and durable permission-decision log (#1084)** (`server/permission-adjudication.ts`) — Pure classifier plus a filesystem append. The only non-local effect is the injected allow seam, and an unmatched or ambiguous command is never auto-allowed.
- **CI runner discovery across repo/org/user scopes plus local containers** (`server/runners.ts`) — CI capacity, not model capacity. A runner executes jobs; nothing here invokes a model.
- **Plugin settings storage** (`server/settings.ts`) — Schema-validated plugin settings. No legacy file fallback, no inference.
- **Fleet MCP tool declarations, schemas, execution dispatchers, and RPC handlers** (`server/mcp-tools.ts`) — Declares fleet MCP tools and dispatches executions with argument validation. Fully deterministic control plane; does not query an LLM.
- **Deterministic repository workspace resolution and candidate ranking** (`server/workspace-lookup.ts`) — Resolves daemon workspace directory for repository checkouts deterministically by ranking unarchived primary workspaces.
- **Worktree-only dispatch guard: primary-checkout detection and worker workspace policy** (`server/workspace-guard.ts`) — Enforces #918: a worker is refused the primary checkout before any SDK/CLI spawn. Detection is a fixed git probe, never a model judgement.

## Client

| Moving part | File | File exports | File loc | Classification | Anchors | Evidence |
| --- | --- | ---: | ---: | --- | --- | --- |
| Barrel re-export for surface, tree-view, panel and tooling | `client/index.ts` | 0 | 8 | `deterministic` | whole file | client/index.ts:1-4 — four `export *` statements, no code |
| Fleet tooling surface: schema-driven manual runner and result viewer | `client/tooling.tsx` | 2 | 392 | `deterministic` | `UppidiFleetToolingView` | tooling.tsx:40-75 — retrieves tool definitions and manages dynamic schema form state<br>tooling.tsx:77-135 — validates required parameters and dispatches RPC tool execution<br>tooling.tsx:185-330 — renders schema-driven form fields with typed controls |
| Workspace panel and sidebar wrappers, panel registration | `client/panel.tsx` | 6 | 49 | `deterministic` | `UppidiFleetPanel`, `UppidiFleetSidebar`, `registerWorkspacePanel` | panel.tsx:11-19 — the panel mounts the host theme and the required scroll owner<br>panel.tsx:27-33 — the sidebar wrapper mounts the host theme for the sidebar registration<br>panel.tsx:40-49 — registration wraps `client.addWorkspacePanel` |
| Agent switcher data projection: Front Desk extraction and per-repo orchestrator grouping | `client/agent-switcher-data.ts` | 3 | 59 | `deterministic` | `AgentSwitcherData`, `AgentSwitcherGroup`, `mapAgentSwitcherData` | agent-switcher-data.ts:22-24 — a missing snapshot returns the empty shape rather than a guess<br>agent-switcher-data.ts:35-43 — repo key falls through `project`, `attributedWork.repo`, `labels.repo`, then `"unassigned"`; the first orchestrator per repo wins<br>agent-switcher-data.ts:45-52 — rows are ordered with `localeCompare` and mapped, no model |
| Agent switcher: navigable sidebar item, popover rows, live agent query, and in-client hand-off | `client/agent-switcher.tsx` | 8 | 330 | `deterministic` | `AGENT_SWITCHER_JUMP_SCREEN_ID`, `AgentSwitcherSidebarIcon`, `AgentSwitcherDropdownProps`, `AgentRowItem`, `AgentSwitcherDropdown`, `AgentSwitcherSidebarItem`, +2 more | agent-switcher.tsx:39-55 — `AgentRowItem` derives its status dot from `getDeterministicStateConfig` over the agent's precomputed state<br>agent-switcher.tsx:150-217 — front desk and orchestrator rows render directly from props, with literal empty states<br>agent-switcher.tsx:253-266 — `useRpcQuery` polls `uppidiAgentsContract`; selecting a row calls `openScreen` with the jump screen id and the selected agent<br>agent-switcher.tsx:308-318 — the navigable screen forwards the selection to `navigation.openAgent` on mount |
| Fleet surface: tabs, router status badge, attention card, role-model and metrics dashboards | `client/surface.tsx` | 19 | 3219 | `deterministic` | `UppidiFleetSurface`, `UppidiBrandMark`, `UppidiTopHeaderBar`, `AttentionAgentCard`, `resolveRouterStatusBadge` | surface.tsx:295-306 — router badge is a three-way branch on two booleans<br>surface.tsx:499 — the surface reads every dataset over `useRpc`<br>surface.tsx:1281-1300 — model selection is a `Select` writing the role-model RPC<br>surface.tsx:682-685 — the write reports the server's own message, not a local guess |
| Forge issues surface: query, filtering, issue rows, status badges | `client/forges-tab.tsx` | 13 | 536 | `deterministic` | `forgeOpenIssuesContract`, `forgeContextContract`, `ForgeIssuesView`, `ForgesTabView` | forges-tab.tsx:21-70 — declares RPC query contracts for forge open issues and context<br>forges-tab.tsx:96-100 — reads issues over useRpcQuery<br>forges-tab.tsx:110-125 — filters issues by client query without model interaction |
| Fleet Kanban board: column mapping, transitions, ticket cards | `client/kanban-board.tsx` | 11 | 746 | `deterministic` | `KANBAN_COLUMNS`, `getIssueKanbanColumn`, `getColumnTransitions`, `KanbanCard`, `UppidiFleetKanbanBoard` | kanban-board.tsx:21-50 — static column definitions and status mappings<br>kanban-board.tsx:52-92 — maps issue labels and state to kanban columns deterministically<br>kanban-board.tsx:101-124 — determines valid next column transition targets |
| Agent tree rendering: status lights, health gauges, metrics cards, rows, project groups | `client/tree-view.tsx` | 38 | 3463 | `deterministic` | `UppidiFleetTreeView`, `AgentStatusLight`, `AgentStateDot`, `AgentHealthGauge`, `AgentMetricsCard`, `OrchestratorRow`, +3 more | tree-view.tsx:387-403 — relative time is arithmetic on a timestamp<br>tree-view.tsx:450 — health gauge reads thresholds computed server-side<br>tree-view.tsx:2042 — the tree view is a pure function of the agents array |
| Shared metrics bar: chip anatomy, selection, zero-count hiding, theme-driven colors | `client/metrics-bar.tsx` | 3 | 108 | `deterministic` | `MetricsBar`, `MetricsBarChip`, `MetricsBarProps` | metrics-bar.tsx:55-66 — container fill, border, radius and padding from theme colors<br>metrics-bar.tsx:69-74 — zero-count hide, selection and tone derivation are boolean arithmetic<br>metrics-bar.tsx:92-98 — icon/label/count render from props, no model call |
| Fleet theme accessor: host theme colors and helpers plus plugin typography scale | `client/theme.ts` | 5 | 62 | `deterministic` | `FleetTheme`, `useFleetTheme` | theme.ts:50-60 — colors, alpha and status helpers come from the host theme; typography is a fixed local scale<br>theme.ts:7-13 — no computed-style scraping, no client provider |
| Plugin-local presentation kit: layout, cards, badges, buttons, inputs, table, ticket lifecycle | `client/host-ui.tsx` | 78 | 2223 | `deterministic` | `Card`, `Button`, `Badge`, `DataTable`, `ModalBody`, `ForgeIcon`, +2 more | host-ui.tsx:1-20 — component library over the host theme, host Icon and plain react-native; no model call<br>host-ui.tsx:100-200 — Row/Stack/Grid and Card/Tabs compose host theme colors only<br>host-ui.tsx:2000-2112 — ticket lifecycle view renders RPC payloads; it does not produce model output |
| Static fleet fixtures for client tests | `client/testing/fleet-fixtures.ts` | 9 | 422 | `deterministic` | `agentsPayload`, `issuesPayload`, `metricsPayload`, `runnersPayload`, `hookQueuesPayload` | fleet-fixtures.ts:222-370 — seven payload builders returning fixed records<br>fleet-fixtures.ts:32 — one wide-worktree geometry constant |
| Render harness: host element stubs, rpc stubs, provider wrapper | `client/testing/fleet-harness.ts` | 36 | 280 | `deterministic` | `getFleetHarness`, `useToast`, `Icon`, `useRevealedText` | fleet-harness.ts:28-58 — host components stubbed to inert React elements<br>fleet-harness.ts:70-80 — toast, icon, scroll/flatlist and copyText stubs<br>fleet-harness.ts:111 — the harness is assembled once and awaited |

- **Barrel re-export for surface, tree-view, panel and tooling** (`client/index.ts`) — Pure re-export barrel.
- **Fleet tooling surface: schema-driven manual runner and result viewer** (`client/tooling.tsx`) — Manual schema-driven tool runner surface. Queries tool schemas and displays execution output.
- **Workspace panel and sidebar wrappers, panel registration** (`client/panel.tsx`) — Chrome around the surface. No model.
- **Agent switcher data projection: Front Desk extraction and per-repo orchestrator grouping** (`client/agent-switcher-data.ts`) — Pure snapshot-to-rows projection. It reads fields the server already derived from model-backed sessions and groups them; the grouping is arithmetic over strings.
- **Agent switcher: navigable sidebar item, popover rows, live agent query, and in-client hand-off** (`client/agent-switcher.tsx`) — Displays the agents array and switches the host view to one of them. Reading a model session's classified state, or navigating to it, is not producing model output.
- **Fleet surface: tabs, router status badge, attention card, role-model and metrics dashboards** (`client/surface.tsx`) — Renders server state and writes back through the deterministic role-model and settings RPCs. The model picker configures another row's spawn; it does not run a model, so it stays deterministic here.
- **Forge issues surface: query, filtering, issue rows, status badges** (`client/forges-tab.tsx`) — Renders forge issues for the workspace and filters them deterministically.
- **Fleet Kanban board: column mapping, transitions, ticket cards** (`client/kanban-board.tsx`) — Interactive Kanban board mapping issues across lifecycle states.
- **Agent tree rendering: status lights, health gauges, metrics cards, rows, project groups** (`client/tree-view.tsx`) — The largest file in the client half and still fully deterministic: it displays whatever the server classified. Displaying an LLM's state is not being one.
- **Shared metrics bar: chip anatomy, selection, zero-count hiding, theme-driven colors** (`client/metrics-bar.tsx`) — Pure presentational component shared by the Work Queue and Agents & Fleet surfaces (#645). Renders counts computed elsewhere; same props, same chips.
- **Fleet theme accessor: host theme colors and helpers plus plugin typography scale** (`client/theme.ts`) — Thin hook over the host theme provider. Same host theme in, same FleetTheme out; no inference.
- **Plugin-local presentation kit: layout, cards, badges, buttons, inputs, table, ticket lifecycle** (`client/host-ui.tsx`) — Replaces the removed frozen helper client kit for uppidi-fleet. Deterministic presentation; model work stays behind the RPCs it renders.
- **Static fleet fixtures for client tests** (`client/testing/fleet-fixtures.ts`) — Test data. Deterministic by construction.
- **Render harness: host element stubs, rpc stubs, provider wrapper** (`client/testing/fleet-harness.ts`) — Test scaffolding. Never shipped: package.json `files` excludes `client/testing`.

## Shared

| Moving part | File | File exports | File loc | Classification | Anchors | Evidence |
| --- | --- | ---: | ---: | --- | --- | --- |
| 45 RPC contracts (zod schemas + input/output types) and the fleet settings contract | `shared/contracts.ts` | 310 | 2348 | `deterministic` | `uppidiFleetSettingsContract`, `uppidiFleetSettingsSchema` | contracts.ts:54-2348 — 45 `defineContract`/`defineSettingsContract` objects across the file<br>contracts.ts:1739-1754 — the fleet settings schema is a `z.object`<br>index.server.ts:135-189 — every one of them is bound to a handler there |
| Settings re-export barrel | `shared/settings.ts` | 3 | 5 | `deterministic` | whole file | shared/settings.ts:1-5 — re-exports three names from `contracts.js` |
| Filtering, sorting, health-gauge derivation, project grouping, bulk-archive eligibility | `shared/sort-filter.ts` | 46 | 1233 | `deterministic` | `filterIssues`, `sortIssues`, `filterQueues`, `sortAgents`, `filterRunners`, `filterMetricCandidates`, +4 more | sort-filter.ts:148 — health gauge buckets counters against fixed thresholds<br>sort-filter.ts:484-540 — bulk-archive eligibility is an explicit ordered rule list<br>sort-filter.ts:875 — project grouping is set/dict work over agent records |
| Canonical repository identity resolution: normalization, coordinate splitting, single-name resolver (#888) | `shared/repo-identity.ts` | 11 | 191 | `deterministic` | `normalizeRepoKey`, `canonicalRepoKey`, `resolveCanonicalRepo`, `canonicalRepoName`, `compactRepoName` | repo-identity.ts:14-30 — `normalizeRepoKey` strips protocol, scp, port and `.git` deterministically<br>repo-identity.ts:83-115 — `repoCoordinates` splits a fully-qualified key into host/owner/repo<br>repo-identity.ts:135-176 — `resolveCanonicalRepo` matches a bare name against the known roster or returns null |
| Attention/state label unions and Forgejo issue/repo shapes | `shared/types.ts` | 4 | 58 | `deterministic` | `AttentionLabel`, `StateLabel`, `ForgeIssue`, `ForgeRepoInfo` | types.ts:1-11 — two string-literal unions<br>types.ts:13-49 — two interfaces |
| Generated plugin version stamp | `shared/version.ts` | 1 | 2 | `deterministic` | `PLUGIN_VERSION` | version.ts:1-2 — `0.1.0+<git sha>`, written by the helper's `stampVersion` |
| Declared helper expectation, resolution mode, helper content digest | `shared/helper-version.ts` | 3 | 29 | `deterministic` | `HELPER_VERSION`, `HELPER_SERVED_FROM`, `HELPER_REVISION` | helper-version.ts:19-20 — version and `checkout` resolution mode as literals<br>helper-version.ts:29 — sha256 digest of `packages/paseo-plugin-helper/src`<br>helper-version.ts:10-15 — nothing reads these and believes them; `helper-resolution.test.mjs` and `doctor-live.mjs` re-derive instead |

- **45 RPC contracts (zod schemas + input/output types) and the fleet settings contract** (`shared/contracts.ts`) — The wire vocabulary. Schemas describe model-shaped concepts (agent metrics, model candidates) but a schema is a validator, not a model.
- **Settings re-export barrel** (`shared/settings.ts`) — Pure re-export barrel.
- **Filtering, sorting, health-gauge derivation, project grouping, bulk-archive eligibility** (`shared/sort-filter.ts`) — 44 exports, every one a pure function of its arguments. Shared verbatim by client and server, which is why both halves of the UI agree by construction.
- **Canonical repository identity resolution: normalization, coordinate splitting, single-name resolver (#888)** (`shared/repo-identity.ts`) — Pure string algebra shared by client and server. The single source of repository identity every surface resolves through.
- **Attention/state label unions and Forgejo issue/repo shapes** (`shared/types.ts`) — Type-only. No runtime behaviour at all.
- **Generated plugin version stamp** (`shared/version.ts`) — A generated constant. Re-stamped by `npm run stamp`.
- **Declared helper expectation, resolution mode, helper content digest** (`shared/helper-version.ts`) — The one file in the plugin that is a declaration about a dependency rather than behaviour — and it is explicit that consumers must re-derive rather than trust it.

## Plugin-owned scripts and hooks

| Moving part | File | File exports | File loc | Classification | Anchors | Evidence |
| --- | --- | ---: | ---: | --- | --- | --- |
| ESM resolve-hook registration for `node --test` | `test/register-ts-hooks.mjs` | 0 | 6 | `deterministic` | whole file | register-ts-hooks.mjs:4-6 — `register('./resolve-ts-hooks.mjs', import.meta.url)` |
| TS specifier resolution fallback for the node test runner | `test/resolve-ts-hooks.mjs` | 1 | 64 | `deterministic` | `resolve` | resolve-ts-hooks.mjs:32-63 — calls `next()` first and only falls back on `ERR_MODULE_NOT_FOUND`<br>resolve-ts-hooks.mjs:45 — a real `.json`/`.node` specifier keeps failing loudly<br>resolve-ts-hooks.mjs:48-53 — deliberately no `.tsx` probe: node type-stripping cannot load JSX |
| Standalone CLI entrypoint for board checking and triage ranking | `bin/fleet-board-check.mjs` | 0 | 114 | `deterministic` | `fleet-board-check`, `runIssuesCheck` | fleet-board-check.mjs:20-55 — parses CLI flags (--repo, --role, --force, --all, --json)<br>fleet-board-check.mjs:75-95 — runs issues check and sets exit code 1 on actionable candidates, 0 on clean |
| Standalone CLI entrypoint for fleet watchdog health auditing | `bin/fleet-watchdog.mjs` | 0 | 117 | `deterministic` | `runWatchdogAudit`, `renderWatchdogAuditMarkdown` | fleet-watchdog.mjs:20-60 — parses CLI flags (--front-desk-id, --recover/--no-recover, --json)<br>fleet-watchdog.mjs:80-98 — executes auditFleet and exits with non-zero code on unresolved anomalies |
| Standalone MCP stdio JSON-RPC 2.0 server | `bin/fleet-mcp-server.mjs` | 0 | 120 | `deterministic` | `executeFleetTool`, `FLEET_MCP_TOOLS` | fleet-mcp-server.mjs:25-50 — stdio readline transport for JSON-RPC 2.0 messages<br>fleet-mcp-server.mjs:60-110 — dispatches initialize, ping, tools/list, and tools/call |
| Standalone CLI entrypoint to deterministically ensure repo orchestrators | `bin/fleet-ensure-orchestrator.mjs` | 0 | 111 | `deterministic` | `fleet-ensure-orchestrator`, `ensureOrchestrator` | fleet-ensure-orchestrator.mjs:30-65 — parses CLI flags (--repo, --mode, --provider, --model, --force, --json)<br>fleet-ensure-orchestrator.mjs:70-100 — invokes router.ensureOrchestrator and prints outcome or JSON |

- **ESM resolve-hook registration for `node --test`** (`test/register-ts-hooks.mjs`) — Loaded via `node --import`. A separate file because a hooks module must be registered, not imported.
- **TS specifier resolution fallback for the node test runner** (`test/resolve-ts-hooks.mjs`) — Build-time only. It replaced an `npx tsx` shellout that was in no package.json and absent from the lockfile (12-16) — a silent download of whatever was current that day. Worth recording as the repo's own worked example of the drift class this matrix is generated to prevent.
- **Standalone CLI entrypoint for board checking and triage ranking** (`bin/fleet-board-check.mjs`) — Standalone executable CLI wrapping server/issues-check.ts with identical arguments and exit code contract.
- **Standalone CLI entrypoint for fleet watchdog health auditing** (`bin/fleet-watchdog.mjs`) — Standalone executable CLI wrapping HookRouter watchdog health audit with recovery controls.
- **Standalone MCP stdio JSON-RPC 2.0 server** (`bin/fleet-mcp-server.mjs`) — Exposes fleet tools over standard Model Context Protocol stdio transport for any MCP-compatible client.
- **Standalone CLI entrypoint to deterministically ensure repo orchestrators** (`bin/fleet-ensure-orchestrator.mjs`) — Standalone executable CLI wrapping HookRouter deterministic orchestrator provisioning.

## Test suites

The suites are moving parts too, and this repo has a scar from forgetting that: #702 found nine
tracked `*.test.*` files that no runner named, merged and reported as delivered coverage while
never executing. Every suite is attributed below to the script that runs it, read from the
plugin's own `package.json` at generation time. `scripts/unreachable-tests.test.mjs` is the guard
that enforces the invariant; this table is the readable view of the same fact.

| Suite | Covers | Runs under | Loc | Classification |
| --- | --- | --- | ---: | --- |
| `client/agent-switcher.test.tsx` | client/agent-switcher | `test:tsx` | 420 | `deterministic` |
| `client/cross-repo-issues.test.ts` | client/cross-repo-issues | `test:tsx` | 277 | `deterministic` |
| `client/entry.test.ts` | Surface/panel registration and teardown | `test:tsx` | 1465 | `deterministic` |
| `client/fleet-state-filter-row.test.ts` | Fleet state filter row rendering | `test:node` | 49 | `deterministic` |
| `client/forges-tab.test.tsx` | client/forges-tab | `test:tsx` | 429 | `deterministic` |
| `client/frontdesk-follow-scroll.test.tsx` | client/frontdesk-follow-scroll | `test:tsx` | 316 | `deterministic` |
| `client/issue-metrics-bar.test.ts` | Issue metrics bar rendering | `test:node` | 64 | `deterministic` |
| `client/kanban-board.test.tsx` | client/kanban-board | `test:tsx` | 842 | `deterministic` |
| `client/metrics-bar-parity.test.ts` | Parity between the metrics bar and its shared source | `test:node` | 95 | `deterministic` |
| `client/mobile-layout.test.ts` | Mobile layout behaviour under the measurement double | `test:tsx` | 270 | `deterministic` |
| `client/repo-enrollment.test.ts` | client/repo-enrollment | `test:tsx` | 131 | `deterministic` |
| `client/role-model-picker.test.ts` | Role-model picker interaction | `test:node` | 62 | `deterministic` |
| `client/search-height.test.ts` | client/search-height | `test:tsx` | 166 | `deterministic` |
| `client/select-stable-rows.test.tsx` | client/select-stable-rows | `test:tsx` | 176 | `deterministic` |
| `client/surface-halt.test.tsx` | client/surface-halt | `test:tsx` | 173 | `deterministic` |
| `client/tree-zebra.test.tsx` | Tree zebra striping | `test:tsx` | 47 | `deterministic` |
| `client/ui-guard.test.ts` | client/ui-guard | `test:tsx` | 155 | `deterministic` |
| `server/agents.test.ts` | Agent normalisation, state derivation, spawn-authority and archive paths | `test:node` | 1927 | `deterministic` |
| `server/audit-receipts.test.ts` | server/audit-receipts | `test:node` | 268 | `deterministic` |
| `server/disk-logger.test.ts` | server/disk-logger | `test:node` | 92 | `deterministic` |
| `server/fleet-reset.test.ts` | server/fleet-reset | `test:node` | 168 | `deterministic` |
| `server/fleet.test.ts` | Cross-surface fleet behaviour | `test:node` | 1390 | `deterministic` |
| `server/hook-router.test.ts` | Webhook classification, coalescing, queueing, watchdog taxonomy, handoff | `test:node` | 8658 | `deterministic` |
| `server/hook.test.ts` | Hook-service handlers, endpoint resolution, unreachable-path shapes | `test:node` | 407 | `deterministic` |
| `server/issues-check.test.ts` | Ported stale-WIP sweep fixtures, checker retirement guard (#733) | `test:node` | 178 | `deterministic` |
| `server/issues.test.ts` | server/issues | `test:node` | 183 | `deterministic` |
| `server/mcp-tools.test.ts` | MCP tool definitions, schema validation, and dispatch fixtures | `test:node` | 381 | `deterministic` |
| `server/metrics.test.ts` | Rollup arithmetic, candidate derivation, receipt persistence | `test:node` | 279 | `deterministic` |
| `server/permission-adjudication.test.ts` | Safe-pattern allowlist, shell scanner, fleet detection, and durable decision log (#1084) | `test:node` | 245 | `deterministic` |
| `server/registry.test.ts` | server/registry | `test:node` | 45 | `deterministic` |
| `server/repos.test.ts` | server/repos | `test:node` | 225 | `deterministic` |
| `server/role-models.test.ts` | server/role-models | `test:node` | 186 | `deterministic` |
| `server/rotation.test.ts` | server/rotation | `test:node` | 247 | `deterministic` |
| `server/runners.test.ts` | Runner scope merge, normalisation, fleet-status decision table | `test:node` | 357 | `deterministic` |
| `server/skills.test.ts` | Fleet skill resolution, canonical override precedence, drift, and spawn-prompt wiring | `test:node` | 509 | `deterministic` |
| `server/workspace-guard.test.ts` | server/workspace-guard | `test:node` | 282 | `deterministic` |
| `server/workspace-lookup.test.ts` | server/workspace-lookup | `test:node` | 300 | `deterministic` |
| `shared/contracts.test.ts` | Contract schema validation | `test:node` | 1421 | `deterministic` |
| `shared/repo-identity.test.ts` | shared/repo-identity | `test:node` | 132 | `deterministic` |
| `shared/sort-filter.test.ts` | Filter, sort, gauge and grouping functions | `test:node` | 1684 | `deterministic` |
| `test/fleet-board-check-cli.test.mjs` | Standalone fleet-board-check CLI options and exit codes | `test:node` | 46 | `deterministic` |
| `test/fleet-ensure-orchestrator-cli.test.mjs` | test/fleet-ensure-orchestrator-cli | `test:node` | 44 | `deterministic` |
| `test/fleet-mcp-server.test.mjs` | MCP stdio protocol handshake, tools/list and execution over stdin/stdout | `test:node` | 104 | `deterministic` |
| `test/fleet-watchdog-cli.test.mjs` | Standalone fleet-watchdog CLI options, recency validation, and diagnostic run | `test:node` | 60 | `deterministic` |
| `test/runtime-boundary.test.mjs` | test/runtime-boundary | `test:node` | 53 | `deterministic` |

Every suite is `deterministic` on the same test used for the source rows: a test asserts a fixed
expected value, and an assertion that had to be re-tuned against a model's output would be a
change-detector, not a test.

## What this table does not cover

The spawned agent sessions have no file, so they have no row. They are the thing every
`hybrid` row points at: a model-backed Paseo agent with a prompt, a provider and a model
chosen by `server/agents.ts` from the map in `server/role-models.ts`. Their behaviour is not
reproducible, which is the entire reason those rows are `hybrid` rather than `deterministic`.

Also outside the inventory, because they are not plugin-owned:

- `~/bin/forgejo-issues-check`, retired by #733: the board sweep now runs the ported `server/issues-check.ts` in-process. A `FORGEJO_ISSUES_CHECK=` override execs an external checker for debugging only.
- The `paseo` CLI and daemon SDK surface, called as a subprocess throughout the server.
- `paseo-plugin-helper`, the UI/storage/logger layer this plugin is built on.

## Appendix: generated export inventory

Read from the tree, uncensored and unedited. This is the inventory half of the document; the
matrix above is the judgement half.

| File | Layer | Loc | Exports | Top-level exported names |
| --- | --- | ---: | ---: | --- |
| `bin/fleet-board-check.mjs` | script | 114 | 0 | — |
| `bin/fleet-ensure-orchestrator.mjs` | script | 111 | 0 | — |
| `bin/fleet-mcp-server.mjs` | script | 120 | 0 | — |
| `bin/fleet-watchdog.mjs` | script | 117 | 0 | — |
| `client/agent-switcher-data.ts` | client | 59 | 3 | `AgentSwitcherData`, `AgentSwitcherGroup`, `mapAgentSwitcherData` |
| `client/agent-switcher.test.tsx` | client | 420 | 0 | — |
| `client/agent-switcher.tsx` | client | 330 | 8 | `AGENT_SWITCHER_JUMP_SCREEN_ID`, `AgentRowItem`, `AgentSwitcherDropdown`, `AgentSwitcherDropdownProps`, `AgentSwitcherJumpScreen`, `AgentSwitcherPopover`, `AgentSwitcherSidebarIcon`, `AgentSwitcherSidebarItem` |
| `client/cross-repo-issues.test.ts` | client | 277 | 0 | — |
| `client/entry.test.ts` | client | 1465 | 0 | — |
| `client/fleet-state-filter-row.test.ts` | client | 49 | 0 | — |
| `client/forges-tab.test.tsx` | client | 429 | 0 | — |
| `client/forges-tab.tsx` | client | 536 | 13 | `AgentEnvelopeCard`, `CommentCard`, `ForgeIssuesView`, `ForgeIssuesViewProps`, `ForgesTabView`, `MarkdownLite`, `NewIssueComposer`, `ScopedLabelGroup`, `TicketLifecycleView`, `canonicalForgeUrl`, `forgeContextContract`, `forgeOpenIssuesContract` …+1 more |
| `client/frontdesk-follow-scroll.test.tsx` | client | 316 | 0 | — |
| `client/host-ui.tsx` | client | 2223 | 78 | `ActionBar`, `ActionBarProps`, `AgentEnvelopeCard`, `AttentionBeacon`, `AttentionBeaconMode`, `AttentionBeaconProps`, `AttentionBeaconTone`, `Badge`, `BadgeProps`, `BadgeSize`, `BadgeStyle`, `Button` …+66 more |
| `client/index.ts` | client | 8 | 0 | — |
| `client/issue-metrics-bar.test.ts` | client | 64 | 0 | — |
| `client/kanban-board.test.tsx` | client | 842 | 0 | — |
| `client/kanban-board.tsx` | client | 746 | 11 | `KANBAN_COLUMNS`, `KanbanCard`, `KanbanCardProps`, `KanbanColumnDef`, `KanbanTransitionAction`, `UppidiFleetKanbanBoard`, `UppidiFleetKanbanBoardProps`, `getActiveDraggingIssue`, `getColumnTransitions`, `getIssueKanbanColumn`, `setActiveDraggingIssue` |
| `client/metrics-bar-parity.test.ts` | client | 95 | 0 | — |
| `client/metrics-bar.tsx` | client | 108 | 3 | `MetricsBar`, `MetricsBarChip`, `MetricsBarProps` |
| `client/mobile-layout.test.ts` | client | 270 | 0 | — |
| `client/panel.tsx` | client | 49 | 6 | `UppidiFleetPanel`, `UppidiFleetSidebar`, `UppidiFleetWorkspacePanel`, `UppidiForgePanel`, `UppidiForgeWorkspacePanel`, `registerWorkspacePanel` |
| `client/repo-enrollment.test.ts` | client | 131 | 0 | — |
| `client/role-model-picker.test.ts` | client | 62 | 0 | — |
| `client/search-height.test.ts` | client | 166 | 0 | — |
| `client/select-stable-rows.test.tsx` | client | 176 | 0 | — |
| `client/surface-halt.test.tsx` | client | 173 | 0 | — |
| `client/surface.tsx` | client | 3219 | 19 | `AttentionAgentCard`, `AttentionAgentCardProps`, `HaltConfirmModal`, `HaltConfirmModalProps`, `HaltedBanner`, `HaltedBannerProps`, `ModelAlertBanner`, `ModelAlertBannerProps`, `ResetStateModal`, `ResetStateModalProps`, `RouterStatusBadge`, `SurfaceTab` …+7 more |
| `client/testing/fleet-fixtures.ts` | client | 422 | 9 | `WIDE_WORKTREE`, `agentsPayload`, `agentsPayloadNoFrontDesk`, `hookQueuesPayload`, `installPayloads`, `issuesPayload`, `metricsPayload`, `runnersPayload`, `skillsPayload` |
| `client/testing/fleet-harness.ts` | client | 280 | 36 | `ActivityIndicator`, `Animated`, `Appearance`, `Dimensions`, `Easing`, `FlatList`, `FleetRenderHarness`, `Icon`, `Image`, `Linking`, `Modal`, `PanResponder` …+24 more |
| `client/theme.ts` | client | 62 | 5 | `FleetTheme`, `FleetTypographyScale`, `FleetTypographyToken`, `HostThemeProvider`, `useFleetTheme` |
| `client/tooling.tsx` | client | 392 | 2 | `UppidiFleetToolingProps`, `UppidiFleetToolingView` |
| `client/tree-view.tsx` | client | 3463 | 38 | `AgentAttentionBanner`, `AgentAttentionBannerProps`, `AgentHealthGauge`, `AgentHealthGaugeProps`, `AgentLabelsRow`, `AgentMetricsCard`, `AgentMetricsCardProps`, `AgentStateDot`, `AgentStatusLight`, `AgentStatusLightProps`, `AgentStatusLightsRow`, `AgentStatusLightsRowProps` …+26 more |
| `client/tree-zebra.test.tsx` | client | 47 | 0 | — |
| `client/ui-guard.test.ts` | client | 155 | 0 | — |
| `index.client.tsx` | entry | 108 | 10 | `AGENT_SWITCHER_JUMP_SCREEN_ID`, `AgentSwitcherJumpScreen`, `AgentSwitcherSidebarItem`, `UppidiFleetPanel`, `UppidiFleetSidebar`, `UppidiFleetSurface`, `UppidiForgePanel`, `UppidiForgeSurface`, `contribute`, `registerWorkspacePanel` |
| `index.server.ts` | entry | 232 | 1 | `contribute` |
| `server/agents.test.ts` | server | 1927 | 0 | — |
| `server/agents.ts` | server | 3360 | 64 | `CanonicalFleetRegistry`, `DEFAULT_AUTO_ACCEPT_PROVIDERS`, `DEFAULT_SPAWN_MODE_PROVIDERS`, `ExecFileAsyncFn`, `RawAgentRecord`, `RawPendingPermissionLike`, `RepoRootInspection`, `SPAWN_AUTHORITY_WORKER_ERROR`, `SPAWN_AUTHORITY_WORKSPACE_ERROR`, `SpawnAuthorityDecision`, `SpawnCapabilities`, `SpawnCapabilityResult` …+52 more |
| `server/audit-receipts.test.ts` | server | 268 | 0 | — |
| `server/audit-receipts.ts` | server | 454 | 22 | `AUDIT_RECONCILIATION_VERSION`, `AppendAuditReceiptOptions`, `AppendAuditReceiptResult`, `AuditLookupQuery`, `AuditMergeReconciliation`, `AuditStoreOptions`, `appendAuditReceipt`, `appendAuditReconciliation`, `auditCheck`, `defaultAuditReconciliationsFilePath`, `defaultAuditsFilePath`, `findAuditReceipt` …+10 more |
| `server/disk-logger.test.ts` | server | 92 | 0 | — |
| `server/disk-logger.ts` | server | 184 | 6 | `DEFAULT_LOG_FILE_NAME`, `DEFAULT_MAX_LOG_BYTES`, `DEFAULT_MAX_LOG_FILES`, `DiskLogger`, `DiskLoggerOptions`, `defaultScopedLogDir` |
| `server/fleet-reset.test.ts` | server | 168 | 0 | — |
| `server/fleet.test.ts` | server | 1390 | 0 | — |
| `server/forgejo-api.ts` | server | 180 | 12 | `DEFAULT_FORGEJO_HOST`, `FORGEJO_API_TIMEOUT_MS`, `FetchLike`, `ForgejoApiResult`, `TokenResolverFn`, `forgejoApiGet`, `forgejoApiRequest`, `forgejoToken`, `resolveForgejoHost`, `resolveForgejoToken`, `setFetchForTest`, `setTokenResolverForTest` |
| `server/hook-router.test.ts` | server | 8658 | 0 | — |
| `server/hook-router.ts` | server | 10359 | 208 | `BoardCandidate`, `BoardCheckResult`, `BoardSweepResult`, `CANCELLATION_TIMEOUT_MARKER`, `CHILD_WAKEUP_EVENTS`, `CI_FAILURE_LABELS`, `CLOSE_GUARD_ACCEPTED_LABELS`, `CLOSE_GUARD_POLICY_COMMENT`, `ChildWakeupAssessment`, `ChildWakeupContext`, `ChildWakeupKind`, `CiFailureDetails` …+196 more |
| `server/hook.test.ts` | server | 407 | 0 | — |
| `server/hook.ts` | server | 325 | 16 | `HookAuthPosture`, `HookEndpointSource`, `ResolvedHookEndpoint`, `handleHookConfigure`, `handleHookDrain`, `handleHookInfo`, `handleHookLogTail`, `handleHookPause`, `handleHookQueues`, `handleHookResume`, `handleHookServiceAction`, `handleHookServiceStatus` …+4 more |
| `server/issues-check.test.ts` | server | 178 | 0 | — |
| `server/issues-check.ts` | server | 1123 | 42 | `EFFORT_WEIGHTS`, `FeedbackInfo`, `ForgejoComment`, `ForgejoIssue`, `ISSUES_CHECK_DEFAULT_HOSTNAME`, `ISSUES_CHECK_DEFAULT_REPO`, `ISSUES_CHECK_DEFAULT_STALE_WIP_HOURS`, `IssueSignature`, `IssuesCheckIo`, `IssuesCheckOptions`, `IssuesCheckOutcome`, `IssuesCheckRole` …+30 more |
| `server/issues.test.ts` | server | 183 | 0 | — |
| `server/issues.ts` | server | 262 | 6 | `ALL_STATE_LABELS`, `CommandRunnerFn`, `STATE_LABELS_FOR_COLUMN`, `handleUppidiIssues`, `handleUppidiTransitionIssue`, `setIssueCommandRunnerForTest` |
| `server/mcp-tools.test.ts` | server | 381 | 0 | — |
| `server/mcp-tools.ts` | server | 940 | 16 | `FLEET_MCP_TOOLS`, `FleetToolCallResult`, `executeFleetBoardSweep`, `executeFleetCheckBoard`, `executeFleetEnsureOrchestrator`, `executeFleetHandoffGenerate`, `executeFleetPruneOrchestrators`, `executeFleetQueueInspect`, `executeFleetQueuePurge`, `executeFleetRotateRole`, `executeFleetTool`, `executeFleetValidateWorkspace` …+4 more |
| `server/metrics.test.ts` | server | 279 | 0 | — |
| `server/metrics.ts` | server | 840 | 22 | `AppendRollupResult`, `BASELINE_CANDIDATES`, `DEFAULT_TASK_PROFILES`, `FleetMetrics`, `MAX_ROLLUP_RECEIPTS`, `METRICS_PRIVACY_NOTICE`, `ModelRollup`, `RollupAgentInput`, `RollupAgentMetrics`, `appendRollupReceipt`, `computeModelRollups`, `defaultMetricsFilePath` …+10 more |
| `server/permission-adjudication.test.ts` | server | 245 | 0 | — |
| `server/permission-adjudication.ts` | server | 886 | 16 | `AdjudicatePermissionInput`, `AdjudicatePermissionResult`, `AdjudicationDecisionRecord`, `AdjudicationLogOptions`, `FleetAgentContext`, `FleetAgentLike`, `RawPermissionLike`, `SAFE_PERMISSION_RULES`, `SafePermissionMatch`, `adjudicatePermission`, `appendAdjudicationDecision`, `classifySafeCommand` …+4 more |
| `server/registry.test.ts` | server | 45 | 0 | — |
| `server/repos.test.ts` | server | 225 | 0 | — |
| `server/repos.ts` | server | 211 | 3 | `handleUppidiEnrollRepo`, `handleUppidiRepos`, `handleUppidiUnenrollRepo` |
| `server/role-models.test.ts` | server | 186 | 0 | — |
| `server/role-models.ts` | server | 346 | 14 | `DEFAULT_ROLE_MODELS`, `ExecFileAsyncFn`, `defaultRoleModelsConfigPath`, `discoverAvailableModels`, `getRoleModelsConfigPath`, `handleUppidiRoleModels`, `handleUppidiSetRoleModel`, `legacyRoleModelsConfigPaths`, `listEnabledProviders`, `loadSavedRoleModels`, `migrateLegacyRoleModelsConfig`, `resolveHostHome` …+2 more |
| `server/rotation.test.ts` | server | 247 | 0 | — |
| `server/rotation.ts` | server | 369 | 15 | `DEFAULT_ROTATION_POLICY`, `DEFAULT_ROTATION_ROLE_POLICY`, `ROTATION_ROLES`, `RotationBlockReason`, `RotationBriefInput`, `RotationBriefTicket`, `RotationLock`, `RotationObservation`, `RotationTriggerContext`, `RotationTriggerDecision`, `RotationTriggerReason`, `buildRotationBrief` …+3 more |
| `server/runners.test.ts` | server | 357 | 0 | — |
| `server/runners.ts` | server | 273 | 6 | `ExecFileAsyncFn`, `fetchLocalContainers`, `handleUppidiRunners`, `normalizeForgejoRunners`, `runnerScopeEndpoints`, `setExecFileAsyncForTest` |
| `server/settings.ts` | server | 39 | 2 | `getUppidiFleetSettingsStorage`, `resetUppidiFleetSettingsStorageInstance` |
| `server/skills.test.ts` | server | 509 | 0 | — |
| `server/skills.ts` | server | 528 | 25 | `CANONICAL_SKILLS_ROOT_ENV`, `EffectiveSkill`, `FLEET_SKILL_DEFINITIONS`, `FleetSkillDefinition`, `PluginRootOptions`, `SkillStorageOptions`, `canonicalSkillsRootCandidates`, `getBundledSkillPath`, `getCanonicalSkillPath`, `getEffectiveSkillContent`, `getEffectiveSkillPath`, `getSkillOverrideStorage` …+13 more |
| `server/workspace-guard.test.ts` | server | 282 | 0 | — |
| `server/workspace-guard.ts` | server | 321 | 13 | `DaemonWorkspaceRegistry`, `ExecFileAsyncFn`, `PrimaryCheckoutInspection`, `WORKER_LOCAL_ISOLATION_ERROR`, `WORKER_PRIMARY_CHECKOUT_ERROR`, `WorkerWorkspaceGuardDecision`, `WorkerWorkspaceGuardOptions`, `WorkspaceGuardRecord`, `evaluateWorkerSpawnWorkspace`, `evaluateWorkerWorkspaceGuard`, `inspectPrimaryCheckout`, `resolveWorkerWorkspaceContext` …+1 more |
| `server/workspace-lookup.test.ts` | server | 300 | 0 | — |
| `server/workspace-lookup.ts` | server | 329 | 12 | `CanonicalWorkspaceDescriptor`, `ProjectRecord`, `ResolvedWorkspace`, `WORKSPACE_NOT_FOUND_REMEDIATION`, `WorkspaceLookupOptions`, `WorkspaceRecord`, `WorkspaceResolutionError`, `candidateHostCheckoutDir`, `canonicalDescriptorsToRegistry`, `resolveWorkspaceForRepo`, `resolveWorkspaceForRepoViaDaemon`, `workspaceNotFoundError` |
| `shared/contracts.test.ts` | shared | 1421 | 0 | — |
| `shared/contracts.ts` | shared | 2348 | 310 | `AgentAttentionReason`, `AgentAttentionReasonSchema`, `AgentBlockDetail`, `AgentBlockDetailSchema`, `AgentLifecycleState`, `AgentLifecycleStateSchema`, `AgentRoleDivergence`, `AgentRoleDivergenceSchema`, `AttentionLabel`, `AttentionLabelSchema`, `CandidateModelMetrics`, `CandidateModelMetricsSchema` …+298 more |
| `shared/helper-version.ts` | shared | 29 | 3 | `HELPER_REVISION`, `HELPER_SERVED_FROM`, `HELPER_VERSION` |
| `shared/repo-identity.test.ts` | shared | 132 | 0 | — |
| `shared/repo-identity.ts` | shared | 191 | 11 | `CanonicalRepo`, `DEFAULT_FORGEJO_HOST`, `RepoCoordinates`, `ResolveCanonicalRepoOptions`, `candidateRepoKeys`, `canonicalRepoKey`, `canonicalRepoName`, `compactRepoName`, `normalizeRepoKey`, `repoCoordinates`, `resolveCanonicalRepo` |
| `shared/settings.ts` | shared | 5 | 3 | `UppidiFleetSettings`, `uppidiFleetSettingsContract`, `uppidiFleetSettingsSchema` |
| `shared/sort-filter.test.ts` | shared | 1684 | 0 | — |
| `shared/sort-filter.ts` | shared | 1233 | 46 | `AgentPreset`, `AgentSortField`, `BuildProjectGroupsOptions`, `BuildProjectGroupsResult`, `DEFAULT_HEALTH_GAUGE_THRESHOLDS`, `HealthGauge`, `HealthGaugeKind`, `HealthGaugeSegment`, `HealthGaugeThresholds`, `HealthGaugeTone`, `IssuePreset`, `IssueSortField` …+34 more |
| `shared/types.ts` | shared | 58 | 4 | `AttentionLabel`, `ForgeIssue`, `ForgeRepoInfo`, `StateLabel` |
| `shared/version.ts` | shared | 2 | 1 | `PLUGIN_VERSION` |
| `test/fleet-board-check-cli.test.mjs` | script | 46 | 0 | — |
| `test/fleet-ensure-orchestrator-cli.test.mjs` | script | 44 | 0 | — |
| `test/fleet-mcp-server.test.mjs` | script | 104 | 0 | — |
| `test/fleet-watchdog-cli.test.mjs` | script | 60 | 0 | — |
| `test/register-ts-hooks.mjs` | script | 6 | 0 | — |
| `test/resolve-ts-hooks.mjs` | script | 64 | 1 | `resolve` |
| `test/runtime-boundary.test.mjs` | script | 53 | 0 | — |

