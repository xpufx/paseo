# Client Module (`paseo-plugin-helper/client`)

The `client` module provides React Native UI primitives, layout containers, and lifecycle registration engines designed to integrate natively into Paseo's mobile and desktop environments.

It guarantees zero Node built-in imports, ensuring compliance with Hermes and Paseo's client plugin compiler.

---

## 1. Visual Flair & Theming

Paseo exposes theme tokens (`PluginTheme`) through host props. `PluginThemeProvider` wraps these tokens and applies custom visual styling rules while calculating WCAG contrast and mobile touch scaling.

### `VisualFlair` Interface
```ts
export interface VisualFlair {
  radius?: "sharp" | "rounded" | "pill";      // Default: "rounded"
  density?: "compact" | "comfortable" | "spacious"; // Default: "comfortable"
  surfaceStyle?: "flat" | "tinted" | "elevated";    // Default: "flat"
  accentColor?: string;                        // Custom brand hex (e.g. "#6366f1")
  borderWidth?: number;                        // Default: 1
  headingTransform?: "none" | "uppercase";     // Default: "none"
}
```

### `usePluginTheme()`
Hook providing resolved colors and utility functions inside any component wrapped by `PluginThemeProvider`:
```ts
const {
  theme,             // Raw Paseo PluginTheme
  colors,            // Resolved theme palette + status colors
  layout,            // ResponsiveLayout ({ compact: boolean, platform: "web" | "ios" | "android" | "macos" | "windows" | "linux" })
  isCompact,         // Boolean: true if mobile screen or narrow desktop split pane
  flair,             // Active VisualFlair configuration
  touchTargetMin,    // Minimum touch size in points (44pt on mobile/compact, 28pt on desktop)
  alpha,             // Helper: alpha(hexColor, opacityNumber) -> hex with alpha
  resolveRadius,     // Helper: resolveRadius("sm" | "md" | "lg" | "pill") -> number
  resolvePadding,    // Helper: resolvePadding("sm" | "md" | "lg") -> number
} = usePluginTheme();
```

---

## 2. Universal Responsive System

Paseo runs on desktop monitors, split-screen desktop windows, and mobile devices (iOS / Android). Because Paseo's composer trackbar enforces `flexShrink: 1` on plugin pills, text will truncate on narrow tracks unless your plugin adapts its content.

The responsive toolkit works across **every UI surface** (composer pills, modals, tabs, data tables, and workspace panels):

### `useResponsive()`
Universal hook giving access to current responsive state and branching helper:

```tsx
import { useResponsive } from "paseo-plugin-helper/client";

function MyComponent() {
  const { isCompact, isMobile, platform, touchTargetMin, select } = useResponsive();

  // Branch cleanly with priority: platform override -> mobile -> compact -> wide -> desktop
  const columns = select({
    desktop: ["Name", "Category", "Status", "Load"],
    compact: ["Name", "Load"],
  });

  return <DataTable columns={columns} ... />;
}
```

### `<Responsive />`
Declarative component for swapping layouts or render branches:

```tsx
import { Responsive } from "paseo-plugin-helper/client";

<Responsive
  desktop={<DesktopDashboard data={data} />}
  compact={<MobileCardList data={data} />}
/>
```

Or via render prop:
```tsx
<Responsive>
  {({ isCompact, touchTargetMin }) => (
    <View style={{ minHeight: touchTargetMin }}>
      <Text>{isCompact ? "Compact" : "Full View"}</Text>
    </View>
  )}
</Responsive>
```

---

## 3. Lifecycle Registration Helpers

### `initClientHelpers({ Icon, Modal, useRpc, useToast })`
Required once per plugin client entry, before any other helper client API is
used. The helper never imports the Paseo SDK itself, so one published build
runs on both Paseo v0.7 and v0.8: the plugin supplies the host
implementations using whichever specifiers match its installed SDK.

```tsx
// Paseo v0.7
import { useRpc } from "@getpaseo/plugin";
import { Icon, Modal, useToast } from "@getpaseo/plugin/react-native";
import { initClientHelpers } from "paseo-plugin-helper/client";

initClientHelpers({ Icon, Modal, useRpc, useToast });
```

```tsx
// Paseo v0.8
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "paseo-plugin-helper/client";

initClientHelpers({ Icon, Modal, useRpc, useToast });
```

