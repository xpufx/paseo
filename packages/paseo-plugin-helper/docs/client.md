# Client Module (`paseo-plugin-helper/client`)

The `client` module provides React Native UI primitives, layout containers, and lifecycle registration engines designed to integrate natively into Paseo's mobile and desktop environments.

It guarantees zero Node built-in imports, ensuring compliance with Paseo's client plugin compiler.

---

## 1. Visual Flair & Theming

Paseo exposes theme tokens (`PluginTheme`) through host props. `PluginThemeProvider` wraps these tokens and applies custom visual styling rules while calculating WCAG contrast and mobile touch scaling.

### `VisualFlair` Interface
```ts
export interface VisualFlair {
  radius?: "sharp" | "rounded" | "pill";      // Default: "rounded"
  density?: "compact" | "comfortable" | "spacious"; // Default: "compact"
  surfaceStyle?: "flat" | "tinted" | "elevated";    // Default: "flat"
  accentColor?: string;                        // Custom brand hex (e.g. "#6366f1")
  borderWidth?: number;                        // Default: 1
  headingTransform?: "none" | "uppercase";     // Default: "none"
}
```

#### Density and the spacing scale

Plugin surfaces are information-dense, so the **default density is `"compact"`**.
`"comfortable"` and `"spacious"` are opt-in per plugin via
`flair: { density: "comfortable" }`. Density feeds `resolvePadding`, which is
the only source of card/body padding any helper primitive should consume:

| Density       | horizontal (wide / compact) | vertical (wide / compact) | gap (wide / compact) |
| ------------- | --------------------------- | ------------------------- | -------------------- |
| `compact` (*) | 12 / 10                     | 8 / 6                     | 8 / 6                |
| `comfortable` | 16 / 12                     | 14 / 10                   | 12 / 8               |
| `spacious`    | 24 / 16                     | 20 / 14                   | 16 / 12              |

(*) default

Rules that keep vertical space honest:

- Never hardcode a vertical padding/margin in a helper primitive — read
  `padding.vertical` / `padding.gap` from `usePluginTheme()`. A literal `8`
  silently ignores the active density.
- Stacked label-above-value costs two text lines; use `KeyValue layout="inline"`
  and `FormRow layout="inline"` whenever the control is a single short element
  (`Toggle`, `StatusDot`, `Badge`, small `Button`).
- Do not wrap helper primitives in extra `View`s that add their own gap or
  padding. `Card` already applies `padding.vertical`, and `Card.Header` already
  reserves its own bottom gap.
- The free-standing scale for gaps inside a row/stack is
  `spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }`; prefer a token
  over a raw pixel value.

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
  typography,        // Semantic title/heading/body/label/caption text styles
} = usePluginTheme();
```

The `typography` scale is derived from the active compact layout and visual
density. Prefer these semantic styles over inventing per-component font sizes
so plugin surfaces remain visually consistent:

```tsx
const { colors, typography } = usePluginTheme();

<Text style={[typography.heading, { color: colors.foreground }]}>
  Repository
</Text>
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
runs on Paseo >= 0.8.0: the plugin supplies the host
implementations using whichever specifiers match its installed SDK.

```tsx
// Paseo 0.8
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "paseo-plugin-helper/client";

initClientHelpers({ Icon, Modal, useRpc, useToast });
```

On Paseo 0.8 the host also owns scrolling, input, and clipboard primitives
with sheet-gesture and keyboard integration. Pass them as optional extras;
every helper falls back to plain React Native when they are absent, so the
four-field call above keeps working unchanged:

