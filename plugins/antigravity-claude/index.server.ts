import type { PluginServerContext } from "@getpaseo/plugin/server";
import { installStorageGuard } from "paseo-plugin-helper/server";
import { createAntigravityProvider } from "./server/provider.js";

export default function contribute(server: PluginServerContext) {
  const uninstallStorageGuard = installStorageGuard({
    pluginId: "antigravity-claude",
    allowTmp: true,
  });

  server.registerProvider(createAntigravityProvider());

  return () => {
    uninstallStorageGuard();
  };
}
