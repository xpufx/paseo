import type { PluginContext } from "@getpaseo/plugin";
import {
  getDemoDataRpc,
  triggerDemoActionRpc,
  demoSettingsContract,
} from "./demo.shared.js";
import {
  handleGetDemoData,
  handleTriggerDemoAction,
  settingsHandlers,
  backgroundWorker,
  log,
} from "./demo.server.js";
import { contributeClient } from "./pill.client.js";

export default function contribute(plugin: PluginContext) {
  plugin.handle(demoSettingsContract.get, settingsHandlers.get);
  plugin.handle(demoSettingsContract.update, settingsHandlers.update);
  plugin.handle(demoSettingsContract.reset, settingsHandlers.reset);
  plugin.handle(getDemoDataRpc, handleGetDemoData);
  plugin.handle(triggerDemoActionRpc, handleTriggerDemoAction);
  plugin.addClientSide(contributeClient);

  return () => {
    backgroundWorker.stop();
    log.info("Helper demo plugin cleaned up cleanly");
  };
}
