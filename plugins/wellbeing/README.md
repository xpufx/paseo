# @xpufx/paseo-wellbeing

> Operator presence tracking, circadian schedule management, and fatigue/wind-down alerting for Paseo.

## Features

- **Continuous Stretch Tracking**: Monitors active operator interaction streaks and idle intervals with automatic streak decay.
- **Circadian Schedule Awareness**: Tracks configurable working hours, wind-down boundaries, and wake-up times.
- **Bed Mode Posture**: One-click or circadian auto-activation of Bed Mode to shift the fleet into custodial holding posture.
- **Fatigue Circuit Breakers**: Alerts the operator via Paseo Desktop and 2fado mobile notifications when continuous high-intensity stretches exceed thresholds.
- **Zero LLM Token Cost**: Pure deterministic mathematical model running in the Paseo daemon event loop.

## RPC Contracts

- `wellbeing.status`: Returns current phase (`working`, `extended-stretch`, `wind-down`, `bed-mode`, `idle`), active stretch minutes, daily usage, and settings.
- `wellbeing.toggle_bed_mode`: Toggles manual Bed Mode override.
- `wellbeing.record_activity`: Manually records an operator or agent interaction timestamp.
- `wellbeing.settings`: Standard get/update/reset settings contract.
