import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "./client/vendor/paseo-plugin-helper/index";
import { registerSlashCommands } from "./client/commands";
import { SlashConsole } from "./client/console";

initClientHelpers({ Icon, Modal, useRpc, useToast });

export default function contribute(client: PluginClientContext) {
  const removeCommands = registerSlashCommands(client);
  const removeItem = client.addCommandCenterItem({
    id: "slash-console",
    title: "Slash console",
    icon: "Terminal",
    keywords: ["slash", "commands", "macros"],
    context: "agent",
    async onSelect() {},
  });
  void SlashConsole;
  return () => {
    removeItem();
    removeCommands();
  };
}
