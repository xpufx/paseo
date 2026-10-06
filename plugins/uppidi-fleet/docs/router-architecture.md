# Hook router architecture: standalone vs embedded

**Status:** Evaluation (docs only — no behavior change)
**Issue:** [xpufx-org/paseo#985](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/985)
**Related:** [platform#283](https://forge.mrs.uppidi.com/xpufx-org/platform/issues/283) / platform PR #284 (`06b8028`), `platform/docs/forgejo-hook-coupling-audit.md`

## Why this document exists

Two implementations of the same fleet webhook router are in flight:

- **Standalone** — `platform/scripts/forgejo-hook.mjs`, a plain Node process run as
  the `forgejo-hook` workspace service. Canonical implementation of the fleet JSON
  envelope (`<!-- {"fleet": {...}} -->`, platform#283).
- **Embedded** — `plugins/uppidi-fleet/server/hook-router.ts`, a TypeScript port
  that runs inside a Paseo plugin lifecycle and owns the live `:8099` listener.

They share a contract (webhook ingest, coalescing, per-repo queues, orchestrator /
Front Desk registry, watchdog, HTTP control plane) but not an implementation.
This document records their current shape differences, the long-term goal of a
router that can run without a Paseo app while still serving Paseo agents, and a
recommendation. It changes no code.

## 1. Current shape

| Dimension | Standalone (`platform/scripts/forgejo-hook.mjs`) | Embedded (`plugins/uppidi-fleet/server/hook-router.ts`) |
|---|---|---|
| Runtime | Plain Node ESM process under a systemd/workspace service | Paseo plugin server module, loaded per daemon |
| Lifecycle | `listen()` on start; module-level `setInterval` for flush/watchdog | `start()`/`stop()`/`restart()`/`reload()` driven by the plugin host |
| Config | Env vars (`HOOK_PORT`, `HOOK_STATE_DIR`, `HOOK_QUEUE_DIR`, `HOOK_TEST_MODE`) | Env vars overlaid with `PluginStorage` settings and `HookRouterOptions` |
| State | `~/.paseo/forgejo-hook/**` by convention | `~/.paseo/plugin-data/xpufx/uppidi-fleet/**` (plugin-scoped) |
| Paseo coupling | Private `@getpaseo/cli/dist/utils/client.js` import + `paseo send` / `paseo agent reload` subprocesses | `PluginServerContext.paseo` SDK (`agents.ref(...).send/update`) with CLI fallback |
| Control plane | HTTP only (`/status`, `/queues`, `/orchestrators`, `/frontdesk`, `/orchestrators/prune`, …) | HTTP **and** typed plugin RPC contracts (`shared/contracts.ts`) + `bin/` CLIs |
| Extra surfaces | — | Board sweep, repo enrollment, mute/pause, teardown broadcast, Front Desk activity/prompt, fleet reset, MCP tool surface |
| Tests | `scripts/forgejo-hook.test.mjs`, synthesizes fake `node_modules` for `connectToDaemon` | `server/hook-router.test.ts` with injectable `deliver`/`reloadAgent`/`spawnAgent` seams |

Both bind `:8099`, so only one can be the live router on a host. Today that host
is the embedded plugin; the standalone copy remains the reference for the delivery
contract and the envelope introduced in platform#283.

### Feature/contract drift

The embedded port is a **superset** of the standalone router (board sweep,
enrollment, teardown, mute/pause, MCP tools) but has already made independent
choices: candidate-key persistence writes one registration under multiple keys,
the Front Desk registry lives at a plugin-scoped path, and watchdog recovery uses
a richer taxonomy. Every one of these is a place the two can silently diverge.
Platform#283 is the first explicit contract synchronization: the same
`fleetEnvelope` / `withFleetEnvelope` shape is now implemented in both, and this
port adds unit tests so the envelope cannot drift unnoticed.

## 2. Long-term goal

A router that can run **standalone without a Paseo app** while still serving
Paseo agents when a daemon is present. The coupling audit already established the
honest boundary:

- The router is a **webhook receiver and queueing control plane**, not an agent
  runtime.
- It can be made agnostic to *which* agent runtime it drives.
- It cannot operate with **no** agent runtime — steer/interrupt, turn-busy
  tracking, and agent reload are load-bearing for queue drain and watchdog recovery.

So "standalone" means *pluggable agent backend*, not *zero daemon*.

## 3. Options

### Option A — Keep both, enforce parity

Status quo. Treat the standalone file as the reference contract, port each change
into the plugin, and cover parity with unit tests + the determinism matrix.

- **Pros:** zero deployment risk; no new packaging; each host keeps its idioms.
- **Cons:** dual maintenance forever; parity is enforced only by discipline and
  tests; graph of features keeps diverging.

### Option B — Extract a transport-agnostic core, two hosts

Move webhook parsing, coalescing, per-repo queues, registry files, HTTP control
plane, and envelope formatting into a shared package
(`@xpufx/fleet-router-core`). Define the `AgentTransport` seam from the coupling
audit (`getAgent`, `listAgents`, `sendMessage`, `updateAgent`, `reloadAgent`,
`listWorkspaces`). Provide two adapters/hosts:

- `PaseoTransport` + plugin host (current default, uses `PluginServerContext`).
- CLI/HTTP standalone host (uses the daemon client directly, or another runtime).

- **Pros:** one implementation of the delivery contract; the standalone build is
  a real, tested artifact; the port `:8099` listener has a single owner choice,
  not two codebases; envelope changes ship once.
- **Cons:** package extraction and the transport refactor are non-trivial; needs
  a versioning/compat story; state-dir and `PluginStorage` paths must be injected,
  not hardcoded.

### Option C — Embedded router is the only implementation

Retire the standalone file; the standalone shape becomes a thin launcher that
starts the plugin host, or a proxy to a running plugin.

- **Pros:** one code path, no drift.
- **Cons:** directly contradicts the decoupling goal — running the router would
  require a Paseo app/plugin host; loses the ability to deploy on hosts without
  Paseo installed.

### Option D — Relocate to a standalone gateway repo

Ship the router as `xpufx-org/forgejo-agent-gateway`, with `platform` reduced to
fleet configuration.

- **Pros:** cleanest separation; externally adoptable; testability without the
  platform checkout.
- **Cons:** new repo, CI, packaging, and deployment migration; largest up-front
  cost; premature until the core/transport seam exists.

## 4. Risks

- **Contract drift (A):** the two copies diverge in exactly the places tests
  don't pin. Mitigate with golden vectors for every machine-readable payload.
- **Paseo build coupling (A/B):** the standalone router imports
  `@getpaseo/cli/dist/utils/client.js` and `daemon-target.js` — private,
  unversioned, layout-sensitive. Any extraction of the core must push this into a
  transport adapter so the core never imports Paseo.
- **State isolation vs scoping:** the embedded router must keep plugin state under
  `~/.paseo/plugin-data/<namespace>/<pluginId>/` (see the coding-agent skill);
  the standalone convention is `~/.paseo/forgejo-hook/**`. A shared core must take
  both as injected paths, never bake one in.
- **Single-listener ownership:** both shapes want `:8099`. Running both on one host
  requires one to proxy or defer; consolidation must make listener ownership explicit.
- **Plugin lifecycle:** `stop()`/`reload()` must not drop in-flight steers. A shared
  core needs the same graceful drain the plugin host already has.
- **Backward compatibility:** keep the existing human-readable Markdown semantics
  and the `[forgejo-hook] {machine}` first line; the fleet envelope is a prepended
  hidden HTML comment only (this port does exactly that). Legacy parsers must keep
  working unchanged.

## 5. Recommendation

**Stage B behind a parity checkpoint:**

1. **Now (this issue):** keep the embedded plugin as the live router, finish the
   envelope port, and pin the contract with unit tests + the determinism matrix.
   Treat `platform/scripts/forgejo-hook.mjs` as the reference and reconcile any
   future delivery change in both until extraction lands.
2. **Next:** extract the transport-agnostic core into a shared package and land the
   `AgentTransport` seam (Option B). Make the standalone host a thin, tested
   launcher over the same core, and make the plugin host one adapter of it.
3. **Eventually:** the standalone host becomes a supported deployment for hosts
   without a Paseo app; the plugin host stays the default inside Paseo. Option D is
   only worth it once the core/transport seam exists — it is a packaging move, not
   an architecture fix.

Do **not** choose Option C: collapsing to the embedded router would satisfy
single-source-of-truth on paper while permanently breaking the standalone
decoupling goal.

## 6. Non-goals

- No behavior change to routing, queues, or watchdog recovery as part of this
  evaluation.
- No new repo, package, or transport interface is created by this issue.
- The envelope port (platform#283 parity) does not depend on consolidation.
