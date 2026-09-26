#!/usr/bin/env node
// fleet-determinism-matrix: emit the uppidi-fleet determinism/AI matrix (#705).
//
// The matrix answers one question per moving part of `plugins/uppidi-fleet`: is
// this thing deterministic, does it run a model, or is it a deterministic control
// plane driving one? The issue asked for the moving parts and the three-way split
// "in that same table/matrix".
//
// ## Why this file exists instead of a hand-written table
//
// The inventory half of this document is generated. A hand-maintained list of
// this plugin's surfaces drifts silently the moment a file is added, renamed or
// split, and a doc that quietly omits a moving part is worse than no doc: it
// reads as complete. #702 is that failure in the test tree -- nine `*.test.*`
// files that no runner named, merged and reported as delivered coverage while
// never executing. The same class of bug, in a doc, is invisible.
//
// So: the file list, the line counts and the exported-symbol inventory are all
// read from the tree on every run, and the judgement map below is validated
// against that inventory. Renaming `handleHookStatus` fails this generator
// rather than producing a table that quietly describes a symbol nobody exports
// any more. `PARTS` entries that name a symbol the file no longer contains are
// a hard error, not a warning.
//
// ## What is generated and what is judgement
//
// Generated: which files are in scope, their layer, their LOC, their top-level
// exports, and which runner script names each test file.
// Judgement: the `label` and `evidence` on each part in `PARTS`. Determinism is
// not mechanically derivable from source, so it is stated, and every claim
// carries the file:line it rests on so a reader can refute it without reading
// the generator.
//
// A file is one row, except where one file genuinely carries concerns with
// different determinism. `server/hook-router.ts` is 3716 lines spanning webhook
// parsing, queue persistence, the fleet watchdog, and message delivery into live
// LLM sessions; collapsing that to one bucket would hide exactly the split the
// issue is asking about. Such a file declares several parts.
//
// Test files are the exception in the other direction: a part is synthesised for
// each of them, so a new suite appears in the matrix on the next run without
// anyone remembering to document it. `SUITE_NOTES` adds a one-line description
// where one is worth having.
//
// Usage: node scripts/fleet-determinism-matrix.mjs [--check]
//   (no flag): write the matrix to its committed path.
//   --check: exit non-zero if the committed matrix differs from a fresh render.
//     Writes nothing.
//
// #705: docs and generator only. No production change, no reshaping of the tree.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "plugins/uppidi-fleet";
const OUT = path.join(PLUGIN, "docs", "determinism-matrix.md");
const CHECK = process.argv.includes("--check");

/** Labels. `contested` is a real answer, not a parking lot: see the legend. */
const DETERMINISTIC = "deterministic";
const HYBRID = "hybrid";
const AI = "ai-llm";
const CONTESTED = "contested";

const LABELS = [DETERMINISTIC, HYBRID, AI, CONTESTED];

// ---------------------------------------------------------------------------
// Inventory: read the tree, do not trust a list
// ---------------------------------------------------------------------------

const SOURCE_EXT = /\.(ts|tsx|mjs)$/;

/**
 * Tracked files under the plugin, by layer. `git ls-files` rather than a
 * filesystem walk for the reason scripts/unreachable-tests.test.mjs gives: the
 * walk skips symlinked directories, and `plugins/uppidi-forge` is a tracked
 * symlink to this plugin, so a walk-based count would either miss the alias or
 * double-count every file under it.
 */
function trackedFiles() {
  const out = execFileSync("git", ["ls-files", PLUGIN], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && SOURCE_EXT.test(l) && fs.statSync(path.join(ROOT, l)).isFile());
}

function layerOf(rel) {
  if (rel.startsWith(`${PLUGIN}/server/`)) return "server";
  if (rel.startsWith(`${PLUGIN}/client/`)) return "client";
  if (rel.startsWith(`${PLUGIN}/shared/`)) return "shared";
  if (rel === `${PLUGIN}/index.server.ts`) return "entry";
  if (rel === `${PLUGIN}/index.client.tsx`) return "entry";
  if (rel.startsWith(`${PLUGIN}/test/`)) return "script";
  return "other";
}

function isTestFile(rel) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
}

/**
 * Top-level exported names. Covers the declaration forms this plugin uses
 * (`function`, `async function`, `const`, `class`, `interface`, `type`) plus
 * re-export braces in both single-line and block form, since
 * `client/index.ts` and `shared/settings.ts` are pure barrels.
 */
function parseExports(src) {
  const names = new Set();
  const add = (raw) => {
    const n = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim();
    if (n && n !== "default") names.add(n);
  };

  for (const m of src.matchAll(
    /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    add(m[1]);
  }

  // `export { a, b as c }` / `export { a, b } from "./x.js"` / block form.
  for (const m of src.matchAll(/^export\s*\{([\s\S]*?)\}\s*(?:from\s*["'][^"']+["'])?\s*;?/gm)) {
    for (const piece of m[1].split(",")) {
      if (!piece.trim()) continue;
      add(piece);
    }
  }

  return [...names].sort();
}

/**
 * Which runner script names each test file, resolved from the plugin's own
 * package.json because `npm run` executes with that package as cwd. The tokens
 * in a `node --test a b c` invocation are paths, so a plain whitespace split is
 * the right model here; this is display data, not the orphan check
 * (scripts/unreachable-tests.test.mjs is the guard for that, and it reads
 * Makefile and workflow surfaces too).
 */
function runnerFor(rel) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, PLUGIN, "package.json"), "utf8"));
  const base = path.basename(rel);
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    for (const token of String(cmd).split(/\s+/)) {
      if (path.basename(token) === base) return name;
    }
  }
  return null;
}

function buildInventory() {
  const inv = new Map();
  for (const rel of trackedFiles()) {
    const abs = path.join(ROOT, rel);
    const src = fs.readFileSync(abs, "utf8");
    inv.set(rel, {
      rel,
      layer: layerOf(rel),
      test: isTestFile(rel),
      // A trailing newline makes split() yield a final empty element; that is not a line.
      loc: src.replace(/\n$/, "").split("\n").length,
      exports: parseExports(src),
      src,
    });
  }
  return inv;
}

