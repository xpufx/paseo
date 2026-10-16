import type { PluginServerContext } from "@getpaseo/plugin/server";
import { installStorageGuard } from "paseo-plugin-helper/server";
import { registerAgentMuxHandlers } from "./server/handlers.js";

export default function contribute(server: PluginServerContext) {
  const uninstallStorageGuard = installStorageGuard({ pluginId: "agent-mux" });
  registerAgentMuxHandlers(server);
  return () => {
    uninstallStorageGuard();
  };
}
