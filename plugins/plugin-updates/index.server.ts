import type { PluginServerContext } from "@getpaseo/plugin/server";
import { pluginUpdatesCheckRpc } from "./shared/updates";
import { checkInstalledPlugins } from "./server/updates";

export default function contribute(server: PluginServerContext) {
  server.handle(pluginUpdatesCheckRpc, ({ workspaceId }) => checkInstalledPlugins(workspaceId));
  return () => {};
}
