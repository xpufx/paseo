import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers, registerSidebarSurface } from "paseo-plugin-helper/client";
import { UppidiFleetSurface, UppidiForgeSurface } from "./client/surface.js";
import {
  UppidiFleetPanel,
  UppidiForgePanel,
  registerWorkspacePanel,
  UPPIDI_FLEET_FLAIR,
  UPPIDI_FORGE_FLAIR,
} from "./client/index.js";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(client: PluginClientContext) {
  const removeSidebar = registerSidebarSurface(client, {
    id: "uppidi-fleet",
    title: "Uppidi Fleet",
    icon: "GitPullRequest",
    Component: UppidiFleetSurface,
    flair: UPPIDI_FLEET_FLAIR,
  });

  const removePanel = client.addWorkspacePanel({
    id: "uppidi-fleet",
    title: "Uppidi Fleet",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: UppidiFleetPanel,
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

export {
  UppidiFleetSurface,
  UppidiForgeSurface,
  UppidiFleetPanel,
  UppidiForgePanel,
  registerWorkspacePanel,
  UPPIDI_FLEET_FLAIR,
  UPPIDI_FORGE_FLAIR,
};
