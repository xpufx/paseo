import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast, ScrollView, FlatList, TextInput as HostTextInput, copyText } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "./client/vendor/paseo-plugin-helper/index";
import { registerSlashCommands } from "./client/commands";
import { SlashConsole } from "./client/console";

initClientHelpers({ Icon, Modal, useRpc, useToast, copyText, ScrollView, FlatList, TextInput: HostTextInput });

export const SLASH_CONSOLE_SETTINGS_ID = "slash-console";

export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: SLASH_CONSOLE_SETTINGS_ID,
    title: "Slash console",
    icon: "Terminal",
    Component: SlashConsole,
  });
  const removeCommands = registerSlashCommands(client);
  const removeItem = client.addCommandCenterItem({
    id: "slash-console",
    title: "Slash console",
    icon: "Terminal",
    keywords: ["slash", "commands", "macros"],
    context: "agent",
    async onSelect(ctx) {
      ctx.openSettings(SLASH_CONSOLE_SETTINGS_ID);
    },
  });
  return () => {
    removeItem();
    removeCommands();
    removeSettings();
  };
}
