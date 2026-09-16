import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers, registerSidebarSurface } from "./client/vendor/paseo-plugin-helper/index";
import { registerSlashCommands } from "./client/commands";
import { SlashConsole } from "./client/console";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export default function contribute(client: PluginClientContext) {
  registerSidebarSurface(client, {
    id: "slash-console",
    title: "S/ash console",
    icon: "Terminal",
    Component: SlashConsole,
  });
  const removeCommands = registerSlashCommands(client);
  return () => {
    removeCommands();
  };
}
