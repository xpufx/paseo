import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers, registerSidebarSurface } from "paseo-plugin-helper/client";
import { UppidiForgeSurface } from "./client/surface.js";
import { UppidiForgePanel, registerWorkspacePanel, UPPIDI_FORGE_FLAIR } from "./client/index.js";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(client: PluginClientContext) {
  const removeSidebar = registerSidebarSurface(client, {
    id: "uppidi-forge",
    title: "Uppidi Forge",
    icon: "GitPullRequest",
    Component: UppidiForgeSurface,
    flair: UPPIDI_FORGE_FLAIR,
  });

  const removePanel = client.addWorkspacePanel({
    id: "uppidi-forge",
    title: "Uppidi Forge",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: UppidiForgePanel,
  });

  return () => {
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

export { UppidiForgePanel, registerWorkspacePanel };