```tsx
// Paseo 0.8 with host-owned primitives
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

- `ModalBody`: compact/mobile viewports use the helper's host-aware scroller
  (with pull-to-refresh); desktop renders a plain content view so the host
  modal or surface remains the single scroll owner and nested desktop scroll
  regions do not appear. Composer popovers on Paseo 0.8 also render plain
  content because Paseo's `MenuSurface` already supplies the scroll owner.
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

Works on both host generations: legacy `{Component, onPress}` pills (pre-0.8 hosts) and `button`-descriptor pills with anchored popovers (Paseo 0.8+), detected once with a throwaway probe registration that is removed immediately. Pass `onError({ agentId, workspaceId, error })` to surface registration failures in your own UI instead of throwing out of plugin setup. On 0.8 hosts the modal becomes an anchored popover driven by the host, so `renderPill` custom bodies and programmatic `open`/`toggle` only apply on legacy hosts; `title`, `icon`, and `renderModal` work on both. Live pill text on 0.8 hosts comes from `resolveLabel({ agentId, workspaceId })`, called once at registration and polled every `refreshIntervalMs` (default 5000, `0` for once-only); each resolved string is pushed via the registration `update({ label })`. Returning `undefined` keeps the current label. Expect a narrow popover column, not a wide modal, so keep `renderModal` content vertically stacked.

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
  flair: { density: "comfortable" }, // optional; default is "compact"
  Component: MyDashboardComponent,
});
```

A registered surface is a full host page: Paseo does **not** wrap the surface
body in a host scroller. `registerSidebarSurface` therefore marks the subtree as
helper-scroll-owned, so any `ModalBody` inside it owns the single scroll region on
every platform — including a wide desktop window. Plugin surfaces get working
scroll for free and must not add their own outer `ScrollView`.

### `registerCommandCenterItem(plugin, contribution)`
Registers an entry in the host Ctrl+K command center. Thin pass-through that keeps plugins on the helper seam; `onSelect` receives `{ openSurface, openSettings }`.

```tsx
import { registerCommandCenterItem } from "paseo-plugin-helper/client";

registerCommandCenterItem(plugin, {
  id: "open-my-surface",
  title: "My surface",
  icon: "LayoutDashboard",
  keywords: ["dashboard", "console"],
  context: "global", // "global" | "workspace" | "agent"
  onSelect({ openSurface }) {
    openSurface("my-surface");
  },
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

### `<InteractiveRow>`
Hover-aware, pressable row container for dense interactive content. Use it where a labeled `<Button>` does not fit: a row of status dots, badges, and metric readouts that still needs a hover state, an RN-web `title` tooltip, pressed opacity, a pointer cursor, and press-event control. Content is arbitrary, and a nested control can call `event.stopPropagation()` because `onPress` receives the raw event.

```tsx
<InteractiveRow
  title={`${agent.name} (${agent.state})`}
  hoverTint
  accessibilityRole="button"
  accessibilityLabel={`Open agent ${agent.name}`}
  onPress={(event) => {
    event.stopPropagation();
    openAgent(agent.id);
  }}
>
  <StatusDot variant="success" />
  <Text>{agent.name}</Text>
  <Badge label={agent.shortId} size="sm" />
</InteractiveRow>
```

#### Properties:
- `children`: Row content; any composition is allowed.
- `onPress(event)`: Press handler receiving the raw `GestureResponderEvent` for propagation control.
- `title`: RN-web tooltip text attached to the hit area.
- `hoverTint` / `hoverTintOpacity`: Paint a subtle accent tint while hovered (default opacity `0.05`).
- `hoverStyle`: Extra style layered only while hovered.
- `pressedOpacity` / `hoveredOpacity` / `opacity` / `disabledOpacity`: Interaction opacity overrides (defaults `0.7` / `opacity` / `1` / `0.45`).
- `onHoverChange(hovered)`: Notified on every hover flip, for callers that tint their own children.
- `disabled`, `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`, `testID`, `style`, `hitSlop`: forwarded to the underlying `Pressable`; `accessibilityRole` defaults to `"button"` when `onPress` is set.

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

### `<Select>`
Compact single-choice picker sized for `<FormRow>`. The closed trigger is one
line tall; opening reveals a bounded, scrollable option list, so a long list
degrades to scrolling instead of overflow. Themed through the same tokens as
`TextInput`/`Badge`; callers supply no styling.

```tsx
<Select
  label="RPC operation"
  value={operation}
  options={rpcOptions.map((name) => ({ label: name, value: name }))}
  onValueChange={setOperation}
  placeholder="Choose an operation…"
  size="md" // "md" (default, theme caption metrics) | "sm" (10/12 Badge scale)
  disabled={isLocked}
