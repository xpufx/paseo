import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers, registerSidebarSurface } from "paseo-plugin-helper/client";
import { UppidiForgeSurface } from "./client/surface";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(client: PluginClientContext) {
  return registerSidebarSurface(client, {
    id: "uppidi-forge",
    title: "Uppidi Forge",
    icon: "GitPullRequest",
    Component: UppidiForgeSurface,
    flair: {
      radius: "rounded",
      density: "comfortable",
      surfaceStyle: "elevated",
      borderWidth: 1,
      headingTransform: "none",
    },
  });
}
