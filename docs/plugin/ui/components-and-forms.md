# Plugin Components, Layout & Settings Forms

> Comprehensive catalog of Paseo Host UI primitives, Settings form components, and the `paseo-plugin-helper/client` design system.
>
> **References**:
> - [Upstream Host UI Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#host-ui)
> - [Upstream Settings Screens Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#settings-screens)
> - [Modal UI Example](file:///home/xpufx/code/3rdparty/paseo/paseo/plugin-examples/modal-ui)
> - [Settings Example](file:///home/xpufx/code/3rdparty/paseo/paseo/plugin-examples/settings)
> - [`paseo-plugin-helper/docs/client.md`](../../../packages/paseo-plugin-helper/docs/client.md)

---

## Table of Contents

1. [Upstream Host UI Primitives](#1-upstream-host-ui-primitives)
   - [`Modal` & `Modal.Content`](#modal--modalcontent)
   - [`Icon`](#icon)
   - [`useToast`](#usetoast)
2. [Upstream Settings Screens & Forms](#2-upstream-settings-screens--forms)
3. [The Modal Size Contract & Containers (`ModalBody`, `ModalContent`)](#3-the-modal-size-contract--containers)
4. [Helper Layout Primitives (`Row`, `Stack`, `Grid`, `ActionBar`)](#4-helper-layout-primitives)
5. [Interactive & Presentation Components](#5-interactive--presentation-components)
   - [`Tabs` with Edge Navigation](#tabs-with-edge-navigation)
   - [`Card`](#card)
   - [`Button` & `InlineButton`](#button--inlinebutton)
   - [`CopyButton`](#copybutton)
   - [`KeyValue` & `KeyValueGroup`](#keyvalue--keyvaluegroup)
   - [`MetricGauge` & `ProgressBar`](#metricgauge--progressbar)
   - [`DataTable`](#datatable)
   - [`AboutSection`](#aboutsection)
   - [`ForgeIcon`](#forgeicon)
   - [`AttentionBeacon` & `StatusDot`](#attentionbeacon--statusdot)
   - [`Collapsible` & `CodeBlock`](#collapsible--codeblock)
6. [Data Fetching & Settings Hooks](#6-data-fetching--settings-hooks)

---

## 1. Upstream Host UI Primitives

Imported from `@getpaseo/plugin/client/react-native`:

### `Modal` & `Modal.Content`
Controlled modal rendering centered on desktop and converting to an `AdaptiveModalSheet` bottom sheet on mobile:

```tsx
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export function ControlledDialog() {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <Text>Open Dialog</Text>
      </Pressable>

      <Modal
        title="Diagnostic Details"
        icon={<Icon name="Activity" size={18} />}
        open={open}
        onOpenChange={setOpen}
      >
        <Modal.Content scrollable={false}>
          <Text>Dialog body content</Text>
        </Modal.Content>
      </Modal>
    </View>
  );
}
```

### `Icon`
Resolves any icon from [Lucide](https://lucide.dev/icons) using Paseo’s internal bundle.
- Unknown icon names render an empty fallback (`null`), guaranteeing that typos will not crash the UI.
- Example: `<Icon name="Terminal" size={16} color={theme.colors.foreground} />`

### `useToast`
Dispatches temporary status notifications within Paseo chrome:
```tsx
import { useToast } from "@getpaseo/plugin/client/react-native";

const toast = useToast();
toast.show("Configuration saved successfully", { variant: "success" });
// variants: "default" | "success" | "warning" | "error"
```

---

## 2. Upstream Settings Screens & Forms

Plugins can contribute dedicated screens to Paseo’s Settings panel via `client.addSettingsScreen`:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  SettingsSection,
  SettingsRow,
  SettingsSwitch,
  SettingsInput,
  SettingsSelect,
  SettingsButton,
} from "@getpaseo/plugin/client/ui";

export function PluginSettings() {
  return (
    <SettingsSection title="Telemetry Preferences" description="Configure telemetry polling intervals">
      <SettingsRow label="Live Refresh" description="Update stats automatically every 2 seconds">
        <SettingsSwitch value={true} onValueChange={(val) => {}} />
      </SettingsRow>
      <SettingsRow label="Log Level">
        <SettingsSelect
          value="info"
          options={[
            { label: "Debug", value: "debug" },
            { label: "Info", value: "info" },
            { label: "Warning", value: "warn" },
          ]}
          onValueChange={(val) => {}}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
```

---

## 3. The Modal Size Contract & Containers

> [!IMPORTANT]
> **Modals do not size themselves.** Plugins must stay fluid within the host-allocated dialog:
> - Never hardcode `width`, `height`, `minWidth`, or `minHeight` on dialog containers.
> - Do not render raw `<Modal.Content>`: Paseo’s default `scrollable={true}` on desktop creates a content-sized card that visibly resizes during state updates.

### `<ModalContent>` and `<ModalBody>`
`paseo-plugin-helper/client` provides drop-in containers enforcing the fluid sizing contract:

```tsx
import { Modal } from "@getpaseo/plugin/client/react-native";
import { ModalBody, ModalContent, Card, Text } from "paseo-plugin-helper/client";

<Modal title="System Details" open={open} onOpenChange={setOpen}>
  <ModalContent size="default" maxContentWidth={640}>
    <Card>
      <Text>Fluid content here</Text>
    </Card>
  </ModalContent>
</Modal>
```

- **Desktop**: Automatically provides bounded scrolling.
- **Mobile (`isCompact: true`)**: Flattens into a safe-inset `<View>`, delegating scrolling cleanly to Paseo’s parent `BottomSheetScrollView` and preventing double-scroll locks.
- **`size="large"`**: The single documented escape hatch for wide data-dense modals (desktop-only; safely ignored on mobile).

---

## 4. Helper Layout Primitives

Stop writing manual `<View style={{ flexDirection: "row", gap: 12 }}>`. Use helper primitives that automatically inherit theme gap tokens:

### `<Row>`
Horizontal flexbox layout:
```tsx
import { Row, StatusDot, Text, Button } from "paseo-plugin-helper/client";

<Row align="center" justify="space-between" gap="sm">
  <Row align="center" gap="xs">
    <StatusDot variant="success" />
    <Text>Daemon Connected</Text>
  </Row>
  <Button label="Refresh" size="sm" variant="ghost" />
</Row>
```

### `<Stack>` / `<VStack>`
Vertical column layout:
```tsx
import { Stack, Text } from "paseo-plugin-helper/client";

<Stack gap="md">
  <Text>Header Section</Text>
  <Text>Detail description</Text>
</Stack>
```

### `<Grid>`
Responsive width-aware grid that gracefully wraps columns down on smaller displays:
```tsx
import { Grid, MetricGauge } from "paseo-plugin-helper/client";

// Displays 4 columns on wide displays, wraps down to 2 or 1 column as width contracts
<Grid columns={4} minColumnWidth={160} gap="sm">
  <MetricGauge label="CPU" value={14} unit="%" />
  <MetricGauge label="RAM" value={68} unit="%" />
  <MetricGauge label="Disk" value={42} unit="%" />
  <MetricGauge label="Net" value={120} unit="KB/s" />
</Grid>
```

---

## 5. Interactive & Presentation Components

### `<Tabs>` with Edge Navigation
Solves horizontal touch hijacking inside mobile modal sheets using `PanResponder` capture:

```tsx
import { Tabs, type TabItem } from "paseo-plugin-helper/client";
import { useState } from "react";

const tabs: TabItem[] = [
  { id: "metrics", label: "Realtime Metrics", shortLabel: "Metrics", icon: "Activity" },
  { id: "logs", label: "System Daemon Logs", shortLabel: "Logs", icon: "Terminal", badge: 4 },
  { id: "settings", label: "Preferences", shortLabel: "Settings", icon: "Settings" },
];

export function TabbedInterface() {
  const [active, setActive] = useState("metrics");

  return (
    <Tabs
      tabs={tabs}
      activeTab={active}
      onTabChange={setActive}
      mode="auto" // "auto" uses shortLabel to fit on mobile; displays chevron arrows if overflowing
    />
  );
}
```

### `<Card>`
```tsx
import { Card, Text, Button } from "paseo-plugin-helper/client";

<Card
  variant="default" // "default" | "elevated" | "flat"
  header="Active Subprocess"
  actions={<Button label="Stop" variant="danger" size="sm" />}
>
  <Text>PID: 12048 • Uptime: 4h 12m</Text>
</Card>
```

### `<Button>` & `<InlineButton>`
- `<Button>`: Standard action button with `primary`, `secondary`, `ghost`, and `danger` variants, automatic 44pt mobile scaling, loading spinners, and Lucide icon support.
- `<InlineButton>`: Compact, accessible action link designed for dense cards and timeline items without custom `Pressable` styles:
```tsx
<InlineButton label="View Raw Log" icon="ExternalLink" onPress={openLog} />
```

### `<CopyButton>`
Clipboard button that executes host `copyText` with a visual "Copied!" checkmark transition:
```tsx
<CopyButton value="git clone https://forge.example.com/repo.git" label="Copy Command" />
```

### `<KeyValue>` & `<KeyValueGroup>`
Structured metadata display:
```tsx
import { KeyValue, KeyValueGroup } from "paseo-plugin-helper/client";

<KeyValueGroup columns={2} minColumnWidth={200}>
  <KeyValue label="Git SHA" value="c89f1a2" mono copyable />
  <KeyValue label="Status" value="Healthy" />
</KeyValueGroup>
```

### `<MetricGauge>` & `<ProgressBar>`
```tsx
<MetricGauge value={75} max={100} label="Memory" unit="%" status="warning" />
<ProgressBar progress={0.65} variant="accent" animated />
```

### `<DataTable>`
```tsx
import { DataTable, type Column } from "paseo-plugin-helper/client";

const columns: Column[] = [
  { id: "name", label: "Task", flex: 2 },
  { id: "status", label: "State", flex: 1 },
];

<DataTable columns={columns} data={[{ id: "1", name: "Build", status: "Done" }]} />
```

### `<AboutSection>`
Renders official plugin version, author attribution, license badge, GitHub logo, and a 1-tap "Copy Diagnostics" bundle:
```tsx
import { AboutSection } from "paseo-plugin-helper/client";

<AboutSection
  pluginId="my-plugin"
  title="Paseo Top"
  version="0.4.0"
  description="Live system resource monitor and telemetry."
  author="xpufx"
  repositoryUrl="https://github.com/xpufx/paseo"
  license="MIT"
/>
```

### `<ForgeIcon>`
Unified brand icon resolver for GitHub, GitLab, Codeberg, Forgejo, and Gitea:
```tsx
import { ForgeIcon } from "paseo-plugin-helper/client";

<ForgeIcon forge="forgejo" size={20} />
```

---

## 6. Data Fetching & Settings Hooks

`paseo-plugin-helper/client` bridges Paseo’s RPC system to TanStack Query:

```tsx
import { useRpcQuery, useRpcMutation } from "paseo-plugin-helper/client";
import { getMetricsRpc, killProcessRpc } from "./shared/contracts";

export function MetricsView({ agentId }: { agentId: string }) {
  // Automatic caching, input hashing, and background refetching
  const { data, isLoading, error } = useRpcQuery(getMetricsRpc, { agentId });

  // Typed mutation
  const killMutation = useRpcMutation(killProcessRpc);

  return (
    <Button
      label="Kill Task"
      loading={killMutation.isPending}
      onPress={() => killMutation.mutate({ pid: 1234 })}
    />
  );
}
```