On Paseo v0.8 the host also owns scrolling, input, and clipboard primitives
with sheet-gesture and keyboard integration. Pass them as optional extras;
every helper falls back to plain React Native when they are absent, so the
four-field call above keeps working unchanged:

```tsx
// Paseo v0.8 with host-owned primitives
import { useRpc } from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  useToast,
  ScrollView,
  FlatList,
  TextInput as HostTextInput,
  copyText,
} from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "paseo-plugin-helper/client";

initClientHelpers({
  Icon,
  Modal,
  useRpc,
  useToast,
  copyText,
  ScrollView,
  FlatList,
  TextInput: HostTextInput,
});
```

`copyToClipboard` tries host `copyText` first and falls through to the
React Native, `navigator.clipboard`, and `execCommand` tiers when absent or
rejected. `ModalBody`, `Tabs`, `TextInput`, and `SearchInput` render through
the host `ScrollView`/`TextInput` when supplied, which removes the need for
the helper's PanResponder sheet-gesture workaround in `Tabs`.

Scroll resolution follows one rule (`selectHostScrollView` in
`src/client/host.ts`): injected host component wins, plain React Native is
the fallback, so pre-0.8 hosts scroll exactly as before:

- `ModalBody`: desktop always scrolls; on compact viewports it uses the host
  scroller (with pull-to-refresh) when injected, otherwise the legacy flat
  `View` that defers to the host sheet and avoids the double-scroll trap.
- `Tabs` (scroll mode) and `CodeBlock` (vertical + horizontal) render through
  the resolved scroller, keeping `nestedScrollEnabled`/`directionalLockEnabled`
  for the fallback path.
- `FlatList` is typed in `ClientHostDeps` and round-trips through init for
  future virtualized lists; no helper component consumes it yet.

Where the plugin owns a scroll region (menu/popover bodies), set the SDK
`Modal.Content scrollable={false}` and bring the resolved `ScrollView` - that
prop lives on the SDK entry point, not on helper types, so consult the SDK
docs for your installed version.

Forgetting the call fails fast: every helper component throws `used before
initClientHelpers()` instead of rendering broken UI, so a missing init shows
up immediately in development rather than as a silent blank pill.

### `registerComposerPill(client, options)`
Handles the complete lifecycle of injecting a composer pill for each active agent, subscribing to agent updates, opening modals, and unmounting cleanly.

Works on both host generations: legacy `{Component, onPress}` pills (Paseo 0.7 and beta apps) and `button`-descriptor pills with anchored popovers (Paseo 0.8+), detected once with a throwaway probe registration that is removed immediately. Pass `onError({ agentId, workspaceId, error })` to surface registration failures in your own UI instead of throwing out of plugin setup. On 0.8 hosts the modal becomes an anchored popover driven by the host, so `renderPill` custom bodies and programmatic `open`/`toggle` only apply on legacy hosts; `title`, `icon`, and `renderModal` work on both. Live pill text on 0.8 hosts comes from `resolveLabel({ agentId, workspaceId })`, called once at registration and polled every `refreshIntervalMs` (default 5000, `0` for once-only); each resolved string is pushed via the registration `update({ label })`. Returning `undefined` keeps the current label. Expect a narrow popover column, not a wide modal, so keep `renderModal` content vertically stacked.

Supports declarative **compact props** so default pills automatically shrink to fit narrow mobile/split-screen tracks without truncating:

```tsx
import { registerComposerPill, ModalBody, Button } from "paseo-plugin-helper/client";

export const contributeClient = (client) => {
  return registerComposerPill(client, {
    id: "top",
    title: "system · 14% CPU",             // Wide/desktop pill button label
    compactTitle: "14%",                   // Swapped in when layout.compact is true (mobile/narrow)
    modalTitle: "Host Resource Monitor",  // Descriptive modal header title (falls back to title)
    icon: "Activity",                     // Pill Lucide icon name
    compactIcon: "Cpu",                   // Optional compact icon
    modalIcon: "Cpu",                     // Modal header icon (name or ReactNode)
    flair: { radius: "rounded", accentColor: "#3b82f6" },
    // Optional default payload resolver when outer host pill button is clicked
    resolveDefaultPayload: ({ agentId, workspaceId }) => "system",
    // renderPill receives ({ isOpen, open, close, toggle, ...props })
    // open(payload) and toggle(payload) pass contextual state to the modal
    renderPill: ({ isOpen, open }) => (
      <View style={{ flexDirection: "row", gap: 4 }}>
        <Pressable onPress={() => open("cpu")}><Text>CPU 14%</Text></Pressable>
        <Pressable onPress={() => open("mcp")}><Text>MCP 4/4</Text></Pressable>
      </View>
    ),
    // renderModal receives ({ agentId, close, payload })
    renderModal: ({ agentId, close, payload }) => (
      <ModalBody>
        <Text>Agent ID: {agentId} (Initial Tab: {payload})</Text>
        <Button label="Close" onPress={close} />
      </ModalBody>
    ),
  });
};
```


