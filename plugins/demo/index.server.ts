import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  demoSettingsContract,
  getDemoDataRpc,
  triggerDemoActionRpc,
  demoAgentIdentityContract,
  demoBeaconSetContract,
  demoBeaconBlinkContract,
  demoBeaconClearContract,
} from "./shared/demo.js";
import {
  handleGetDemoData,
  handleTriggerDemoAction,
  handleGetAgentIdentity,
  handleDemoBeaconSet,
  handleDemoBeaconBlink,
  handleDemoBeaconClear,
  settingsHandlers,
  backgroundWorker,
  demoBeacon,
  log,
} from "./server/demo.js";
import { suiteSettings, suiteSettingsHandlers } from "./server/suite-settings.js";
import { demoSettingsSnapshotContract } from "./shared/server-settings.js";
import {
  handleGetServerSettingsSnapshot,
  registerDemoServerSettings,
} from "./server/server-settings.js";

export default function contribute(server: PluginServerContext) {
  // TEMP DEMO (issue #62): upstream registerSettings() -> read()/subscribe().
  const serverSettings = registerDemoServerSettings(server);
  server.handle(demoSettingsSnapshotContract, handleGetServerSettingsSnapshot);
  server.handle(demoSettingsContract.get, settingsHandlers.get);
  server.handle(demoSettingsContract.update, settingsHandlers.update);
  server.handle(demoSettingsContract.reset, settingsHandlers.reset);
  server.handle(suiteSettings.contract.get, suiteSettingsHandlers.get);
  server.handle(suiteSettings.contract.update, suiteSettingsHandlers.update);
  server.handle(suiteSettings.contract.reset, suiteSettingsHandlers.reset);
  server.handle(getDemoDataRpc, handleGetDemoData);
  server.handle(triggerDemoActionRpc, handleTriggerDemoAction);
  server.handle(demoAgentIdentityContract, handleGetAgentIdentity);
  server.handle(demoBeaconSetContract, handleDemoBeaconSet);
  server.handle(demoBeaconBlinkContract, handleDemoBeaconBlink);
  server.handle(demoBeaconClearContract, handleDemoBeaconClear);

  log.info("Helper demo server handlers registered");

  return () => {
    backgroundWorker.stop();
    demoBeacon.stopAll();
    serverSettings.dispose();
    log.info("Helper demo server background task stopped");
  };
}