// ---------------------------------------------------------------------------
// Judgement: one entry per moving part, keyed by the symbols that define it
// ---------------------------------------------------------------------------
//
// `exports` anchors are checked against the parsed export inventory. `symbols`
// anchors cover class methods and module-internal functions, which are not
// top-level exports, and are checked by word presence in the file. Both are
// hard errors when stale: that check is the whole anti-drift mechanism.
//
// `label: contested` is used where the honest answer depends on which lens you
// take. It is reported, with the reason, rather than resolved into a bucket the
// evidence does not support.

const PARTS = [
  // ---------------------------------------------------------------- server ---
  {
    file: `${PLUGIN}/index.server.ts`,
    part: "RPC registration and plugin lifecycle",
    layer: "entry",
    label: DETERMINISTIC,
    anchors: { symbols: ["server.handle", "startHookRouter", "registerSettingsRpc"] },
    evidence: [
      [`index.server.ts:81-103`, "23 `server.handle(contract, handler)` bindings, one per RPC contract"],
      [`index.server.ts:133`, "`startHookRouter(server)` starts the HTTP listener"],
      [`index.server.ts:142-145`, "teardown returns a disposer, no model call"],
    ],
    note: "Binds contracts to handlers and owns load/unload. Every handler it registers is classified on its own row below.",
  },
  {
    file: `${PLUGIN}/server/agents.ts`,
    part: "Agent record normalisation, metrics projection, deterministic-state derivation",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: ["normalizeRawAgent", "normalizeAgentMetrics", "deriveDeterministicState", "categorizeAgent"],
    },
    evidence: [
      [`agents.ts:227-253`, "copies token/cost/turn counters off the record, no inference"],
      [`agents.ts:255-348`, "`deriveDeterministicState` is ordered `if`/`includes` matching over status and error text"],
      [`agents.ts:281-296`, "quota/spawn/timeout classification is literal substring matching"],
    ],
    note: "THE TELEMETRY ROW. It reads token counts, cost and turn state produced by an LLM session, and it is fully deterministic: same record in, same state out. Observing a model is not being one. The substring table at 281-296 is a fixed vocabulary, not a learned judgement.",
  },
  {
    file: `${PLUGIN}/server/agents.ts`,
    part: "Fleet topology, workspace mapping, permission scope, on-disk metadata",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: [
        "buildAgentTree",
        "getWorkspaceProjectMap",
        "findScopeMatchingPermission",
        "getAgentDiskMetadataMap",
        "checkRepoMainDirty",
      ],
    },
    evidence: [
      [`agents.ts:425-543`, "`buildAgentTree` links parents to children from ids"],
      [`agents.ts:689-707`, "`checkRepoMainDirty` shells `git status` and parses the result"],
      [`agents.ts:758`, "`fetchPaseoAgents` reads `paseo ls --json`"],
    ],
    note: "Subprocess and filesystem reads. Same inputs, same tree; nothing here consults a model.",
  },
  {
    file: `${PLUGIN}/server/agents.ts`,
    part: "Agent session spawning, front-desk and orchestrator lifecycle, spawn-authority guard",
    layer: "server",
    label: HYBRID,
    anchors: {
      exports: ["spawnPaseoAgent", "handleUppidiCreateFrontDesk", "handleUppidiAddOrchestrator", "evaluateSpawnAuthority"],
    },
    evidence: [
      [`agents.ts:1519`, "`context.paseo.agents.create(createPayload)` creates a model-backed session"],
      [`agents.ts:1563`, "CLI fallback `paseo run -d ... <prompt>` — the prompt is the agent's task"],
      [`agents.ts:1652-1654`, "default front-desk prompt is a fixed instruction string"],
      [`agents.ts:1380-1428`, "spawn-authority guard is deterministic policy over caller id and cwd"],
    ],
    note: "The spawn call is deterministic -- the same request yields the same agent record. What that session then does is model inference, and nothing in this file constrains it. The guard half is deterministic policy and is cited as such.",
  },
  {
    file: `${PLUGIN}/server/forgejo-api.ts`,
    part: "Forgejo host/token resolution and classified API reads",
    layer: "server",
    label: DETERMINISTIC,
    anchors: { exports: ["resolveForgejoHost", "resolveForgejoToken", "forgejoApiGet", "forgejoToken"] },
    evidence: [
      [`forgejo-api.ts:9-11`, "host is `process.env.FORGEJO_HOST` or a constant"],
      [`forgejo-api.ts:24-47`, "token is read from env or parsed out of `~/.config/tea/config.yml`"],
      [`forgejo-api.ts:88-122`, "one GET, three outcomes: ok / http-error / unreachable"],
    ],
    note: "Deterministic given host state, and it says so when unauthenticated rather than substituting data (22-23).",
  },
  {
    file: `${PLUGIN}/server/issues.ts`,
    part: "Issue read and label-derived attention/status projection",
    layer: "server",
    label: DETERMINISTIC,
    anchors: { exports: ["handleUppidiIssues"] },
    evidence: [
      [`issues.ts:20-32`, "single `GET /api/v1/repos/<repo>/issues`"],
      [`issues.ts:55-64`, "attention is exact label matching against three known spellings"],
      [`issues.ts:66-73`, "status is a fixed precedence over `state/*` and `review/*` labels"],
    ],
    note: "Issues are labelled by humans and agents, so the input is not reproducible, but the projection is: same payload, same counts.",
  },
  {
    file: `${PLUGIN}/server/hook.ts`,
    part: "Hook-service RPC handlers, endpoint resolution, x-comms presence probe",
    layer: "server",
    label: DETERMINISTIC,
    anchors: { exports: ["resolveHookUrl", "handleHookStatus", "handleHookQueues", "handleHookConfigure", "handleHookLogTail"] },
    evidence: [
      [`hook.ts:42-78`, "ordered fallback: explicit arg, env, live router, settings, persisted config, loopback"],
      [`hook.ts:87-96`, "status is a `fetch` with a 4s timeout"],
      [`hook.ts:105-111`, "`isPluginInstalled` tolerates absence to `false` and never throws"],
    ],
    note: "These handlers are a transport shim over the hook router. None of them touches a model; the router they call is classified on its own rows.",
  },
  {
    file: `${PLUGIN}/server/hook-router.ts`,
    part: "Webhook ingress, event classification, digest and coalesce formatting",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: ["isBypassEvent", "sosStateOf", "eventKind", "eventHash", "formatDigest", "summarize", "forgejoEnvelope"],
      symbols: ["ingestWebhook", "SLASH_BYPASS_RE"],
    },
    evidence: [
      [`hook-router.ts:246-267`, "bypass is one regex over the event body"],
      [`hook-router.ts:291-300`, "`eventKind` maps a fixed event-type table"],
      [`hook-router.ts:358-368`, "`formatDigest` is string concatenation"],
      [`hook-router.ts:1489`, "`ingestWebhook` classifies then enqueues"],
    ],
    note: "The ingress path is a pure function of the webhook payload.",
  },
  {
    file: `${PLUGIN}/server/hook-router.ts`,
    part: "Queue persistence, pause/resume/mute, drain scheduling, backoff",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: ["loadRouterConfig", "saveRouterConfig", "getFleetRosterInfo"],
      symbols: ["drain", "pause", "resume", "persistQueue", "coalesce"],
    },
    evidence: [
      [`hook-router.ts:2776-2885`, "`drain` is guarded by closed/paused/muted/draining sets"],
      [`hook-router.ts:2833`, "backoff delay is `min(30000, 3000 * 1.5^attempts)`"],
      [`hook-router.ts:2694-2724`, "pause/resume mutate a `Set`"],
    ],
    note: "Scheduling is deterministic; the message it eventually hands to `deliverMessage` is not, and is classified separately below.",
  },
  {
    file: `${PLUGIN}/server/hook-router.ts`,
    part: "Fleet watchdog: health taxonomy detection and recovery planning",
    layer: "server",
    label: HYBRID,
    anchors: {
      exports: ["assessAgentHealth", "planWatchdogRecovery", "WATCHDOG_TAXONOMY", "scanCancellationTimeouts"],
      symbols: ["runWatchdogAudit", "recoverWatchdogAgent"],
    },
    evidence: [
      [`hook-router.ts:984-1006`, "six boolean detectors, each substring or timestamp comparison"],
      [`hook-router.ts:1054-1072`, "`planWatchdogRecovery` is set algebra over the taxonomy"],
      [`hook-router.ts:1060`, "quota exhaustion is a circuit break: `steer` is forced false"],
      [`hook-router.ts:2154`, "the plan is executed by steering a live turn"],
    ],
    note: "Detection is deterministic. Recovery is not: `planWatchdogRecovery` returns `steer: true` and the caller turns that into a wake message inside a running model session, whose response is unconstrained. Deterministic decision, nondeterministic remedy.",
  },
  {
    file: `${PLUGIN}/server/hook-router.ts`,
    part: "Message delivery into live LLM sessions (steer / no-wait, onboarding, board-sweep notice)",
    layer: "server",
    label: HYBRID,
    anchors: { symbols: ["deliverMessage", "runBoardSweep", "doFrontDeskHandoff"] },
    evidence: [
      [`hook-router.ts:1813`, "`agentRef.send(msg, { steer })` hands text to a model-backed session"],
      [`hook-router.ts:1826-1829`, "CLI fallback `paseo send --no-wait --steer <id> <msg>`"],
      [`hook-router.ts:2471-2474`, "handoff onboarding text is a template, delivered with `steer: true`"],
      [`hook-router.ts:2531-2556`, "board sweep summarises candidates deterministically, then steers the notice"],
    ],
    note: "The send itself is a deterministic API call. What the recipient model does with it -- whether the wake actually revives the turn, whether the notice is acted on -- is the part that cannot be asserted. Hybrid for that reason, not because the delivery code guesses.",
  },
  {
    file: `${PLUGIN}/server/hook-router.ts`,
    part: "Hook HTTP service surface: listen, status/info/queues, configure, restart, teardown",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: ["getHookServiceStatus", "configureHookService", "executeHookServiceAction", "getHookRouterInfo", "startHookRouter"],
      symbols: ["handleHttpRequest", "sendJson"],
    },
    evidence: [
      [`hook-router.ts:2960-3002`, "`createServer` + `listen`, EADDRINUSE degrades to disabled rather than throwing"],
      [`hook-router.ts:3047-3088`, "`configure` writes config then restarts if listening"],
      [`hook-router.ts:3455-3484`, "status is a projection of bound address, pid and uptime"],
    ],
    note: "Lifecycle and transport. Deterministic given the same host state.",
  },
  {
    file: `${PLUGIN}/server/metrics.ts`,
    part: "Model rollup receipts and candidate derivation from daemon counters",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: ["computeModelRollups", "deriveCandidatesFromReceipts", "appendRollupReceipt", "loadFleetMetrics", "median"],
    },
    evidence: [
      [`metrics.ts:409-480`, "groups by `provider::model`, reduces with a median over per-agent counters"],
      [`metrics.ts:489-532`, "candidate rows are sums and a completion rate over stored receipts"],
      [`metrics.ts:559-613`, "append is a read-modify-write with a tmp file + rename"],
      [`metrics.ts:483-488`, "comment states task-profile attribution is deliberately absent: minimized receipts cannot carry it"],
    ],
    note: "THE ROW THAT IS EASY TO GET WRONG, and it is deterministic. It measures LLM sessions -- token use, cache ratio, turn duration, cost -- and every number is arithmetic over counters the daemon already computed. Nothing here is a model. The privacy posture is explicit too (34-35): no transcripts, prompts or code are stored.",
  },
  {
    file: `${PLUGIN}/server/metrics.ts`,
    part: "BASELINE_CANDIDATES seed table",
    layer: "server",
    label: CONTESTED,
    anchors: { exports: ["BASELINE_CANDIDATES", "DEFAULT_TASK_PROFILES", "METRICS_PRIVACY_NOTICE"] },
    evidence: [
      [`metrics.ts:44-281`, "four hand-authored models with pass rates, trial counts and latency figures"],
      [`metrics.ts:624-628`, "but `loadFleetMetrics` no longer serves it: the baseline is 'retired as served data'"],
      [`metrics.test.ts:223`, "its one remaining consumer asserts it is *not* served (`assert.notEqual`)"],
    ],
    note: "Deterministic as code -- a literal is the most reproducible thing in the repo -- but the numbers are unsourced claims about how models behave, and nothing in the tree measures them. It is a hardcoded fixture that reads like a measurement, which is why it is reported rather than filed under either neighbouring bucket. Worth knowing that it is now dead: the declaration and that one assertion are its only references in the repository, so it survives solely as the fixed side of a regression guard.",
  },
  {
    file: `${PLUGIN}/server/role-models.ts`,
    part: "Role-to-model assignment, persistence, and available-model discovery",
    layer: "server",
    label: CONTESTED,
    anchors: { exports: ["DEFAULT_ROLE_MODELS", "loadSavedRoleModels", "saveRoleModels", "discoverAvailableModels", "handleUppidiSetRoleModel"] },
    evidence: [
      [`role-models.ts:18-54`, "defaults are a literal role -> model map"],
      [`role-models.ts:56-69`, "load merges saved JSON over defaults"],
      [`role-models.ts:98-101`, "discovery shells `paseo provider list --json`"],
      [`agents.ts:1455-1468`, "but the consumer uses this to pick the model a spawned session runs on"],
    ],
    note: "Performs no inference and takes no decision that depends on one, so by the test used everywhere else in this table it is deterministic. It is contested because it is the plugin's only surface whose entire purpose is choosing which model other rows spawn -- the AI/LLM character of the fleet is set here and executed in `agents.ts`. The bucket depends on whether you classify a control surface or the thing it controls.",
  },
  {
    file: `${PLUGIN}/server/runners.ts`,
    part: "CI runner discovery across repo/org/user scopes plus local containers",
    layer: "server",
    label: DETERMINISTIC,
    anchors: { exports: ["runnerScopeEndpoints", "normalizeForgejoRunners", "fetchLocalContainers", "handleUppidiRunners"] },
    evidence: [
      [`runners.ts:58-71`, "three endpoint paths derived from `owner/repo`"],
      [`runners.ts:78-118`, "projection counts entries lacking id/name as skipped rather than inventing labels"],
      [`runners.ts:145-148`, "local runners are `podman ps --format json`"],
      [`runners.ts:232-241`, "fleet status is a fixed decision table over per-scope outcomes"],
    ],
    note: "CI capacity, not model capacity. A runner executes jobs; nothing here invokes a model.",
  },
  {
    file: `${PLUGIN}/server/settings.ts`,
    part: "Plugin settings storage, legacy router-config migration",
    layer: "server",
    label: DETERMINISTIC,
    anchors: { exports: ["getLegacyRouterConfig", "migrateLegacyConfigIfNeeded", "getUppidiFleetSettingsStorage"] },
    evidence: [
      [`settings.ts:18-63`, "first existing candidate path wins; malformed files are skipped"],
      [`settings.ts:65-119`, "migration is a key-by-key patch of undefined fields"],
      [`settings.ts:123-148`, "storage is a singleton over `PluginStorage` with a schema"],
    ],
    note: "Key-presence migration. No inference, no timing dependence.",
  },

  // ---------------------------------------------------------------- client ---
  {
    file: `${PLUGIN}/index.client.tsx`,
    part: "Sidebar surface, workspace panel, helper settings screen registration",
    layer: "entry",
    label: DETERMINISTIC,
    anchors: { symbols: ["registerSidebarSurface", "addWorkspacePanel", "registerHelperSettingsScreen"] },
    evidence: [
      [`index.client.tsx:26-62`, "three registrations, each returning a disposer"],
      [`index.client.tsx:64-83`, "teardown calls each disposer, tolerating either shape"],
    ],
    note: "Client lifecycle. All three registrations render over server data classified below.",
  },
  {
    file: `${PLUGIN}/client/index.ts`,
    part: "Barrel re-export for surface, tree-view and panel",
    layer: "client",
    label: DETERMINISTIC,
    anchors: {},
    evidence: [[`client/index.ts:1-3`, "three `export *` statements, no code"]],
    note: "Pure re-export barrel.",
  },
  {
    file: `${PLUGIN}/client/panel.tsx`,
    part: "Workspace panel wrapper, flair, panel registration",
    layer: "client",
    label: DETERMINISTIC,
    anchors: { exports: ["UPPIDI_FLEET_FLAIR", "UppidiFleetPanel", "registerWorkspacePanel"] },
    evidence: [
      [`panel.tsx:10-18`, "flair is a static `VisualFlair` literal"],
      [`panel.tsx:20-30`, "the panel delegates to the tree view"],
      [`panel.tsx:37-46`, "registration wraps `client.addWorkspacePanel`"],
    ],
    note: "Chrome around the tree view. No model.",
  },
  {
    file: `${PLUGIN}/client/surface.tsx`,
    part: "Fleet surface: tabs, router status badge, attention card, role-model and metrics dashboards",
    layer: "client",
    label: DETERMINISTIC,
    anchors: {
      exports: ["UppidiFleetSurface", "UppidiBrandMark", "UppidiTopHeaderBar", "AttentionAgentCard", "resolveRouterStatusBadge"],
    },
    evidence: [
      [`surface.tsx:295-306`, "router badge is a three-way branch on two booleans"],
      [`surface.tsx:499`, "the surface reads every dataset over `useRpc`"],
      [`surface.tsx:1281-1300`, "model selection is a `Select` writing the role-model RPC"],
      [`surface.tsx:682-685`, "the write reports the server's own message, not a local guess"],
    ],
    note: "Renders server state and writes back through the deterministic role-model and settings RPCs. The model picker configures another row's spawn; it does not run a model, so it stays deterministic here.",
  },
  {
    file: `${PLUGIN}/client/tree-view.tsx`,
    part: "Agent tree rendering: status lights, health gauges, metrics cards, rows, project groups",
    layer: "client",
    label: DETERMINISTIC,
    anchors: {
      exports: [
        "UppidiFleetTreeView",
        "AgentStatusLight",
        "AgentStateDot",
        "AgentHealthGauge",
        "AgentMetricsCard",
        "OrchestratorRow",
        "ProjectGroupCard",
        "formatRelativeTime",
        "formatDurationMs",
      ],
    },
    evidence: [
      [`tree-view.tsx:387-403`, "relative time is arithmetic on a timestamp"],
      [`tree-view.tsx:450`, "health gauge reads thresholds computed server-side"],
      [`tree-view.tsx:2042`, "the tree view is a pure function of the agents array"],
    ],
    note: "The largest file in the client half and still fully deterministic: it displays whatever the server classified. Displaying an LLM's state is not being one.",
  },
  {
    file: `${PLUGIN}/client/testing/fleet-fixtures.ts`,
    part: "Static fleet fixtures for client tests",
    layer: "client",
    label: DETERMINISTIC,
    anchors: { exports: ["agentsPayload", "issuesPayload", "metricsPayload", "runnersPayload", "hookQueuesPayload"] },
    evidence: [
      [`fleet-fixtures.ts:222-370`, "seven payload builders returning fixed records"],
      [`fleet-fixtures.ts:32`, "one wide-worktree geometry constant"],
    ],
    note: "Test data. Deterministic by construction.",
  },
  {
    file: `${PLUGIN}/client/testing/fleet-harness.ts`,
    part: "Render harness: host element stubs, rpc stubs, provider wrapper",
    layer: "client",
    label: DETERMINISTIC,
    anchors: { exports: ["getFleetHarness", "useToast", "Icon", "useRevealedText"] },
    evidence: [
      [`fleet-harness.ts:28-58`, "host components stubbed to inert React elements"],
      [`fleet-harness.ts:70-80`, "toast, icon, scroll/flatlist and copyText stubs"],
      [`fleet-harness.ts:111`, "the harness is assembled once and awaited"],
    ],
    note: "Test scaffolding. Never shipped: package.json `files` excludes `client/testing`.",
  },
  {
    file: `${PLUGIN}/client/testing/flex-measure.ts`,
    part: "Layout measurement double for mobile/zebra assertions",
    layer: "client",
    label: DETERMINISTIC,
    anchors: { exports: ["measureText", "resolveStyle", "findHorizontalOverflows"] },
    evidence: [
      [`flex-measure.ts:153`, "text width is computed from the style, not a real layout pass"],
      [`flex-measure.ts:371`, "overflow findings are walked off the resolved style tree"],
    ],
    note: "Test scaffolding for layout assertions. Not shipped.",
  },

  // ---------------------------------------------------------------- shared ---
  {
    file: `${PLUGIN}/shared/contracts.ts`,
    part: "24 RPC contracts (zod schemas + input/output types) and the fleet settings contract",
    layer: "shared",
    label: DETERMINISTIC,
    anchors: { exports: ["uppidiFleetSettingsContract", "uppidiFleetSettingsSchema"] },
    evidence: [
      [`contracts.ts:54-1258`, "24 `defineContract`/`defineSettingsContract` objects across the file"],
      [`contracts.ts:1250-1256`, "the fleet settings schema is a `z.object`"],
      [`index.server.ts:81-103`, "every one of them is bound to a handler there"],
    ],
    note: "The wire vocabulary. Schemas describe model-shaped concepts (agent metrics, model candidates) but a schema is a validator, not a model.",
  },
  {
    file: `${PLUGIN}/shared/settings.ts`,
    part: "Settings re-export barrel",
    layer: "shared",
    label: DETERMINISTIC,
    anchors: {},
    evidence: [[`shared/settings.ts:1-5`, "re-exports three names from `contracts.js`"]],
    note: "Pure re-export barrel.",
  },
  {
    file: `${PLUGIN}/shared/sort-filter.ts`,
    part: "Filtering, sorting, health-gauge derivation, project grouping, bulk-archive eligibility",
    layer: "shared",
    label: DETERMINISTIC,
    anchors: {
      exports: [
        "filterIssues",
        "sortIssues",
        "filterQueues",
        "sortAgents",
        "filterRunners",
        "filterMetricCandidates",
        "deriveHealthGauge",
        "buildProjectGroups",
        "isAgentEligibleForBulkArchive",
        "getStatusLightColor",
      ],
    },
    evidence: [
      [`sort-filter.ts:148`, "health gauge buckets counters against fixed thresholds"],
      [`sort-filter.ts:484-540`, "bulk-archive eligibility is an explicit ordered rule list"],
      [`sort-filter.ts:875`, "project grouping is set/dict work over agent records"],
    ],
    note: "44 exports, every one a pure function of its arguments. Shared verbatim by client and server, which is why both halves of the UI agree by construction.",
  },
  {
    file: `${PLUGIN}/shared/types.ts`,
    part: "Attention/state label unions and Forgejo issue/repo shapes",
    layer: "shared",
    label: DETERMINISTIC,
    anchors: { exports: ["AttentionLabel", "StateLabel", "ForgeIssue", "ForgeRepoInfo"] },
    evidence: [[`types.ts:1-11`, "two string-literal unions"], [`types.ts:13-49`, "two interfaces"]],
    note: "Type-only. No runtime behaviour at all.",
  },
  {
    file: `${PLUGIN}/shared/version.ts`,
    part: "Generated plugin version stamp",
    layer: "shared",
    label: DETERMINISTIC,
    anchors: { exports: ["PLUGIN_VERSION"] },
    evidence: [[`version.ts:1-2`, "`0.1.0+<git sha>`, written by the helper's `stampVersion`"]],
    note: "A generated constant. Re-stamped by `npm run stamp`.",
  },
  {
    file: `${PLUGIN}/shared/helper-version.ts`,
    part: "Declared helper expectation, resolution mode, helper content digest",
    layer: "shared",
    label: DETERMINISTIC,
    anchors: { exports: ["HELPER_VERSION", "HELPER_SERVED_FROM", "HELPER_REVISION"] },
    evidence: [
      [`helper-version.ts:19-20`, "version and `checkout` resolution mode as literals"],
      [`helper-version.ts:29`, "sha256 digest of `packages/paseo-plugin-helper/src`"],
      [`helper-version.ts:10-15`, "nothing reads these and believes them; `helper-resolution.test.mjs` and `doctor-live.mjs` re-derive instead"],
    ],
    note: "The one file in the plugin that is a declaration about a dependency rather than behaviour — and it is explicit that consumers must re-derive rather than trust it.",
  },

  // ------------------------------------------------- plugin-owned scripts ---
  {
    file: `${PLUGIN}/test/register-ts-hooks.mjs`,
    part: "ESM resolve-hook registration for `node --test`",
    layer: "script",
    label: DETERMINISTIC,
    anchors: {},
    evidence: [[`register-ts-hooks.mjs:4-6`, "`register('./resolve-ts-hooks.mjs', import.meta.url)`"]],
    note: "Loaded via `node --import`. A separate file because a hooks module must be registered, not imported.",
  },
  {
    file: `${PLUGIN}/test/resolve-ts-hooks.mjs`,
    part: "TS specifier resolution fallback for the node test runner",
    layer: "script",
    label: DETERMINISTIC,
    anchors: { exports: ["resolve"] },
    evidence: [
      [`resolve-ts-hooks.mjs:32-63`, "calls `next()` first and only falls back on `ERR_MODULE_NOT_FOUND`"],
      [`resolve-ts-hooks.mjs:45`, "a real `.json`/`.node` specifier keeps failing loudly"],
      [`resolve-ts-hooks.mjs:48-53`, "deliberately no `.tsx` probe: node type-stripping cannot load JSX"],
    ],
    note: "Build-time only. It replaced an `npx tsx` shellout that was in no package.json and absent from the lockfile (12-16) — a silent download of whatever was current that day. Worth recording as the repo's own worked example of the drift class this matrix is generated to prevent.",
  },
];

