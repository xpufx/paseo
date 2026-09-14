import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  exportBundleRpc,
  importBundleRpc,
  listCommandsRpc,
  runCommandRpc,
  slashSettingsContract,
} from "./shared/resources";
import {
  handleExportBundle,
  handleGetSettings,
  handleImportBundle,
  handleListCommands,
  handleResetSettings,
  handleRunCommand,
  handleUpdateSettings,
  log,
} from "./server/resources";

export default function contribute(server: PluginServerContext) {
  server.handle(slashSettingsContract.get, handleGetSettings);
  server.handle(slashSettingsContract.update, handleUpdateSettings);
  server.handle(slashSettingsContract.reset, handleResetSettings);
  server.handle(listCommandsRpc, handleListCommands);
  server.handle(runCommandRpc, handleRunCommand);
  server.handle(exportBundleRpc, handleExportBundle);
  server.handle(importBundleRpc, handleImportBundle);
  log.info("slash plugin contributed: send/open/rpc verbs over settings-doc storage");
  return () => {};
}