### `registerSidebarSurface(plugin, options)`
Registers a sidebar icon and corresponding full-page surface in a single call, automatically injecting `<PluginThemeProvider>` with custom visual flair.

```tsx
import { registerSidebarSurface } from "paseo-plugin-helper/client";

registerSidebarSurface(plugin, {
  id: "my-surface",
  title: "Dashboard",
  icon: "LayoutDashboard",
  flair: { density: "comfortable" },
  Component: MyDashboardComponent,
});
```

### `registerWorkspacePanel(plugin, options)` & `registerAgentPanel(plugin, options)`
Registers panels with automatic `<PluginThemeProvider>` injection.

```tsx
import { registerWorkspacePanel, registerAgentPanel } from "paseo-plugin-helper/client";

registerWorkspacePanel(plugin, {
  id: "project-stats",
  title: "Project Stats",
  icon: "BarChart3",
  Component: ProjectStatsPanel,
});

registerAgentPanel(plugin, {
  id: "agent-memory",
  title: "Agent Memory",
  icon: "Brain",
  Component: AgentMemoryPanel,
});
```

---

## 3. UI Primitives

### `<Button>`
Responsive button supporting 4 visual variants, loading spinners, icons, and minimum 44pt touch scaling on mobile.

```tsx
<Button
  label="Deploy"
  variant="primary"       // "primary" | "secondary" | "danger" | "ghost"
  size="md"               // "sm" | "md" | "lg"
  icon="Rocket"
  loading={isDeploying}
  disabled={!canDeploy}
  onPress={handleDeploy}
/>
```

### `<TextInput>`
Form input with label, placeholder, helper or error text, secure text entry, and automatic focus ring highlighting.

```tsx
<TextInput
  label="API Host"
  placeholder="https://api.example.com"
  value={host}
  onChangeText={setHost}
  helperText="Include port if running locally"
  errorText={isValid ? undefined : "Invalid URL"}
/>
```

### `<Toggle>`
Accessible boolean switch with minimum 44pt touch boundary and custom visual flair theme support.

```tsx
<Toggle
  label="Enable Telemetry"
  description="Send anonymous crash reports to team"
  value={enabled}
  onValueChange={setEnabled}
/>
```

### `<Collapsible>`
Accordion container with chevron rotation, badges, and smooth expand/collapse.

```tsx
<Collapsible title="Schema Details" badge={<Badge label="JSON" />}>
  <CodeBlock code={schemaString} language="json" />
</Collapsible>
```

### `<Badge>`
Status indicator chip with automatic contrast styling.
```tsx
<Badge label="Online" variant="success" style="tinted" dot />
<Badge label="Warning" variant="warning" style="outline" />
<Badge label="Error" variant="danger" style="solid" />
```

### `<Card>`
Adaptive container styled according to the active `VisualFlair.surfaceStyle` (`flat`, `tinted`, or `elevated`). Includes a compound `<Card.Header>` for structured headers with titles, icons, and action chips.
```tsx
<Card variant="tinted" padding="md">
  <Card.Header
    title="Host Metrics"
    icon="Cpu"
    badge={<Badge label="Active" variant="success" size="sm" />}
  />
  <Text>Card Content</Text>
</Card>
```

### `<Tabs>`
Segmented horizontal tab selector designed for Paseo modal and surface environments. Features automatic fitting on mobile with `shortLabel` support and elevated edge navigation chevrons when scrolling. On Paseo v0.8 the tab ribbon renders inside the host `ScrollView`, so sheet gestures work without extra capture handling.

