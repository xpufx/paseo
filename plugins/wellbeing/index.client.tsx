import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  useToast,
  ScrollView,
  FlatList,
  TextInput as HostTextInput,
  copyText,
} from "@getpaseo/plugin/client/react-native";
import { initClientHelpers, registerSidebarSurface } from "paseo-plugin-helper/client";
import { WellbeingSurface } from "./client/surface.js";

initClientHelpers({
  Icon,
  Modal,
  useRpc,
  useToast,
  copyText,
  ScrollView,
  FlatList,
  TextInput: HostTextInput,
});

export default function contribute(client: PluginClientContext) {
  return registerSidebarSurface(client, {
    id: "wellbeing",
    title: "Wellbeing",
    icon: "Heart",
    Component: WellbeingSurface,
    flair: {
      radius: "rounded",
      density: "comfortable",
      surfaceStyle: "elevated",
      borderWidth: 1,
      headingTransform: "none",
    },
  });
}
