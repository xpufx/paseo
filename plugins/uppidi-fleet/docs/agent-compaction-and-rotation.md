# Long-lived agent compaction & rotation

**Status:** Research / decision — docs only, no behavior change
**Issue:** [xpufx-org/paseo#1019](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1019)
**Scope:** uppidi-fleet orchestrators and Front Desk (the long-lived roles)
**Evidence base:** the installed Paseo SDK `@getpaseo/*@0.11.0-beta.5` and the
provider implementations shipped in `@getpaseo/server`, plus this plugin's
router and skills.

> Coding workers are ephemeral and cheap to discard. Front Desk and the
> per-repo orchestrators are not: they accumulate context until it costs
> tokens or overflows the window. This document answers *how* to compact or
> respawn them without losing their skills or their grip on the board, and
> what Paseo actually offers.

---

## 1. Problem statement & constraints

The operator's framing from #1019: "The hook/sweep messages should be enough
for them to reorient themselves from a fresh start. But how do we proceed with
the actual compacting? Not all providers support it. Same for 'clean' and that
would actually make it forget its skills."

The constraints are real and are visible in the code:

1. **Role orientation is inlined into the spawn prompt (#1080).** The
   orchestrator is spawned with a prompt that carries the effective skill
   **content**, not a path: `renderSkillDirective("orchestrator")`
   (`plugins/uppidi-fleet/server/hook-router.ts`), and the Front
   Desk/Orchestrator add path inlines the coding-agent skill too
   (`plugins/uppidi-fleet/server/agents.ts`). The effective text is the
   operator override under
   `~/.paseo/plugin-data/xpufx/uppidi-fleet/skills/<id>.md` when present, else
   the canonical `platform/skills/<id>/SKILL.md` when a `platform` checkout is
   reachable, else the bundled
   `plugins/uppidi-fleet/examples/skills/<id>/SKILL.md`
   (`plugins/uppidi-fleet/server/skills.ts`, `resolveEffectiveSkill`; README
   §6). A provider `/clear` therefore matters not because it drops
   "skills" from a provider store, but because it drops the conversation
   *turn that carried the skill text*.

2. **Durable state already lives outside the agent.** The Forgejo board is the
   source of truth (orchestrator skill §12), workspaces are Paseo-owned, and
   the router owns the orchestrator and Front Desk registries
   (`writeOrchestrator`/`frontdesk.json`). A fresh agent can rediscover all of
   it, which is exactly why the operator calls this "low-hanging fruit".

3. **No portable compaction capability signal exists.** `AgentCapabilityFlags`
   (`@getpaseo/server …/agent/agent-sdk-types.d.ts:123`) and the provider-plugin
   `PROVIDER_CAPABILITIES` list (`@getpaseo/plugin/dist/server/provider.d.ts:4`)
   contain no `compact`/`clear` flag. Compaction is either provider-native
   slash commands or a provider-internal auto behavior. The orchestration layer
   must therefore probe or know the provider.

4. **The plugin server `PaseoApi` is a scoped subset.** It exposes
   `agents.list/ref/create/subscribe` and a handle with `send/run/commands/
   archive/detach/refresh` (`@getpaseo/client/dist/index.d.ts:302-327`). The
   richer session primitives — `rewindAgent`, `buildAgentForkContext`,
   `resumeAgent`, `refreshAgent` — live on the raw `DaemonClient`
   (`@getpaseo/client/dist/daemon-client.d.ts:810-861`) and are **not declared**
   on the plugin API. Any design that needs them must either reimplement the
   small amount of curation or establish that the runtime object passed to the
   plugin is richer than its type (an experiment; see §7).

---

## 2. What the runtime actually supports

### 2.1 Provider-native compaction and clear

Compaction in Paseo is not a Paseo API; it is a provider slash command sent as a
normal prompt (`/compact`), which the provider either handles out-of-band or
forwards to the underlying harness. Inspected implementations:

| Provider | Manual compaction | Auto-compaction | Session clear | Evidence |
|---|---|---|---|---|
| `claude` | `/compact` | Yes, provider-native; emits `type:"compaction"` timeline items | `/clear` (classified root-only) | `providers/claude/agent.js:183-184` (`CLAUDE_ROOT_ONLY_COMMANDS`), `:3496-3513`; rewind supported `:144-146` |
| `codex` | `/compact` | Yes (`thread/compacted`, `contextCompaction` items) | not observed | `codex-app-server-agent.js:3893-3896`, `:3918-3972`, `:2016-2022`, `:4965` |
| `opencode` | `/compact`, `/summarize` → `session.compact()` | provider-native | not observed | `opencode/v2/commands.js:10`, `opencode/v2/turns.js:195-196`, `v2/timeline.js:131-136` |
| `omp` | `/compact [instructions]` | `/autocompact on\|off\|toggle` | not observed | `providers/omp/agent.js:908-915`, `:1084`; `omp/runtime.d.ts:37` |
| `pi` | `/compact [instructions]` | `/autocompact on\|off\|toggle` | not observed | `providers/pi/agent.js:44-51`, `:1398`; `pi/runtime.d.ts:45` |
| ACP family (`copilot`, `cursor`, `kimi`, `kiro`, `trae`, `generic`) | pass-through of whatever the ACP agent advertises | provider-dependent | provider-dependent | `providers/acp-agent.js:1267-1280`, `:2076-2082` |

Notes:

- The live host currently runs orchestrators on the **`pi`** provider
  (`paseo ls --json`), which supports `/compact` and `/autocompact` in-process
  — the least-effort path today.
- The ACP rows are genuinely unknown without probing. Paseo maps the ACP
  `available_commands_update` list straight through with `kind:"command"`
  (`acp-agent.js:2076-2082`), so whether `/compact` or a clear command exists is
  a property of Copilot/Cursor/Kimi/Kiro/Trae, not of Paseo. Probe it with the
  agent handle's `commands()`.
- `claude` is the only built-in with a first-class **session clear** (`/clear`).
  For everyone else, "clear" means either a provider rewind that resolves to a
  fresh session or a Paseo-level respawn.

### 2.2 Paseo session primitives (raw daemon client)

- `sendAgentMessage(agentId, text, { activeTurnBehavior })` — deliver `/compact`
  or a reorientation envelope; `--steer` in the platform `paseo send` wrapper
  maps to `activeTurnBehavior:"steer"` so it queues behind an active turn
  instead of interrupting it.
- `refreshAgent(agentId)` (`daemon-client.d.ts:838`) — "reload the agent
  (restarts the underlying process)". The lifecycle contract models this as
  `PluginSessionOpenRequest.reason:"refresh"` (`@getpaseo/plugin/dist/server/
  lifecycle.d.ts`), i.e. it re-opens the **same** persisted session. Refresh is
  not a clear.
- `rewindAgent(agentId, messageId, "conversation"|"files"|"both")`
  (`daemon-client.d.ts:861`) — Claude-only today. `resolveConversationRewindTarget`
  falls back to `{kind:"fresh-session"}` when there is no earlier answered turn
  (`claude/agent.js:2482-2485`), so rewind *can* empty a conversation, but only
  for rewind-capable providers and only relative to a message id.
- `buildAgentForkContext(agentId, {boundaryMessageId, boundaryCursor})`
  (`daemon-client.d.ts:858`) — returns a curated `text/plain` attachment with
  `contextKind:"chat_history"` summarising user/assistant/tool items up to a
  boundary (`agent/activity-curator.js:214-245`). This is Paseo's own
  "compaction artifact".
- `createAgent(options)` accepts `attachments` (`PaseoAgentCreateOptions`,
  `index.d.ts:165-181`), and `prompt-attachments.js` puts `chat_history`
  attachments **first** in the prompt block order. So a fresh session can be
  seeded with the fork-context attachment.
- `archiveAgent`, `detachAgent`, `deleteAgent`, `resumeAgent(handle)`.

**Capability gap:** `buildAgentForkContext` and the fork-flow are not on the
plugin `PaseoApi`. The plugin *can* fetch the same raw timeline via
`handle.timeline.refetch()` and format its own summary, or seed with a
router-generated handoff instead of a chat transcript (arguably better for an
orchestrator).

### 2.3 Existing fleet primitives (what this plugin already has)

- `ensureOrchestrator` / `provisionOrchestrator` — idempotent spawn, workspace
  resolution, model fallback, pre-spawn dedup, registry write
  (`hook-router.ts:4459`). `force:true` archives matching live
  orchestrators before spawning.
- `handleUppidiReplaceOrchestrator` — archives the old agent and spawns a
  fresh one via `handleUppidiAddOrchestrator` with the skill-path prompt
  (`agents.ts:2715`). **It does not seed a handoff or re-inject board
  context**; the new agent relies entirely on the next hook/sweep. This is the
  rotation spine that already exists.
- Front Desk rotation is the mature template: `POST /frontdesk-handoff`
  → `doFrontDeskHandoff` seeds `latest-handoff.md`, renames/retires agents,
  persists `frontdesk.json`, drains the queue, and steers an onboarding message
  containing the handoff path + excerpt to the new agent
  (`hook-router.ts:5768-5848`; README §13.5). `handoffPath`,
  `writeHandoff`, `readHandoff`, `handoffSummary` at `hook-router.ts:5730-5765`.
- `generateHandoff` / MCP `fleet_handoff_generate` builds a board+worker
  report (`hook-router.ts:5853`; `server/mcp-tools.ts:210`, `:689`).
- Fleet envelopes: `withFleetEnvelope`/`routerEnvelope` prepend a machine
  signature to every router message (`hook-router.ts:729-760`), and
  `runBoardSweep` is the periodic proactive wake (`hook-router.ts:6081`).

---

## 3. What an orchestrator must reorient from

Whatever mechanism is chosen, a fresh orchestrator needs these re-injected or
re-discoverable:

| Input | Source today | Re-injection needed? |
|---|---|---|
| Role instruction ("you are the orchestrator for `<repo>`") + absolute skill path | `hook-router.ts:4549`, `agents.ts:2650` | Yes — mandatory; this is the "skills" the operator worries about losing |
| Board state (open tickets, labels, PR/review queue) | `teax issue list --json`, `teax pr list` (skill §12) | No — rediscoverable, but a pointer safe is cheap |
| Active workers / pending permissions per repo | `paseo ls`, `paseo permit ls` (skill §3) | No — rediscoverable |
| Workspaces and worktree cleanliness | `paseo workspace ls`, git probes (skill §3/§15) | No |
| Escalation route (Front Desk id) and its liveness | `scripts/frontdesk-info` + `frontdesk.json` (skill §13) | No — rediscoverable |
| In-flight operator decisions / handoff rationale | `latest-handoff.md` (Front Desk only today) | Yes for Front Desk; **missing for orchestrators** |
| Fleet envelope semantics and reply etiquette | skill §11 | Part of the skill text |
| Uncommitted intent (claims, next planned action) | nowhere durable | Yes — the one thing a fresh session cannot rediscover |

The existing hook/sweep envelopes (`withFleetEnvelope`, `runBoardSweep`) carry
board deltas but not the reorientation prompt; they assume an already-oriented
agent.

---

## 4. Options

### Option A — Compact in place with the provider's own command

Send `/compact` (optionally with custom instructions) to the live orchestrator
via `paseo send --steer --no-wait <id> /compact`, then send a short
reorientation envelope naming the skill path and the next sweep.

- **Pros:** cheapest; preserves session identity, registry, workspace, and tool
  grants; supported today for `pi` (the live orchestrator provider), `claude`,
  `codex`, `opencode`, `omp`; no Paseo changes.
- **Cons:** not portable (ACP providers unknown; no clear command anywhere but
  Claude); the summary is provider-controlled and may not retain the skill
  pointer; auto-compaction may already have fired, making manual compaction a
  no-op; no clean way to detect success from the plugin (compaction is a
  timeline item, not a command result).
- **Verdict:** good optimization, unsafe as the only strategy.

### Option B — Router-driven respawn/rotation (fresh session, same identity)

Generalize the existing `handleUppidiReplaceOrchestrator` into a first-class
rotation protocol modeled on Front Desk's: seed a per-repo handoff snapshot,
archive the incumbent, spawn a fresh orchestrator with prompt = skill path +
handoff excerpt + board pointer, re-register, notify, and post a hand-over
comment.

- **Pros:** fully provider-agnostic; re-points at the skill file (preserves
  "skills" by construction); deterministic and testable; reuses shipped
  primitives; the board and registry are already the durable state, so little
  context is actually lost.
- **Cons:** loses conversation nuance since the last handoff; costs a spawn;
  needs a handoff-seeding step that does not exist for orchestrators yet;
  in-flight turns must be drained first.
- **Verdict:** the provider-independent backbone.

### Option C — Paseo fork-context into a fresh session

Call `buildAgentForkContext` on the incumbent at a safe boundary and pass the
returned `chat_history` attachment into `createAgent`. Highest history fidelity
of any fresh-session option.

- **Pros:** Paseo-curated summary (messages + tool calls); attachment ordering
  guarantees history precedes the new instruction; keeps the provider-agnostic
  property.
- **Cons:** `buildAgentForkContext` is **not exposed on the plugin `PaseoApi`**
  (only on the raw `DaemonClient`); boundary selection has failure modes
  ("checkpoint changed…", stale epoch); for an orchestrator whose job is board
  coordination, a transcript summary is mostly noise compared to a board
  snapshot.
- **Verdict:** attractive, but blocked on an SDK/API surface question and lower
  value than a board-native handoff.

### Option D — Hybrid: compact when supported, rotate on schedule/failure

Compact in place (A) while the provider supports it and the agent is healthy;
rotate (B) on a token threshold, on repeated compaction failure, on provider
change, or on explicit operator command.

- **Pros:** cheapest common case, deterministic fallback; a single rotation
  protocol covers all providers.
- **Cons:** two code paths; needs a trigger and a support probe.
- **Verdict:** recommended.

---

## 5. Recommendation

**Adopt Option D, with Option B as the provider-independent spine and Option A
as an optimization.**

Concretely:

1. **Rotation is the contract; compaction is an optimization.** Build one
   `orchestrator rotate` protocol that always works, mirroring Front Desk's
   `POST /frontdesk-handoff`: seed handoff → spawn replacement with skill path
   + handoff → archive incumbent → re-register → notify + hand-over comment.
   This is the thing that "preserves skills", because the spawn prompt re-points
   at `getEffectiveSkillPath("orchestrator")`.
2. **Try `/compact` first when the provider advertises or is known to support
   it**, then send a reorientation envelope (skill path + board pointer +
   Front Desk id). Detect support with the agent handle's `commands()`; fall
   back to rotation when absent, errored, or unchanged after a timeout.
3. **Trigger rotation on observable signals:** `lastUsage.contextWindowUsedTokens
   / contextWindowMaxTokens` above a configurable threshold while idle, N failed
   compactions, provider change, or operator action. Never rotate mid-turn —
   drain first (the router already tracks busy state).
4. **Keep the handoff board-native, not transcript-native.** The orchestrator's
   value is the board and its workers; `generateHandoff` already builds exactly
   that report. Reuse it, scoped to one repo.
5. **Do not pursue `buildAgentForkContext` / ACP clear** until §7's experiments
   answer whether the plugin runtime can reach the daemon client and what the
   ACP providers advertise.

Rationale: the operator's own hypothesis — "the hook/sweep messages should be
enough for them to reorient themselves from a fresh start" — is correct for
orchestrators precisely because their state is external. Compaction is a
token optimization, not the mechanism of continuity; the mechanism of
continuity is the skill pointer plus the board.

---

## 6. Implementation checklist (dispatch as-is)

All paths are under `plugins/uppidi-fleet/`. Follow the existing router/MCP
patterns and the Front Desk rotation as the reference.

**Core protocol**

- [ ] `server/hook-router.ts`: add `public async rotateOrchestrator(repo, opts)`:
  resolve workspace/model, drain/inspect active turn for the incumbent, call
  `generateHandoff` scoped to `repo` and write a per-repo snapshot (e.g.
  `latest-handoff-<sanitized-key>.md` next to `frontdesk.json`; extend
  `handoffPath()`/`writeHandoff()` or add siblings), archive the incumbent via
  `archiveAgent`, spawn via `ensureOrchestrator({repo, force:true})` with a
  prompt that injects the skill path + handoff excerpt + Front Desk id, then
  `writeOrchestrator`/`enrollRepo`, notify the new agent with
  `withFleetEnvelope(routerEnvelope(...), ...)`, and return old/new ids.
- [ ] `server/hook-router.ts`: add `public async compactOrchestrator(repo, opts)`:
  `handle.commands()` → if a `compact` command exists, `send('/compact')` with
  `activeTurnBehavior:"steer"`, wait for the compaction timeline item (bounded
  timeout), then send the reorientation envelope; return
  `{ ok, supported, compacted }`. Caller falls back to `rotateOrchestrator`.
- [ ] `server/hook-router.ts`: add HTTP `POST /orchestrator-rotate` and
  `POST /orchestrator-compact` (parse `{repo, reason?, handoffText?}`), plus
  `GET /orchestrator-rotation` status, mirroring the `/frontdesk-handoff`
  block (`hook-router.ts:7595-7619`).
- [ ] `server/agents.ts`: reuse `handleUppidiReplaceOrchestrator` as the spawn
  path; add the handoff excerpt to its prompt instead of duplicating spawn logic.

**Surface**

- [ ] `shared/contracts.ts`: add `uppidiRotateOrchestratorContract` and
  `uppidiCompactOrchestratorContract` (zod input/output) and export types.
- [ ] `index.server.ts`: register both RPC handlers.
- [ ] `server/mcp-tools.ts`: add `fleet_orchestrator_rotate` and
  `fleet_orchestrator_compact` tools (model on `fleet_handoff_generate` and
  `fleet_ensure_orchestrator`).
- [ ] `client/` Cockpit: add a per-repo "Rotate" / "Compact" action in the
  existing agent/forges tab (reuse the Replace Front Desk control pattern).

**Trigger & policy**

- [ ] `server/hook-router.ts` watchdog/sweep: when an idle orchestrator's
  `lastUsage` ratio exceeds `ORCHESTRATOR_COMPACT_THRESHOLD` (default unset or
  0.80), attempt `compactOrchestrator`; on failure or repeated threshold hit,
  `rotateOrchestrator`. Gate behind a config flag and never fire mid-turn.
- [ ] Parse an operator `/rotate` (and `/compact`) slash-command in the ticket
  comment protocol (`server/issues.ts` / hook classification) and route it like
  the existing `/hold` family (orchestrator skill §6).

**Docs & skills**

- [ ] `examples/skills/orchestrator/SKILL.md` §15: replace the abstract
  "supported Paseo/session handover mechanism" with the concrete commands and
  the handoff path.
- [ ] `README.md` §13: add an "Orchestrator rotation protocol" subsection
  modeled on §13.5, and update the control-endpoint table at §7.4.
- [ ] `docs/` (this directory): link this document from the README.

**Tests**

- [ ] `server/hook-router.test.ts`: rotation seeds a handoff, archives the
  incumbent, registers the replacement, and includes the skill path in the
  spawn prompt (injectable spawn/archive seams already exist).
- [ ] `server/hook-router.test.ts`: compaction sends `/compact` when
  `commands()` advertises it, falls back to rotation when it does not, and
  sends the reorientation envelope after success.
- [ ] `server/mcp-tools.test.ts` and `client/` tests for the new tools/actions.
- [ ] `scripts/`/determinism matrix: if the new MCP tools enter the tool list,
  update `scripts/fleet-determinism-matrix.mjs` expectations.

**Verification**

- [ ] `npm run typecheck -w @xpufx/paseo-uppidi-fleet` and
  `npm run test -w @xpufx/paseo-uppidi-fleet`.

---

## 7. Unknowns & experiments

These are stated as unknowns on purpose; do not assume support without running
them.

1. **Does the plugin server runtime expose the raw `DaemonClient`?**
   `PluginHandlerContext.paseo` is typed `PaseoApi` (`@getpaseo/plugin/dist/
   server/contracts.d.ts`), but the fleet already reaches undocumented members
   via casts (`hook-router.ts:4398`). *Experiment:* from a scratch plugin RPC,
   log `Object.keys(Object.getPrototypeOf(context.paseo))` and test
   `typeof (context.paseo as any).buildAgentForkContext`. If present, Option C
   becomes cheap; if not, reimplement curation from
   `handle.timeline.refetch()` or stay board-native.
2. **Which ACP providers actually advertise `/compact` or a clear command?**
   *Experiment:* on the live host (copilot is enabled), create a scratch ACP
   agent and call `paseo agent … commands()` / the SDK `commands()`, and record
   whether `compact`/`clear` appear. This fills the ACP rows in §2.1.
3. **Does `/clear` preserve a re-read of the skill file for `claude`?** The
   skill is only named in the spawn prompt, so a clear should lose it.
   *Experiment:* clear a Claude agent and check whether it re-reads the skill
   without a new prompt. Expectation: it does not; re-inject.
4. **Is `lastUsage.contextWindowUsedTokens` populated by `pi`/ACP providers?**
   If not, the threshold trigger in the checklist has no input and rotation must
   be schedule/operator-driven. *Experiment:* inspect `paseo ls --json` for the
   live orchestrator after a few turns.
5. **What does Paseo auto-compaction do to the spawn-prompt skill pointer?**
   Auto-compaction may retain or drop the initial user turn. *Experiment:*
   force a compaction on a `pi` orchestrator and inspect the post-compaction
   timeline for the skill path; if dropped, always follow compaction with the
   reorientation envelope.

## 8. Non-goals

- No changes to provider implementations or the Paseo SDK in this issue.
- No worker lifecycle change: workers remain ephemeral and disposable.
- No new retry/fallback of the underlying boards or workspaces.