```tsx
<Tabs
  tabs={[
    { id: "overview", label: "System Overview", shortLabel: "Overview", icon: "Cpu" },
    { id: "storage", label: "Storage Volumes", shortLabel: "Storage", icon: "HardDrive" },
    { id: "network", label: "Network Diagnostics", shortLabel: "Net", icon: "Activity" },
    { id: "logs", label: "Realtime Logs", shortLabel: "Logs", icon: "Terminal", badge: 3 },
  ]}
  activeTab={activeTab}
  onTabChange={setActiveTab}
  mode="auto" // "auto" (fits on mobile or <= 4 tabs) | "fit" | "scroll"
/>
```

#### Properties:
- `tabs`: Array of `TabItem` objects (`id`, `label`, `shortLabel?`, `icon?`, `badge?`).
- `activeTab`: ID string of the currently selected tab.
- `onTabChange`: Callback fired with the new tab ID on selection.
- `mode`: `"auto"` (default), `"fit"` (stretches to fill container width), or `"scroll"` (horizontal ribbon with elevated edge chevron buttons and swipe capture).

### `<CodeBlock>`
Monospace viewer with safe nested horizontal scrolling and a 1-tap clipboard copy button with visual checkmark feedback.
```tsx
<CodeBlock code={sourceCode} language="typescript" title="index.ts" maxHeight={240} />
```

### `<KeyValue>` & `<KeyValueGroup>`
Displays key/value metadata. Automatically stacks vertically on compact/mobile screens and aligns horizontally on desktop. Use `<KeyValueGroup>` for responsive multi-column metric grids.
```tsx
<KeyValueGroup columns={2}>
  <KeyValue label="CPU Usage" value="14.2%" />
  <KeyValue label="RAM Used" value="3.2 GB" />
  <KeyValue label="Endpoint" value="https://api.example.com/v1" copyable mono />
  <KeyValue label="Uptime" value="3d 4h" />
</KeyValueGroup>
```

### `<ProgressBar>`
Visual gauge with automated threshold coloring (<75% green, 75-89% yellow, >=90% red).
```tsx
<ProgressBar value={82} max={100} showLabel label="RAM Usage" />
```

### `<MetricGauge>`
Circular metric gauge with center value slot and automated threshold coloring.
```tsx
<MetricGauge value={78} label="CPU Load" size={90} />
```

### `<DataTable>`
Responsive data table that automatically reflows to a structured card list on mobile and compact viewports.
```tsx
<DataTable
  data={processes}
  keyExtractor={(p) => String(p.pid)}
  columns={[
    { key: "name", header: "Process", render: (p) => <Text>{p.name}</Text> },
    { key: "cpu", header: "CPU %", align: "right", render: (p) => <Text>{p.cpu}%</Text> },
  ]}
/>
```

### `<AboutSection>`
Standardized, responsive plugin metadata and diagnostics view. Automatically pulls theme tokens and visual flair styling, displays external action buttons (`Repository`, `Issues`, `Documentation`), and provides a 1-tap "Copy Diagnostics" button for issue triage.

```tsx
import { AboutSection } from "paseo-plugin-helper/client";
import { PLUGIN_VERSION } from "./version.js";

<AboutSection
  name="Host Resource Monitor"
  description="Real-time system resource monitor (CPU, memory, load average) for Paseo composers."
  version={PLUGIN_VERSION}
  author="xpufx"
  repository="https://github.com/xpufx/paseo-top"
  issues="https://github.com/xpufx/paseo-top/issues"
  license="MIT"
  // Logo: image require, URL, Lucide icon name, or omitted to auto-resolve GitHub avatar!
  logo="Activity" 
  extraItems={[
    { label: "Daemon Verified Port", value: "4280", copyable: true },
    { label: "Host Uptime", value: "3h 12m" },
  ]}
/>
```

#### Logo Resolution:
1. If `logo` is provided as an image require (`require("./logo.png")`) or image URL string (`"https://..."`), it renders directly with rounded corners matching the active visual flair.
2. If `logo` is a Lucide icon string (e.g. `"Cpu"`, `"Sliders"`, `"Activity"`), it renders a centered theme icon.
3. If `logo` is omitted, `<AboutSection>` automatically extracts the GitHub user/org from `repository` (or `author`) and resolves the official avatar: `https://github.com/:owner.png?size=128`!

