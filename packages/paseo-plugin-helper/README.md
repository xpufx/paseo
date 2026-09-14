# paseo-plugin-helper

> Developer toolkit, UI design system, and lifecycle primitives for building high-quality Paseo desktop & mobile plugins.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

`paseo-plugin-helper` provides drop-in solutions for building 3rd-party plugins for [Paseo](https://github.com/getpaseo/paseo). It eliminates boilerplate and provides native-feeling React Native UI components with **mobile-first responsiveness**, **configurable visual flairs**, **zero-dependency MCP client diagnostics**, and **daemon runtime utilities**.

> [!NOTE]
> **Developer Library**: `paseo-plugin-helper` is an npm developer toolkit / SDK used by plugin authors (it is **not** a standalone Paseo plugin itself and cannot be installed directly via `paseo plugin add`).
>
> **Compatibility**: one published build runs on **Paseo v0.7 and v0.8**. `paseo-plugin-helper/client` imports zero Paseo SDK modules and instead receives `Icon`, `Modal`, `useRpc`, and `useToast` via a single `initClientHelpers()` call in the plugin client entry (see `docs/client.md`). `server`, `shared`, `mcp`, and `testing` carry no SDK imports at all.

---

## Features

- 📝 **Structured Logging & Identity**: `createPluginLogger` automatically prints an informative startup banner with plugin identity/version in Paseo GUI logs and keeps log lines unfragmented.
- 🏷️ **Version Resolution & Stamping**: Auto-extracts plugin version from `package.json` + Git tags (`resolvePluginVersion`) and generates static TypeScript versions for Hermes client bundles (`stampVersion`).
- 📱 **Mobile & Desktop First**: Automatically scales touch targets (min 44pt on iOS/Android or narrow panes), avoids bottom-bar clipping, and reflows layouts between desktop and mobile.
- 📐 **Mobile Modal Gesture Architecture**: Solves nested horizontal scrolling and double-scroll issues inside Paseo mobile bottom sheets implicitly using `ModalBody` non-nested rendering and `Tabs` edge navigation.
- 🎨 **Configurable Visual Flair**: Authors can customize corner radii (`sharp`, `rounded`, `pill`), information density, surface treatments, and brand accents while honoring Paseo's light/dark themes.
- ℹ️ **Plugin About & Diagnostics Card**: `<AboutSection>` standardizes plugin branding, license tags, version badges, external navigation buttons, 1-tap "Copy Diagnostics" for issue triage, and auto-resolves official GitHub logos from author or repository URLs.
- 💊 **Composer Pill Lifecycle Engine**: Complete management of agent subscriptions, pill contributions, and modal states in one function call (`registerComposerPill`).
- 🖥️ **Panels & Surfaces**: One-line registration for sidebar surfaces (`registerSidebarSurface`) and panels (`registerWorkspacePanel`, `registerAgentPanel`) with automatic theme and flair propagation.
- 🔌 **Zero-Dependency MCP Client**: Built-in stdio client (`McpClient`) with stderr ring buffering, non-JSON stdout line filtering, cross-platform process tree cleanup, and fallback ping readiness checks.
- 🛠️ **Agent MCP Config Writer**: `upsertMcpServer` and `removeMcpServer` safely register plugin or Gateway MCP servers into Claude Desktop, Claude Code, OpenCode, Cursor, and Gemini configs with JSONC parsing, atomic writes, deep-equality idempotency, and automated backups.
- ⚡ **React Query RPC Bridge**: `useRpcQuery` & `useRpcMutation` with automatic caching, refetching, and input hashing.
- 🔌 **Plugin Query & Lifecycle Helpers**: `listPlugins`, `getPluginInfo`, `isPluginRunning`, and `isPluginInstalled` inspect active daemon state and cross-plugin availability with status filtering and built-in TTL caching.
- ⚙️ **End-to-End Settings System**: Type-safe settings flow from Zod schema (`defineSettingsContract`) to atomic daemon storage (`registerSettingsRpc`) and optimistic React Native UI state (`usePluginSettings`).
- 💾 **Daemon State & File Storage**: Atomic, temporary-swap file storage (`PluginStorage`) preventing corruption during power cuts or crashes.
- 🔒 **Security & Redaction**: Deep secret masking for Bearer tokens, API keys, and connection credentials (`redactSecrets`).
- 🔍 **Deterministic Plugin Audit CLI**: `npx paseo-plugin-helper audit` scans plugin codebases to detect raw bespoke patterns (manual subscriptions, raw filesystem writes, unformatted console logs, raw MCP spawns) and recommends drop-in helper replacements.
- 🧪 **Mock Testing Harness**: In-memory mocks for `PluginClientContext` and `PluginContext` for testing plugins in Vitest / Jest.

---

## Subpath Imports

To guarantee compliance with Paseo's bundler and compiler rules (no Node builtins in client bundles), import through explicit subpaths:

| Subpath | Target Platform | Description | Docs |
| :--- | :--- | :--- | :--- |
| `paseo-plugin-helper/client` | React Native / Hermes | UI components, visual flair provider, pill engine, panels, React Query hooks | [docs/client.md](docs/client.md) |
| `paseo-plugin-helper/server` | Node.js 20+ | `createPluginLogger`, `resolvePluginVersion`, `stampVersion`, `getSystemMetrics`, `PluginStorage`, `safeSpawn`, `redactSecrets` | [docs/server.md](docs/server.md) |
| `paseo-plugin-helper/mcp` | Node.js 20+ | Zero-dependency stdio `McpClient`, ring buffer, process tree killer | [docs/mcp.md](docs/mcp.md) |
| `paseo-plugin-helper/cli` | Node.js 20+ | `auditProject` programmatic scanner and reporting | [docs/cli.md](docs/cli.md) |
| `paseo-plugin-helper/shared` | Universal | `defineContract`, formatters (`formatBytes`, `formatUptime`, `resolveMetricStatus`) | [docs/shared.md](docs/shared.md) |
| `paseo-plugin-helper/testing` | Universal | Mock client and server contexts for unit and integration testing | [docs/testing.md](docs/testing.md) |

---

## Installation

Install directly from GitHub:

```bash
# npm
npm install github:xpufx/paseo-plugin-helper

# pnpm
pnpm add github:xpufx/paseo-plugin-helper
```

Or in your plugin's `package.json`:
```json
{
  "dependencies": {
    "paseo-plugin-helper": "github:xpufx/paseo-plugin-helper"
  }
}
```

> [!TIP]
> The repository includes an automated `prepare` build lifecycle script. When npm/pnpm installs from GitHub, it automatically compiles the dual ESM/CJS bundles and TypeScript declaration maps on-the-fly.

---

## Quickstart

### 1. Client: Composer Pill & UI Primitives

```tsx
import type { PluginClientContribution } from "@getpaseo/plugin";
import {
  registerComposerPill,
  ModalBody,
  Card,
  Button,
  Badge,
  KeyValue,
  TextInput,
  Toggle,
  Collapsible,
  useRpcQuery,
} from "paseo-plugin-helper/client";
import { myStatusContract } from "./contracts.js";

export const contributeClient: PluginClientContribution = (client) => {
  return registerComposerPill(client, {
    id: "my-plugin",
    title: "System Stats",
    icon: "Activity",
    flair: {
      radius: "rounded",          // "sharp" | "rounded" | "pill"
      density: "comfortable",     // "compact" | "comfortable" | "spacious"
      accentColor: "#10b981",     // Custom brand emerald accent
    },
    renderModal({ agentId, close }) {
      const { data, isLoading } = useRpcQuery(myStatusContract, { agentId });

      return (
        <ModalBody>
          <Card>
            <KeyValue label="Status" value={data?.status} />
            <KeyValue label="Uptime" value={data?.uptime} />
            <Badge variant="success" label="Healthy" />
          </Card>
          <Button variant="secondary" label="Dismiss" onPress={close} />
        </ModalBody>
      );
    },
  });
};
```

### 1b. Style Guide: Tokens Over Literals

```tsx
import {
  usePluginTheme,   // colors, fonts, padding, resolveRadius, isCompact
  spacing,          // xxs:2 xs:4 sm:8 md:12 lg:16 xl:24
  resolveElevation, // "none" | "sm" | "md" | "lg" -> shadow + elevation
} from "paseo-plugin-helper/client";

function Row() {
  const { colors, padding, isCompact } = usePluginTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface1,   // never a hex literal
        paddingHorizontal: padding.horizontal,
        paddingVertical: isCompact ? spacing.xs : spacing.sm, // one rung down in compact
        ...resolveElevation("sm"),          // no hand-rolled shadowColor
      }}
    />
  );
}
```

Rules: `Card`, `KeyValue`, `Tabs`, and `ModalBody` already follow this scale,
so compose them instead of re-implementing wrappers. `PluginThemeProvider`
merges static defaults, live Paseo 0.8 CSS variables (`--background`,
`--foreground`, `--muted`, `--accent`, `--border`), and the injected host
theme in that order, so surfaces track host dark/light switches with no
plugin code.

---

```ts
import { McpClient } from "paseo-plugin-helper/mcp";

// Connect to any local or bundled MCP server over stdio
const client = McpClient.forStdio("node", ["./dist/mcp-server.js"]);

const ping = await client.ping({ mode: "tools" });
if (ping.healthy) {
  const tools = await client.listTools();
  console.log(`MCP server online. Latency: ${ping.latencyMs}ms. Tools:`, tools);
} else {
  console.error(`MCP server offline: ${ping.error}\nRecent stderr:\n${ping.stderr}`);
}

await client.close();
```

---

### 3. Server: Atomic Storage & Safe Process Execution

```ts
import type { PluginContribution } from "@getpaseo/plugin";
import { createPluginLogger, PluginStorage, safeSpawn } from "paseo-plugin-helper/server";
import { myStatusContract } from "./contracts.js";

// Emits startup banner: "[my-plugin v0.1.0] Initializing plugin..."
const log = createPluginLogger("my-plugin", { version: "0.1.0" });

interface PluginState {
  lastRun: string;
  runCount: number;
}

const storage = new PluginStorage<PluginState>("my-plugin", "state.json", {
  defaultData: { lastRun: "", runCount: 0 },
});

export const contributePlugin: PluginContribution = (plugin) => {
  plugin.handle(myStatusContract, async (input) => {
    log.info("Processing status request", { target: input.target });
    const { stdout } = await safeSpawn("uptime", [], { timeoutMs: 3000 });

    storage.update((prev) => ({
      lastRun: new Date().toISOString(),
      runCount: prev.runCount + 1,
    }));

    return {
      uptime: stdout,
      status: "online",
    };
  });

  return () => {};
};
```

---

## Mobile Modal Gesture Architecture & `<Tabs>`

### The Challenge with Nested Scrolling in Paseo Modals

On mobile viewports (`isCompact: true`), Paseo renders modal dialogs using an `@gorhom/bottom-sheet` component (`AdaptiveModalSheet`). Under the hood, this sheet attaches a root `PanGestureHandler` to manage dragging, detents, and swipe-to-dismiss behavior.

In standard React Native, nesting a horizontal `<ScrollView>` inside a gesture-driven bottom sheet creates immediate conflicts:
1. **Touch Hijacking**: The parent bottom sheet's gesture recognizer claims ownership of all touch streams. When a user attempts to swipe a nested horizontal ribbon, the parent gesture handler intercepts the touch events and cancels them.
2. **Double ScrollView Trap**: Paseo's modal host already wraps plugin content in a `BottomSheetScrollView` on mobile. If a plugin wraps its modal content in another vertical `<ScrollView>`, the nested views fight for touch ownership, locking scrolling velocity and swallowing gestures.

### How `paseo-plugin-helper` Solves This Automatically

`paseo-plugin-helper` provides built-in defenses so plugin developers do not need to invent complex workarounds:

1. **Non-Nested `<ModalBody>` on Mobile**:
   [`ModalBody`](src/client/layout/ModalBody.tsx) checks `isCompact`. On desktop, it renders a standard React Native `<ScrollView>`. On mobile, it automatically renders a responsive `<View>` with safe bottom insets, deferring vertical scrolling directly to Paseo's host `BottomSheetScrollView` without creating a double-scroll trap.

2. **Universal Edge Navigation in `<Tabs>`**:
   [`Tabs`](src/client/components/Tabs.tsx) provides two responsive modes:
   - **`mode="fit"` (Default)**: Tabs stretch to fit the viewport width. Authors can provide `shortLabel` on any tab item (e.g. `label: "Interactive Controls"`, `shortLabel: "Controls"`), allowing tabs to fit cleanly on narrow mobile screens without truncation.
   - **`mode="scroll"`**: If tabs exceed the container width, elevated chevron buttons (`ChevronLeft` and `ChevronRight`) appear on the track edges on both desktop and mobile. Tapping an arrow smoothly advances the tab track by 70% of the visible viewport width.
   - **Gesture Capture**: `<Tabs>` attaches a `PanResponder` configured with `onMoveShouldSetPanResponderCapture`. When horizontal movement is detected, it claims the gesture during the capture phase before the parent bottom sheet can cancel it.

#### Usage Example:

```tsx
import { Tabs, type TabItem } from "paseo-plugin-helper/client";

const tabs: TabItem[] = [
  { id: "overview", label: "System Overview", shortLabel: "Overview", icon: "Cpu" },
  { id: "storage", label: "Storage Volumes", shortLabel: "Storage", icon: "HardDrive" },
  { id: "network", label: "Network Diagnostics", shortLabel: "Net", icon: "Activity" },
  { id: "logs", label: "Realtime Logs", shortLabel: "Logs", icon: "Terminal", badge: 3 },
];

<Tabs
  tabs={tabs}
  activeTab={activeTab}
  onTabChange={setActiveTab}
  mode="auto" // "auto" fits on mobile with shortLabel; use "scroll" for ribbon navigation
/>
```

---

## Interactive Showcase Demo

The repository includes a runnable reference plugin in [`demo/`](demo/README.md) (`helper-demo`) demonstrating all components, responsive mobile bottom-sheet behaviors, an interactive Visual Flair Studio, and the `<AboutSection>` component with auto-resolved GitHub branding. See the [**Demo README**](demo/README.md) for installation and walkthrough details.

---

## Issues-Centered Workflow

Day-to-day coordination runs on Forgejo issues, not chat. Agents work in
silence, report via issue comments, and move their own cards through labels.
Chat is for decisions, approvals, and escalations only.

The [`fgjx` wrapper](https://forge.mrs.aager.de/xpufx/paseo-plugin-helper/issues/23)
fills gaps in the `fgj` CLI that matter for this flow: labeled issue
listings and views, query flags (`--not-by`, `--sort`, `--since`), and
`--help` patched so agents discover the extensions. Everything else passes
straight through to `fgj`.

```bash
fgjx issue list --sort updated --not-by xpufx   # what moved without you
fgjx issue view 12                              # labels, body, comments
```

### Scoped Label Taxonomy

All repository workflows use two-tone exclusive scoped labels (`scope/name`):

| Scope | Labels | Purpose & Lifecycle |
| :--- | :--- | :--- |
| **Priority** | `priority/0-SOS`, `priority/1-high`, `priority/2-normal`, `priority/3-low`, `priority/4-backburner` | Urgency tier (`0-SOS` preempts all tasks immediately). |
| **State** | `state/0-triage`, `state/1-wip`, `state/2-review`, `state/3-verify`, `state/4-done` | Execution stage lifecycle. |
| **Spec** | `spec/0-needed`, `spec/1-checklist`, `spec/2-approved` | Shaping gate (`spec/2-approved` allows autonomous coding). |
| **Format** | `format/0-needed`, `format/1-ok` | Presentation and markdown quality check. |
| **Size** | `size/0-cheap`, `size/1-medium`, `size/2-expensive`, `size/3-chunk` | Cognitive effort; `size/3-chunk` halts implementation to slice PRs. |
| **Linked** | `linked/0-needs-split`, `linked/1-peer`, `linked/2-done` | Cluster coordination (`0-needs-split` splits domain; `1-peer` syncs via `Linked: #...`). |
| **Dep** | `dep/blocker`, `dep/blocked` | Hard issue dependencies. |
| **Review** | `review/0-needed`, `review/1-changes-requested`, `review/2-approved` | Formal diff and architectural signoff gate. |
| **Verify** | `verify/automated-ok`, `verify/needs-device` | Automated suites pass vs physical desktop/hardware verification needed. |
| **Upstream** | `upstream/0-explore`, `upstream/1-blocked`, `upstream/2-aligned` | Upstream Paseo core tracking and alignment. |
| **Attention** | `attention/0-orchestrator`, `attention/1-agent`, `attention/2-user`, `attention/3-ignore` | Signal target (`0-orchestrator` requests triage; `1-agent` requests worker claim). |
| **Flags** | `flag/evergreen`, `flag/security`, `flag/stop-work`, `flag/wont-do`, `flag/audit` | Behavioral flags (`stop-work` is a hard circuit breaker). |
| **Target** | `target/helper`, `target/top`, `target/x-comms`, `target/mcp-tools`, `target/forgejo`, `target/monorepo`, `target/daemon`, `target/paseo-plugin` | Domain or package boundary. |

Label combinations steer autonomous agents deterministically: an issue requires `state/0-triage` + `spec/2-approved` (or `attention/1-agent`) without blocking labels (`dep/blocked`, `flag/stop-work`, `size/3-chunk`, `linked/0-needs-split`, `attention/0-orchestrator`) to qualify for autonomous claim.

---

## Documentation

Comprehensive API and module documentation:

- 📖 [Client Design System & Lifecycles (`docs/client.md`)](docs/client.md)
- 📖 [Server Daemon Utilities (`docs/server.md`)](docs/server.md)
- 📖 [MCP Client & Transports (`docs/mcp.md`)](docs/mcp.md)
- 📖 [Shared Types & Formatters (`docs/shared.md`)](docs/shared.md)
- 📖 [Testing Harness (`docs/testing.md`)](docs/testing.md)

---

## Known Users of the Library

Plugins powered by `paseo-plugin-helper`:

- 📊 [**`paseo-top`**](https://github.com/xpufx/paseo-top) – Real-time system resource monitor (CPU, memory, load average) for Paseo composers with responsive charts, cards, and warning thresholds.

---

## My other Paseo plugins

More from the same author: [xpufx.github.io/#paseo](https://xpufx.github.io/#paseo)

---

## License

MIT © [xpufx](LICENSE)
