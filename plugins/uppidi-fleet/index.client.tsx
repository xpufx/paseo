import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import React, { View } from "react";
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

// --- Safe shim components for when @getpaseo/plugin/client/react-native has empty exports ---
// These prevent Hermes TypeError: Cannot read properties of undefined (reading 'prototype')

/** Shim Icon: renders nothing when icon name is falsy; safe for Hermes. */
const ShimIcon = ({ name }: { name: string }) => (name ? null : null);

/** Shim Modal: simple view wrapper. */
const ShimModal = ({
  children,
}: {
  children: React.ReactNode;
}) => <View>{children}</View>;

/** Shim useToast: no-op toast implementation. */
const ShimUseToast = (() => {
  const show = (_: string) => {};
  const copied = (_?: string) => {};
  const error = (_: string) => {};
  return { show, copied, error };
})();

/** Shim copyText: no-op implementation. */
const ShimCopyText = async (_: string) => {
  /* no-op */
};

/** Shim ScrollView: simple View placeholder. */
const ShimScrollView = () => <View />;

/** Shim FlatList: simple View placeholder. */
const ShimFlatList = () => <View />;

/** Shim TextInput: simple View placeholder. */
const ShimTextInput = () => <View />;

initClientHelpers({
  Icon: ShimIcon,
  Modal: ShimModal,
  useRpc,
  useToast: ShimUseToast,
  copyText: ShimCopyText,
  ScrollView: ShimScrollView,
  FlatList: ShimFlatList,
  TextInput: ShimTextInput,
});

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