### `<SearchInput>`
Themed search input with magnifying glass icon and clear button.
```tsx
<SearchInput value={query} onChangeText={setQuery} placeholder="Filter processes..." />
```

### `<EmptyState>`
Placeholder view for empty lists or zero-state panels.
```tsx
<EmptyState
  icon="Inbox"
  title="No Peers Found"
  description="Start by pairing with a remote daemon."
  actionLabel="Add Peer"
  onAction={openAddModal}
/>
```

---

## 4. Layout Primitives

### `<ModalBody>`
A scrollable container for `<Modal.Content>` that automatically applies bottom padding (`paddingBottom: 48` on mobile) to clear OS home navigation bars and keyboards.
Supports native pull-to-refresh on mobile via `refreshing` and `onRefresh`.

```tsx
<Modal.Content>
  <ModalBody refreshing={isRefetching} onRefresh={refetch}>
    {/* controls and cards */}
  </ModalBody>
</Modal.Content>
```

For conversation-style views that track new content, pass `stickToEnd` to
auto-scroll to the bottom on content size changes, or pass `scrollRef` for
imperative scrolling:

```tsx
<ModalBody stickToEnd>
  {messages.map((m) => (
    <Text key={m.id}>{m.text}</Text>
  ))}
</ModalBody>
```

### `<ActionBar>`
Toolbar container that renders buttons in a row with spacing on desktop, and automatically stacks them vertically with full width on mobile or compact panels.

```tsx
<ActionBar align="end">
  <Button label="Cancel" variant="ghost" onPress={close} />
  <Button label="Save Changes" variant="primary" onPress={save} />
</ActionBar>
```

### `<FormRow>`
Standardized form label and input layout container with responsive stacking.

```tsx
<FormRow label="Server Port" description="Local listening port">
  <TextInput value={port} onChangeText={setPort} keyboardType="numeric" />
</FormRow>
```

---

## 5. React Query Hooks

### `useRpcQuery(contract, input, options?)`
Invokes a Paseo RPC contract with React Query caching, deduplication, and automatic refetching.

```tsx
const { data, isLoading, refetch } = useRpcQuery(
  myStatusContract,
  { agentId },
  { refetchInterval: 5000 }
);
```

### `useRpcMutation(contract, options?)`
Executes an RPC contract mutation for write operations.

```tsx
const { mutate, isPending } = useRpcMutation(updateSettingContract, {
  onSuccess: () => queryClient.invalidateQueries([myStatusContract.name]),
});
```

### `useAutoRefreshQuery(contract, input, options?)`
Enhanced React Query hook for live polling metrics. Automatically halts background polling when modal/panel is closed (`isOpen === false`) to save battery and CPU on mobile, and provides selectable interval controls ("1s", "2s", "5s", "paused").

```tsx
const { data, rate, setRate, isPolling } = useAutoRefreshQuery(
  myStatusContract,
  { agentId },
  { defaultRate: "2s", isOpen: isModalOpen }
);
```

### `usePluginSettings(contract, options?)`
Reactive settings hook with **optimistic UI updates**, automatic error rollback, and background caching via React Query. Settings are never undefined (falls back to contract defaults).

```tsx
import { usePluginSettings, FormRow, Toggle, TextInput, Card } from "paseo-plugin-helper/client";
import { topSettingsContract } from "../shared/settings.js";

function SettingsTab() {
  const { settings, updateSettings, isUpdating, resetSettings } = usePluginSettings(topSettingsContract);

  return (
    <Card>
      <FormRow label="Show CPU & RAM" description="Display load in pill">
        <Toggle
          value={settings.showCpuRam}
          onValueChange={(val) => updateSettings({ showCpuRam: val })}
        />
      </FormRow>

      <FormRow label="Rotation Speed" description="Seconds between metric flips">
        <TextInput
          value={String(settings.rotationSeconds)}
          onChangeText={(text) => {
            const val = parseInt(text, 10);
            if (!isNaN(val)) updateSettings({ rotationSeconds: val });
          }}
          keyboardType="numeric"
        />
      </FormRow>
    </Card>
  );
}
```

