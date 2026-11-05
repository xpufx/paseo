# Agent Mux

Agent Mux brings multi-account quota tracking, profile management, and live rate-limit monitoring for `agent-mux` directly into Paseo.

The plugin surfaces multiplexer telemetry and account states across active streaming agent providers (`antigravity`, `opencode`, `pi`), providing live quota health, countdown timers for cooldown locks, routing event logs, and account toggle controls without leaving Paseo.

## Features and Capabilities

- **Quota & Health Dashboard**: Displays high-level health indicators (healthy, warning, exhausted), isolation mode status (bubblewrap sandbox), active cooldown locks, and per-provider account availability with on-demand connectivity probes.
- **Profile Management**: Full inventory of configured account profiles across providers, displaying authentication status (`Authenticated`, `Pending login`, `missing directory`), account emails, local directory paths, and persistent enable/disable toggles.
- **Cooldown & Rate-Limit Tracking**: Real-time countdown timers for active rate-limit locks, cooldown reasons, expiration timestamps, and scoped clear functionality to unlock accounts once refreshed.
- **Live Event Logs**: Real-time streaming log viewer showing routing decisions, failovers, and cooldown event history with event filtering (`ALL`, `SUPERVISOR`, `ROUTER`, `ERROR`) and adjustable tail depth.
- **Configuration Inspector**: Inspects global multiplexer routing policies, stream surface account modes, configuration file paths, and CLI wrapper binaries (`agy`, `opencode`, `pi`).

## Surfaces and UI

- **Sidebar Surface**: Dedicated full-featured dashboard with tabs for Dashboard, Profiles, Quota & Cooldowns, Logs, Config, and Settings.
- **Command Palette**: Quick navigation to Agent Mux surfaces and status views.

## Configuration and Settings

- **Auto-Refresh Interval**: Configurable poll interval (in seconds) for status, profiles, and active cooldowns.
- **Log Tail Depth**: Number of log lines retrieved when tailing multiplexer activity.
- **Auto-Probe on Load**: Option to trigger connectivity probes across configured profiles on initial surface open.
- **Live Countdown Display**: Toggle active countdown timers for pending cooldown locks.

## Setup and Requirements

- Requires Paseo 0.9.0 or later.
- Requires the `agent-mux` binary installed on the daemon host (available in `PATH` or `~/.local/bin`).
- Operates locally on the daemon machine via read-only CLI calls (`agent-mux status`, `profile list`, `cooldowns`, `logs`).