/>
```

#### Properties:
- `value`: Currently selected value; a free-text value that is not in `options` is surfaced on the trigger instead of the placeholder.
- `options`: `{ label, value }[]` choices.
- `onValueChange`: Fired with the new value on selection; the list closes.
- `label`: Optional accessible label (composed with the current value).
- `size`: `"md"` (default) or `"sm"`, reusing the `Badge` size scale.
- `placeholder`: Shown when `value` is empty (default `"Select…"`).
- `disabled`: Blocks opening and mutes the trigger. A trigger with no options is also inert.
- `style`: Escape-hatch override for the container.

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
<Badge label="bug" variant="neutral" size="sm" />
```

#### Properties:
- `label`: Chip text.
- `variant`: `StatusVariant` controlling the palette (`neutral` default).
- `styleVariant`: `"tinted"` (default), `"outline"`, or `"solid"`.
- `size`: `"md"` (default, theme caption metrics) or `"sm"` — a compact pill with 10/12 type, `paddingVertical: 1`, `paddingHorizontal: 5`, and a 10px icon.
- `icon`: Lucide icon name or custom node rendered before the label.
- `dot`: Renders a status dot instead of an icon.
- `style` / `textStyle`: Escape-hatch overrides layered on top of the size metrics.
- `highlightQuery`: When set, every case-insensitive (literal, non-regex) occurrence of the query inside `label` is painted with the accent highlight, with the same token fuzzy fallback as `<HighlightedText>`. Pair it with `highlightFuzzyFallback` to mark the whole label when no literal or token hit exists.

### `<HighlightedText>`
`<Text>` that paints every case-insensitive occurrence of a search query with the theme accent background/foreground. The query is matched literally via `indexOf` (never compiled as a regular expression), so user input cannot inject a pattern. When the literal query is absent — a fuzzy search result — the splitter highlights the query's multi-character tokens at word starts; with no token hit either nothing is painted, unless `fuzzyFallback` marks the whole field. When the query is empty or absent the text renders unchanged. Pair it with `splitHighlightParts(text, query, options?)` / `hasHighlightMatch(text, query)` / `hasFuzzyHighlight(text, query)` from `paseo-plugin-helper/shared` when you need the runs or a boolean without rendering.

```tsx
<HighlightedText text={issue.title} query={query} fuzzyFallback style={styles.title} />
```

#### Properties:
- `text`: Source text; rendered as-is when no query is active.
- `query`: Active search query. Matched case-insensitively and literally, with a token fuzzy fallback.
- `fuzzyFallback`: When true, a query with no literal or token hit marks the whole text. Use it on the primary label (row/detail title), not on every small field.
- `style`: Escape-hatch text style applied to the outer `<Text>`.
- `highlightStyle`: Overrides the matched-run style (defaults to accent background + `accentForeground`).
- `numberOfLines` / `selectable`: Forwarded to the underlying `<Text>`.

Shared matchers: `splitHighlightParts` returns the matched/unmatched runs (pass `{ fallbackToWholeField: true }` for the whole-field fallback); `hasHighlightMatch` is the literal, case-insensitive test; `hasFuzzyHighlight` adds the word-start token fallback but never the whole-field fallback, so it pinpoints the row or section that genuinely mentions a fuzzy query (used for go-to-match in forges). All three strip surrounding whitespace and matching single/double quotes via `normalizeSearchQuery(query)` first — so `meta` and `"meta"` behave identically — while the raw query is what callers hand to a remote forge search.

### `<Card>`
Adaptive container styled according to the active `VisualFlair.surfaceStyle` (`flat`, `tinted`, or `elevated`). Includes a compound `<Card.Header>` for structured headers with titles, icons, and action chips. `<Card.Header highlightQuery={q}>` highlights case-insensitive matches of `q` inside the title, with the same token/whole-field fuzzy fallback as `<HighlightedText>`.
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
Segmented horizontal tab selector designed for Paseo modal and surface environments. Features automatic fitting on mobile with `shortLabel` support and elevated edge navigation chevrons when scrolling. On Paseo 0.8 the tab ribbon renders inside the host `ScrollView`, so sheet gestures work without extra capture handling.

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