// ---------------------------------------------------------------------------
// Test suites: described by the inventory, not by hand
// ---------------------------------------------------------------------------

/**
 * Optional one-line descriptions for the auto-generated suite rows. A suite with
 * no entry still gets a row -- that is the point -- it just gets the generic
 * label. A key here that is not a tracked suite is a hard error, so renaming a
 * suite cannot leave a stale description behind.
 */
const SUITE_NOTES = {
  "server/agents.test.ts": "Agent normalisation, state derivation, spawn-authority and archive paths",
  "server/fleet.test.ts": "Cross-surface fleet behaviour",
  "server/hook.test.ts": "Hook-service handlers, endpoint resolution, unreachable-path shapes",
  "server/hook-router.test.ts": "Webhook classification, coalescing, queueing, watchdog taxonomy, handoff",
  "server/metrics.test.ts": "Rollup arithmetic, candidate derivation, receipt persistence",
  "server/runners.test.ts": "Runner scope merge, normalisation, fleet-status decision table",
  "client/entry.test.ts": "Surface/panel registration and teardown",
  "client/fleet-state-filter-row.test.ts": "Fleet state filter row rendering",
  "client/issue-metrics-bar.test.ts": "Issue metrics bar rendering",
  "client/metrics-bar-parity.test.ts": "Parity between the metrics bar and its shared source",
  "client/mobile-layout.test.ts": "Mobile layout behaviour under the measurement double",
  "client/role-model-picker.test.ts": "Role-model picker interaction",
  "client/tree-zebra.test.tsx": "Tree zebra striping",
  "shared/contracts.test.ts": "Contract schema validation",
  "shared/sort-filter.test.ts": "Filter, sort, gauge and grouping functions",
};

