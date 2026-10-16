import type { PluginServerContext } from "@getpaseo/plugin/server";
import { installStorageGuard } from "paseo-plugin-helper/server";
import {
  pluginUpdatesCheckRpc,
  pluginUpdatesUpdateAllRpc,
  pluginUpdatesUpdateRpc,
} from "./shared/updates";
import {
  checkInstalledPlugins,
  updateAllPlugins,
  updatePlugin,
} from "./server/updates";

export default function contribute(server: PluginServerContext) {
  const uninstallStorageGuard = installStorageGuard({ pluginId: "plugin-updates" });

  server.handle(pluginUpdatesCheckRpc, ({ workspaceId }) => checkInstalledPlugins(workspaceId));
  server.handle(pluginUpdatesUpdateRpc, ({ workspaceId, pluginId, force }) =>
    updatePlugin(pluginId, workspaceId, { force }),
  );
  server.handle(pluginUpdatesUpdateAllRpc, ({ workspaceId, force }) =>
    updateAllPlugins(workspaceId, { force }),
  );
  return () => {
    uninstallStorageGuard();
  };
}
