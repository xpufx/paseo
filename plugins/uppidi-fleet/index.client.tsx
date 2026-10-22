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
} from "./client/index.js";

// The helper's structural registrar predates the host's narrower
// `addSidebarHeaderItem` contribution type.
type CompatibleClientContext = PluginClientContext & Parameters<typeof registerSidebarSurface>[0];

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(rawClient: PluginClientContext) {
  const client = rawClient as CompatibleClientContext;

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
};

