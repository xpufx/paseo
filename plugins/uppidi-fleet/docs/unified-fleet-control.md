# Unified fleet control: one mode, five axes, event-class policy

**Status:** Design — decision-grade, docs only (no behavior change)
**Issue:** [xpufx-org/paseo#1034](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1034)
**Related:** [#994](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/994) (canonical ALL HALT), [#1013](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1013) (HALT/RESUME controls), [#1033](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1033) (announce mode transitions), [#1019](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1019) (agent rotation/compaction)
**Supersedes:** the `PAUSE` / `HALT` / `STOP` / `TEARDOWN` tangle.

All `file:line` references are relative to `plugins/uppidi-fleet/` unless noted. Line numbers are
the current tree at the time of writing (`hook-router.ts`, `agents.ts`, `contracts.ts`).

---

## 0. Decision summary

1. **One stored lifecycle value: `mode`.** `RUN | DRAIN | HALT | STOP`, plus one surgical
   per-repo override (`pausedRepos`). `HOLD` is accepted as a request alias for `HALT` — see §4.
2. **Five orthogonal axes** replace the bundled booleans: ingress, dispatch, provisioning,
   observability, lifecycle (§2). Every mode is a vector over the axes, so combinations stop
   being ambiguous.
3. **Event classes gate delivery**, not the mode alone. Six classes — `sos`, `administrative`,
   `health`, `attention`, `work`, `noise` — and a per-mode default policy (§3).
4. **Observability detect always runs.** Only `STOP` (daemon down) suppresses detection;
   `HOLD`/`HALT`/`DRAIN` observe but do not remediate. This is the testable invariant (§5).
5. **Ingress never drops.** `HALT` must **accept + durably persist** events and fire them on
   resume. Today it drops the event and fakes `200 { queued: true }`, which is lossy and is the
   core of this ticket (§6).
6. **Fire-once vs idempotent is first-class.** Forgejo Actions events are delivered once and are
   never re-sent; they must never be dropped by any mode, only persisted + replayed or explicitly
   recorded as lost. Idempotent board events can be re-derived (§7).
7. **Teardown is not a mode.** It is a Lifecycle operator action that transiently drives the mode
   to `HALT` while it culls agents, then restores the prior mode (§4.4).

---

## 1. Why this exists: the incident, grounded

On 2026-10-06 a fleet teardown called `router.halt()`. `halt()` does four unrelated things at once
(`server/hook-router.ts:6451`):

```ts
public halt(): void {
  this.isHaltedState = true;
  this.pause("all");
  this.stopBackgroundLoops();
  ...
}
```

Because `stopBackgroundLoops()` kills the watchdog and board sweep (`server/hook-router.ts:6255`)
and `isHaltedState` makes `runWatchdogAudit()` return an empty result
(`server/hook-router.ts:5128`) and `runBoardSweep()` return `swept: 0`
(`server/hook-router.ts:6128`), the very loop that would surface a wedged agent was killed by a
halt that was only meant to stop work. A `runner-containers` orchestrator stuck on a `pi`
"Yes/No" permission dialog went unreported for 30+ minutes and was only found by manually running
`paseo permit ls`.

`HALT` is four concerns behind one bit. It cannot express "stop dispatching work but keep watching
for wedged agents", which is the exact thing the operator needed.

---

## 2. Current control inventory (grounded)

| Control | Code | What it actually does today |
| --- | --- | --- |
| Queue `PAUSE` | `pause()` `hook-router.ts:6379`; `resume()` `:6399` | Global pause sets `allQueuesPaused` and adds every queue key, enrolled repo and `frontdesk` to `pausedQueues` (`:6381`–`:6392`). **Ingress is untouched** — `ingestWebhook` doesn't consult pause; `enqueue` still persists and then skips `drain` when the repo is paused (`:6369`). Delivery suppressed by `drain` (`:7054`, guards at `:7065`/`:7070`). Safe: hold, never drop. |
| `HALT` (#994) | `halt()` `hook-router.ts:6451`; `isHalted()` `:6459` | Sets `isHaltedState`, calls `pause("all")`, `stopBackgroundLoops()`. Ingress: `ingestWebhook` returns `suppressed` **before** `enqueue` (`:2967`–`:2970`). Provisioning disabled: `ensureOrchestrator` (`:4508`), `ensureUnstaffedEnrolledRepo` (`:3652`). Detection loops short-circuited (`:5128`, `:6128`) and stopped (`:6255`). Dispatch suppressed via `isPaused()` (`:6435`, `:6442`). |
| `STOP` (kill hook script) | `server/hook.ts:298` (`start|stop|restart|reload`), daemon service stop | The process is no longer listening. Not a router state today; nothing is persisted. |
| Teardown | `handleFleetTeardown` `server/agents.ts:1137` | `markTeardownStart()` (`:1144`) → `router.halt()` (`:1165`) → optional drain-wait (`:1170`–`:1194`) → queue the notice (`:1205`) → `archiveAgentById` per agent (`:1221`, def `:1105`) → delete frontdesk/orchestrator state (`:1244`+) → `markTeardownEnd()` (`:1452`). `teardownInProgress` blocks `resume()` (`:6400`) and `resumeAll()` (`:6487`). |
| Per-repo pause | `isRepoPaused` `:3520`; `pauseRepo` `:3534`; `toggleRepoPause` `:3553` | The one genuinely surgical override; persisted via `saveConfigState()` (`:3696`) → `pausedRepos` (`contracts.ts:1542`). |

**The asymmetry that is the core of this ticket:** `PAUSE` holds (safe); `HALT` drops + fakes an ack
(lossy). At `server/hook-router.ts:7828` the `/forgejo` handler unconditionally replies
`200 { ok: true, queued: true }` even when `ingestWebhook` returned `suppressed`, so Forgejo never
redelivers — the event is silently lost.

---

## 3. The five axes

Each axis is independently observable and independently assertable in a test.

| Axis | Question | Values | Code seam |
| --- | --- | --- | --- |
| **Ingress** | Do we accept the delivery? | `accept` (persist + classify) — `drop` is **removed** from the vocabulary | `ingestWebhook` `:2955`; `/forgejo` handler `:7828` |
| **Dispatch** | Do we deliver queued `work` to agents? | `on` / `off` | `drain` `:7054`; `enqueue` `:6369`; `isPaused` `:6435` |
| **Provisioning** | Do we auto-spawn / replace agents? | `on` / `off` | `ensureOrchestrator` `:4508`; `ensureUnstaffedEnrolledRepo` `:3652` |
| **Observability** | Do detect loops run, and do they remediate? | `detect` / `detect+remediate` / `off` | `runWatchdogAudit` `:5127`; `runBoardSweep` `:6127`; `planWatchdogRecovery` `:2402`; quota circuit-break `:2085` |
| **Lifecycle** | What happens to running agents? | `leave` / `drain` / `cull` | `handleFleetTeardown` `agents.ts:1137`; `archiveAgentById` `agents.ts:1105` |

`Ingress = drop` is forbidden by construction because of the fire-once constraint (§7). The only
question ingress answers is *deliver now* vs *persist and hold*.

---

## 4. Named profiles

### 4.1 Mode → axis vector

| Mode | Ingress | Dispatch (`work`) | Provisioning | Observability | Lifecycle |
| --- | --- | --- | --- | --- | --- |
| `RUN` | accept + persist | `on` | `on` | `detect + remediate` | `leave` |
| `DRAIN` | accept + persist; **new** `work` held, **snapshot** dispatched | `drain-snapshot → off` | `off` | `detect` | `leave` |
| `HALT` (alias `HOLD`) | accept + persist (hold) | `off` | `off` | `detect` | `leave` |
| `STOP` | process down — cannot accept | `off` | `off` | `off` | `leave` |

**Dispatch axis governs the `work` class only.** `sos`, `administrative`, `attention` and `health`
are delivered by their own class policy regardless of the dispatch axis (§5). This is a deliberate
change from today, where a queue pause gates everything — including the attention that would have
surfaced the incident.

### 4.2 `DRAIN` vs `HALT`

`DRAIN` is **not** "stop now". On entry it captures a watermark: the ids of every `work` entry
already queued are marked dispatchable; entries enqueued after the watermark are held. The router
dispatches the snapshot to completion and then behaves as `HALT`. This answers the open question
from the ticket: **`HOLD`/`HALT` and `DRAIN` do not collapse** — they differ on the dispatch axis
(freeze the backlog vs finish it), and the watermark is the durable discriminator.

### 4.3 `HOLD` vs `HALT` — they collapse; keep one storage value

Under unified ingress semantics both `HOLD` and `HALT` must accept + persist and hold `work`, and
the ratified invariant keeps both detect-only. They are the same axis vector. Rather than ship two
identical modes (the "one more flag" failure mode this ticket exists to remove):

- **`HALT` is the canonical stored value.**
- **`HOLD` is accepted as a request alias and mapped to `HALT`.** Existing `pause("all")`
  callers and any operator vocabulary that says "hold" keep working; storage and `GET /status`
  report `halt`.
- `HOLD` is retained only as an input synonym, never a second state. This is the explicit answer
  to "Is `HOLD` distinct enough from `DRAIN`, or do they collapse?": `HOLD` collapses into `HALT`;
  `DRAIN` is distinct on dispatch.

### 4.4 The one surgical per-repo override

`pausedRepos` / `toggleRepoPause` (`hook-router.ts:3553`, contract
`contracts.ts:1345`) stays exactly as it is, and is the **only** per-repo exception surface.
Semantics under the new model: per-repo pause behaves like a per-repo `HALT` on dispatch, but
ingress still accepts + persists. It is orthogonal to `mode` and can coexist with any mode.

### 4.5 Teardown is a Lifecycle action, not a mode

Teardown answers "cull agents", which is the Lifecycle axis, not a lifecycle *state*. In the new
model `handleFleetTeardown` (`agents.ts:1137`):

1. `markTeardownStart()` (retained, `:1144`) — the window guard that blocks `resume()`.
2. Set `mode = HALT` for the duration (instead of calling raw `halt()` at `:1165`).
3. Perform the optional graceful drain-wait (`:1170`–`:1194`).
4. Cull via `archiveAgentById` (`:1221`).
5. `markTeardownEnd()` (`:1452`) and **restore the prior mode** (or leave `HALT` if the operator
   asked for a terminal stop).

This answers "Where does teardown belong?" — a Lifecycle operator action that transiently drives
the mode, not a fourth state.

---

## 5. Event classes and per-mode policy

### 5.1 The six classes

Classification is by **event type + action + label + author**, in that precedence. Today's seed
already exists:

- `isFrontDeskEvent` (`hook-router.ts:348`) — `attention/frontdesk`, user attention labels
  (`USER_ATTENTION_LABELS` `:341`), and `/frontdesk` in a comment.
- `isBypassEvent` (`:360`) — `attention/*`, `ping/*`, `BYPASS_LABELS` (`:358`),
  and slash commands (`SLASH_BYPASS_RE` `:357`).
- `sosStateOf` (`:385`) — dedupes SOS label transitions so only the first delivery interrupts.
- `eventKind` (`:713`) — `event:action`, with `state-transition` for `state/`|`priority/`|`flag/`
  label edits.
- Self-authored suppression (`:2994`–`:3000`) — routine orchestrator comments are demoted.

| Class | Members | Properties |
| --- | --- | --- |
| `sos` | `priority/0-sos`, `priority/sos`, `flag/stop-work` (`SOS_STATE_LABELS` `:359`); `/sos`, `/stop` (`:357`) | Fire-once-ish, must interrupt, bypasses debounce/coalescing |
| `administrative` | halt / resume / mode change / config / teardown commands | Must always be accepted and executed, **even under HALT**, or the fleet cannot be resumed |
| `health` | watchdog findings, permission sweep, quota circuit-break (`:2085`), wedge/attention anomalies | Generated internally, not from a webhook; detect + alert channel (`deliverWatchdogAlert` `:4038`) |
| `attention` | `attention/frontdesk`, `attention/2-user`, `/frontdesk`, `ping/*` | Human/Front Desk interrupt; not work |
| `work` | issue / PR / CI dispatchable events (both idempotent and fire-once) | The class the dispatch axis gates |
| `noise` | routine self-authored comments/edits (the `:2994` suppression) | Idempotent; safe to drop |

### 5.2 Per-mode policy

Each mode yields a default `eventClassPolicy`; operators may override per class.

| Class | `RUN` | `DRAIN` | `HALT` / `HOLD` | `STOP` |
| --- | --- | --- | --- | --- |
| `sos` | deliver | deliver | deliver | n/a (process down) |
| `administrative` | deliver | deliver | deliver | n/a |
| `attention` | deliver | deliver | deliver | n/a |
| `health` | detect + remediate + alert | detect + alert | detect + alert | off |
| `work` | deliver | snapshot deliver; new held | hold (persist) | held / backfill |
| `noise` | drop | drop | drop | drop |

`deliver` bypasses the dispatch axis. `hold` means accept + durably persist, deliver on resume.
`detect` means run the detector and surface the alert; it does **not** dispatch work or remediate.
`drop` is permitted only for idempotent `noise`.

---

## 6. The invariant: observe always, act per mode

> **Observability detection ALWAYS runs. Only `STOP` suppresses it. Modes gate remediation only.**

- **Detect** — `runWatchdogAudit` (`:5127`), the permission sweep, the quota circuit-break
  (`:2085`), and `runBoardSweep` (`:6127`) keep running in `RUN`, `DRAIN`, `HALT`, and per-repo
  pause. They stop only when the process stops (`STOP`).
- **Remediate** — `planWatchdogRecovery` (`:2402`) and the recovery application
  (`hook-router.ts:~5080`) run only in `RUN`. `ensureOrchestrator` (`:4508`) and
  `ensureUnstaffedEnrolledRepo` (`:3652`) run only in `RUN`.
- Therefore a wedged agent under `HALT` **is detected and reported to the Front Desk**, but is not
  auto-stopped/steered. That is the regression test for the 2026-10-06 incident.

Today this invariant is violated in three places: the `isHaltedState` early returns at
`hook-router.ts:5128` and `:6128`, and `stopBackgroundLoops()` inside `halt()` at `:6451`/`:6255`.
All three are removed in the implementation checklist (§10).

---

## 7. Fire-once vs idempotent (Front Desk hard constraint)

Forgejo Actions events are fire-once. If the router suppresses or drops them during a mode the CI
run simply never happens and Forgejo does not re-send. This rules out treating Actions events like
issue/PR state, which can be re-queried from the board.

### 7.1 Classification

| Kind | Examples | Semantics |
| --- | --- | --- |
| **Fire-once** | Actions events (`action_run_failure` — direct-action handler `:3048`; workflow-run / `workflow_dispatch` triggers) | At-least-once: accept → durably persist → replay on resume. Never dropped. If persistence fails, fail the webhook so the sender knows. |
| **Idempotent / queryable** | `issues`, `issue_comment`, `pull_request`, `push`, `repository`, label transitions, `ping` | Can be re-derived by reconciliation (board sweep / re-query). Hold or drop is recoverable. |

### 7.2 Durable ingress, truthful ack

The design requires a single honest rule:

- **`HALT` accepts and persists; it does not drop.** `ingestWebhook` must classify first, then
  `enqueue` (which atomically persists — see below), then skip `drain`. The `isHaltedState`
  early return at `hook-router.ts:2967`–`:2970` is deleted.
- **`200 { queued: true }` means persisted.** The `/forgejo` handler (`:7828`) must only ack after
  a successful `persistQueue`. On persistence failure it must return non-2xx so the delivery is
  not silently lost.
- **The queue is already durable.** `persistQueue` (`:6308`) writes `queueDir/<key>.json` with a
  temp file + atomic `rename`; `loadPersistedQueues` (`:6270`) rehydrates on startup (called from
  `:2864` and `:7524`). So "keep the process up and queue at ingress" is a small restructure, not
  new storage.
- **Hold vs deliver is a per-entry marker**, not a separate store: entries carry
  `{ class, fireOnce, held, watermark }`. On resume, held entries whose class policy is now
  `deliver` are drained in order.

### 7.3 Two gaps to close

1. **Depth pruning silently drops.** `enqueue` prunes to 50 and increments `droppedCount`
   (`:6354`–`:6361`). Acceptable for idempotent work, **never** acceptable for fire-once Actions.
   Fire-once entries must spill to an append-only log or be exempt from pruning, and any loss must
   be explicit (surfaced through `droppedCount`, `:7345`).
2. **Backfill/reconcile.** While `STOP` (process down) no ingress is possible. On restart the
   router must reconcile: query Forgejo for Actions runs since a persisted cursor and replay any
   missed ones. A cursor (`last-seen run id` / timestamp) must be persisted alongside the queue.

---

## 8. Storage and API surface

### 8.1 Shape

- A single stored value `mode: RUN | DRAIN | HALT | STOP` (input accepts `HOLD` → `HALT`).
- `eventClassPolicy?: Partial<Record<EventClass, "deliver" | "hold" | "detect" | "drop">>` —
  optional per-class overrides; absent entries default from `mode` (§5.2).
- `pausedRepos: string[]` — the one surgical per-repo override, unchanged
  (`contracts.ts:1542`, `hook-router.ts:3696`).
- Teardown window is runtime-only (`teardownInProgress`), not stored as mode.

Persist `mode` + `eventClassPolicy` next to `pausedRepos`/`enrolledRepos` in
`saveConfigState` (`hook-router.ts:3696`) / `uppidiFleetSettingsSchema`
(`contracts.ts:1538`) so they survive restart. `HALT` must not be silently lost on restart the way
the current `isHaltedState` boolean is (it is in-memory only).

### 8.2 Read surface

- `getStatusOverview` (`hook-router.ts:7301`) and `HookStatusOutputSchema`
  (`contracts.ts:126`) expose `mode`, `eventClassPolicy`, `pausedRepos`, and
  `teardownInProgress`. Keep `halted`/`paused` populated for one release as derived aliases
  (`halted = mode === "HALT"`, `paused = pausedRepos`).
- `GET /status` remains the machine truth; `scripts/frontdesk-info` should surface `mode` as a
  first-class line (that is [#1033](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1033)'s
  scope; the field is defined here).

### 8.3 Write surface

- New canonical: `POST /mode` `{ mode, reason?, eventClassPolicy? }`.
- Compatibility (mapped, not new mechanisms):
  - `POST /queue/pause` (`hook-router.ts:7768` region) → `HALT`
  - `POST /queue/resume` → `RUN`
  - `POST /queue/drain` → `DRAIN`
  - RPC `uppidi-fleet.fleet-halt` (`contracts.ts:1508`) → `HALT`
  - RPC `uppidi-fleet.fleet-resume` (`contracts.ts:1530`) → `RUN` (or restore the pre-teardown mode)
  - RPC `uppidi-fleet.toggle-repo-pause` (`contracts.ts:1345`) → per-repo override, unchanged

### 8.4 How running agents learn the mode ([#1033](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1033))

Three surfaces, one source of truth:

1. **Announce on transition.** Mode changes are `administrative`-class fleet events delivered to
   the registered Front Desk and every registered orchestrator via the existing delivery/steer
   channel (`deliverMessage` `hook-router.ts:3896`), the same path watchdog alerts use
   (`deliverWatchdogAlert` `:4038`). The notice carries the reason/source, target scope, and, on
   resume, how long the fleet was held and what is draining.
2. **Self-describing messages.** Add `mode` to `fleetEnvelope` (`hook-router.ts:759`) so every
   queued/steered message tells a waking agent what mode the fleet is in. Agents read it from the
   envelope header rather than polling.
3. **Status.** `GET /status` (`:7301`) and `scripts/frontdesk-info`.

Because #1033 is `dep/blocked` on this design, item 1 above is the contract #1033 implements.

---

## 9. Backward-compatibility mapping

| Today | New model |
| --- | --- |
| `router.halt()` / `fleet-halt` RPC | `mode = HALT` (now non-lossy at ingress) |
| `router.resume("all")` / `fleet-resume` RPC | `mode = RUN` (or restore pre-teardown mode) |
| `pause("all")` / `POST /queue/pause` | input `HOLD` → stored `mode = HALT` |
| `pause(repo)` / `toggleRepoPause` | per-repo `pausedRepos` override (unchanged) |
| `POST /queue/resume` | clear per-repo pause; global → `mode = RUN` |
| `POST /queue/drain` | `mode = DRAIN` |
| `STOP` (kill hook script / daemon stop, `server/hook.ts:298`) | `mode = STOP`; process down, impossible to persist, recovered via backfill (§7.3) |
| `handleFleetTeardown` (`agents.ts:1137`) | Lifecycle action: transient `HALT` for the window (`markTeardownStart` `:1144`) + cull (`:1221`), restore prior mode (`markTeardownEnd` `:1452`) |
| `teardownInProgress` guard (`:6400`, `:6487`) | retained, unchanged |
| `mutedRepos` (`contracts.ts:1544`) | legacy alias of `pausedRepos` (already merged, unchanged) |

### 9.1 Knobs removed

- `isHaltedState` boolean (`hook-router.ts:2715`) → `mode`.
- `allQueuesPaused` boolean (`:2707`) + global `pausedQueues` set (`:2705`) → `mode` +
  per-repo `pausedRepos`.
- The **lossy** `isHaltedState` early return in `ingestWebhook` (`:2967`–`:2970`) and the
  unconditional `200 queued:true` ack (`:7828`).
- `halt()`'s coupling to `stopBackgroundLoops()` (`:6451`, `:6255`) → split to the observability
  axis.
- The `isHaltedState` short-circuits in `runWatchdogAudit` (`:5128`) and `runBoardSweep`
  (`:6128`).
- Depth-based silent drop for fire-once entries (`:6354`).

---

## 10. Open questions — answered or explicitly deferred

| # | Question | Resolution |
| --- | --- | --- |
| 1 | Is `HOLD` distinct enough from `DRAIN`? | **`DRAIN` is distinct** (dispatch snapshot vs freeze). `HOLD` is a request alias for `HALT`; it collapses. §4.2/§4.3 |
| 2 | Should `HALT` stop observability? | **No. Only `STOP` does.** Ratified as the testable invariant in §6. |
| 3 | Where does teardown belong? | **Lifecycle operator action**, transiently driving `mode = HALT`. §4.5. |
| 4 | Event classes by label, type, or both? | **Both, in precedence** type+action → label → author. §5.1. |
| 5 | Storage/API surface? | **Single `mode` + `eventClassPolicy` + `pausedRepos`**, persisted in settings. §8. |
| 6 | How do running agents learn the mode? | **#1033 announce + envelope header + status.** §8.4. |
| 7 | Backward compat? | **Mapping table §9.** |
| 8 | Does Forgejo retry webhooks on non-2xx? | **Deferred — experiment required.** Stand up a 500-returning endpoint and observe redelivery. The design must not depend on retries (it persists). |
| 9 | Can Forgejo Actions runs be listed for backfill? | **Deferred — experiment required.** Probe `GET /repos/{owner}/{repo}/actions/runs` for pagination and whether run metadata carries enough to replay. If not, persist raw webhook payloads in the fire-once log. |
| 10 | Disk budget for the never-drop queue? | **Deferred — experiment required.** Measure queue growth under HALT; choose append-only log vs spill vs disk cap with explicit loss accounting. |

---

## 11. Implementation checklist (dispatchable)

**A. Model + storage**
- [ ] Add `FleetMode = RUN | DRAIN | HALT | STOP` and `EventClass = sos | administrative | health | attention | work | noise` to `shared/contracts.ts`; accept `HOLD` input → `HALT`.
- [ ] Add `mode` + `eventClassPolicy` to `uppidiFleetSettingsSchema` (`contracts.ts:1538`) and persist via `saveConfigState` (`server/hook-router.ts:3696`); default `RUN`. This makes `HALT` survive restart (today `isHaltedState` does not).
- [ ] Extend `HookStatusOutputSchema` (`contracts.ts:126`) and `getStatusOverview` (`hook-router.ts:7301`) with `mode`/`eventClassPolicy`; derive `halted` from `mode`.

**B. Classifier**
- [ ] Implement `classifyEvent(event, body) → { class, fireOnce }` reusing `isFrontDeskEvent` (`:348`), `isBypassEvent` (`:360`), `sosStateOf` (`:385`), `eventKind` (`:713`), self-author check (`:2994`); mark all Actions-origin events `fireOnce`.
- [ ] Table-driven unit test over captured webhook fixtures (stable class + fire-once flag).

**C. Ingress rework (never drop)**
- [ ] Delete the `isHaltedState` early return in `ingestWebhook` (`:2967`–`:2970`); classify → `enqueue`/persist → skip `drain` per policy.
- [ ] Ack `200 { queued: true }` only after successful `persistQueue`; return non-2xx on persistence failure (`/forgejo` handler `:7828`).
- [ ] Tag queue entries with `{ class, fireOnce, held, watermark }`.

**D. Dispatch gating**
- [ ] Replace `isPaused`/`isAllPaused` checks in `drain` (`:7054`) and `enqueue` (`:6369`) with `eventClassPolicy` + `mode`.
- [ ] Implement `DRAIN` watermark: snapshot on enter, drain snapshot, hold post-watermark work; persist the watermark.

**E. Observability (the invariant)**
- [ ] Remove `stopBackgroundLoops()` from `halt()` (`:6451`); loops run whenever the process is up.
- [ ] Remove the `isHaltedState` short-circuits in `runWatchdogAudit` (`:5128`) and `runBoardSweep` (`:6128`); detect always, alert always.
- [ ] Gate `planWatchdogRecovery` (`:2402`) and recovery application on `mode === RUN`.
- [ ] Keep permission sweep and quota circuit-break (`:2085`) running in all non-`STOP` modes.

**F. Provisioning gate**
- [ ] `ensureOrchestrator` (`:4508`) and `ensureUnstaffedEnrolledRepo` (`:3652`) gate on `mode === RUN` instead of `isHaltedState`.

**G. Profiles + API**
- [ ] `POST /mode`; map `/queue/pause|resume|drain` (`:7768` region) and `fleet-halt`/`fleet-resume` (`contracts.ts:1508`/`:1530`) onto modes.
- [ ] Keep `toggleRepoPause` (`:3553`) as the sole per-repo override.

**H. Teardown**
- [ ] `handleFleetTeardown` (`agents.ts:1137`): set `mode = HALT` for the window, retain `markTeardownStart/End` (`:1144`/`:1452`), restore prior mode, keep cull (`:1221`).

**I. Announce (#1033)**
- [ ] On mode change, deliver an `administrative`-class notice to Front Desk + orchestrators via `deliverMessage` (`:3896`).
- [ ] Add `mode` to `fleetEnvelope` (`:759`).

**J. Fire-once durability + backfill**
- [ ] Exempt fire-once entries from depth pruning (`:6354`); spill to append-only storage with explicit loss accounting.
- [ ] Persist an Actions cursor; reconcile/replay missed runs on startup and on resume-from-`STOP` (pending experiment #9).

**K. Tests**
- [ ] **Observe-always regression:** wedged agent under `HALT` produces a Front Desk alert; no remediation fires.
- [ ] **Never-drop:** Action event under `HALT` is persisted, survives a router restart, and replays on `RUN`.
- [ ] **DRAIN watermark:** queued-before-drain dispatches; enqueued-after-drain holds.
- [ ] Per-class policy matrix for all modes.
- [ ] `classifyEvent` table; back-compat mapping; envelope `mode` field.

**L. Docs**
- [ ] Update the control-plane table (`README.md:489`) and mark the removed knobs in §9.1.

---

## 12. Acceptance criteria

1. A single `mode` value plus `pausedRepos` explains every fleet control state; `halted`/`paused`
   are derived aliases, not independent booleans.
2. Under `HALT`, `GET /status` reports `mode: "halt"`, the watchdog and board sweep still run and
   still alert, and no non-`sos`/`administrative`/`attention` work is dispatched.
3. An Actions event delivered while `HALT` is engaged is persisted, acknowledged truthfully, and
   delivered after resume without being re-sent by Forgejo.
4. `handleFleetTeardown` culls agents under a transient `HALT` and restores the prior mode.
5. Every mode transition is announced to the Front Desk and registered orchestrators, and every
   fleet envelope carries the current mode.

## 13. Out of scope

- Implementation of any of the above (this is a design doc).
- #1033's announce transport details beyond the contract in §8.4.
- #1019 compaction/rotation mechanics; mode transitions may *trigger* rotation, but that is #1019.
- Forgejo API backfill implementation pending experiments #8/#9.
