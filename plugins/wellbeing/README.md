# @xpufx/paseo-wellbeing

> Operator presence tracking, circadian schedule management, and fatigue / wind-down
> alerting for [Paseo](https://github.com/getpaseo/paseo). A deterministic mathematical
> model that runs entirely inside the Paseo daemon event loop — **zero LLM tokens,
> zero model calls, zero network round-trips.**

<p align="center">
  <img src="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/wellbeing/screenshots/wellbeing.jpg" alt="Wellbeing surface in Paseo Desktop" width="560" />
</p>

> **Wellbeing is an experiment.** The available metrics and sensors are not settled yet. It currently cannot provide reliable status but is provided as an example of what may be possible as the project progresses.

`wellbeing` watches the *human* behind the fleet. It answers three questions on
every tick:

1. **Is the operator actually here?** (presence / idle / away)
2. **How long have they been heads-down without a real break?** (continuous active stretch)
3. **What time-of-day posture should the fleet adopt?** (circadian phase → fleet posture)

It then publishes the answers two ways: an interactive sidebar surface in Paseo
Desktop, and a set of RPC contracts (`wellbeing.status` et al.) that agents,
orchestrators, and the Front Desk can poll to decide *how* to talk to the operator
— quick interactive turns during desk focus, async batching during idle, composer
silence during Bed Mode.

Built on [paseo-plugin-helper](https://github.com/xpufx/paseo/tree/main/packages/paseo-plugin-helper), the shared Paseo plugin runtime.

---

## Table of contents

1. [Overview & philosophy](#1-overview--philosophy)
2. [Installation & accessing the surface](#2-installation--accessing-the-surface)
3. [End-user guide](#3-end-user-guide)
4. [Configuration](#4-configuration)
5. [Data computation & mechanics](#5-data-computation--mechanics)
6. [Fleet postures & directives](#6-fleet-postures--directives)
7. [RPC contracts & schema reference](#7-rpc-contracts--schema-reference)
8. [Runtime state & file map](#8-runtime-state--file-map)
9. [Identified gaps & TODOs](#9-identified-gaps--todos)
10. [Development](#10-development)
11. [License](#11-license)

---

## 1. Overview & philosophy

The fleet does not need an LLM to know the operator is tired. It needs arithmetic.

Most "presence aware" tooling either (a) fires an LLM call to summarise user
activity, or (b) hard-codes wall-clock schedules. `wellbeing` does neither. It is a
small, pure state machine — `PresenceTracker` — that ingests timestamped activity
pulses, persists a few counters to disk, and derives an **operator phase** and a
**fleet posture** from deterministic math over those timestamps and the operator's
configured circadian windows.

Three design commitments follow from this:

- **The daemon is the source of truth.** Presence is computed server-side in
  `index.server.ts`, not in the client. The client is a thin telemetry emitter and
  renderer; if Paseo Desktop is closed, the daemon still tracks the last-known
  activity and the circadian clock still advances.
- **Silence is a feature, not an accident.** The output of the system is a
  *directive string* broadcast to the rest of the fleet. When the operator is in
  Bed Mode the directive is to maintain composer silence and escalate only
  `priority/0-SOS`. The point is to stop the fleet interrupting a resting human.
- **Fatigue is a circuit breaker, not a nag.** A single threshold
  (`maxSessionContinuousMinutes`), a cooldown (`fatigueAlertCooldownMinutes`), and
  a snooze window gate exactly one outbound notification per breach. The system is
  designed to be quiet by default and loud only when a human is genuinely at risk
  of grinding.

> The model is intentionally *small and legible*. Everything described in
> [§5](#5-data-computation--mechanics) is implemented in
> [`server/presence.ts`](server/presence.ts) — under 400 lines, no dependencies
> beyond Node's `fs` and `child_process`.

---

## 2. Installation & accessing the surface

### Requirements

- Paseo `>=0.8.0` (declared in [`paseo-plugin.json`](paseo-plugin.json)).

### Installing it

Install from npm:

```sh
paseo plugin add npm:@xpufx/paseo-wellbeing
```

Or install directly from the Git repository:

```sh
paseo plugin add xpufx/paseo --path plugins/wellbeing
```

Then reload the daemon. On load, `index.server.ts` logs:

```
wellbeing plugin contributed: operator presence tracking & circadian wind-down live
```

### Opening the Wellbeing sidebar

The client half (`index.client.tsx`) registers a single sidebar surface:

| Property | Value |
| --- | --- |
| Surface id | `wellbeing` |
| Title | `Wellbeing` |
| Icon | `Heart` |
| Flair | `rounded` radius, `comfortable` density, `elevated` surface, 1px border |

In Paseo Desktop, open the **Wellbeing** item in the sidebar (the heart icon).
The surface opens instantly with a loading state — *"Loading operator presence
telemetry…"* — then renders the live dashboard. The status query auto-refreshes
every **5 seconds** (`refetchInterval: 5000`) while the surface is mounted.

> The surface does **not** need to be open for *core* tracking to work: the daemon
> runs its own 60 s heartbeat (see [§5.6](#56-fatigue-circuit-breaker--notifications))
> regardless of what the UI is showing. The richer client-side telemetry
> (`pointerdown` / `keydown` / `focus` listeners and the 30 s visibility
> heartbeat) only runs while the surface component is mounted, since those
> listeners are registered inside `WellbeingSurface`. The surface is a viewer plus
> manual controls.

---

## 3. End-user guide

The surface is a single scroll-free dashboard with four regions:

```
┌──────────────────────────────────────────────────────────┐
│  Operator Wellbeing                 [ DESK FOCUS ]        │  ← phase badge
│  Telemetry: UI Touch/Keyboard                             │
├──────────────────────────────────────────────────────────┤
│  Continuous Active Stretch               Limit: 180m      │
│  47 min                                                   │
│  ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░                      │  ← progress bar
│  ┌ ⚠️ Unbroken focus exceeds healthy limits. ───────────┐ │
│  │  💤 Snooze 15m                                       │ │  ← only in fatigue
│  └──────────────────────────────────────────────────────┘ │
├──────────────────────────┬───────────────────────────────┤
│  Total Active Today      │  Breaks Taken                 │
│  3h 12m                  │  4                            │
│  Window: 09:00–18:00     │  Longest: 96m                 │
├──────────────────────────┴───────────────────────────────┤
│  Fleet Posture Directive                                  │
│  Operator Status: Active (Desk Focus). …                  │
│  🌙 Wind-Down: 22:30            ☀️ Wake: 07:30             │
├──────────────────────────┬───────────────────────────────┤
│  🛌 Shift to Bed Mode     │  ⚡ Log Focus                 │
└──────────────────────────┴───────────────────────────────┘
```

### 3.1 The phase badge

Top-right. Colour and label are driven by `status.phase`:

| Phase | Badge label | Meaning |
| --- | --- | --- |
| `working` | **DESK FOCUS** | Operator is active and within a normal working stretch. |
| `extended-stretch` | **FATIGUE ALERT** | Unbroken active stretch exceeded the configured limit and is not snoozed. |
| `wind-down` | **WIND-DOWN** | Inside the wind-down→wake window; the operator should be winding down. |
| `bed-mode` | **BED MODE** | Manual override is on, or the circadian wind-down window auto-engaged Bed Mode. |
| `idle` | **AWAY** | No activity for longer than `idleTimeoutMinutes`. |

The sub-label *"Telemetry: …"* shows the **last activity source**, humanised:

| Source | Displayed as |
| --- | --- |
| `client_surface` | Surface Active |
| `client_interaction` | UI Touch/Keyboard |
| `interactive_turn` | Prompt Interaction |
| `permission_resolved` | Permission Decision |
| `manual_override` | Manual Pulse |

If no activity has ever been recorded it reads *"Telemetry: Standby"*.

### 3.2 Continuous Active Stretch card

Shows `activeStretchMinutes` (rounded), the configured limit
(`maxSessionContinuousMinutes`), and a progress bar. Bar thresholds: **warning at
75 %**, **danger at 100 %**, auto-coloured by the shared `ProgressBar`.

When the phase is `extended-stretch`, an inline alert box appears:

> ⚠️ Unbroken focus exceeds healthy limits. Take a macro-break!

with a **💤 Snooze 15m** button. Pressing it calls
`wellbeing.snooze_alert { minutes: 15 }`, which suppresses fatigue alerts and
demotes the phase out of `extended-stretch` for 15 minutes. The alert box
disappears as soon as the phase moves off `extended-stretch`.

### 3.3 Daily metrics grid (2×2)

| Tile | Source field | Notes |
| --- | --- | --- |
| **Total Active Today** | `dailyUsageMinutes` | Rendered as `Xh Ym`. Footer shows the configured `workingHours` window (display only — see gap [T7](#9-identified-gaps--todos)). |
| **Breaks Taken** | `breaksTaken` | Footer shows `longestStretchMinutes`. |

Both counters reset at local midnight (see [§5.2](#52-daily-usage--breaks)).

### 3.4 Fleet Posture Directive box

Renders `fleetDirective` verbatim, plus the configured `windDownTime` / `wakeUpTime`.
This is the exact instruction string that agents and orchestrators read from
`wellbeing.status`. See [§6](#6-fleet-postures--directives) for the five postures.

### 3.5 Action controls

| Control | Label when inactive | Label when Bed Mode active | RPC |
| --- | --- | --- | --- |
| Bed Mode toggle | **🛌 Shift to Bed Mode** | **🌙 Bed Mode Active (Resume)** | `wellbeing.toggle_bed_mode { enabled: !isBedMode }` |
| Manual pulse | **⚡ Log Focus** | (unchanged) | `wellbeing.record_activity { source: "manual_override" }` |

- **Shift to Bed Mode / Bed Mode Active (Resume)** — explicitly sets the manual
  Bed Mode override to the opposite of the current state and immediately refetches
  status. Activating Bed Mode also fires a 2fado notification if `notifyVia2fado`
  is enabled (see [§5.6](#56-fatigue-circuit-breaker--notifications)).
- **Log Focus (⚡)** — records a manual activity pulse. Use it when you are working
  but the automatic detectors can't see it (e.g. reading on another screen). It
  updates `lastActivityAt`, `lastActivitySource = manual_override`, and feeds the
  same streak/break/fatigue math as any other pulse.

---

## 4. Configuration

Settings are persisted through the standard `paseo-plugin-helper` settings
contract under the name `wellbeing.settings`, and are readable/writable via three
RPCs (see [§7.5](#75-wellbeing-settings--settingsget--update--reset)).

### 4.1 Settings fields

| Field | Type | Default | Range / format | Purpose |
| --- | --- | --- | --- | --- |
| `workingHours.start` | `HH:MM` | `09:00` | `00:00`–`23:59` | Nominal work window. **Display only today** (gap [T7](#9-identified-gaps--todos)). |
| `workingHours.end` | `HH:MM` | `18:00` | `00:00`–`23:59` | Same. |
| `windDownTime` | `HH:MM` | `22:30` | `00:00`–`23:59` | Start of the wind-down / Bed Mode window. |
| `wakeUpTime` | `HH:MM` | `07:30` | `00:00`–`23:59` | End of the wind-down / Bed Mode window (may cross midnight). |
| `bedMode` | `boolean` | `false` | — | Seed value for the manual Bed Mode override. Only applied if no override exists yet (see [§5.3](#53-circadian-phase-resolution)). |
| `maxSessionContinuousMinutes` | `integer` | `180` | `15`–`720` | Continuous-stretch fatigue threshold. |
| `idleTimeoutMinutes` | `integer` | `15` | `1`–`120` | Inactivity gap that counts as a break and resets the streak. |
| `fatigueAlertCooldownMinutes` | `integer` | `60` | `5`–`360` | Minimum time between two fatigue notifications. |
| `notifyVia2fado` | `boolean` | `true` | — | Forward fatigue / Bed Mode notices to 2fado mobile push. |

All fields are Zod-validated on write; invalid updates are rejected by the
contract. Updates are **partial merges** — send only the keys you want to change.

### 4.2 Circadian window semantics

`windDownTime → wakeUpTime` defines Bed Mode. It is evaluated by
`isTimeInWindow(currentMinutes, start, end)`:

- If `start <= end`, the window is the plain interval `[start, end]` (inclusive).
- If `start > end`, the window **wraps past midnight**: `current >= start || current <= end`.

So `22:30 → 07:30` matches 22:30–23:59 **and** 00:00–07:30. Boundary minutes are
inclusive. Times use the **daemon host's local clock**; there is no timezone field.

### 4.3 Example: night owl

```jsonc
// wellbeing.settings.update
{
  "workingHours": { "start": "12:00", "end": "22:00" },
  "windDownTime": "01:00",
  "wakeUpTime": "09:30",
  "maxSessionContinuousMinutes": 120,
  "idleTimeoutMinutes": 10
}
```

This wraps Bed Mode across midnight (01:00 → 09:30) and tightens both the
continuous-stretch and idle thresholds.

---

## 5. Data computation & mechanics

All logic lives in [`server/presence.ts`](server/presence.ts). The tracker holds a
single JSON-serialisable state object and recomputes every derived value from it on
demand.

### 5.1 Continuous active stretch (streaks, decay, breaks)

The tracker stores four relevant fields: `streakStartTs`, `lastActivityTs`,
`longestStretchSeconds`, and `breaksTakenToday`.

**First-ever pulse** (`lastActivityTs === null`):

```
streakStartTs  = now
lastActivityTs = now
lastActivitySource = source
```

Active stretch is 0, since the streak has just begun.

**Subsequent pulses** — let `idleMs = now - lastActivityTs`:

- **If `idleMs > idleTimeoutMinutes * 60_000`** → the operator was away long
  enough to count as a **break**:
  ```
  breaksTakenToday += 1
  streakStartTs     = now      // streak restarts at this pulse
  ```
  Note: the idle gap itself is **not** credited to `dailyUsageSeconds`.
- **Else if `idleMs > 0`** → the operator was continuously present, so accrue
  usage, capped at the idle timeout:
  ```
  dailyUsageSeconds += min(idleMs, idleTimeoutMinutes * 60_000) / 1000
  ```

Regardless of branch, `lastActivityTs = now` and `lastActivitySource = source` are
updated. The current stretch is then:

```ts
getActiveStretchMinutes(now):
  if no streak/lastActivity            -> 0
  if (now - lastActivityTs) > idleTimeout  -> 0    // streak has decayed
  else -> (now - streakStartTs) / 60000
```

If the current stretch (in seconds) exceeds `longestStretchSeconds`, the longest
figure is updated. **Idle interval decay is live**: a streak that has gone stale
reports 0 even before the next pulse arrives, because `getActiveStretchMinutes`
re-checks the idle gap against `idleTimeoutMinutes`.

> **Important nuance:** the streak start is *not* reset by ordinary continuous
> activity. A streak begins at the first pulse and only restarts when a pulse
> arrives after a gap longer than `idleTimeoutMinutes`. This is what makes a
> "continuous active stretch" different from "wall-clock time since first event."

### 5.2 Daily usage & breaks

On **every** `recordActivity` call the tracker computes today's local date stamp
(`YYYY-MM-DD`) via `getTodayStamp`. If it differs from the stored `lastDayStamp`
(i.e. local midnight has passed), it performs a rollover:

```
dailyUsageSeconds   = 0
longestStretchSeconds = 0
breaksTakenToday    = 0
lastDayStamp        = today
fatigueAlertCount   = 0
lastFatigueAlertTs  = null
```

`dailyUsageMinutes` in status is `round(dailyUsageSeconds / 60)`. Because usage
only accrues on a pulse (and only for the interval since the previous pulse,
capped at `idleTimeoutMinutes`), the total **undercounts** time after the most
recent event and full idle gaps — see gaps [T4](#9-identified-gaps--todos) and
[T5](#9-identified-gaps--todos).

### 5.3 Circadian phase resolution

`calculatePhase(now)` resolves in strict priority order. The first matching rule
wins:

| # | Condition | Phase |
| --- | --- | --- |
| 1 | `isBedModeActive(now)` | `bed-mode` |
| 2 | `idleMinutes > idleTimeoutMinutes` | `idle` |
| 3 | `activeStretchMinutes >= maxSessionContinuousMinutes` **and not snoozed** | `extended-stretch` |
| 4 | current local time inside `windDownTime → wakeUpTime` | `wind-down` |
| 5 | otherwise | `working` |

`isBedModeActive(now)` itself resolves as:

- If a **manual override** exists (`manualBedMode !== null`) → return it.
- Otherwise → `isTimeInWindow(now, windDownTime, wakeUpTime)` — i.e. **Bed Mode
  auto-engages inside the wind-down window**.

> **Subtlety worth knowing:** because rule 1 already claims the
> `windDownTime → wakeUpTime` window when no override is set, the
> `wind-down` phase (rule 4) is only reachable when the manual override has been
> explicitly set to `false`. With the default configuration and no manual toggle,
> nights resolve to `bed-mode`, never `wind-down`. See gap
> [T2](#9-identified-gaps--todos).

`getIdleMinutes(now)` is `max(0, (now - lastActivityTs) / 60000)`, or `0` if no
activity has ever been recorded.

### 5.4 Activity telemetry sources

`ActivitySource` is a closed enum of five values. Each pulse records where it came
from, surfaced as `lastActivitySource`:

| Source | Emitted by | Trigger |
| --- | --- | --- |
| `client_surface` | Client | Initial heartbeat when the surface opens; a **30 s** interval heartbeat while `document.visibilityState === "visible"`. The daemon's 60 s fatigue heartbeat no longer emits this (it calls read-only `evaluateFatigue()` — see gap [T3](#9-identified-gaps--todos)). |
| `client_interaction` | Client | `pointerdown`, `keydown`, and `focus` window events (throttled to one pulse per **15 s**). |
| `interactive_turn` | Server | `agent.turn_ended` where the timeline contains a `user_message` whose `clientMessageId` is absent or does **not** start with `cron_` (i.e. a real human prompt, not a scheduled one). |
| `permission_resolved` | Server | `agent.permission_resolved` — the operator acted on a permission prompt. |
| `manual_override` | Client | The **⚡ Log Focus** button. |

Client-side throttling (`lastHeartbeatRef`, 15 s) means pointer/key/focus bursts
coalesce into at most one `record_activity` call per 15 seconds. Every client pulse
triggers a status refetch so the UI stays current.

### 5.5 Fatigue circuit breaker

Evaluated via the private `maybeTriggerFatigueAlert` helper, called both inside
`recordActivity` after the streak/usage update and from the read-only
`evaluateFatigue()` heartbeat path (which advances only the cooldown bookkeeping):

```
isSnoozed = snoozedUntilTs !== null && now < snoozedUntilTs

if (activeStretchMinutes >= maxSessionContinuousMinutes && !isSnoozed):
    canAlert = lastFatigueAlertTs === null
            || (now - lastFatigueAlertTs) >= fatigueAlertCooldownMinutes * 60000
    if canAlert:
        lastFatigueAlertTs = now
        fatigueAlertCount += 1
        fatigueAlertTriggered = true
```

Key properties:

- The **snooze** suppresses both the alert and the `extended-stretch` phase, since
  `calculatePhase` and `getFleetPosture` both check `isSnoozed`.
- The **cooldown** prevents re-alerting on every subsequent pulse after a breach.
- `fatigueAlertCount` resets on the daily rollover.

`fatigueAlertTriggered` in `WellbeingStatus` is **derived** — it is
`phase === "extended-stretch"` rather than the raw per-call flag. During a cooldown
window (still fatigued but already alerted), status will report
`fatigueAlertTriggered: true` even though no new notification was dispatched. See
gap [T9](#9-identified-gaps--todos).

### 5.6 Fatigue circuit breaker & notifications

When a fatigue alert fires and `notifyVia2fado` is enabled,
`index.server.ts` dispatches:

```
2fado notify --summary "⚠️ Operator Wellbeing: Continuous high-intensity session reached Nm. Consider taking a break or enabling Bed Mode." --link http://localhost:3000
```

via `execFile` (`send2fadoNotice`). Success/failure is swallowed — the plugin never
throws on a notification failure.

There are three notification sites:

1. **Manual/auto Bed Mode activation** (in the `toggle_bed_mode` handler) —
   `"🌙 Bed Mode Activated: Fleet in custodial off-hours posture. Interactive queries deferred to morning."`
2. **First fatigue breach** — dispatched from the `record_activity` handler when
   `recordActivity` returns `fatigueAlertTriggered: true`.
3. **Daemon heartbeat** — every **60 s** (`setInterval`), if the current phase is
   `extended-stretch` and `notifyVia2fado` is on, the daemon calls the read-only
   `PresenceTracker.evaluateFatigue()` and, if that call produced an alert, sends the
   same fatigue notice. The heartbeat is cleared on plugin teardown.

> The heartbeat exists to catch the case where no further client pulses arrive
> while the operator remains fatigued. `evaluateFatigue()` is **read-only**: it
> recomputes the active stretch from existing state and only advances the
> fatigue-alert cooldown, so it never refreshes `lastActivityTs`, accrues
> `dailyUsageSeconds`, or extends the streak. This means a genuinely idle operator
> reaches `idle` after `idleTimeoutMinutes` even with the ticker running.
> See gap [T3](#9-identified-gaps--todos) (resolved).

### 5.7 Persistence & migration

Two distinct files are involved.

**Settings** (via `PluginStorage`):

```
~/.paseo/plugin-data/xpufx/wellbeing/settings.json
```

**Presence state** (managed directly by `PresenceTracker`):

```
canonical: ~/.paseo/plugin-data/xpufx/wellbeing/wellbeing-state.json
legacy:    ~/.config/paseo/wellbeing-state.json
```

Resolution at construction time (`PresenceTracker`):

1. If an explicit `stateFilePath` option is provided (tests) → use it.
2. Else if the **canonical** file exists → use it.
3. Else if the **legacy** file exists → copy it to the canonical location
   (creating parent directories), then use the canonical path; if the copy fails,
   fall back to reading/writing the legacy path in place.
4. Else → use the canonical path (file created on first save).

Writes are **atomic**: state is serialised to `<path>.tmp.<timestamp>`, then
`rename`d over the target. All disk errors are swallowed — persistence is
best-effort and never blocks the event loop.

Legacy migration is covered by a regression test (`#446`) in
[`server/presence.test.ts`](server/presence.test.ts).

### 5.8 Persisted state shape

`PresenceStateData` (the on-disk JSON):

| Field | Type | Meaning |
| --- | --- | --- |
| `lastActivityTs` | `number \| null` | Epoch ms of the last pulse. |
| `lastActivitySource` | `ActivitySource \| null` | Source of the last pulse. |
| `streakStartTs` | `number \| null` | Epoch ms the current streak began. |
| `longestStretchSeconds` | `number` | Longest continuous stretch today (seconds). |
| `breaksTakenToday` | `number` | Breaks recorded since local midnight. |
| `snoozedUntilTs` | `number \| null` | Snooze expiry, epoch ms. |
| `dailyUsageSeconds` | `number` | Accumulated active seconds today. |
| `lastDayStamp` | `string` | `YYYY-MM-DD` stamp of the current day. |
| `lastFatigueAlertTs` | `number \| null` | Last alert dispatch, epoch ms. |
| `fatigueAlertCount` | `number` | Alerts dispatched today. |
| `manualBedMode` | `boolean \| null` | `null` = automatic (circadian); `true`/`false` = sticky override. |

---

## 6. Fleet postures & directives

`getFleetPosture(now)` mirrors the phase resolution but with its own priority order
and names:

| # | Condition | Posture |
| --- | --- | --- |
| 1 | Bed Mode active | `bed-mode-custodial` |
| 2 | `idleMinutes > idleTimeoutMinutes` | `idle-standby` |
| 3 | `activeStretchMinutes >= maxSessionContinuousMinutes` **and not snoozed** | `extended-stretch` |
| 4 | current time inside `windDownTime → wakeUpTime` | `wind-down` |
| 5 | otherwise | `active-focus` |

`getFleetDirective(now)` maps posture → instruction string. These strings are the
contract by which the rest of the fleet is expected to adjust behaviour:

| Posture | Directive |
| --- | --- |
| `bed-mode-custodial` | *"Operator Status: Bed Mode (Rest/Mobile). Front Desk holds autonomous custody. Fleet maintains composer silence. Escalate ONLY priority/0-SOS to Front Desk."* |
| `wind-down` | *"Operator Status: Circadian Wind-Down. Prefer async batching and issue updates over interactive interruptions. Silence non-blockers."* |
| `extended-stretch` | *"Operator Status: Extended High-Intensity Session. Operator fatigue threshold exceeded; keep messages ultra-concise."* |
| `idle-standby` | *"Operator Status: Away / Idle. Batch non-urgent notifications."* |
| `active-focus` | *"Operator Status: Active (Desk Focus). Interactive prompts and quick turnarounds."* |

### How agents & orchestrators are expected to respond

- **`active-focus`** — the normal mode. Interactive prompts and quick turnarounds
  are welcome.
- **`extended-stretch`** — the operator is fatigued. Keep messages ultra-concise;
  avoid open-ended questions.
- **`wind-down`** — prefer async batching and issue updates over blocking
  interaction. Silence non-blockers.
- **`bed-mode-custodial`** — the fleet maintains **composer silence**. Interactive
  queries are held for morning; only `priority/0-SOS` may be escalated to the
  Front Desk. This is the posture that stops the fleet waking a sleeping operator.
- **`idle-standby`** — the operator is away. Batch non-urgent notifications.

> **Reality check:** the directive is a *string contract*. The plugin broadcasts
> it, but there is currently **no enforcement hook** that intercepts composer
> submissions or muting in Bed Mode — consuming agents/orchestrators must honour
> it themselves. See gap [T1](#9-identified-gaps--todos).

---

## 7. RPC contracts & schema reference

All contracts are defined in [`shared/contracts.ts`](shared/contracts.ts) using
`paseo-plugin-helper`'s `defineContract` / `defineSettingsContract`. Zod schemas
validate both input and output.

### 7.1 `wellbeing.status`

Current operator presence, continuous-session metrics, and circadian phase.

**Input:** `{}` (empty object)

**Output — `WellbeingStatus`:**

| Field | Type | Description |
| --- | --- | --- |
| `phase` | `"working" \| "extended-stretch" \| "wind-down" \| "bed-mode" \| "idle"` | Resolved operator phase. |
| `fleetPosture` | `"active-focus" \| "extended-stretch" \| "wind-down" \| "bed-mode-custodial" \| "idle-standby"` | Resolved fleet posture. |
| `fleetDirective` | `string` | Human/agent-readable directive (see [§6](#6-fleet-postures--directives)). |
| `isBedMode` | `boolean` | Effective Bed Mode (manual override or circadian). |
| `activeStretchMinutes` | `number` | Current continuous stretch, rounded. `0` if decayed. |
| `longestStretchMinutes` | `number` | Longest stretch today, rounded. |
| `breaksTaken` | `number` | Breaks today. |
| `idleMinutes` | `number` | Minutes since last activity, rounded. |
| `dailyUsageMinutes` | `number` | Accumulated active minutes today, rounded. |
| `lastActivityAt` | `string \| null` | ISO-8601 timestamp of last pulse. |
| `lastActivitySource` | `ActivitySource \| null` | Source of last pulse. |
| `streakStartedAt` | `string \| null` | ISO-8601 start of current streak. |
| `fatigueAlertTriggered` | `boolean` | **Derived:** `phase === "extended-stretch"`. |
| `fatigueAlertCount` | `number` | Alerts dispatched today. |
| `snoozedUntil` | `string \| null` | ISO-8601 snooze expiry. |
| `settings` | `WellbeingSettings` | Full effective settings snapshot. |

### 7.2 `wellbeing.toggle_bed_mode`

Toggle or explicitly set Bed Mode posture.

**Input:**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean \| undefined` | no | Explicit target. Omit to invert the *effective* current state. |

**Output:**

| Field | Type | Description |
| --- | --- | --- |
| `isBedMode` | `boolean` | Effective Bed Mode after the call. |
| `phase` | `OperatorPhase` | Recomputed phase. |
| `fleetPosture` | `FleetPosture` | Recomputed posture. |
| `fleetDirective` | `string` | Recomputed directive. |

**Side effects:** sets the sticky `manualBedMode` override; persists state; if the
result is Bed Mode **and** `notifyVia2fado` is on, dispatches a 2fado notice. Once
set, the override persists across restarts and is not cleared by the circadian
clock (see gap [T2](#9-identified-gaps--todos)).

### 7.3 `wellbeing.record_activity`

Record a human-operator or interactive-client activity pulse.

**Input:**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `source` | `ActivitySource \| undefined` | no | `client_interaction` | Where the pulse came from. |

**Output:**

| Field | Type | Description |
| --- | --- | --- |
| `ok` | `boolean` | Always `true` on success. |
| `activeStretchMinutes` | `number` | Rounded stretch after the pulse. |
| `source` | `ActivitySource` | Echoed source. |

**Side effects:** daily rollover if needed; streak/break/usage update; longest
stretch update; fatigue evaluation; state persistence; 2fado notice on a fresh
breach.

### 7.4 `wellbeing.snooze_alert`

Snooze fatigue alerts.

**Input:**

| Field | Type | Required | Default | Range |
| --- | --- | --- | --- | --- |
| `minutes` | `integer` | no | `15` | `1`–`180` |

**Output:**

| Field | Type | Description |
| --- | --- | --- |
| `ok` | `boolean` | Always `true`. |
| `snoozedUntil` | `string` | ISO-8601 expiry (`now + minutes`). |

**Side effects:** sets `snoozedUntilTs`, persists state, and (while active)
suppresses both `extended-stretch` phases and fatigue alerts.

### 7.5 `wellbeing.settings` — `.get` / `.update` / `.reset`

Registered via `registerSettingsRpc` against `wellbeingSettingsContract`
(name `wellbeing.settings`). Three concrete RPCs are exposed:

| RPC | Input | Output | Behaviour |
| --- | --- | --- | --- |
| `wellbeing.settings.get` | `void \| {}` | `WellbeingSettings` | Reads persisted settings. |
| `wellbeing.settings.update` | Partial `WellbeingSettings` | `WellbeingSettings` | Merges the partial, validates, persists, and calls `tracker.updateSettings`. |
| `wellbeing.settings.reset` | `void \| {}` | `WellbeingSettings` | Restores schema defaults and calls `tracker.updateSettings`. |

On `update`/`reset`, `onUpdate` calls `tracker.updateSettings(next)`, which
re-seeds `manualBedMode` from `settings.bedMode` **only when no manual override
exists**. It also logs `wellbeing settings updated`.

> The client surface reads settings from the `wellbeing.status` payload, not from
> `settings.get`, so the two are always consistent within one status poll.

---

## 8. Runtime state & file map

| Path | Contents | Managed by |
| --- | --- | --- |
| `~/.paseo/plugin-data/xpufx/wellbeing/settings.json` | User settings (`WellbeingSettings`). | `PluginStorage` |
| `~/.paseo/plugin-data/xpufx/wellbeing/wellbeing-state.json` | Presence counters & timestamps (`PresenceStateData`). | `PresenceTracker` (atomic writes) |
| `~/.config/paseo/wellbeing-state.json` | **Legacy** state; auto-migrated once to the canonical path. | `PresenceTracker` (read-only after migration) |

Source layout:

```
plugins/wellbeing/
├── index.server.ts        # daemon entry: settings storage, RPC handlers, event wiring, heartbeat
├── index.client.tsx       # client entry: initClientHelpers + sidebar surface registration
├── client/
│   ├── surface.tsx        # WellbeingSurface React component (dashboard + controls)
│   └── entry.test.ts      # static test: entry injects required host deps
├── server/
│   ├── presence.ts        # PresenceTracker: the deterministic model
│   └── presence.test.ts   # unit tests: circadian math, streaks, fatigue, bed mode, migration
├── shared/contracts.ts    # Zod schemas + RPC contract definitions
├── paseo-plugin.json      # plugin id + Paseo version requirement
└── package.json           # workspace package, test/typecheck scripts
```

---

## 9. Identified gaps & TODOs

These are known limitations of the current implementation, in rough priority
order. They are **not** bugs fixed elsewhere — they are candidates for future
work. Each is annotated with the file it would touch.

- [ ] **T1 — Fleet directive has no enforcement hook.** `fleetDirective` is
  broadcast as a string; nothing in the plugin intercepts composer submissions,
  mutes notifications, or blocks turns while in `bed-mode-custodial`. The
  "composer silence" guarantee depends entirely on consuming agents honouring the
  directive. *(`index.server.ts`, cross-plugin integration.)*
- [ ] **T2 — Manual Bed Mode override is sticky and cannot be returned to auto.**
  Once `toggle_bed_mode` is called, `manualBedMode` is non-`null` forever and the
  circadian auto-Bed window is bypassed permanently (and the `wind-down` phase /
  posture becomes unreachable). There is no RPC to clear the override back to
  `"auto"`; `settings.update` only seeds it when it is already `null`. Add a
  tri-state option or a `wellbeing.clear_bed_mode_override` RPC.
  *(`shared/contracts.ts`, `server/presence.ts`.)*
- [x] **T3 — 60 s heartbeat feeds `client_surface` activity, potentially
  masking genuine idle.** **Resolved (#562).** The fatigue heartbeat now calls the
  read-only `PresenceTracker.evaluateFatigue()`, which recomputes the active stretch
  without refreshing `lastActivityTs` or accruing `dailyUsageSeconds`. `recordActivity`
  is reserved for genuine activity sources (`client_surface` RPC, `interactive_turn`,
  `permission_resolved`), so genuine idle now elapses and `extended-stretch`
  terminates as expected. *(`index.server.ts`, `server/presence.ts`.)*
- [ ] **T4 — `dailyUsageSeconds` undercounts.** Usage only accrues on the
  interval between consecutive pulses, and each interval is clamped to
  `idleTimeoutMinutes`. Time after the last pulse, and full idle gaps (which are
  breaks and credited zero), are never added. Daily totals are therefore a lower
  bound. *(`server/presence.ts`.)*
- [ ] **T5 — Streak decay is computed lazily on read.** There is no background
  tick that resets `streakStartTs` when a streak goes stale; the value is only
  zeroed by `getActiveStretchMinutes`/`getFleetPosture` re-checking the idle gap.
  This is correct but means the persisted `streakStartTs` can reference a long-dead
  streak until the next pulse. *(`server/presence.ts`.)*
- [ ] **T6 — No historical analytics, trends, or export.** State keeps only
  today's counters plus last-alert timestamps. There is no rolling-day history, no
  weekly fatigue trend, and no export/`wellbeing.history` RPC. *(`server/presence.ts`,
  `shared/contracts.ts`.)*
- [ ] **T7 — `workingHours` is display-only.** It renders in the UI but does
  not participate in phase, posture, or fatigue math. Either wire it into a
  "within working hours" signal or document/remove it. *(`server/presence.ts`,
  `client/surface.tsx`.)*
- [ ] **T8 — No multi-device presence sync.** `manualBedMode`, streaks, and
  usage are local to each daemon host's `~/.paseo` directory. Working in Paseo
  Desktop on two machines produces two independent, divergent presence models.
  *(`server/presence.ts`, requires a sync/transport design.)*
- [ ] **T9 — `fatigueAlertTriggered` in status is derived, not event-accurate.**
  `getStatus` reports it as `phase === "extended-stretch"`, so it is `true`
  throughout a cooldown even when no notification was sent for that poll.
  Distinguish "currently fatigued" from "alert just dispatched". *(`server/presence.ts`.)*
- [ ] **T10 — No in-app fatigue surface beyond the inline card.** Alerts go
  only to 2fado; there is no Paseo toast, modal, or `AttentionBeacon` when the
  operator is looking at a different surface. *(`client/surface.tsx`.)*
- [ ] **T11 — No Pomodoro / work-rest interval scheduling.** The model tracks
  a single continuous stretch and threshold; it does not enforce or suggest
  repeating focus/break intervals. *(`server/presence.ts`, `shared/contracts.ts`.)*
- [ ] **T12 — Version drift.** `WELLBEING_VERSION` in
  `shared/contracts.ts` is `0.2.1` while `package.json` is `0.1.0`. Reconcile the
  two (ideally generate one from the other). *(`shared/contracts.ts`,
  `package.json`.)*
- [ ] **T13 — No automated bed-mode scheduling.** Bed Mode only engages via the
  manual toggle or the fixed `windDownTime` window; there is no "auto-enable after
  N minutes idle" or calendar-driven scheduling. *(`server/presence.ts`.)*
- [ ] **T14 — Timezone is implicit.** All window math uses the daemon host's
  local clock; there is no configurable timezone for travelling operators or
  remote daemons. *(`server/presence.ts`, `shared/contracts.ts`.)*
- [ ] **T15 — Heartbeat and notification paths are untested.** Unit tests cover
  `PresenceTracker` thoroughly, but the 60 s heartbeat, 2fado dispatch, and event
  wiring in `index.server.ts` have no coverage. *(`index.server.ts` tests.)*

---

## 10. Development

```bash
# Typecheck + unit tests (presence model, circadian math, migration, entry contract)
npm test --workspace=plugins/wellbeing

# Typecheck only
npm run typecheck --workspace=plugins/wellbeing
```

The test suite is executed with `node:test` via `tsx` and asserts:

- `parseMinutes` / `isTimeInWindow`, including midnight-wrapping windows.
- Streak tracking and source attribution.
- Break recording and streak reset after idle-timeout gaps.
- Fatigue-threshold triggering and snooze suppression.
- Background `evaluateFatigue()` checks leave `lastActivityTs`, usage, and streak
  state untouched, and `extended-stretch` still transitions to `idle` after the
  idle timeout while the 60 s ticker runs (`#562`).
- Manual Bed Mode toggling and fleet directives (including the `priority/0-SOS`
  escalation text).
- Legacy `~/.config/paseo` → canonical `~/.paseo` state migration (`#446`).
- Static verification that `index.client.tsx` injects the required host deps.

When adding behaviour, extend `PresenceTracker` with pure, injectable `now`
parameters (as the existing methods do) so the model stays testable without
mocking the clock.

---

## 11. License

MIT — see [LICENSE](LICENSE).