### `<CopyButton>`
Standalone clipboard affordance for styled/plugin surfaces that the host's
selection-copy handler ignores. It uses the helper's host `copyText` /
`copyToClipboard` path and flips Copy → Check / "Copied!" on success.
```tsx
// Lazy text is resolved at press time, so a growing digest stays current.
<CopyButton getText={() => buildDigest(data)} toastMessage="timeline card" />

// Or copy a literal string.
<CopyButton text={sha} accessibilityLabel="Copy commit SHA" />
```
Set `label=""` / `copiedLabel=""` for an icon-only control, and `variant="secondary"`
for a bordered chip instead of the default ghost styling.

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

#### Collapse control
By default a compact surface still collapses the group to a single column (the
historical behavior, preserved for existing consumers). Two optional props let a
group keep its columns when there is room:

- `collapse`: `"compact"` (default) collapses to one column on a compact
  surface; `"never"` keeps the requested `columns`.
- `minColumnWidth`: when set and the container width is known, the effective
  column count is capped so each column stays at least this wide — it wraps to
  fewer columns instead of collapsing to one. `columns` remains the upper bound.

```tsx
// Stay 2-up in a compact popover as long as each cell has 220px.
<KeyValueGroup columns={2} collapse="never" minColumnWidth={220}>
  <KeyValue layout="inline" label="Version" value={sha} mono />
  <KeyValue layout="inline" label="Remote" value={remote} mono />
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

### `<ForgeIcon>`
One shared forge brand mark so plugins never carry their own per-forge icon
tables. Pass a forge `host` and/or an explicit `kind`; the resolver decides
which mark to draw.

GitHub and GitLab stay on the host Lucide set (`Github`, `Gitlab`), and any
unrecognised host falls back to `Globe`. Codeberg, Forgejo and Gitea have no
Lucide equivalent, so the helper draws their official mono marks inline as an
SVG data URI on web/Electron. On native — where Paseo plugin bundles cannot
render SVG — those three fall back to a distinct Lucide glyph
(`Mountain`/`Hammer`/`Coffee`) so forges stay distinguishable.

```tsx
import { ForgeIcon, resolveForgeMark } from "paseo-plugin-helper/client";

// host-driven (e.g. parsed from a remote URL)
<ForgeIcon host="codeberg.org" size={16} color={colors.foreground} />

// explicit forge identity when the host is a self-hosted unknown
<ForgeIcon host="forge.example.com" kind="forgejo" size={16} />

// pure, testable resolution for shared/server code
const mark = resolveForgeMark({ host: "gitea.com" });
// { kind: "gitea", label: "Gitea", lucideName: "Coffee", custom: true }
```

The pure resolver is also exported from `paseo-plugin-helper/shared` as
`resolveForgeMark`, `forgeKindFromHost`, `normalizeForgeHost` and `isForgeKind`
(plus the `ForgeKind` / `ResolvedForgeMark` types), so host→mark logic can live
in a plugin's shared layer without importing React.

### `<AttentionBeacon>`
Wraps any child and animates it to draw attention. Modes:
`radar` (expanding halo, default), `ring` (alias of `radar`), `glow`
(breathing halo behind the child), `badge` (pulsing corner pip, optional
`badgeIcon` string or node), `bounce` (vertical nudge), and `pulse`
(opacity animated directly on the child — no halo, so the wrapped icon
keeps its own shape).

`pulse` is the mode to use when the attention target is itself an icon
whose shape must not change (e.g. a header icon gated on a pending count
or health state). `glow` renders a halo *behind* the child and `StatusDot`
is dot-only, so neither fits that case. `tone`/`color` resolve from the
same theme tokens as every other mode; `duration` (default `900`ms) and
`easing` (default linear) tune the pulse loop; `active={false}` renders
the child inert with no animation.
```tsx
<AttentionBeacon
  mode="pulse"
  tone="warning" // "warning" | "accent" | "danger", or color="#eab308"
  active={pendingCount > 0}
  duration={900}
  testID="header-beacon"
