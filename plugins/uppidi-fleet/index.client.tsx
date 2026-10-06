import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import {
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
  SettingsSelect,
  SettingsInput,
} from "@getpaseo/plugin/client/ui";
import { initClientHelpers } from "paseo-plugin-helper/core";
import { registerSidebarSurface } from "paseo-plugin-helper/lifecycle";
import { registerHelperSettingsScreen } from "paseo-plugin-helper/ui";
import { uppidiFleetSettingsContract } from "./shared/contracts.js";
import { UppidiFleetSurface, UppidiForgeSurface } from "./client/surface.js";
import {
  UppidiFleetPanel,
  UppidiForgePanel,
  UppidiFleetSidebar,
  registerWorkspacePanel,
  AgentSwitcherHeaderIcon,
  AgentSwitcherPopover,
} from "./client/index.js";
import { HostThemeProvider } from "./client/theme.js";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(client: PluginClientContext) {
  const headerButtons = new Map<string, () => void>();

  const addSwitcherButton = (workspaceId: string) => {
    if (!workspaceId || headerButtons.has(workspaceId)) return;
    if (typeof client.addHeaderButton === "function") {
      const registration = client.addHeaderButton({
        id: "uppidi-fleet-agent-switcher",
        workspaceId,
        button: {
          title: "Agent Switcher",
          icon: AgentSwitcherHeaderIcon,
          behavior: {
            kind: "popover",
            Content: (props) => (
              <HostThemeProvider theme={props.theme}>
                <AgentSwitcherPopover {...props} />
              </HostThemeProvider>
            ),
          },
        },
      });
      headerButtons.set(workspaceId, () => {
        if (typeof registration?.remove === "function") {
          registration.remove();
        }
      });
    }
  };

  const unsubscribeAgents = client.paseo?.agents?.subscribe?.((update: any) => {
    if (update.kind !== "upsert" || !update.agent?.workspaceId) return;
    addSwitcherButton(update.agent.workspaceId);
  });

  if (client.paseo?.agents?.list) {
    void Promise.resolve()
      .then(() => client.paseo.agents.list())
      .then(
        (res: any) => {
          const entries = Array.isArray(res?.entries) ? res.entries : [];
          for (const { agent } of entries) {
            if (typeof agent?.workspaceId === "string") {
              addSwitcherButton(agent.workspaceId);
            }
          }
        },
        (err) => console.warn("[uppidi-fleet] Failed to list agents for header switcher:", err),
      );
  }

  const removeSidebar = registerSidebarSurface(client, {
    id: "uppidi-fleet",
    title: "Uppidi Fleet",
    icon: "GitPullRequest",
    Component: UppidiFleetSidebar,
  });

  const removePanel = client.addWorkspacePanel({
    id: "uppidi-fleet",
    title: "Uppidi Fleet",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: UppidiFleetPanel,
  });

  const removeSettings = registerHelperSettingsScreen(client, uppidiFleetSettingsContract, {
    ui: { SettingsCard, SettingsSection, SettingsSwitch, SettingsSelect, SettingsInput },
    id: "uppidi-fleet",
    title: "Uppidi Fleet",
    icon: "GitPullRequest",
    labels: {
      hookHost: "Hook service listen host",
      hookPort: "Hook service listen port",
    },
  });

  return () => {
    if (typeof unsubscribeAgents === "function") {
      unsubscribeAgents();
    }
    for (const remove of headerButtons.values()) {
      remove();
    }
    headerButtons.clear();

    if (typeof removeSettings === "function") {
      removeSettings();
    } else if (removeSettings && typeof (removeSettings as any).remove === "function") {
      (removeSettings as any).remove();
    }
    if (typeof removePanel === "function") {
      removePanel();
    } else if (removePanel && typeof (removePanel as any).remove === "function") {
      (removePanel as any).remove();
    }
    if (typeof removeSidebar === "function") {
      removeSidebar();
    } else if (removeSidebar && typeof (removeSidebar as any).remove === "function") {
      (removeSidebar as any).remove();
    }
  };
}

export {
  UppidiFleetSurface,
  UppidiForgeSurface,
  UppidiFleetPanel,
  UppidiForgePanel,
  UppidiFleetSidebar,
  registerWorkspacePanel,
  AgentSwitcherHeaderIcon,
  AgentSwitcherPopover,
};