// ---------------------------------------------------------------------------
// Validation: judgement is only allowed to describe code that exists
// ---------------------------------------------------------------------------

/**
 * Anchor accessors. Every reader goes through these.
 *
 * They exist because this file shipped one bug of exactly the kind it is meant
 * to prevent: the first draft validated `part.exports` while the data was
 * written at `part.anchors.exports`, so the export-anchor check silently
 * validated nothing -- a renamed export passed clean. `assertAnchorShape`
 * below is the fix for the class, not just the instance: an anchors key this
 * code does not understand is a hard error, never a quietly ignored field.
 */
const anchorExports = (part) => part.anchors?.exports ?? [];
const anchorSymbols = (part) => part.anchors?.symbols ?? [];

const ANCHOR_KEYS = new Set(["exports", "symbols"]);

function assertAnchorShape(part, errors) {
  if (part.exports !== undefined) {
    errors.push(
      `${part.file}: anchors are written under \`anchors\`, not at the top level ` +
        "(`exports` here is silently unvalidated)",
    );
  }
  for (const key of Object.keys(part.anchors ?? {})) {
    if (!ANCHOR_KEYS.has(key)) {
      errors.push(
        `${part.file}: unknown anchor kind "${key}" (expected ${[...ANCHOR_KEYS].join(" or ")})`,
      );
    }
  }
}