>
  <Icon name="Bell" size={16} color={colors.foreground} />
</AttentionBeacon>
```

---

## 4. Layout Primitives

### `<Row>`, `<Stack>` / `<VStack>`, `<Grid>`
Thin, themed flexbox wrappers. They exist so plugins compose horizontally and
wrap instead of authoring everything as a vertical stack of hand-rolled
`<View style={{ flexDirection: "row", gap }}>`. `gap` defaults to the active
theme's `padding.gap`; pass a spacing token (`"xs" | "sm" | "md" | "lg" | "xl"`)
or a raw px number to override.

```tsx
import { Grid, MetricGauge, Row, Stack, StatusDot, Text } from "paseo-plugin-helper/client";

<Row align="center" gap="sm" wrap>
  <StatusDot variant="success" />
  <Text>Build passing</Text>
</Row>

<Stack gap="xs">
  <Text>Title</Text>
  <Text>Subtitle</Text>
</Stack>

<Grid columns={4} minColumnWidth={180}>
  <MetricGauge value={12} label="CPU" />
  <MetricGauge value={64} label="RAM" />
</Grid>
```

- `Row`: `flexDirection: "row"`; optional `wrap`, `align`, `justify`.
- `Stack` (alias `VStack`): the deliberate column default; optional `align`,
  `justify`.
- `Grid`: wrapping row grid. `columns` caps the count (default `2`);
  `minColumnWidth` makes it width-aware — as many columns as fit, wrapping the
  rest. It never collapses to one column on a compact surface.


### `<ModalBody>`

A scrollable container for `<Modal.Content>` that automatically applies bottom padding (`paddingBottom: 48` on mobile) to clear OS home navigation bars and keyboards.
Supports native pull-to-refresh on mobile via `refreshing` and `onRefresh`.
Pass `header` with `headerMode="pinned"` for a fixed tab/navigation bar. On
desktop, the host remains the scroll owner and the web header uses sticky
positioning; on compact/mobile, the header stays above the helper scroller:

#### Modal size contract

Every plugin modal takes the **host-allocated dialog size** and is fluid within
it. The helper enforces the contract, so plugins never size their own frame:

- **Fill the allocation, don't dictate it.** `ModalBody` is
  `flex: 1 / minHeight: 0 / width: "100%"`. Keep every wrapper between the host
  and `ModalBody` equally fluid (`flex: 1`, `minHeight: 0`, `width: "100%"`).
- **No content-driven resizing.** Children must never determine the dialog's
  width or height. A root that sizes itself to its children makes the modal
  visibly resize/redraw as data loads, polls, or grows.
- **No hardcoded modal dimensions.** Do not put `minWidth`, `minHeight`, `width`,
  or `height` literals on a modal/surface container. For text that must be able
  to shrink, use `minWidth: 0` + `flexShrink: 1`. The audit rule
  `no-hardcoded-modal-dimensions` flags the large cases.
- **No nested scrollers.** Let the host own the outer scroll on desktop and the
  bottom sheet own it on mobile; use `ModalBody` for the body instead of wrapping
  it in another `ScrollView` (a bounded inner `ScrollView` inside `Modal.Content`
  is still a content-driven height - drop it and let the host scroll).

#### Host behavior: desktop dialog vs mobile sheet

| Surface | Host owns | `ModalBody` renders |
| --- | --- | --- |
| Desktop dialog | Bounded dialog size + outer scroll | Plain content view (no second scrollbar; sticky web header for `headerMode="pinned"`) |
| Mobile bottom sheet (`AdaptiveModalSheet`) | Sheet viewport + sheet gesture + `BottomSheetScrollView` | Host-aware scroller when the helper owns scroll, plain view when the host does; adds the safe bottom inset |
| 0.8 composer popover | `MenuSurface` / `FloatingScrollView` | Plain content (`ModalBodyScrollOwnerContext` marks the subtree) |

Because the host allocates the size, a plugin cannot request a different dialog
frame from plugin code - content simply flows into whatever the host gives it.

Scroll ownership defaults to `scrollMode="auto"`: the helper scrolls on
compact/mobile surfaces and defers to the host on desktop. Pass
`scrollMode="always"` only when the host supplies no scroller because the content
view is bounded (`ModalContent` does this for its bound `<Modal.Content>`); it
makes the helper own the desktop scroller so nothing is clipped.

#### Requesting a wider dialog: `size`

When a genuinely data-dense modal/surface needs more room, use the single
documented preset instead of a per-plugin literal:

```tsx
// Default: fully fluid inside the host allocation.
<ModalBody>...</ModalBody>

