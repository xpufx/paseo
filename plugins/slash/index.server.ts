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
  server.handle(slashSettingsContract.get, (_input, context) => handleGetSettings(context));
  server.handle(slashSettingsContract.update, (input, context) => handleUpdateSettings(input, context));
  server.handle(slashSettingsContract.reset, (_input, context) => handleResetSettings(context));
  server.handle(listCommandsRpc, (_input, context) => handleListCommands(context));
  server.handle(catalogRpc, handleListCatalog);
  server.handle(operationsListRpc, handleListOperations);
  server.handle(runCommandRpc, (input, context) => handleRunCommand(input, context));
  server.handle(exportBundleRpc, handleExportBundle);
  server.handle(importBundleRpc, handleImportBundle);
  log.info("slash plugin contributed: send/open/rpc verbs over settings-doc storage");
  return () => {};
}
