# helper-demo

> A comprehensive reference plugin for [Paseo](https://github.com/getpaseo/paseo) exercising all client UI design system primitives, mobile modal gesture architecture, and server daemon utilities provided by [`paseo-plugin-helper`](../README.md).

---

## Installing & Running

In Paseo:

```bash
# Install directly from GitHub:
paseo plugin add xpufx/paseo-plugin-helper:demo

# Or install locally during library development:
paseo plugin add ./demo
```

To reload after building changes:

```bash
paseo plugin reload helper-demo
```

---

## Showcase Tabs & Features

Open the `demo` composer pill to explore the modal showcase:

### 1. 📊 Gauges & Hardware
- **Metric Gauges**: `<MetricGauge>` circular SVG rings with automatic warning/danger status coloring based on dynamic thresholds.
- **Linear Progress**: `<ProgressBar>` with rounded track styles.
- **Host Info**: Multi-column `<KeyValueGroup>` and `<KeyValue>` with copy-to-clipboard, uptime formatting, and hardware details.

### 2. 🎨 Visual Flair Studio
- **Corner Radius Preset**: Toggle live between `sharp` (2px), `rounded` (8px), and `pill` (9999px).
- **Layout Density**: Switch between `compact`, `comfortable`, and `spacious` padding and typography scales.
- **Surface Treatment**: Switch card and container backgrounds between `flat`, `tinted`, and `elevated`.
- **Container Border Width**: Adjust outline stroke width (`0px`, `1px`, `2px`, `3px`).
- **Brand Accent Colors**: Color swatches (`Indigo`, `Emerald`, `Violet`, `Amber`, `Rose`, `Cyan`) dynamically overriding the active palette.
- **Heading Transforms**: Toggle uppercase section headers.
- **Atomic Persistence**: Every flair adjustment is saved immediately to `settings.json` on the daemon via `usePluginSettings` and reflected in the live preview card.

### 3. 📋 Data Table
- **Responsive Reflow**: `<DataTable>` rendering desktop 3-column layouts and auto-collapsing into mobile card rows on compact viewports.
- **Search Filtering**: Live substring search powered by `<SearchInput>`.
- **Status Badges**: Highlighting service statuses with semantic `<Badge>` variants.

### 4. 🎛️ Interactive Controls & Code
- **Form Controls**: `<Toggle>` switches, `<Button>` variants (`primary`, `secondary`, `ghost`), and `<TextInput>`.
- **Daemon RPC Execution**: `useRpcMutation` triggering daemon-side actions with animated loading states and tactile haptic feedback (`triggerHaptic`).
- **Syntax Highlighting**: `<CodeBlock>` with syntax coloring and one-click copy button.

### 5. ⚙️ Plugin Settings
- **Type-Safe Schema**: Backed by `defineSettingsContract` and Zod validation.
- **Live Updating**: Optimistic client cache updates with atomic disk persistence.
- **Settings Reset**: One-click reset to factory defaults with warning haptics.

### 6. 🌐 Network Diagnostics
- **Verified Daemon Sockets**: `findAvailablePort` verification and loopback interface inspection.
- **Connection Checks**: Real-time port ping and host reachability status.

### 7. 📜 System Logs
- **Streaming Daemon Ticks**: Displays real-time daemon background task tick counts and uptime metrics.
- **Formatted Terminal Output**: Rendered via `<CodeBlock>` with syntax styling.

### 8. ℹ️ About Plugin
- **Auto-Resolved Branding**: Automatically fetches and renders the official GitHub avatar from the `repository` or `author` field with matching flair corner radius.
- **Standardized Metadata**: Plugin name, semantic version badge, license tag, and description.
- **External Action Buttons**: Pre-styled touchable buttons for `Repository`, `Report Issue`, and `Documentation`.
- **1-Tap "Copy Diagnostics"**: One-click copying of full environment diagnostics formatted for GitHub issue triage.

---

## Responsive & Mobile Architecture

`helper-demo` is built specifically to demonstrate defense against nested mobile gesture traps:

- **`<ModalBody>`**: Renders a vertical `<ScrollView>` on desktop, but defers scrolling directly to Paseo's host `BottomSheetScrollView` on mobile without creating double-scroll locks.
- **`<Tabs>` Edge Navigation**: Supports both `fit` (viewport-stretching) and `scroll` (ribbon mode with touch-stealing `PanResponder` and elevated `ChevronLeft`/`ChevronRight` buttons).
- **Haptics**: Native tactile feedback via `triggerHaptic` on taps, toggles, and warnings.