// Wide extent for tables, logs, or dense dashboards.
<ModalBody size="large">...</ModalBody>
```

`size="large"` applies the helper's documented minimum width on desktop only.
It is ignored on mobile (the bottom sheet is already full-bleed) and inside
composer popovers (the host owns that narrow viewport). The host still owns the
final size, so `large` is a request for room, not a hardcoded frame. Do not add
`size`-related width/minWidth literals in plugin code; widen here instead.

#### Constraining content width: `maxContentWidth`

`size` widens the *dialog*; `maxContentWidth` caps the *content column* inside
it so settings and forms stay readable on large viewports instead of stretching
edge-to-edge. It is additive and defaults to the fully fluid body:

```tsx
// Host allocates a wide dialog; content stays a centered ~600px column.
<ModalBody maxContentWidth={600}>...</ModalBody>
```

The helper applies `width: "100%"` (fluid below the cap) and
`alignSelf: "center"` (centered above it) to its single content column, in both
the host-owned and helper-owned scroll paths. It does not dictate the dialog
frame, so it composes with `size` and the rest of the size contract. Prefer this
over a per-plugin wrapper carrying a `maxWidth` literal.

```tsx
<ModalBody
  header={<Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />}
  headerMode="pinned"
>
  {/* moving page content */}
</ModalBody>
```

```tsx
// Inside a host-provided modal (registerComposerPill `renderModal`), the helper
// already owns `<Modal.Content scrollable={false}>` — just render `ModalBody`:
<ModalBody refreshing={isRefetching} onRefresh={refetch}>
  {/* controls and cards */}
</ModalBody>
```

When the plugin opens its own host `<Modal>`, render `<ModalContent>` (next
section) instead of a raw `<Modal.Content>`, so the host content view gets the
same bounded allocation.

For composer popovers, do not add another `ScrollView` around `ModalBody`.
`registerComposerPill` marks the popover subtree with
`ModalBodyScrollOwnerContext`, allowing Paseo's outer `FloatingScrollView` or
`BottomSheetScrollView` to own scrolling on both desktop and mobile. Keep the
popover wrapper unconstrained: fixed heights and `overflow: hidden` can clip
content before the host scroller measures it.

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

### `<ModalContent>`
Helper-owned replacement for the raw host `<Modal.Content>` when a plugin
renders its own host `<Modal>`. It always passes `scrollable={false}` to the
host content view and renders the shared `<ModalBody>` contract inside it, so
the dialog always takes the host-allocated size and can never end up
content-sized.

Why this exists: Paseo's host maps the default `<Modal.Content scrollable>` to a
desktop card with no explicit height, so a plugin using the raw host content
view gets a dialog that resizes/redraws with its children. `scrollable={false}`
makes the host allocate a bounded dialog (`desktopHeight: "85%"`). Because that
bounded host content view supplies no scroller, `ModalContent` also forces
`ModalBody scrollMode="always"`, so the helper owns the single scroll region on
every surface (desktop included) and long content scrolls instead of clipping.

```tsx
import { Modal } from "@getpaseo/plugin/client/react-native";
import { ModalContent } from "paseo-plugin-helper/client";

