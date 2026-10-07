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
export const DETERMINISTIC = "deterministic";
export const HYBRID = "hybrid";
export const AI = "ai-llm";
export const CONTESTED = "contested";

export const LABELS = [DETERMINISTIC, HYBRID, AI, CONTESTED];

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
    .filter((l) => l && SOURCE_EXT.test(l) && !l.startsWith(`${PLUGIN}/web/`) && fs.statSync(path.join(ROOT, l)).isFile());
}

function layerOf(rel) {
  if (rel.startsWith(`${PLUGIN}/server/`)) return "server";
  if (rel.startsWith(`${PLUGIN}/client/`)) return "client";
  if (rel.startsWith(`${PLUGIN}/shared/`)) return "shared";
  if (rel.startsWith(`${PLUGIN}/bin/`)) return "script";
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
 *
 * Exported so the test suite can build fixture inventories through the real
 * parser rather than a hand-rolled approximation of it.
 */
export function parseExports(src) {
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
      [`agents.ts:748-765`, "`checkRepoMainDirty` resolves the primary checkout, shells `git status`/`git rev-parse` and parses the result"],
      [`agents.ts:767`, "`fetchPaseoAgents` reads `paseo ls --json`"],
    ],
    note: "Subprocess and filesystem reads. Same inputs, same tree; nothing here consults a model.",
  },
  {
    file: `${PLUGIN}/server/agents.ts`,
    part: "Agent session spawning, front-desk and orchestrator lifecycle, hook-context injection, spawn-authority guard",
    layer: "server",
    label: HYBRID,
    anchors: {
      exports: ["spawnPaseoAgent", "buildFrontDeskIntroPrompt", "handleUppidiCreateFrontDesk", "handleUppidiAddOrchestrator", "evaluateSpawnAuthority"],
    },
    evidence: [
      [`agents.ts:2075`, "`context.paseo.agents.create(createPayload)` creates a model-backed session"],
      [`agents.ts:2130-2147`, "CLI fallback `paseo run -d ... <prompt>` — the prompt is the agent's task"],
      [`agents.ts:2238-2256`, "`buildFrontDeskIntroPrompt` appends the resolved hook endpoint and auth posture (#903)"],
      [`agents.ts:2265`, "`handleUppidiCreateFrontDesk` uses the intro prompt at spawn"],
      [`agents.ts:1966-2014`, "spawn-authority guard is deterministic policy over caller id and cwd"],
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
    file: `${PLUGIN}/server/repos.ts`,
    part: "Repo enrollment surface: Forgejo listing, roster/pause/queue/orchestrator projection, enroll/unenroll",
    layer: "server",
    label: DETERMINISTIC,
    anchors: { exports: ["handleUppidiRepos", "handleUppidiEnrollRepo", "handleUppidiUnenrollRepo"] },
    evidence: [
      [`repos.ts:39-60`, "one classified GET (`/repos/search`) with a `/user/repos` 404 fallback; 401 maps to a fixed message and an empty list"],
      [`repos.ts:73-95`, "each row is built by matching the roster (enrolled, paused, summed queue depth) and the active router's orchestrator record"],
      [`repos.ts:127-150`, "enroll canonicalises the key, delegates to the router, or patches the persisted config when no router is active"],
      [`repos.ts:177-195`, "unenroll is the same shape with a membership filter"],
    ],
    note: "Reads Forgejo and the hook router's persisted state and does set membership over it; no inference anywhere. Enrolling a repo is a control-plane edit that later gates deliveries, not a spawn.",
  },
  {
    file: `${PLUGIN}/server/hook.ts`,
    part: "Hook-service RPC handlers, endpoint resolution, auth posture, x-comms presence probe",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: ["resolveHookEndpoint", "resolveHookAuthPosture", "resolveHookUrl", "handleHookStatus", "handleHookQueues", "handleHookConfigure", "handleHookLogTail"],
    },
    evidence: [
      [`hook.ts:88-121`, "`resolveHookEndpoint` ordered fallback: explicit arg, env, live router, settings, loopback"],
      [`hook.ts:148-166`, "`resolveHookAuthPosture` reports the secret location, never the value"],
      [`hook.ts:169-187`, "status is a `fetch` with a 4s timeout"],
      [`hook.ts:194-200`, "`resolveXCommsInstalled` tolerates absence to `false` and never throws"],
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
      [`hook-router.ts:247-261`, "bypass is one regex over the event body"],
      [`hook-router.ts:292-301`, "`eventKind` maps a fixed event-type table"],
      [`hook-router.ts:359-369`, "`formatDigest` is string concatenation"],
      [`hook-router.ts:1600`, "`ingestWebhook` classifies then enqueues"],
    ],
    note: "The ingress path is a pure function of the webhook payload.",
  },
  {
    file: `${PLUGIN}/server/hook-router.ts`,
    part: "Queue persistence, queue/repo pause, drain scheduling, backoff",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: ["loadRouterConfig", "saveRouterConfig", "getFleetRosterInfo"],
      symbols: ["drain", "pause", "resume", "persistQueue", "coalesce"],
    },
    evidence: [
      [`hook-router.ts:2939-3048`, "`drain` is guarded by closed, queue-paused, repo-paused, and draining sets"],
      [`hook-router.ts:2996`, "backoff delay is `min(30000, 3000 * 1.5^attempts)`"],
      [`hook-router.ts:2857-2885`, "pause/resume mutate a `Set`"],
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
      [`hook-router.ts:591-714`, "six boolean detectors, each substring or timestamp comparison"],
      [`hook-router.ts:1161-1181`, "`planWatchdogRecovery` is set algebra over the taxonomy"],
      [`hook-router.ts:1157-1181`, "quota exhaustion is a circuit break: `steer` is forced false"],
      [`hook-router.ts:2153`, "the plan is executed by steering a live turn"],
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
      [`hook-router.ts:1924`, "`agentRef.send(msg, { steer })` hands text to a model-backed session"],
      [`hook-router.ts:1929-1939`, "CLI fallback `paseo send --no-wait --steer <id> <msg>`"],
      [`hook-router.ts:2589-2592`, "handoff onboarding text is a template, delivered with `steer: true`"],
      [`hook-router.ts:2703-2712`, "board sweep summarises candidates deterministically, then steers the notice (failures included)"],
    ],
    note: "The send itself is a deterministic API call. What the recipient model does with it -- whether the wake actually revives the turn, whether the notice is acted on -- is the part that cannot be asserted. Hybrid for that reason, not because the delivery code guesses.",
  },
  {
    file: `${PLUGIN}/server/issues-check.ts`,
    part: "In-process board checker port: stale-WIP recovery sweep and its regression guard (#733)",
    layer: "server",
    label: DETERMINISTIC,
    anchors: { exports: ["staleWipAge", "hasStaleWipReminder", "recoverStaleWipIssue", "sweepStaleWipIssues"] },
    evidence: [
      ["issues-check.ts:216", "stale WIP age is a timestamp comparison against a fixed skip-label set"],
      ["issues-check.ts:229", "reminder detection is a substring probe for the marker"],
      ["issues-check.ts:272", "recovery posts one comment (same label edit grammar)"],
      ["issues-check.ts:326", "sweep filtering is bounded by thresholds over issues already fetched"],
    ],
    note: "Ported from platform `scripts/forgejo-issues-check`; forgejo-issues-check.test.py carries the same fixtures.",
  },
  {
    file: `${PLUGIN}/server/issues-check.ts`,
    part: "Deterministic priority tuple, dispatchability and taxonomy classification",
    layer: "server",
    label: DETERMINISTIC,
    anchors: { exports: ["calculatePriorityTuple", "isDispatchableCandidate", "classifyCandidate", "isActionable"] },
    evidence: [
      ["issues-check.ts:346", "tier/urgency/effort come from fixed label-weight tables; age sorts lexicographically"],
      ["issues-check.ts:378", "dispatchability is set algebra over blocker and approver labels"],
      ["issues-check.ts:414", "classification is a first-match ladder over label sets producing fixed reason strings"],
    ],
    note: "Pure classification carried over from the Python checker; the board sweep consumes it every 15 minutes.",
  },
  {
    file: `${PLUGIN}/server/issues-check.ts`,
    part: "Board-check IO: teax transport, cache read/write, human-feedback probe",
    layer: "server",
    label: DETERMINISTIC,
    anchors: { exports: ["createDefaultIssuesCheckIo", "runIssuesCheck", "IssuesCheckTransportError"] },
    evidence: [
      ["issues-check.ts:632", "teax runs via spawn with captured stdout; query failure is an error, not an empty board"],
      ["issues-check.ts:677", "cache is a JSON document under ~/.cache keyed by repo slug"],
      ["issues-check.ts:806-808", "signature diff (updated_at/labels/comments_count against the persisted cache) decides new/changed candidates"],
    ],
    note:
      "Runs inside the daemon's node context; the transport subprocess is `teax`, one invocation per query like the original.",
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
      [`hook-router.ts:3133-3162`, "`createServer` + `listen`, EADDRINUSE degrades to disabled rather than throwing"],
      [`hook-router.ts:3210-3236`, "`configure` writes config then restarts if listening"],
      [`hook-router.ts:3629-3657`, "status is a projection of bound address, pid and uptime"],
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
  // #702: the `BASELINE_CANDIDATES` row that used to sit here has been moved out
  // of the matrix at the operator's request. It was the second `contested` row,
  // and the finding behind it is recorded on #702 rather than deleted:
  //
  //   `server/metrics.ts` exports a four-model table of hand-authored pass rates,
  //   trial counts and latencies that nothing in the tree measures, so it reads
  //   as evidence while being connected to nothing. `loadFleetMetrics` already
  //   stopped serving it ("retired as served data"), and its only remaining
  //   reference in the repository is the `assert.notEqual` at
  //   `server/metrics.test.ts:223` that pins it as *not* served -- the
  //   declaration and that one assertion, nothing else. It is dead code shaped
  //   like a measurement.
  //
  // Two things this map deliberately does not do, so the removal is not mistaken
  // for a silent deletion or for the renderer hiding a row:
  //
  //   1. The constant is NOT removed from the plugin. Whether to delete it is a
  //      separate decision, tracked on #702, and out of scope for a docs change.
  //   2. The renderer has no exclusion list. The row is gone because its entry
  //      is gone, which is the only way a generated table can be trusted to have
  //      lost nothing: a filter would put a row back whenever its file came back.
  //
  // `server/metrics.ts` still has a row below for the parts that are settled --
  // the rollup arithmetic, which is deterministic. The remaining `contested` row
  // is `server/role-models.ts`, a different question #702 did not cover.
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
    file: `${PLUGIN}/server/rotation.ts`,
    part: "Long-lived role rotation: layered policy resolution, trigger evaluation, brief rendering, one-at-a-time lock (#1019)",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: [
        "DEFAULT_ROTATION_ROLE_POLICY",
        "resolveRotationPolicy",
        "evaluateRotationTrigger",
        "buildRotationBrief",
        "RotationLock",
      ],
    },
    evidence: [
      [`rotation.ts:18-69`, "role defaults are a literal role -> threshold table (2h/50 and 3h/75 per the approved spec)"],
      [`rotation.ts:89-116`, "effective policy is a fixed merge of defaults -> global role -> per-repo role"],
      [`rotation.ts:177-268`, "trigger evaluation is timestamp/turn arithmetic over fixed thresholds; manual/in-flight/cooldown guards are literal branches"],
      [`rotation.ts:304-341`, "the rotation brief is string concatenation over caller-supplied board state"],
      [`rotation.ts:343-364`, "the one-at-a-time guard is a Set keyed by role+repo"],
    ],
    note: "The whole trigger decision is deterministic: same observation and policy, same verdict. It drives a model-backed respawn (classified under `hook-router.ts` / `agents.ts`) but performs no inference of its own.",
  },
  {
    file: `${PLUGIN}/server/skills.ts`,
    part: "Fleet skill effective resolution, canonical platform root, override persistence, and Settings RPC handlers",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: [
        "FLEET_SKILL_DEFINITIONS",
        "resolveEffectiveSkill",
        "getEffectiveSkillPath",
        "getEffectiveSkillContent",
        "renderSkillDirective",
        "canonicalSkillsRootCandidates",
        "resolveCanonicalSkillsRoot",
        "getCanonicalSkillPath",
        "listFleetSkills",
        "setSkillContent",
        "handleUppidiSkills",
        "handleUppidiSetSkill",
      ],
    },
    evidence: [
      [`skills.ts:149-183`, "the canonical `platform/skills` root is explicit-option, env override, then the sibling checkout of each plugin root"],
      [`skills.ts:198-221`, "the three fleet skills are a literal id/title/bundled-path table"],
      [`skills.ts:254-261`, "override storage is a PluginStorage path under plugin-data, never the checkout or ~/.agents"],
      [`skills.ts:304-341`, "canonical path/content reads are filesystem existence checks under `platform/skills/<id>/SKILL.md`"],
      [`skills.ts:359-408`, "effective text is override-else-canonical-else-bundled, a filesystem existence check with no model"],
      [`skills.ts:428-450`, "renderSkillDirective inlines the effective bytes for a spawn prompt instead of a permission-gated path"],
      [`skills.ts:462-490`, "save writes raw Markdown with a tmp-file rename; null unlinks the override"],
    ],
    note: "Reads and writes skill Markdown on disk and resolves it for spawn prompts. No inference: the operator, the canonical `platform` checkout, or the bundled fallback supplies every byte.",
  },
  {
    file: `${PLUGIN}/server/permission-adjudication.ts`,
    part: "Conservative safe-pattern allowlist, shell scanner, fleet detection, and durable permission-decision log (#1084)",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: [
        "SAFE_PERMISSION_RULES",
        "scanShellCommand",
        "classifySafeCommand",
        "extractPermissionCommandText",
        "isFleetAgent",
        "appendAdjudicationDecision",
        "readAdjudicationDecisions",
        "adjudicatePermission",
      ],
    },
    evidence: [
      [`permission-adjudication.ts:57-84`, "the allowlist rules are a literal, documented id/description table"],
      [`permission-adjudication.ts:262-490`, "the scanner is quote/heredoc-aware character arithmetic: quoted heredoc bodies are inert data, unquoted delimiters and redirections are refused"],
      [`permission-adjudication.ts:607-630`, "`classifySafeCommand` returns a match only when every segment and substitution matches"],
      [`permission-adjudication.ts:659-681`, "fleet detection is label/id membership, never a guess"],
      [`permission-adjudication.ts:713-742`, "the durable log is a JSONL append and a line-by-line read"],
      [`permission-adjudication.ts:776-885`, "adjudication is a fixed branch tree: non-fleet, no-match, no-id, or no-seam escalate; only a match plus a successful seam allow auto-allows"],
    ],
    note: "Pure classifier plus a filesystem append. The only non-local effect is the injected allow seam, and an unmatched or ambiguous command is never auto-allowed.",
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
    part: "Plugin settings storage",
    layer: "server",
    label: DETERMINISTIC,
    anchors: { exports: ["getUppidiFleetSettingsStorage", "resetUppidiFleetSettingsStorageInstance"] },
    evidence: [
      [`settings.ts:11-31`, "storage is a singleton over `PluginStorage` with a schema"],
      [`settings.ts:33-35`, "the singleton can be dropped for isolated tests"],
    ],
    note: "Schema-validated plugin settings. No legacy file fallback, no inference.",
  },
  {
    file: `${PLUGIN}/server/mcp-tools.ts`,
    part: "Fleet MCP tool declarations, schemas, execution dispatchers, and RPC handlers",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: [
        "FLEET_MCP_TOOLS",
        "executeFleetCheckBoard",
        "executeFleetWatchdogAudit",
        "executeFleetBoardSweep",
        "executeFleetPruneOrchestrators",
        "executeFleetQueueInspect",
        "executeFleetQueuePurge",
        "executeFleetHandoffGenerate",
        "executeFleetTool",
        "handleFleetToolList",
        "handleFleetToolExecute",
      ],
    },
    evidence: [
      [`mcp-tools.ts:31-218`, "typed JSON schemas for daemon operations and diagnostic tools"],
      [`mcp-tools.ts:230-330`, "deterministic board-checker execution with argument validation"],
      [`mcp-tools.ts:334-372`, "deterministic watchdog audit execution and markdown rendering"],
      [`mcp-tools.ts:375-432`, "deterministic board sweep execution and Front Desk notification"],
      [`mcp-tools.ts:434-484`, "deterministic orchestrator pruning with dry-run support"],
      [`mcp-tools.ts:486-549`, "deterministic queue inspection and filtering"],
      [`mcp-tools.ts:551-614`, "deterministic queue purge with confirmation guard"],
      [`mcp-tools.ts:616-646`, "deterministic fleet shift handoff generation"],
    ],
    note: "Declares fleet MCP tools and dispatches executions with argument validation. Fully deterministic control plane; does not query an LLM.",
  },
  {
    file: `${PLUGIN}/server/workspace-lookup.ts`,
    part: "Deterministic repository workspace resolution and candidate ranking",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: [
        "resolveWorkspaceForRepo",
      ],
    },
    evidence: [
      [`workspace-lookup.ts:54-130`, "deterministically matches repo slugs against projects/workspaces registry"],
    ],
    note: "Resolves daemon workspace directory for repository checkouts deterministically by ranking unarchived primary workspaces.",
  },
  {
    file: `${PLUGIN}/server/workspace-guard.ts`,
    part: "Worktree-only dispatch guard: primary-checkout detection and worker workspace policy",
    layer: "server",
    label: DETERMINISTIC,
    anchors: {
      exports: [
        "inspectPrimaryCheckout",
        "evaluateWorkerWorkspaceGuard",
        "evaluateWorkerSpawnWorkspace",
        "WORKER_PRIMARY_CHECKOUT_ERROR",
      ],
    },
    evidence: [
      [`workspace-guard.ts:62-105`, "`inspectPrimaryCheckout` shells `git rev-parse --path-format=absolute --git-dir`/`--git-common-dir` and treats equality as the primary checkout"],
      [`workspace-guard.ts:149-215`, "`evaluateWorkerWorkspaceGuard` is ordered policy over the inspection, project rootPath and daemon registry record; non-worker categories pass untouched"],
      [`workspace-guard.ts:269-323`, "resolves the workspace record/project rootPath from the daemon registry and applies the guard to worker spawns"],
    ],
    note: "Enforces #918: a worker is refused the primary checkout before any SDK/CLI spawn. Detection is a fixed git probe, never a model judgement.",
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
    part: "Barrel re-export for surface, tree-view, panel and tooling",
    layer: "client",
    label: DETERMINISTIC,
    anchors: {},
    evidence: [[`client/index.ts:1-4`, "four `export *` statements, no code"]],
    note: "Pure re-export barrel.",
  },
  {
    file: `${PLUGIN}/client/tooling.tsx`,
    part: "Fleet tooling surface: schema-driven manual runner and result viewer",
    layer: "client",
    label: DETERMINISTIC,
    anchors: {
      exports: ["UppidiFleetToolingView"],
    },
    evidence: [
      [`tooling.tsx:40-75`, "retrieves tool definitions and manages dynamic schema form state"],
      [`tooling.tsx:77-135`, "validates required parameters and dispatches RPC tool execution"],
      [`tooling.tsx:185-330`, "renders schema-driven form fields with typed controls"],
    ],
    note: "Manual schema-driven tool runner surface. Queries tool schemas and displays execution output.",
  },
  {
    file: `${PLUGIN}/client/panel.tsx`,
    part: "Workspace panel and sidebar wrappers, panel registration",
    layer: "client",
    label: DETERMINISTIC,
    anchors: { exports: ["UppidiFleetPanel", "UppidiFleetSidebar", "registerWorkspacePanel"] },
    evidence: [
      [`panel.tsx:11-19`, "the panel mounts the host theme and the required scroll owner"],
      [`panel.tsx:27-33`, "the sidebar wrapper mounts the host theme for the sidebar registration"],
      [`panel.tsx:40-49`, "registration wraps `client.addWorkspacePanel`"],
    ],
    note: "Chrome around the surface. No model.",
  },
  {
    file: `${PLUGIN}/client/agent-switcher-data.ts`,
    part: "Agent switcher data projection: Front Desk extraction and per-repo orchestrator grouping",
    layer: "client",
    label: DETERMINISTIC,
    anchors: { exports: ["AgentSwitcherData", "AgentSwitcherGroup", "mapAgentSwitcherData"] },
    evidence: [
      [`agent-switcher-data.ts:22-24`, "a missing snapshot returns the empty shape rather than a guess"],
      [`agent-switcher-data.ts:35-43`, "repo key falls through `project`, `attributedWork.repo`, `labels.repo`, then `\"unassigned\"`; the first orchestrator per repo wins"],
      [`agent-switcher-data.ts:45-52`, "rows are ordered with `localeCompare` and mapped, no model"],
    ],
    note: "Pure snapshot-to-rows projection. It reads fields the server already derived from model-backed sessions and groups them; the grouping is arithmetic over strings.",
  },
  {
    file: `${PLUGIN}/client/agent-switcher.tsx`,
    part: "Agent switcher: navigable sidebar item, popover rows, live agent query, and in-client hand-off",
    layer: "client",
    label: DETERMINISTIC,
    anchors: { exports: ["AGENT_SWITCHER_JUMP_SCREEN_ID", "AgentSwitcherSidebarIcon", "AgentSwitcherDropdownProps", "AgentRowItem", "AgentSwitcherDropdown", "AgentSwitcherSidebarItem", "AgentSwitcherPopover", "AgentSwitcherJumpScreen"] },
    evidence: [
      [`agent-switcher.tsx:39-55`, "`AgentRowItem` derives its status dot from `getDeterministicStateConfig` over the agent's precomputed state"],
      [`agent-switcher.tsx:150-217`, "front desk and orchestrator rows render directly from props, with literal empty states"],
      [`agent-switcher.tsx:253-266`, "`useRpcQuery` polls `uppidiAgentsContract`; selecting a row calls `openScreen` with the jump screen id and the selected agent"],
      [`agent-switcher.tsx:308-318`, "the navigable screen forwards the selection to `navigation.openAgent` on mount"],
    ],
    note: "Displays the agents array and switches the host view to one of them. Reading a model session's classified state, or navigating to it, is not producing model output.",
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
    file: `${PLUGIN}/client/forges-tab.tsx`,
    part: "Forge issues surface: query, filtering, issue rows, status badges",
    layer: "client",
    label: DETERMINISTIC,
    anchors: {
      exports: ["forgeOpenIssuesContract", "forgeContextContract", "ForgeIssuesView", "ForgesTabView"],
    },
    evidence: [
      [`forges-tab.tsx:21-70`, "declares RPC query contracts for forge open issues and context"],
      [`forges-tab.tsx:96-100`, "reads issues over useRpcQuery"],
      [`forges-tab.tsx:110-125`, "filters issues by client query without model interaction"],
    ],
    note: "Renders forge issues for the workspace and filters them deterministically.",
  },
  {
    file: `${PLUGIN}/client/kanban-board.tsx`,
    part: "Fleet Kanban board: column mapping, transitions, ticket cards",
    layer: "client",
    label: DETERMINISTIC,
    anchors: {
      exports: ["KANBAN_COLUMNS", "getIssueKanbanColumn", "getColumnTransitions", "KanbanCard", "UppidiFleetKanbanBoard"],
    },
    evidence: [
      [`kanban-board.tsx:21-50`, "static column definitions and status mappings"],
      [`kanban-board.tsx:52-92`, "maps issue labels and state to kanban columns deterministically"],
      [`kanban-board.tsx:101-124`, "determines valid next column transition targets"],
    ],
    note: "Interactive Kanban board mapping issues across lifecycle states.",
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
    file: `${PLUGIN}/client/metrics-bar.tsx`,
    part: "Shared metrics bar: chip anatomy, selection, zero-count hiding, theme-driven colors",
    layer: "client",
    label: DETERMINISTIC,
    anchors: { exports: ["MetricsBar", "MetricsBarChip", "MetricsBarProps"] },
    evidence: [
      [`metrics-bar.tsx:55-66`, "container fill, border, radius and padding from theme colors"],
      [`metrics-bar.tsx:69-74`, "zero-count hide, selection and tone derivation are boolean arithmetic"],
      [`metrics-bar.tsx:92-98`, "icon/label/count render from props, no model call"],
    ],
    note: "Pure presentational component shared by the Work Queue and Agents & Fleet surfaces (#645). Renders counts computed elsewhere; same props, same chips.",
  },
  {
    file: `${PLUGIN}/client/theme.ts`,
    part: "Fleet theme accessor: host theme colors and helpers plus plugin typography scale",
    layer: "client",
    label: DETERMINISTIC,
    anchors: { exports: ["FleetTheme", "useFleetTheme"] },
    evidence: [
      [`theme.ts:50-60`, "colors, alpha and status helpers come from the host theme; typography is a fixed local scale"],
      [`theme.ts:7-13`, "no computed-style scraping, no client provider"],
    ],
    note: "Thin hook over the host theme provider. Same host theme in, same FleetTheme out; no inference.",
  },
  {
    file: `${PLUGIN}/client/host-ui.tsx`,
    part: "Plugin-local presentation kit: layout, cards, badges, buttons, inputs, table, ticket lifecycle",
    layer: "client",
    label: DETERMINISTIC,
    anchors: {
      exports: ["Card", "Button", "Badge", "DataTable", "ModalBody", "ForgeIcon", "TicketLifecycleView", "NewIssueComposer"],
    },
    evidence: [
      [`host-ui.tsx:1-20`, "component library over the host theme, host Icon and plain react-native; no model call"],
      [`host-ui.tsx:100-200`, "Row/Stack/Grid and Card/Tabs compose host theme colors only"],
      [`host-ui.tsx:2000-2112`, "ticket lifecycle view renders RPC payloads; it does not produce model output"],
    ],
    note: "Replaces the removed frozen helper client kit for uppidi-fleet. Deterministic presentation; model work stays behind the RPCs it renders.",
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

  // ---------------------------------------------------------------- shared ---
  {
    file: `${PLUGIN}/shared/contracts.ts`,
    part: "26 RPC contracts (zod schemas + input/output types) and the fleet settings contract",
    layer: "shared",
    label: DETERMINISTIC,
    anchors: { exports: ["uppidiFleetSettingsContract", "uppidiFleetSettingsSchema"] },
    evidence: [
      [`contracts.ts:54-1258`, "26 `defineContract`/`defineSettingsContract` objects across the file"],
      [`contracts.ts:1250-1256`, "the fleet settings schema is a `z.object`"],
      [`index.server.ts:81-105`, "every one of them is bound to a handler there"],
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
        "getStatusLightTone",
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
    file: `${PLUGIN}/shared/repo-identity.ts`,
    part: "Canonical repository identity resolution: normalization, coordinate splitting, single-name resolver (#888)",
    layer: "shared",
    label: DETERMINISTIC,
    anchors: {
      exports: [
        "normalizeRepoKey",
        "canonicalRepoKey",
        "resolveCanonicalRepo",
        "canonicalRepoName",
        "compactRepoName",
      ],
    },
    evidence: [
      [`repo-identity.ts:14-30`, "`normalizeRepoKey` strips protocol, scp, port and `.git` deterministically"],
      [`repo-identity.ts:83-115`, "`repoCoordinates` splits a fully-qualified key into host/owner/repo"],
      [`repo-identity.ts:135-176`, "`resolveCanonicalRepo` matches a bare name against the known roster or returns null"],
    ],
    note: "Pure string algebra shared by client and server. The single source of repository identity every surface resolves through.",
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
  {
    file: `${PLUGIN}/bin/fleet-board-check.mjs`,
    part: "Standalone CLI entrypoint for board checking and triage ranking",
    layer: "script",
    label: DETERMINISTIC,
    anchors: { symbols: ["fleet-board-check", "runIssuesCheck"] },
    evidence: [
      [`fleet-board-check.mjs:20-55`, "parses CLI flags (--repo, --role, --force, --all, --json)"],
      [`fleet-board-check.mjs:75-95`, "runs issues check and sets exit code 1 on actionable candidates, 0 on clean"],
    ],
    note: "Standalone executable CLI wrapping server/issues-check.ts with identical arguments and exit code contract.",
  },
  {
    file: `${PLUGIN}/bin/fleet-watchdog.mjs`,
    part: "Standalone CLI entrypoint for fleet watchdog health auditing",
    layer: "script",
    label: DETERMINISTIC,
    anchors: { symbols: ["runWatchdogAudit", "renderWatchdogAuditMarkdown"] },
    evidence: [
      [`fleet-watchdog.mjs:20-60`, "parses CLI flags (--front-desk-id, --recover/--no-recover, --json)"],
      [`fleet-watchdog.mjs:80-98`, "executes auditFleet and exits with non-zero code on unresolved anomalies"],
    ],
    note: "Standalone executable CLI wrapping HookRouter watchdog health audit with recovery controls.",
  },
  {
    file: `${PLUGIN}/bin/fleet-mcp-server.mjs`,
    part: "Standalone MCP stdio JSON-RPC 2.0 server",
    layer: "script",
    label: DETERMINISTIC,
    anchors: { symbols: ["executeFleetTool", "FLEET_MCP_TOOLS"] },
    evidence: [
      [`fleet-mcp-server.mjs:25-50`, "stdio readline transport for JSON-RPC 2.0 messages"],
      [`fleet-mcp-server.mjs:60-110`, "dispatches initialize, ping, tools/list, and tools/call"],
    ],
    note: "Exposes fleet tools over standard Model Context Protocol stdio transport for any MCP-compatible client.",
  },
  {
    file: `${PLUGIN}/bin/fleet-ensure-orchestrator.mjs`,
    part: "Standalone CLI entrypoint to deterministically ensure repo orchestrators",
    layer: "script",
    label: DETERMINISTIC,
    anchors: { symbols: ["fleet-ensure-orchestrator", "ensureOrchestrator"] },
    evidence: [
      [`fleet-ensure-orchestrator.mjs:30-65`, "parses CLI flags (--repo, --mode, --provider, --model, --force, --json)"],
      [`fleet-ensure-orchestrator.mjs:70-100`, "invokes router.ensureOrchestrator and prints outcome or JSON"],
    ],
    note: "Standalone executable CLI wrapping HookRouter deterministic orchestrator provisioning.",
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
  "server/issues-check.test.ts": "Ported stale-WIP sweep fixtures, checker retirement guard (#733)",
  "server/metrics.test.ts": "Rollup arithmetic, candidate derivation, receipt persistence",
  "server/runners.test.ts": "Runner scope merge, normalisation, fleet-status decision table",
  "server/skills.test.ts": "Fleet skill resolution, canonical override precedence, drift, and spawn-prompt wiring",
  "server/permission-adjudication.test.ts": "Safe-pattern allowlist, shell scanner, fleet detection, and durable decision log (#1084)",
  "server/mcp-tools.test.ts": "MCP tool definitions, schema validation, and dispatch fixtures",
  "test/fleet-board-check-cli.test.mjs": "Standalone fleet-board-check CLI options and exit codes",
  "test/fleet-watchdog-cli.test.mjs": "Standalone fleet-watchdog CLI options, recency validation, and diagnostic run",
  "test/fleet-mcp-server.test.mjs": "MCP stdio protocol handshake, tools/list and execution over stdin/stdout",
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

// Bound per validate() call; kept module-level so resolveEvidence stays free of
// plumbing.
const INVENTORY = new Map();

/**
 * Check a judgement map against an inventory. `parts` is a parameter rather than
 * the module's own `PARTS` so the test suite can feed it deliberately wrong maps
 * -- that is the whole point of having negative tests, and a validator that can
 * only ever be called with its own correct input cannot be tested for catching
 * anything.
 */
export function validate(parts, inv, suiteNotes = SUITE_NOTES) {
  INVENTORY.clear();
  for (const [k, v] of inv) INVENTORY.set(k, v);

  const errors = [];
  const seen = new Set();

  for (const part of parts) {
    const file = inv.get(part.file);
    if (!file) {
      errors.push(`${part.file}: declared as a part but not a tracked source file in scope`);
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

  for (const [key] of Object.entries(suiteNotes)) {
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
    "- `~/bin/forgejo-issues-check`, retired by #733: the board sweep now runs the ported `server/issues-check.ts` in-process. A `FORGEJO_ISSUES_CHECK=` override execs an external checker for debugging only.",
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
  const errors = validate(PARTS, inv);
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

// Only when executed directly. Importing this module must not render the doc or
// exit the process -- `scripts/fleet-determinism-matrix.test.mjs` imports
// `validate` and `parseExports` to test them against deliberately wrong input.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