/**
 * Resolve an evidence citation to a file and line range in the inventory.
 * Citations are written `file:LINE` or `file:START-END`, and the file is either
 * a sibling of the part's own file (`agents.ts:255`) or plugin-root relative
 * (`index.server.ts:70`), so neither form has to repeat its directory.
 */
function resolveEvidence(ref, partFile) {
  const m = /^([\w./-]+):(\d+)(?:-(\d+))?$/.exec(ref);
  if (!m) return null;
  const refPath = m[1];
  const start = Number(m[2]);
  const end = m[3] ? Number(m[3]) : start;
  const dir = path.posix.dirname(partFile);
  const candidates = [
    refPath.startsWith(PLUGIN) ? refPath : null,
    `${dir}/${refPath}`,
    `${PLUGIN}/${refPath}`,
  ].filter(Boolean);
  for (const c of candidates) {
    const norm = path.posix.normalize(c);
    if (norm === refPath || INVENTORY.has(norm)) {
      return { path: INVENTORY.has(norm) ? norm : refPath, start, end };
    }
  }
  return { path: null, start, end };
}

// Bound in main(); kept module-level so resolveEvidence stays free of plumbing.
const INVENTORY = new Map();

function validate(inv) {
  INVENTORY.clear();
  for (const [k, v] of inv) INVENTORY.set(k, v);

  const errors = [];
  const seen = new Set();

  for (const part of PARTS) {
    const file = inv.get(part.file);
    if (!file) {
      errors.push(`${part.file}: in PARTS but not a tracked source file in scope`);
      continue;
    }
    if (part.label && !LABELS.includes(part.label)) {
      errors.push(`${part.file} / ${part.part}: unknown label "${part.label}"`);
    }
    if (!part.part || !part.evidence?.length) {
      errors.push(`${part.file}: part "${part.part}" needs a name and at least one evidence citation`);
    }
    assertAnchorShape(part, errors);
    for (const ex of anchorExports(part)) {
      if (!file.exports.includes(ex)) {
        errors.push(
          `${part.file}: anchor export "${ex}" is not a top-level export (renamed or removed?)`,
        );
      }
    }
    for (const sym of anchorSymbols(part)) {
      if (!new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(file.src)) {
        errors.push(`${part.file}: anchor symbol "${sym}" does not appear in the file`);
      }
    }
    for (const [ref] of part.evidence ?? []) {
      const target = resolveEvidence(ref, part.file);
      if (!target) {
        errors.push(`${part.file}: evidence "${ref}" is not file:LINE[-END] form`);
        continue;
      }
      if (!target.path) {
        errors.push(`${part.file}: evidence cites ${ref}, which resolves to no file in scope`);
        continue;
      }
      const tf = inv.get(target.path);
      if (!tf) {
        errors.push(`${part.file}: evidence cites ${ref}; ${target.path} is not in scope`);
        continue;
      }
      if (target.start < 1 || target.end > tf.loc || target.end < target.start) {
        errors.push(
          `${part.file}: evidence cites ${ref} but ${target.path} has ${tf.loc} lines ` +
            "(or the range runs backwards)",
        );
      }
    }
    seen.add(part.file);
  }

  for (const [key] of Object.entries(SUITE_NOTES)) {
    if (!inv.has(`${PLUGIN}/${key}`)) {
      errors.push(`SUITE_NOTES has "${key}", which is not a tracked suite in scope`);
    }
  }

  // The drift this generator exists to catch, in its own inventory: a source
  // file in scope that no part describes. Suites are exempt because they are
  // described by construction above.
  for (const rel of inv.keys()) {
    if (rel === OUT || seen.has(rel) || isTestFile(rel)) continue;
    errors.push(`${rel}: in scope but no part describes it -- add a part or drop it from the tree`);
  }

  return errors;
}