<Modal title="My modal" open={open} onOpenChange={setOpen}>
  <ModalContent header={<Tabs … />} headerMode="pinned">
    {/* content */}
  </ModalContent>
</Modal>;
```

`ModalContent` accepts every `ModalBody` prop (`header`, `headerMode`,
`refreshing`, `onRefresh`, `stickToEnd`, `scrollRef`, `debugTag`, `style`,
`contentContainerStyle`, …), so `size?: "default" | "large"` remains the only
size escape hatch. Do not put a raw `<Modal.Content>` in plugin client code.

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

### `useSharedPluginSettings(contract, options?)`
Reactive hook for suite-wide settings shared by independently installed sibling plugins. It wraps
`usePluginSettings` with sync-friendly defaults (`staleTime: 0`, `refetchOnMount: "always"`,
`refetchOnWindowFocus: true`) plus a 2 s background poll, so a value written by another plugin
appears without a reload or reopening the modal. Set `pollIntervalMs: false` to disable polling.

```tsx
import { useSharedPluginSettings } from "paseo-plugin-helper/client";
import { suiteSettingsContract } from "../shared/suite-settings.js";

const { settings, updateSettings } = useSharedPluginSettings(suiteSettingsContract);
```

`useSuiteSettings(options?)` is the same hook bound to the canonical `SuiteSettingsContract`.
Server-side setup lives in `createSharedPluginSettings` (see `docs/server.md` section 15).

### `registerHelperSettingsScreen(client, contract, options)`
Turns a settings contract built by `defineSettingsContract` into a native Paseo settings screen with zero hand-written JSX. Field mapping follows the Zod object schema: boolean fields render as Switch, `z.enum` fields render as Select, string and number fields render as Input. Schema `.describe()` text is used for labels and hints when present, otherwise the field name is used. Unsupported field shapes are skipped with a logged warning and never throw. Values bind through the existing `usePluginSettings(contract)` hook, so the host `useRpc` injected via `initClientHelpers` is reused with no new plumbing. Number fields ignore unparseable keystrokes and keep the last good value, so `NaN` is never written back.

### Shared snapshot keys and no-op guards (`snapshot.ts`)
When pill, modal, and surface views render one host snapshot, route them
through a single workspace-scoped cache identity. `sharedSnapshotKey`
normalizes blank directories to the host-wide entry so `undefined`, `null`,
and `""` never fragment the cache, and `normalizeSnapshotScope` keeps
per-workspace entries separate. Keep selective server-side field params out
of the client key; fetch the shared snapshot and derive per-item views from
it. Settings listeners and live-label caches should gate fan-out with
`shouldEmitSnapshotUpdate` (backed by `shallowEqualRecord`): React Query
returns fresh object identities on every background refetch, and notifying
on identity alone causes redraw loops with no value change.

```tsx
import { sharedSnapshotKey, shouldEmitSnapshotUpdate } from "paseo-plugin-helper/client";

const key = sharedSnapshotKey(myStatusContract.name, workspaceDirectory);
const query = useRpcQuery(myStatusContract, key[1], { refetchInterval: 5000 });

useEffect(() => {
  if (shouldEmitSnapshotUpdate(prevRef.current, settings)) {
    prevRef.current = settings;
    notifySettingsChanged(settings);
  }
}, [settings]);
```

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
Universal cross-platform copy function for Paseo plugins. Works reliably across React Native (mobile webviews / touch events), desktop, and modern secure browsers.
Automatically integrates with Paseo's `useToast()` to display a toast notification on success.
Tier order: host `copyText` from `initClientHelpers` (Paseo 0.8, when supplied), then React Native Clipboard, then `navigator.clipboard`, then an `execCommand` fallback.

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


# Inline actions

Use `InlineButton` for compact links and actions inside timeline cards or
dense content. It keeps touch targets, accent styling, and accessibility
consistent without requiring each plugin to hand-roll a `Pressable`.

```tsx
<InlineButton
  label="Open issue"
  icon="ExternalLink"
  onPress={() => Linking.openURL(url)}
/>
```
