Top adds real-time host resource telemetry and session performance metrics directly to the Paseo composer trackbar, conversation timeline, and an interactive dashboard modal.

The plugin displays live CPU and memory utilization, system load averages (1m, 5m, 15m), active agent turns, token consumption, and cost telemetry. An interactive dashboard modal provides visual resource gauges, multi-host fleet telemetry, workspace context, and configurable metric routing.

## Capabilities and Data Access

- **Host Resource Telemetry**: Samples CPU usage, memory utilization (including Linux `/proc/meminfo` available memory), load averages, host uptime, and core counts via local OS interfaces.
- **Agent and Turn Telemetry**: Monitors active agent session metadata (model, provider, turn counts, input/output/cached tokens, execution error counts) and can stamp a summary card into the session timeline upon turn completion.
- **Display Modes**: Supports Cycle Mode (rotates through metrics on a configurable interval), All-in-One Mode (unified ticker), and Multiple Mode (side-by-side pills).
- **Multi-Host Telemetry**: When configured with multiple daemon hosts, queries registered hosts bounded to one probe per host on a 15-second cadence with a 4-second timeout to report online/offline status and host latency.
- **Custom Metrics**: Supports user-defined metrics via declarative `.jsonc` definitions in scoped plugin storage (`~/.paseo/plugin-data/xpufx/top/pills/`) with optional periodic command execution and threshold status mapping.

## Setup and Requirements

- Runs on the Paseo daemon and requires Paseo 0.9.0 or later.
- Telemetry sampling runs locally on the daemon host (Linux, macOS, Windows).
- All plugin persistent configuration is stored within scoped plugin storage.
