# paseo-helper-demo

This plugin is a demo for showcasing some of the capabilities of
[`paseo-plugin-helper`](https://github.com/xpufx/paseo-plugin-helper) ([npm](https://www.npmjs.com/package/paseo-plugin-helper)),
namely the UI design system, lifecycle primitives, and daemon utilities for
building Paseo plugins. It does not necessarily do anything useful to end
users. Install this one to see every pattern running live; depend on the
helper to build your own.

Built on [paseo-plugin-helper](https://github.com/xpufx/paseo/tree/main/packages/paseo-plugin-helper), the shared Paseo plugin runtime.

The helper package and demo are together a demonstration of an idea: that
the plugin ecosystem can benefit from a common library, not necessarily this
common library, rather than solving the same issues again and again.

<p align="center">
  <a href="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/demo/screenshots/helper-visual-flair.png">
    <img src="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/demo/screenshots/helper-visual-flair.png" alt="Visual Flair Studio" />
  </a>
</p>

| System Metrics | About Plugin |
| :---: | :---: |
| <a href="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/demo/screenshots/helper-metric-gauges.png"><img src="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/demo/screenshots/helper-metric-gauges.png" alt="System Metrics" /></a> | <a href="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/demo/screenshots/helper-about.png"><img src="https://raw.githubusercontent.com/xpufx/paseo/main/plugins/demo/screenshots/helper-about.png" alt="About Plugin" /></a> |

> [!NOTE]
> **Prerequisites & Platform Support**:
> - The composer pill shows live host CPU; the modal covers metrics, actions, tables, beacons, settings, diagnostics, and logs.

## Showcase tabs

| Tab | Pattern it teaches |
| :--- | :--- |
| Gauges & Hardware | `MetricGauge`, `ProgressBar`, `KeyValueGroup`, auto-refresh polling with selectable cadence |
| Visual Flair Studio | Live theme/flair customizer (`radius`, `density`, `surface`, `borderWidth`, `accentColor`) backed by atomic settings |
| Data Table | `DataTable` + `SearchInput` over live daemon items, with `EmptyState` |
| Interactive Controls | `Button`, `Toggle`, `TextInput`, `FormRow`, haptics + toast feedback |
| Attention & Beacons | `AttentionBeacon` modes/tones plus workspace beacon RPCs (set/blink/clear) and agent identity inspection |
| Plugin Settings | Type-safe Zod settings with optimistic React Query updates, navigation-style switch (tabs/dropdown) |
| Network Diagnostics | `CodeBlock` host details, daemon port, platform |
| System Logs | Copyable log view fed by the daemon tick counter |
| About Plugin | `AboutSection` reference (version, repo, issues, license, extras) |

## Navigation styles

The modal navbar renders two ways, switchable in the Settings tab (`navigationStyle`):

- **Tabs**: sliding single-row `<Tabs mode="scroll">`, pinned above the scroller (`headerMode="pinned"`).
- **Dropdown** (default): in-flow dropdown trigger + menu inside the `ModalBody` header, scrolling with the content (`headerMode="scroll"`, see `resolveDemoHeaderMode` in `shared/demo.ts`). The open menu resets on navigation-style switches and on pull-to-refresh.

## RPC contracts (`shared/demo.ts`)

- `helper-demo.get-data`: hostname, platform, CPU model/usage, memory, load averages, uptime, daemon port, background ticks, service items.
- `helper-demo.trigger-action`: background action demo with success/error toast + haptic feedback.
- `helper-demo.agent-identity`: active agent identity/session for self-inspection.
- `helper-demo.beacon-set` / `beacon-blink` / `beacon-clear`: workspace status beacon control.
- `helper-demo.settings`: persisted settings (`showCpuUsage`, `accentPillLabel`, `pollingRate`, `navigationStyle`, `highCpuThreshold`, flair fields).

## TEMP: upstream server settings handle (issue #62)

A **temporary** sidebar page (`Server Settings (temp)`) demonstrates the
upstream server-side settings handle added in Paseo `0.9.0-beta.1` (upstream
PR #4674), *not* our helper's `PluginStorage`/`registerSettingsRpc` layer:

- `index.server.ts` calls `server.registerSettings(defineSettings({ id: "server-demo", ... }))`
  and keeps the returned `PluginSettings` handle.
- The daemon reads through `handle.read()` and subscribes through
  `handle.subscribe()` (see `server/server-settings.ts`).
- The page (`client/server-settings.tsx`) renders the daemon's handle state
  (`status` / `revision` / `values` / `subscribe()` event count) and writes the
  same document through the host's auto-registered `settings.server-demo.*` RPC.
- The document lives at `~/.paseo/plugin-settings/paseo-helper-demo/server-demo.json`.

On hosts older than `0.9.0-beta.1`, `registerSettings()` returns `void`; the page
then reports the handle as unavailable and points at the SDK version. This page
is scaffolding for the #62 demo and is not wired into the pill/modal surfaces.

Tests: `npm test --workspace plugins/demo` (or `npx vitest run` in `plugins/demo`).
