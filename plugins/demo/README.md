# paseo-demo

This plugin is a demo for showcasing some of the capabilities of
[`paseo-plugin-helper`](https://github.com/xpufx/paseo-plugin-helper) ([npm](https://www.npmjs.com/package/paseo-plugin-helper)),
namely the UI design system, lifecycle primitives, and daemon utilities for
building Paseo plugins. It does not necessarily do anything useful to end
users. **The helper is the thing to take home**, not this plugin. Install
this one to see every pattern running live; depend on the helper to build
your own.

The helper package and demo are together a demonstration of an idea — that
the plugin ecosystem can benefit from a common library, not necessarily this
common library, rather than solving the same issues again and again.

> [!NOTE]
> **Prerequisites & Platform Support**:
> - Zero install requirements: the helper runtime is vendored (`client|server|shared/vendor/paseo-plugin-helper/`, pinned helper 0.4.0-beta.12), so Paseo installs this plugin with no build step and no npm/registry access. For local development (`typecheck`/`test`), Node.js (v18+) is enough.
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

- **Tabs** (default): sliding single-row `<Tabs mode="scroll">`, pinned above the scroller (`headerMode="pinned"`).
- **Dropdown**: in-flow dropdown trigger + menu inside the `ModalBody` header, scrolling with the content (`headerMode="scroll"`, see `resolveDemoHeaderMode` in `shared/demo.ts`). The open menu resets on navigation-style switches and on pull-to-refresh.

## RPC contracts (`shared/demo.ts`)

- `helper-demo-v8.get-data` — hostname, platform, CPU model/usage, memory, load averages, uptime, daemon port, background ticks, service items.
- `helper-demo-v8.trigger-action` — background action demo with success/error toast + haptic feedback.
- `helper-demo-v8.agent-identity` — active agent identity/session for self-inspection.
- `helper-demo-v8.beacon-set` / `beacon-blink` / `beacon-clear` — workspace status beacon control.
- `helper-demo-v8.settings` — persisted settings (`showCpuUsage`, `accentPillLabel`, `pollingRate`, `navigationStyle`, `highCpuThreshold`, flair fields).

## Screenshots

[![Visual Flair Studio](images/helper-visual-flair.png)](images/helper-visual-flair.png)

| System Metrics | About Plugin |
| :---: | :---: |
| [![System Metrics](images/helper-metric-gauges.png)](images/helper-metric-gauges.png) | [![About Plugin](images/helper-about.png)](images/helper-about.png) |