/** A row per test file, synthesised from the inventory. */
function suiteRows(inv) {
  const rows = [];
  for (const rel of [...inv.keys()].sort()) {
    const f = inv.get(rel);
    if (!f.test) continue;
    const key = rel.replace(`${PLUGIN}/`, "");
    rows.push({
      file: rel,
      layer: f.layer,
      label: DETERMINISTIC,
      generated: true,
      part: `Suite: ${SUITE_NOTES[key] ?? key.replace(/\.test\.[cm]?[jt]sx?$/, "")}`,
      evidence: [[`${path.posix.basename(rel)}:1`, "a suite asserting fixed expected values"]],
      note: null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const LAYER_ORDER = ["entry", "server", "client", "shared", "script", "other"];
const LAYER_TITLE = {
  entry: "Plugin entry points",
  server: "Server",
  client: "Client",
  shared: "Shared",
  script: "Plugin-owned scripts and hooks",
  other: "Other",
};

function esc(s) {
  return String(s).replace(/\|/g, "\\|");
}

function anchorsCell(part) {
  const names = [...anchorExports(part), ...anchorSymbols(part)];
  if (names.length === 0) return "whole file";
  const shown = names.slice(0, 6).map((n) => `\`${n}\``);
  if (names.length > 6) shown.push(`+${names.length - 6} more`);
  return shown.join(", ");
}

function evidenceCell(part) {
  return part.evidence
    .map(([ref, what]) => `${ref} — ${what}`)
    .join("<br>");
}

function render(inv) {
  const rows = PARTS.map((part) => {
    const file = inv.get(part.file);
    return { ...part, fileMeta: file };
  });

  const srcRows = rows.filter((r) => !r.fileMeta.test);
  const testRows = suiteRows(inv).map((r) => ({ ...r, fileMeta: inv.get(r.file) }));
  const allRows = [...srcRows, ...testRows];

  const byLabel = new Map(LABELS.map((l) => [l, 0]));
  for (const r of allRows) byLabel.set(r.label, byLabel.get(r.label) + 1);

  const out = [];
  out.push("# uppidi-fleet determinism matrix");
  out.push("");
  out.push(
    "<!-- GENERATED FILE. Do not edit by hand. Run `node scripts/fleet-determinism-matrix.mjs` -->",
  );
  out.push("<!-- from the repository root; `--check` verifies the committed copy. Source: #705. -->");
  out.push("");
  out.push(
    "Every moving part of `plugins/uppidi-fleet`, classified as **deterministic**, **AI/LLM-based**,",
  );
  out.push(
    "**hybrid**, or **contested** where the evidence does not settle it. The file inventory, line",
  );
  out.push(
    "counts, export lists and runner attributions below are read from the tree by the generator;",
  );
  out.push(
    "only the labels and their evidence citations are human judgement. A part whose anchor symbol has",
  );
  out.push(
    "been renamed fails the generator instead of being described from memory — see",
  );
  out.push("`scripts/fleet-determinism-matrix.mjs`.");
  out.push("");

  out.push("## Legend");
  out.push("");
  out.push("| Label | Meaning |");
  out.push("| --- | --- |");
  out.push(
    "| `deterministic` | No model in the causal path. Same inputs, same output, modulo external state. |",
  );
  out.push(
    "| `ai-llm` | This part's own output is produced by model inference. |",
  );
  out.push(
    "| `hybrid` | A deterministic control plane whose correctness depends on, or whose action lands in, a model session it does not control. |",
  );
  out.push(
    "| `contested` | The honest answer depends on the lens, or the code is deterministic while the claim it encodes is not. Reported with the reason rather than forced into a bucket. |",
  );
  out.push("");
  out.push("**Observing a model is not being one.** Telemetry that reads an LLM session's token counts,");
  out.push(
    "cost and turn state is arithmetic over counters, and is `deterministic`. Three rows below —",
  );
  out.push("`server/metrics.ts` rollups, `server/agents.ts` state derivation, and the client gauges that");
  out.push("render them — exist only to make that distinction explicit, because the opposite reading is");
  out.push("the easy mistake.");
  out.push("");

  out.push("## Distribution");
  out.push("");
  out.push("| Label | Parts |");
  out.push("| --- | ---: |");
  for (const l of LABELS) out.push(`| \`${l}\` | ${byLabel.get(l)} |`);
  out.push(`| **total** | **${allRows.length}** |`);
  out.push("");
  out.push(
    `Inventory: ${inv.size} tracked source files in scope — ${srcRows.length} described above as ` +
      `source (${new Set(srcRows.map((r) => r.file)).size} files, some carrying several parts) and ` +
      `${testRows.length} test suites, which are described by the inventory itself rather than by hand.`,
  );
  out.push("");
  if (byLabel.get(AI) === 0) {
    out.push(
      "**The `ai-llm` column is empty, and that is the finding rather than a gap.** Nothing in this",
    );
    out.push(
      "plugin performs model inference: there is no completions call, no provider SDK, no temperature",
    );
    out.push(
      "or sampling parameter anywhere under `plugins/uppidi-fleet`. The plugin's entire AI surface is",
    );
    out.push(
      "indirect — it spawns model-backed sessions and steers messages into them, and the model's",
    );
    out.push(
      "behaviour is whatever the model does. Every row that touches that behaviour is therefore",
    );
    out.push(
      "`hybrid`: deterministic machinery on the near side, unconstrained inference on the far side.",
    );
    out.push("See *What this table does not cover* below for the sessions themselves.");
    out.push("");
  }

  for (const layer of LAYER_ORDER) {
    const layerRows = rows.filter((r) => r.fileMeta.layer === layer && !r.fileMeta.test);
    if (layerRows.length === 0) continue;
    out.push(`## ${LAYER_TITLE[layer]}`);
    out.push("");
    out.push("| Moving part | File | File exports | File loc | Classification | Anchors | Evidence |");
    out.push("| --- | --- | ---: | ---: | --- | --- | --- |");
    for (const r of layerRows) {
      out.push(
        `| ${esc(r.part)} | \`${r.file.replace(`${PLUGIN}/`, "")}\` | ${r.fileMeta.exports.length} | ` +
          `${r.fileMeta.loc} | \`${r.label}\` | ${anchorsCell(r)} | ${evidenceCell(r)} |`,
      );
    }
    out.push("");
    for (const r of layerRows) {
      out.push(`- **${r.part}** (\`${r.file.replace(`${PLUGIN}/`, "")}\`) — ${r.note}`);
    }
    out.push("");
  }

  out.push("## Test suites");
  out.push("");
  out.push(
    "The suites are moving parts too, and this repo has a scar from forgetting that: #702 found nine",
  );
  out.push(
    "tracked `*.test.*` files that no runner named, merged and reported as delivered coverage while",
  );
  out.push("never executing. Every suite is attributed below to the script that runs it, read from the");
  out.push(
    "plugin's own `package.json` at generation time. `scripts/unreachable-tests.test.mjs` is the guard",
  );
  out.push("that enforces the invariant; this table is the readable view of the same fact.");
  out.push("");
  out.push("| Suite | Covers | Runs under | Loc | Classification |");
  out.push("| --- | --- | --- | ---: | --- |");
  for (const r of testRows) {
    const runner = runnerFor(r.file);
    out.push(
      `| \`${r.file.replace(`${PLUGIN}/`, "")}\` | ${esc(r.part.replace(/^Suite: /, ""))} | ` +
        `${runner ? `\`${runner}\`` : "**no runner names it**"} | ${r.fileMeta.loc} | \`${r.label}\` |`,
    );
  }
  out.push("");
  out.push(
    "Every suite is `deterministic` on the same test used for the source rows: a test asserts a fixed",
  );
  out.push(
    "expected value, and an assertion that had to be re-tuned against a model's output would be a",
  );
  out.push("change-detector, not a test.");
  out.push("");

  out.push("## What this table does not cover");
  out.push("");
  out.push(
    "The spawned agent sessions have no file, so they have no row. They are the thing every",
  );
  out.push("`hybrid` row points at: a model-backed Paseo agent with a prompt, a provider and a model");
  out.push(
    "chosen by `server/agents.ts` from the map in `server/role-models.ts`. Their behaviour is not",
  );
  out.push(
    "reproducible, which is the entire reason those rows are `hybrid` rather than `deterministic`.",
  );
  out.push("");
  out.push("Also outside the inventory, because they are not plugin-owned:");
  out.push("");
  out.push(
    "- `~/bin/forgejo-issues-check`, invoked by the board sweep at `server/hook-router.ts:2500-2505`.",
  );
  out.push("- The `paseo` CLI and daemon SDK surface, called as a subprocess throughout the server.");
  out.push("- `paseo-plugin-helper`, the UI/storage/logger layer this plugin is built on.");
  out.push("");

  out.push("## Appendix: generated export inventory");
  out.push("");
  out.push(
    "Read from the tree, uncensored and unedited. This is the inventory half of the document; the",
  );
  out.push("matrix above is the judgement half.");
  out.push("");
  out.push("| File | Layer | Loc | Exports | Top-level exported names |");
  out.push("| --- | --- | ---: | ---: | --- |");
  for (const rel of [...inv.keys()].sort()) {
    const f = inv.get(rel);
    const names = f.exports.slice(0, 12);
    const rest = f.exports.length - names.length;
    const cell = names.length
      ? names.map((n) => `\`${n}\``).join(", ") + (rest > 0 ? ` …+${rest} more` : "")
      : "—";
    out.push(
      `| \`${rel.replace(`${PLUGIN}/`, "")}\` | ${f.layer} | ${f.loc} | ${f.exports.length} | ${cell} |`,
    );
  }
  out.push("");

  return out.join("\n");
}

// ---------------------------------------------------------------------------

function main() {
  const inv = buildInventory();
  const errors = validate(inv);
  if (errors.length > 0) {
    console.error("fleet-determinism-matrix: judgement does not match the tree:\n");
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`\n${errors.length} problem(s). Fix the PARTS map or the tree, then re-run.`);
    process.exit(1);
  }

  const markdown = `${render(inv)}\n`;
  const dest = path.join(ROOT, OUT);

  const suites = suiteRows(inv);
  const total = PARTS.length + suites.length;

  if (CHECK) {
    const current = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
    if (current === markdown) {
      console.log(`fleet-determinism-matrix: ${OUT} is current (${total} rows).`);
      return;
    }
    console.error(
      `fleet-determinism-matrix: ${OUT} is stale.\n` +
        "  Re-run `node scripts/fleet-determinism-matrix.mjs` and commit the result.",
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, markdown, "utf8");

  const counts = new Map(LABELS.map((l) => [l, 0]));
  for (const p of [...PARTS, ...suites]) counts.set(p.label, counts.get(p.label) + 1);
  const summary = LABELS.map((l) => `${l}=${counts.get(l)}`).join(" ");
  console.log(
    `fleet-determinism-matrix: wrote ${OUT} — ${PARTS.length} judged parts + ` +
      `${suites.length} generated suite rows over ${inv.size} files (${summary}).`,
  );
}

main();
