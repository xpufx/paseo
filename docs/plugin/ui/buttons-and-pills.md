# Header Buttons, Popovers & Composer Pills

> Guide to contributing custom header action buttons, menu popovers, and composer track bar pills.
>
> **References**:
> - [Upstream Header Buttons Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#header-buttons)
> - [Upstream Composer Pills Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#composer-pills)
> - [Upstream Button Descriptor Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#button-descriptor)
> - [Buttons Example](file:///home/xpufx/code/3rdparty/paseo/paseo/plugin-examples/buttons)
> - [Paseo Top In-Repo Plugin](../../../plugins/top)

---

## Table of Contents

1. [Header Buttons & Popovers](#1-header-buttons--popovers)
   - [Button Descriptors](#button-descriptors)
   - [Dropdown Menus & Popover Panels](#dropdown-menus--popover-panels)
   - [Sheet Teleportation & Context Re-injection](#sheet-teleportation--context-re-injection)
2. [Composer Pills Architecture](#2-composer-pills-architecture)
   - [Raw SDK Pattern (`addComposerPill`)](#raw-sdk-pattern)
3. [The `registerComposerPill` Engine](#3-the-registercomposerpill-engine)
   - [Automated Lifecycle & Subscriptions](#automated-lifecycle--subscriptions)
   - [Modal Dialog Integration](#modal-dialog-integration)
4. [Custom Metric Pills Suite (`registerCustomPills`)](#4-custom-metric-pills-suite)

---

## 1. Header Buttons & Popovers

Header buttons appear in the top action bar of Paseo workspace and agent views.

### Button Descriptors
A button descriptor specifies the appearance, badge, and interaction behavior:

```tsx
client.addButton({
  id: "sync-repo",
  title: "Sync Repository",
  icon: "RefreshCw",
  badge: { count: 2, variant: "warning" },
  async onPress() {
    // Action triggered on tap
  },
});
```

### Dropdown Menus & Popover Panels
Header buttons can reveal dropdown action menus or anchored popover panels:

```tsx
client.addButton({
  id: "quick-tools",
  title: "Dev Tools",
  icon: "Wrench",
  menu: [
    { id: "clean", label: "Clean Build Artifacts", icon: "Trash2", onSelect: () => {} },
    { id: "restart", label: "Restart Gateway", icon: "RotateCw", onSelect: () => {} },
  ],
  popover: {
    title: "Quick Diagnostics",
    Component: QuickDiagnosticsPopover,
  },
});
```

### Sheet Teleportation & Context Re-injection
> [!IMPORTANT]
> On mobile and narrow viewports, button popovers teleport into a native bottom sheet.
> When children are teleported, the standard React tree hierarchy is severed. Paseo’s button runtime automatically **rebuilds the installation’s SDK, state, query, and toast providers** inside the teleported sheet so hooks like `usePaseo()` and `useToast()` continue to function seamlessly.

---

## 2. Composer Pills Architecture

Composer pills are per-agent interactive chips residing directly in the prompt composer track bar (alongside **Tasks** and **Subagents**):

```text
┌──────────────────────────────────────────────────────────────┐
│ [Compose a prompt...]                                        │
├──────────────────────────────────────────────────────────────┤
│ [Tasks (3)] [Subagents (1)] | [⚡ CPU 24%] [🔒 2FADo Gate]    │
└──────────────────────────────────────────────────────────────┘
```

### Raw SDK Pattern
When using `@getpaseo/plugin/client` directly, you must subscribe to agent lifecycle updates and manually manage pill teardown:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";

export function contributeClient(client: PluginClientContext) {
  const activePills = new Map<string, () => void>();

  // Subscribe to agent upserts
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind !== "upsert" || !update.agent.workspaceId) return;
    const { id: agentId, workspaceId } = update.agent;

    // Clean previous pill for this agent if present
    activePills.get(agentId)?.();

    // Register composer pill
    const removePill = client.addComposerPill({
      id: "agent-monitor",
      title: "Agent Stats",
      workspaceId,
      agentId,
      Component: ({ theme }) => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ color: theme.colors.foreground }}>Stats</Text>
        </View>
      ),
      async onPress() {
        client.openPanel("agent-stats", { workspaceId, agentId });
      },
    });

    activePills.set(agentId, removePill);
  });

  return () => {
    unsubscribe();
    for (const remove of activePills.values()) remove();
  };
}
```

---

## 3. The `registerComposerPill` Engine

`paseo-plugin-helper/client` provides `registerComposerPill`, which completely automates agent tracking, idempotent teardown, modal state machines, and visual theme flair:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  registerComposerPill,
  ModalBody,
  Card,
  KeyValue,
  Badge,
  Button,
  useRpcQuery,
} from "paseo-plugin-helper/client";
import { agentStatsContract } from "./shared/contracts";

export function contributePills(client: PluginClientContext) {
  return registerComposerPill(client, {
    id: "system-stats",
    title: "System Stats",
    icon: "Activity",
    flair: {
      radius: "rounded",
      density: "comfortable",
      accentColor: "#3b82f6",
    },
    // Optional dynamic badge on the pill chip
    resolveBadge({ agentId }) {
      return { count: 1, variant: "warning" };
    },
    // Content rendered inside the dialog/bottom sheet when pill is pressed
    renderModal({ agentId, close }) {
      const { data } = useRpcQuery(agentStatsContract, { agentId });

      return (
        <ModalBody maxContentWidth={540}>
          <Card header="Agent Process Telemetry">
            <KeyValue label="Status" value={data?.status ?? "Checking..."} />
            <KeyValue label="CPU Usage" value={`${data?.cpu ?? 0}%`} />
            <Badge variant="success" label="Active Run" />
          </Card>
          <Button label="Close" variant="secondary" onPress={close} />
        </ModalBody>
      );
    },
  });
}
```

---

## 4. Custom Metric Pills Suite

For plugins monitoring real-time metrics (like `plugins/top`), `registerCustomPills` provides a declarative suite for registering metric chips that auto-refresh:

```tsx
import { registerCustomPills } from "paseo-plugin-helper/client";

export function contributeCustomMetrics(client: PluginClientContext) {
  return registerCustomPills(client, {
    suiteId: "top-metrics",
    metrics: [
      {
        id: "cpu",
        label: "CPU",
        icon: "Cpu",
        resolveValue: (stats) => `${stats.cpu}%`,
        resolveStatus: (stats) => (stats.cpu > 80 ? "error" : stats.cpu > 60 ? "warning" : "normal"),
      },
      {
        id: "mem",
        label: "RAM",
        icon: "HardDrive",
        resolveValue: (stats) => `${stats.mem}%`,
      },
    ],
  });
}
```
