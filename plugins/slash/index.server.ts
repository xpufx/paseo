import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  catalogRpc,
  exportBundleRpc,
  importBundleRpc,
  listCommandsRpc,
  operationsListRpc,
  runCommandRpc,
  slashSettingsContract,
} from "./shared/resources";
import {
  handleExportBundle,
  handleGetSettings,
  handleImportBundle,
  handleListCatalog,
  handleListCommands,
  handleListOperations,
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
  server.handle(catalogRpc, handleListCatalog);
  server.handle(operationsListRpc, handleListOperations);
  server.handle(runCommandRpc, handleRunCommand);
  server.handle(exportBundleRpc, handleExportBundle);
  server.handle(importBundleRpc, handleImportBundle);
  log.info("slash plugin contributed: send/open/rpc verbs over settings-doc storage");
  return () => {};
}
