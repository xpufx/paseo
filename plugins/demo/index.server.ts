import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  demoSettingsContract,
  getDemoDataRpc,
  triggerDemoActionRpc,
} from "./shared/demo.js";
import {
  handleGetDemoData,
  handleTriggerDemoAction,
  settingsHandlers,
  backgroundWorker,
  log,
} from "./server/demo.js";
import { suiteSettings, suiteSettingsHandlers } from "./server/suite-settings.js";

export default function contribute(server: PluginServerContext) {
  server.handle(demoSettingsContract.get, settingsHandlers.get);
  server.handle(demoSettingsContract.update, settingsHandlers.update);
  server.handle(demoSettingsContract.reset, settingsHandlers.reset);
  server.handle(suiteSettings.contract.get, suiteSettingsHandlers.get);
  server.handle(suiteSettings.contract.update, suiteSettingsHandlers.update);
  server.handle(suiteSettings.contract.reset, suiteSettingsHandlers.reset);
  server.handle(getDemoDataRpc, handleGetDemoData);
  server.handle(triggerDemoActionRpc, handleTriggerDemoAction);

  log.info("Helper demo v8 server handlers registered");

  return () => {
    backgroundWorker.stop();
    log.info("Helper demo v8 server background task stopped");
  };
}
