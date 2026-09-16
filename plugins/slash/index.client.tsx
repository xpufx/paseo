import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers, registerCommandCenterItem, registerSidebarSurface } from "./client/vendor/paseo-plugin-helper/index";
import { registerSlashCommands } from "./client/commands";
import { SlashConsole } from "./client/console";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

const SLASH_CONSOLE_SURFACE = "slash-console";

export default function contribute(client: PluginClientContext) {
  registerSidebarSurface(client, {
    id: SLASH_CONSOLE_SURFACE,
    title: "S/ash console",
    icon: "Terminal",
    Component: SlashConsole,
  });
  const removeCommandCenter = registerCommandCenterItem(client, {
    id: "slash-console",
    title: "S/ash console",
    icon: "Terminal",
    keywords: ["slash", "console", "settings", "commands"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface(SLASH_CONSOLE_SURFACE);
    },
  });
  const removeCommands = registerSlashCommands(client);
  return () => {
    removeCommandCenter();
    removeCommands();
  };
}
