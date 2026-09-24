# Plugin Surfaces, Workspace Panels & Navigation

> Detailed specification and patterns for creating full-screen sidebar views, workspace tabs, Explorer-embedded panels, Command Center actions, and composer slash commands.
>
> **References**:
> - [Upstream Surfaces Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#surfaces-and-sidebar-items)
> - [Upstream Workspace Panels Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#workspace-panels)
> - [Upstream Command Center Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#command-center-items)
> - [Upstream Slash Commands Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#slash-commands)
> - [Local Plugin Example](file:///home/xpufx/code/3rdparty/paseo/paseo/plugin-examples/local-plugin)

---

## Table of Contents

1. [Sidebar Surfaces (`addSurface` + `addSidebarItem`)](#1-sidebar-surfaces)
2. [Helper-Assisted Surface (`registerSidebarSurface`)](#2-helper-assisted-surface)
3. [Workspace Panels (`addWorkspacePanel`)](#3-workspace-panels)
4. [Explorer Sidebar Hosting (`locations: ["explorer"]`)](#4-explorer-sidebar-hosting)
5. [Reading Host State (`useWorkspace` & `useAgent`)](#5-reading-host-state)
6. [Command Center Items (`addCommandCenterItem`)](#6-command-center-items)
7. [Client Slash Commands (`addSlashCommand`)](#7-client-slash-commands)

---

## 1. Sidebar Surfaces

A sidebar surface is a dedicated full-screen view inside Paseo, reachable from the top navigation list in the app sidebar.

### Surface Architecture
- **Host Ownership**: Paseo owns the route navigation, header title, Lucide icon rendering, host selector dropdown, close action, and the crash error boundary.
- **Plugin Ownership**: The plugin component renders everything inside the scrollable body below the header.
- **Multi-Host Coalescing**: When the same plugin is installed across multiple connected daemons, Paseo shows a single sidebar row and provides a host picker in the screen header. The selected host supplies the RPC transport, bundle, and TanStack Query cache.

### Core SDK Pattern
```tsx
// client/main-surface.tsx
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";

export function MainSurface({ theme, host, layout, navigation }: PluginSurfaceProps) {
  const styles = useMemo(
    () => ({
      container: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        backgroundColor: theme.colors.surface0,
      },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24 },
      subtitle: { color: theme.colors.foregroundMuted, marginTop: 4 },
    }),
    [theme, layout.compact],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>System Control</Text>
      <Text style={styles.subtitle}>Connected to {host.label} ({layout.platform})</Text>
    </View>
  );
}
```

```tsx
// index.client.tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { MainSurface } from "./client/main-surface";

export default function contribute(client: PluginClientContext) {
  // 1. Register the surface component
  client.addSurface("system-control", MainSurface);

  // 2. Register the sidebar item linking to the surface
  const removeSidebar = client.addSidebarItem({
    id: "system-control",
    title: "System Control",
    icon: "Server", // Valid Lucide icon name
    surface: "system-control",
  });

  return () => {
    removeSidebar();
  };
}
```

### `PluginSurfaceProps` Definition
| Prop | Type | Description |
| :--- | :--- | :--- |
| `theme` | `PluginTheme` | Typed theme tokens (`colors`, `appearance: "light" \| "dark"`). |
| `host` | `{ id: string, label: string }` | Selected daemon host identity and display name. |
| `layout` | `{ compact: boolean, platform: "ios" \| "android" \| "web" }` | Viewport constraints (`compact: true` on mobile/narrow panes). |
| `navigation` | `PluginNavigation` | Optional router actions: `openAgent({ agentId })`, `openWorkspace({ workspaceId })`, `openBrowser({ url })`. |

---

## 2. Helper-Assisted Surface (`registerSidebarSurface`)

In `paseo-plugin-helper/client`, `registerSidebarSurface` wraps `addSurface` and `addSidebarItem` into one call and automatically provides theme flair propagation:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerSidebarSurface, Card, KeyValue, Row } from "paseo-plugin-helper/client";

export function contributeSurface(client: PluginClientContext) {
  return registerSidebarSurface(client, {
    id: "fleet-overview",
    title: "Fleet Overview",
    icon: "Cpu",
    flair: { radius: "rounded", density: "comfortable" },
    render({ host }) {
      return (
        <Card>
          <KeyValue label="Host Daemon" value={host.label} />
        </Card>
      );
    },
  });
}
```

---

## 3. Workspace Panels

A workspace panel opens as a tab beside agent chats, terminals, files, and diff editors within a workspace.

### Core SDK Pattern
```tsx
// client/overview-panel.tsx
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useWorkspace } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";

export function OverviewPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  // Select fields with shallow equality to avoid rerenders on unrelated changes
  const workspace = useWorkspace(workspaceId, ({ name, directory }) => ({ name, directory }));

  const styles = useMemo(
    () => ({
      panel: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        backgroundColor: theme.colors.surface0,
      },
      name: { color: theme.colors.foreground, fontSize: 18, fontWeight: "600" as const },
      path: { color: theme.colors.foregroundMuted, marginTop: 4 },
    }),
    [theme, layout.compact],
  );

  return (
    <View style={styles.panel}>
      <Text style={styles.name}>{workspace?.name}</Text>
      <Text style={styles.path}>{workspace?.directory}</Text>
    </View>
  );
}
```

```tsx
// Registration in index.client.tsx
client.addWorkspacePanel({
  id: "overview",
  title: "Workspace Overview",
  icon: "PanelsTopLeft",
  context: "workspace", // "workspace" or "agent"
  Component: OverviewPanel,
});
```

---

## 4. Explorer Sidebar Hosting

Workspace-scoped panels can opt into hosting inside Paseo’s Explorer sidebar alongside Files and Changes:

```tsx
client.addWorkspacePanel({
  id: "git-forge-issues",
  title: "Issues",
  icon: "CircleDot",
  context: "workspace",
  locations: ["workspace", "explorer"], // Allow rendering in both workspace tabs and Explorer sidebar
  Component: GitIssuesPanel,
});
```

> [!NOTE]
> `locations` controls where Paseo allows the panel to mount; context remains strictly scoped to `workspaceId`. An agent-context panel cannot be hosted inside the Explorer sidebar.

---

## 5. Reading Host State (`useWorkspace` & `useAgent`)

Plugins must read normalized client state synchronously using required selectors:

```tsx
import { useAgent, useWorkspace } from "@getpaseo/plugin/client";

function AgentInspector({ agentId, workspaceId }: { agentId: string; workspaceId: string }) {
  // Good: Select only the required fields
  const agentStatus = useAgent(agentId, (agent) => agent.status);
  const workspaceName = useWorkspace(workspaceId, (ws) => ws.name);

  // BAD (Anti-pattern): Selecting whole object or fetching via RPC
  // const agent = useAgent(agentId, (a) => a); // Causes constant re-renders
  // const agent = await rpc(getAgentInfo, { id: agentId }); // Unnecessary latency

  return (
    <View>
      <Text>Agent is {agentStatus} in {workspaceName}</Text>
    </View>
  );
}
```

**Key Invariants**:
- Selectors use shallow equality comparison.
- Snapshots returned to plugins are deeply frozen (`Object.freeze`) at runtime to prevent plugin mutations of app state.

---

## 6. Command Center Items

Command Center items register actions into Paseo’s global search palette (**⌘K** on macOS, **Ctrl+K** on Windows/Linux).

```tsx
client.addCommandCenterItem({
  id: "open-fleet-overview",
  title: "Open Fleet Overview",
  icon: "Activity",
  context: "global", // "global" | "workspace" | "agent"
  onSelect({ openSurface, openPanel, rpc, paseo }) {
    // Open a registered surface or panel
    openSurface("system-control");
  },
});

// Workspace-scoped action
client.addCommandCenterItem({
  id: "open-workspace-issues",
  title: "Open Issue Tracker",
  icon: "CircleDot",
  context: "workspace",
  onSelect({ openPanel, workspace }) {
    openPanel("git-forge-issues");
  },
});
```

---

## 7. Client Slash Commands

Slash commands run custom plugin logic directly inside the composer when submitted as `/command args`.

```tsx
import { myReviewRpc } from "./shared/contracts";

client.addSlashCommand({
  name: "review",
  description: "Run automated security code review",
  argumentHint: "[scope: full|staged]",
  context: "agent", // "agent" or "workspace" (for drafts)
  async onSubmit({ args, agent, rpc, openPanel }) {
    // args contains the trimmed string following "/review"
    await rpc(myReviewRpc, { agentId: agent.id, scope: args });
    openPanel("review-results");
  },
});
```

### Precedence & Invariants:
1. **Collision Order**: Built-in Paseo client commands take first priority, followed by plugin commands, followed by provider slash commands.
2. **Attachments**: Plugin slash commands are suppressed while composer has active image or file attachments.
3. **Execution**: Nothing is sent to the LLM when a slash command fires; execution is purely client-driven.