### `registerHelperSettingsScreen(client, contract, options)`
Turns a settings contract built by `defineSettingsContract` into a native Paseo settings screen with zero hand-written JSX. Field mapping follows the Zod object schema: boolean fields render as Switch, `z.enum` fields render as Select, string and number fields render as Input. Schema `.describe()` text is used for labels and hints when present, otherwise the field name is used. Unsupported field shapes are skipped with a logged warning and never throw. Values bind through the existing `usePluginSettings(contract)` hook, so the host `useRpc` injected via `initClientHelpers` is reused with no new plumbing. Number fields ignore unparseable keystrokes and keep the last good value, so `NaN` is never written back.

Like `initClientHelpers`, the helper client imports zero Paseo SDK modules. The SDK settings UI components arrive as an explicit `options.ui` bundle supplied by the plugin from its own SDK version:

```tsx
import {
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
  SettingsSelect,
  SettingsInput,
} from "@getpaseo/plugin/client/ui";
import { registerHelperSettingsScreen } from "paseo-plugin-helper/client";
import { demoSettingsContract } from "../shared/settings.js";

export const contributeClient = (client) => {
  return registerHelperSettingsScreen(client, demoSettingsContract, {
    ui: { SettingsCard, SettingsSection, SettingsSwitch, SettingsSelect, SettingsInput },
    // Optional overrides: id defaults to contract.name, title defaults to
    // contract.description else contract.name, icon defaults to "Settings".
    id: "demo-settings",
    title: "Demo settings",
    icon: "Settings",
    labels: { showCpuUsage: "Show CPU usage" },
    descriptions: { showCpuUsage: "Display load in the pill" },
  });
};
```

Registration returns the host remover for cleanup, like every other `register*` helper.

---

## 6. Declarative Custom Metric Pills

The client module provides ready-made components and registration helpers to render user-defined custom metrics in the composer trackbar with automatic design system styling, responsive compact modes, and drill-down inspection modals:

### `registerCustomPills(client, options)`
Registers an array of `CustomPillState` entries with Paseo's composer trackbar:

```tsx
import { registerCustomPills } from "paseo-plugin-helper/client";

export default function activateClient(client: PluginClientContext) {
  // states received via RPC or storage
  const cleanup = registerCustomPills(client, {
    pills: customPillStates,
    onRefreshModal: async (pillId) => {
      // Call daemon RPC to execute pill.modal.command and return output
      return await client.rpc.call("top:runCustomPillModal", { id: pillId });
    },
  });

  return cleanup;
}
```

### `<CustomPillBody>` & `<CustomPillModalContent>`
For embedding custom metrics inside a composite pill (e.g. `paseo-top`'s main modal or trackbar):

```tsx
import { CustomPillBody, CustomPillModalContent } from "paseo-plugin-helper/client";

// Inside custom trackbar or dashboard:
<CustomPillBody state={pillState} />

// Inside drill-down inspection tab:
<CustomPillModalContent
  state={pillState}
  onRefresh={() => refreshPill(pillState.id)}
/>
```

Each `CustomPillState` carries an optional `sourceFile` (the absolute config
file path, injected at discovery time on the server). Use it for a display-only
provenance hint such as "defined in ...". Display it shortened (for example
with `~/...`) rather than as a raw absolute path.


---

## 7. Utilities

### `copyToClipboard(text, options?)`
Universal cross-platform copy function for Paseo plugins. Works reliably across React Native (Hermes / mobile webviews / touch events), desktop, and modern secure browsers.
Automatically integrates with Paseo's `useToast()` to display a toast notification on success.
Tier order: host `copyText` from `initClientHelpers` (Paseo v0.8, when supplied), then React Native Clipboard, then `navigator.clipboard`, then an `execCommand` fallback.

```tsx
import { copyToClipboard, useToast } from "paseo-plugin-helper/client";

const toast = useToast();

const handleCopy = async () => {
  await copyToClipboard("https://api.example.com/v1", {
    toast,
    toastMessage: "API Endpoint", // Displays "Copied API Endpoint to clipboard" or uses Paseo toast.copied
  });
};
```

### `triggerHaptic(type?)`
Triggers subtle tactile haptic vibration on mobile devices ("light", "medium", "heavy", "success", "warning", "error"). Gracefully degrades on unsupported platforms.

```tsx
import { triggerHaptic } from "paseo-plugin-helper/client";

const handlePress = () => {
  triggerHaptic("light");
  doAction();
};
```


