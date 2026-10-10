import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import React, { type ComponentType, type ForwardRefExoticComponent, type ReactElement, type ReactNode, type Ref, type RefAttributes, forwardRef } from "react";
import { View, type ScrollViewProps, type FlatListProps, type TextInputProps } from "react-native";
import type { FlatList as RNFlatList, ScrollView as RNScrollView, TextInput as RNTextInput } from "react-native";
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

// --- Safe shim components matching ClientHostDeps from paseo-plugin-helper/core/host.ts ---
// These prevent Hermes TypeError: Cannot read properties of undefined (reading 'prototype')

/** Shim Icon: matches HostIcon = ComponentType<{ name: string; size?: number; color?: string }> */
const ShimIcon: ComponentType<{ name: string; size?: number; color?: string }> = ({ name, size, color }) => {
  if (!name) return null;
  return null;
};

/** Shim Modal: matches HostModal = ComponentType<HostModalProps> & { Content: ComponentType<HostModalContentProps> } */
const ShimModalContent = ({ children }: { children: ReactNode; scrollable?: boolean }) => <View>{children}</View>;
const ShimModal = Object.assign(
  ({ title, icon, open, onOpenChange, children }: { title: string; icon?: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) => (
    <View>{children}</View>
  ),
  { Content: ShimModalContent }
);

/** Shim useToast: matches HostUseToast = () => HostToast */
const ShimUseToast = () => ({
  show: (_: string, _options?: unknown) => {},
  copied: (_?: string) => {},
  error: (_: string) => {},
});

/** Shim copyText: matches HostCopyText = (text: string) => Promise<void> */
const ShimCopyText = async (_: string): Promise<void> => {
  /* no-op */
};

/** Shim ScrollView: matches HostScrollView = ForwardRefExoticComponent<ScrollViewProps & RefAttributes<RNScrollView>> */
const ShimScrollView = forwardRef<RNScrollView, ScrollViewProps & { children?: ReactNode }>(
  ({ children, ...props }, _ref) => <View {...props}>{children}</View>
) as ForwardRefExoticComponent<ScrollViewProps & RefAttributes<RNScrollView>>;

/** Shim FlatList: matches HostFlatList = <ItemT>(props: FlatListProps<ItemT> & { ref?: Ref<RNFlatList<ItemT>> }) => ReactElement */
const ShimFlatList = ((props: FlatListProps<any> & { ref?: Ref<RNFlatList<any>>; children?: ReactNode }): ReactElement => {
  const { children, ref, ...rest } = props;
  return <View {...rest}>{children}</View>;
}) as <ItemT>(props: FlatListProps<ItemT> & { ref?: Ref<RNFlatList<ItemT>>; children?: ReactNode }) => ReactElement;

/** Shim TextInput: matches HostTextInput = ForwardRefExoticComponent<TextInputProps & RefAttributes<RNTextInput>> */
const ShimTextInput = forwardRef<RNTextInput, TextInputProps & { children?: ReactNode }>(
  ({ children, ...props }, _ref) => <View {...props}>{children}</View>
) as ForwardRefExoticComponent<TextInputProps & RefAttributes<RNTextInput>>;

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

