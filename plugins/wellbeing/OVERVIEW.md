# Wellbeing

Wellbeing is an operator presence tracker, circadian schedule manager, and fatigue alerting engine running entirely within Paseo.

Operating without LLM tokens or external network calls, Wellbeing implements a deterministic mathematical model inside the daemon event loop to monitor operator focus stretches, detect idle periods, and compute optimal fleet postures based on circadian rhythm phases.

## Features and Capabilities

- **Deterministic Presence Tracking**: Derives operator status (`active`, `idle`, `away`) using timestamped activity pulses without machine learning inference or external services.
- **Continuous Stretch Monitoring**: Computes uninterrupted active focus time to identify sustained heads-down sessions and encourage timely breaks.
- **Circadian Phase Management**: Maps local wall-clock time and operator habits into circadian phases (Focus, Normal, Wind-Down, Bed Mode).
- **Fleet Posture Directives**: Publishes automated behavioral directives for the agent fleet:
  - *Interactive Focus*: Rapid turn turnaround and immediate clarification requests while the operator is actively present.
  - *Async Batching*: Defer low-priority questions and batch notifications when the operator is idle or away.
  - *Bed Mode Silence*: Restrict notifications and background chatter during rest periods.
- **RPC Contracts**: Exposes typed RPC methods (`wellbeing.status`, `wellbeing.record_pulse`, `wellbeing.settings`) for agent queries and client surfaces.

## Surfaces and UI

- **Sidebar Surface**: Interactive dashboard presenting current presence status, active stretch gauge, circadian phase dial, and posture directives.
- **Timeline & Composer Indicators**: Status badges showing current operator posture and recommended engagement style.

## Setup and Requirements

- Requires Paseo 0.8.0 or later.
- Computations run purely locally within the Paseo daemon process.
- All state and configuration persist in scoped plugin storage.
