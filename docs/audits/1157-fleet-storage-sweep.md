# Audit #1157 — Whole-fleet sweep for filesystem access outside scoped storage

**Ticket:** [xpufx-org/paseo#1157](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1157)
**Branch:** `audit/1157-fleet-storage-sweep`
**Kind:** audit only — no fixes.

## Scope and definition

**Scoped storage** for `uppidi-fleet` is defined as:

- its plugin data dir `~/.paseo/plugin-data/xpufx/uppidi-fleet/`, and
- its own repo workspace (`plugins/uppidi-fleet/**`).

Everything else on the filesystem is "outside". The sweep covered:

- `plugins/uppidi-fleet/**` (server, shared, client, bin, examples) — runtime paths only.
- The `paseo-plugin-helper` copy it actually resolves: **`packages/paseo-plugin-helper`**
  (workspace package; uppidi-fleet has **no** vendored copy under `plugins/uppidi-fleet/`).
  Only the helper modules reachable from uppidi-fleet's imports are listed:
  `server/storage.ts`, `server/settings.ts`, `server/plugins.ts`, `server/tickets.ts`.
- Fleet `scripts/*.mjs` in this repo that touch fleet state.
- The hook router (`server/hook-router.ts`) and everything it reads/writes.

**Method:** grep for `os.homedir`, `process.env.HOME`, `homedir()`, `~/.paseo`, `readFile(`,
`writeFile(`, `rename(`, `mkdir`, `tmpdir(`, `fs.`, `unlink`, `readdir`, `existsSync`,
`openSync`, `appendFile`, `createReadStream`, `createWriteStream`, `copyFile` across the scope,
then verified every hit by reading the surrounding code. Test files, `client/testing`, and
purely string `Array.join` hits were excluded. Environment-variable overrides
(`PASEO_DIR`, `HOOK_STATE_DIR`, `HOOK_QUEUE_DIR`, `MODEL_HEALTH_PATH`, `PASEO_PLUGIN_DATA`,
`UPPIDI_FLEET_*`) are noted where they change the resolved path.

## Results

Legend for the last column: **Y** = the data is owned by the Paseo daemon and should be read/written
through daemon RPC/SDK rather than by path; **N** = not daemon-owned (fleet legacy state, host CLI
config, external cache, or operator-supplied paths).

| file:line | read/write | path or pattern | outside scoped storage because… | daemon-owned (should be RPC) Y/N |
|---|---|---|---|---|
| `plugins/uppidi-fleet/server/agents.ts:583-598` | Read | `~/.paseo/projects/projects.json`, `~/.paseo/projects/workspaces.json` | Workspace/project registry lives in the daemon dir, not `plugin-data/xpufx/uppidi-fleet/` | Y |
| `plugins/uppidi-fleet/server/agents.ts:645-648` | Read | `~/.paseo/limit-alerts.json` (or `$PASEO_DIR/limit-alerts.json`) | Daemon quota-alert state | Y |
| `plugins/uppidi-fleet/server/agents.ts:668-681` | Read | `~/.paseo/agents/<id>/<id>.json` (or `$PASEO_DIR/agents`) | Daemon agent registry | Y |
| `plugins/uppidi-fleet/server/agents.ts:1443-1470` | Delete | `~/.paseo/forgejo-hook/{,orchestrators/}frontdesk.json`, `~/.paseo/{,orchestrators/}frontdesk.json` | Legacy (pre-#1012) fleet state under the daemon dir | N |
| `plugins/uppidi-fleet/server/agents.ts:1506-1526` | Delete | `~/.paseo/forgejo-hook/orchestrators/*.json` | Legacy fleet orchestrator registry | N |
| `plugins/uppidi-fleet/server/agents.ts:1591-1611` | Delete | `~/.paseo/forgejo-hook/queues/*.{json,jsonl}` (or `$HOOK_QUEUE_DIR`) | Legacy fleet queue dir | N |
| `plugins/uppidi-fleet/server/agents.ts:1817-1846` | Delete | `~/.cache/forgejo-board-state*.json`, `~/.cache/forgejo-issues/*` | OS cache dir, outside `plugin-data`; cache is written by the retired external `forgejo-issues-check` | N |
| `plugins/uppidi-fleet/server/agents.ts:1878-1885` | Delete | `~/.paseo/forgejo-hook/board-state/*.json` | Legacy fleet board-state | N |
| `plugins/uppidi-fleet/server/agents.ts:2863` | Read (stat) | `matching.cwd` — an active agent's workspace dir | Arbitrary workspace path outside fleet scope | Y |
| `plugins/uppidi-fleet/server/agents.ts:2874-2875` | Read (stat) | `~/code/<repoBasename>` | Host checkout outside fleet scope | N |
| `plugins/uppidi-fleet/server/forgejo-api.ts:28-29` | Read | `~/.config/tea/config.yml` | Operator's `tea` CLI config, outside `~/.paseo` | N |
| `plugins/uppidi-fleet/server/hook.ts:154-156` | Read | `~/.paseo/forgejo-hook.secret` (or `$PASEO_FORGEJO_HOOK_SECRET_FILE`) | Webhook secret in the daemon dir | N |
| `plugins/uppidi-fleet/server/hook-router.ts:2089-2123` | Read | `~/.paseo/agents/*/*.json` | Daemon agent registry | Y |
| `plugins/uppidi-fleet/server/hook-router.ts:2152-2167` | Write | `~/.paseo/agents/<id>/<id>.json` (remove `lastError`) | Mutates daemon-owned agent metadata | Y |
| `plugins/uppidi-fleet/server/hook-router.ts:2178-2196` | Write | `~/.paseo/agents/<id>/<id>.json` (merge fields e.g. attention flags) | Mutates daemon-owned agent metadata | Y |
| `plugins/uppidi-fleet/server/hook-router.ts:2205-2236,2277` | Read | `~/.paseo/daemon.log`, `~/.paseo/*.log` (or `--daemon-log-dir`) | Daemon log stream | Y |
| `plugins/uppidi-fleet/server/hook-router.ts:2322,2362-2386` | Read + Write | `~/.paseo/model-health.json` (or `$MODEL_HEALTH_PATH`) | Shared model-health circuit-breaker cache in the daemon dir | Y |
| `plugins/uppidi-fleet/server/hook-router.ts:3736-3740` | Read | `mergeEventHooks[].checkoutPath` with `~` expansion | Arbitrary checkout path supplied by webhook config (often another repo) | N |
| `plugins/uppidi-fleet/server/hook-router.ts:3847-3970` | Write | `git fetch`/`git reset` executed with `cwd = checkoutPath` | Writes another checkout's `.git` and working tree | N |
| `plugins/uppidi-fleet/server/hook-router.ts:4772-4784,4793-4820` | Read | `~/.paseo/forgejo-hook/frontdesk.json`, `~/.paseo/forgejo-hook/orchestrators/frontdesk.json`, `~/.paseo/frontdesk.json` | Legacy daemon-dir front-desk records | N |
| `plugins/uppidi-fleet/server/hook-router.ts:6311` | Read (connection target) | `$HOME/.paseo` passed as daemon client `home` | `HOME` assumption for the daemon RPC endpoint; breaks under agent-mux/other user | Y |
| `plugins/uppidi-fleet/server/hook-router.ts:6427,6435` | Read | `$HOME/.paseo` daemon log dir | Daemon logs | Y |
| `plugins/uppidi-fleet/server/hook-router.ts:7229` | Read | `input.handoffFile` (operator-supplied) | Arbitrary host file path | N |
| `plugins/uppidi-fleet/server/hook-router.ts:10036-10049` | Read | `~/.paseo/forgejo-hook/orchestrators/*.json` (or `$HOOK_STATE_DIR`) | Legacy fleet registry | N |
| `plugins/uppidi-fleet/server/hook-router.ts:10074-10081` | Read | `~/.config/uppidi-fleet/queues/*.json` (or `$HOOK_QUEUE_DIR`) | Legacy fleet queue dir outside `~/.paseo` entirely | N |
| `plugins/uppidi-fleet/server/metrics.ts:84-85,635,666` | Read | `~/.paseo/uppidi-fleet-metrics.json` (and `.bak` sibling) | Legacy metrics receipt location; migrated into scoped `metrics.json` | N |
| `plugins/uppidi-fleet/server/permission-adjudication.ts:707-720` | Read + Write | `~/.paseo/forgejo-hook/permission-decisions.jsonl` | Legacy fleet audit log in the daemon dir | N |
| `plugins/uppidi-fleet/server/permission-adjudication.ts:811` | Read (`HOME` for path) | `input.home ?? input.env?.HOME ?? process.env.HOME` | `HOME` assumption when resolving the adjudication log | N |
| `plugins/uppidi-fleet/server/role-models.ts:66-67,95-113` | Read | `~/uppidi-fleet-role-models.json{,.bak}`, `~/.paseo/uppidi-fleet-role-models.json{,.bak}` | Legacy unscoped role-model config; copied into scoped `role-models.json` | N |
| `plugins/uppidi-fleet/server/role-models.ts:77` | Read + Write | `$UPPIDI_FLEET_ROLE_MODELS_CONFIG` (absolute path honoured) | Arbitrary operator override file | N |
| `plugins/uppidi-fleet/server/skills.ts:53,119-124` | Read | `~/.paseo/config.json` | Daemon plugin registry | Y |
| `plugins/uppidi-fleet/server/skills.ts:74-84` | Read | `~/.paseo/plugins/<pluginId>/<commit>/checkout` | Daemon plugin install dir | Y |
| `plugins/uppidi-fleet/server/skills.ts:156-160,282-337,387` | Read | `<pluginRoot>/../../../platform/skills/<id>/SKILL.md`, `$PASEO_UPPIDI_FLEET_CANONICAL_SKILLS_ROOT` | Sibling `platform` checkout outside the paseo repo | N |
| `plugins/uppidi-fleet/server/workspace-guard.ts:234-256` | Read | `~/.paseo/projects/{workspaces,projects}.json` (or `$PASEO_WORKSPACES_PATH`/`$PASEO_PROJECTS_PATH`) | Daemon workspace/project registry | Y |
| `plugins/uppidi-fleet/server/workspace-lookup.ts:57-84,115-139` | Read | `~/.paseo/{projects/,}{workspaces,projects}.json` | Daemon workspace/project registry (probed in several fallback shapes) | Y |
| `plugins/uppidi-fleet/server/workspace-lookup.ts:276` | Read (stat) | `workspace.cwd` from the registry | Arbitrary workspace directory | Y |
| `plugins/uppidi-fleet/server/workspace-lookup.ts:312-313` | Read (stat) | `~/code/<repoBasename>` | Host checkout fallback | N |
| `packages/paseo-plugin-helper/src/server/storage.ts:63` | Home resolution | `os.homedir()/.paseo/plugin-data/xpufx/<pluginId>` | `os.homedir()` used as the anchor for the scoped path (agent-mux divergence, #1158) | N |
| `packages/paseo-plugin-helper/src/server/storage.ts:71-78` | Write | `~/.paseo/plugin-data/xpufx/README.md` (namespace parent) | Parent namespace dir, outside `.../uppidi-fleet/` | N |
| `packages/paseo-plugin-helper/src/server/plugins.ts:84-86` | Read | `~/.paseo/config.json` | Daemon plugin registry (fallback when `paseo plugin ls --json` fails) | Y |
| `packages/paseo-plugin-helper/src/server/tickets.ts:629-633` | Read | `~/.paseo/plugin-data/xpufx/forges/settings.json` | Another plugin's scoped dir; default `storagePluginId` is `forges` when uppidi-fleet calls `registerTicketHandlers(server)` with no options | Y |
| `packages/paseo-plugin-helper/src/server/tickets.ts:648-649,676-677` | Read | `~/.config/tea/config.yml` | Operator CLI config | N |
| `packages/paseo-plugin-helper/src/server/tickets.ts:124-126` | Read | `<directory>/.git` and the resolved common git dir `config` | Git metadata of the caller's repository, outside fleet scope | N |

### Notes and non-findings

- **`scripts/*.mjs` are clean.** None of the fleet-related repo scripts read or write fleet state
  outside the repo checkout. `scripts/fleet-determinism-matrix.mjs` only reads files under
  `plugins/uppidi-fleet/` and writes `plugins/uppidi-fleet/docs/determinism-matrix.md` (inside the
  repo). `doctor-live.mjs`, `vendor-sync.mjs`, `measure-plugin-bundles.mjs`, `stamp-helper-revision.mjs`,
  `mirror-github.mjs`, `npm-*.mjs`, `publish-npm.mjs` operate on repo-relative paths only.
- **Scoped files that still resolve through `HOME` directly (divergence risk, cf. #1158), not counted
  as "outside":** `server/issues-check.ts:257-258` (`~/.paseo/plugin-data/xpufx/uppidi-fleet/board-state`),
  `server/metrics.ts:72-73`, `server/settings.ts:18` (test `tmpdir`), and the `PluginStorage` default.
  Under an `agent-mux` profile `HOME` these can land in the profile dir rather than the host
  `~/.paseo`. `resolveHostHome()` (role-models.ts) is the host-aware helper, but several call sites
  bypass it.
- **No fleet read/write of `~/.paseo/push-tokens.json`, `~/.paseo/daemon-keypair.json`,
  `~/.paseo/config.json` directly (config.json only via the helper registry fallback), or
  `~/.paseo/projects/workspaces.json` outside the registry readers listed above.**
- **The `~/.paseo/forgejo-hook/` tree is the largest legacy cluster.** It is read or deleted by
  teardown, front-desk resolution, permission adjudication, and roster info. It is fleet-owned legacy
  state, not daemon state, but it sits outside the defined scoped dir.
- **Agent metadata is both read and mutated** (`~/.paseo/agents/<id>/<id>.json`). This is the
  daemon's own registry; the watchdog's clear-error/attention writes are the clearest "should be RPC"
  operations in the sweep.
- **The helper's `PluginStorage` writes a `README.md` one level above the fleet dir**
  (`plugin-data/xpufx/README.md`) whenever it first ensures the namespace directory.
