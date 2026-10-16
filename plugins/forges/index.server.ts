import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPluginLogger, installStorageGuard } from "paseo-plugin-helper/server";
import { registerTicketHandlers } from "@xpufx/backend-tickets/server";
import { forgeSettingsContract } from "./shared/issues.js";
import { settingsHandlers } from "./server/settings.js";

const log = createPluginLogger("forges");

export default function contribute(server: PluginServerContext) {
  const uninstallStorageGuard = installStorageGuard({ pluginId: "forges" });

  registerTicketHandlers(server);

  // forge.install-labels is operator-only: the optional label-set install is
  // hidden from the release surface (issue #163). handleInstallLabels stays in
  // server/issues.ts for our own board; the RPC is deliberately not registered.
  server.handle(forgeSettingsContract.get, settingsHandlers.get);
  server.handle(forgeSettingsContract.update, settingsHandlers.update);
  server.handle(forgeSettingsContract.reset, settingsHandlers.reset);
  log.info("forges server handlers registered");
  return () => {
    uninstallStorageGuard();
  };
}
