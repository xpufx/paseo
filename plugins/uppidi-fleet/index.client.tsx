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
  AgentSwitcherSidebarItem,
  AgentSwitcherJumpScreen,
  AGENT_SWITCHER_JUMP_SCREEN_ID,
} from "./client/index.js";
import { HostThemeProvider } from "./client/theme.js";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(client: PluginClientContext) {
  const removeSwitcherItem =
    typeof client.addSidebarHeaderItem === "function"
      ? client.addSidebarHeaderItem({
          id: "uppidi-fleet-agent-switcher",
          title: "Agent Switcher",
          Component: AgentSwitcherSidebarItem,
        })
      : undefined;

  const removeSwitcherScreen =
    typeof client.addScreen === "function"
      ? client.addScreen({
          id: AGENT_SWITCHER_JUMP_SCREEN_ID,
          title: "Agent Switcher",
          Component: (props) => (
            <HostThemeProvider theme={props.theme}>
              <AgentSwitcherJumpScreen {...props} />
            </HostThemeProvider>
          ),
        })
      : undefined;

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
    const registrations = [
      removeSwitcherItem,
      removeSwitcherScreen,
      removeSettings,
      removePanel,
      removeSidebar,
    ];
    for (const registration of registrations) {
      if (typeof registration === "function") {
        registration();
      } else if (registration && typeof (registration as any).remove === "function") {
        (registration as any).remove();
      }
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
  AgentSwitcherSidebarItem,
  AgentSwitcherJumpScreen,
  AGENT_SWITCHER_JUMP_SCREEN_ID,
};

