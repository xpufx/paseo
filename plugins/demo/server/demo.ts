import {
  createPluginLogger,
  createPeriodicTask,
  findAvailablePort,
  getSystemMetrics,
  PluginStorage,
  createSettingsHandlers,
} from "paseo-plugin-helper/server";
import { demoSettingsContract, type DemoData, type DemoSettings } from "../shared/demo.js";
import { PLUGIN_VERSION } from "../shared/version.js";

export const log = createPluginLogger("helper-demo-v8");

export const demoStorage = new PluginStorage<DemoSettings>("helper-demo-v8", "settings.json", {
  schema: demoSettingsContract.schema,
});

export const settingsHandlers = createSettingsHandlers(demoSettingsContract, demoStorage, {
  onUpdate: (newSettings) => {
    log.info("Demo v8 settings updated via RPC:", newSettings);
  },
  onReset: () => {
    log.info("Demo v8 settings reset to default values");
  },
});

let daemonPort = 4280;
let backgroundTicks = 0;

findAvailablePort(4280, 20).then((port) => {
  daemonPort = port;
  log.info(`Showcase demo v8 background service verified on port: ${port}`);
});

export const backgroundWorker = createPeriodicTask({
  intervalMs: 3000,
  runImmediately: true,
  task: () => {
    backgroundTicks++;
  },
  onError: (err) => {
    log.error("Periodic background task error:", err);
  },
});

export function handleGetDemoData(): DemoData {
  const metrics = getSystemMetrics();

  return {
    version: PLUGIN_VERSION,
    hostname: metrics.hostname,
    platform: metrics.platform,
    cpuModel: metrics.cpu.model,
    cpuUsagePercent: metrics.cpu.usagePercent,
    memoryUsedPercent: Math.round(metrics.memory.usedPercent),
    memoryUsedBytes: metrics.memory.usedBytes,
    memoryTotalBytes: metrics.memory.totalBytes,
    loadAvg: metrics.cpu.loadAverage,
    uptimeSeconds: metrics.uptimeSeconds,
    daemonPort,
    backgroundTicks,
    items: [
      { id: "1", name: "Core Agent Supervisor", category: "Core", status: "running", loadPercent: 14 },
      { id: "2", name: "Vector Index Pipeline", category: "Data", status: "syncing", loadPercent: 48 },
      { id: "3", name: "MCP Tool Gateway", category: "Network", status: "running", loadPercent: 6 },
      { id: "4", name: "Local Disk Compactor", category: "Storage", status: "idle", loadPercent: 0 },
      { id: "5", name: "Peer Gossip Protocol", category: "Network", status: "warning", loadPercent: 82 },
    ],
  };
}

export function handleTriggerDemoAction(input: { actionName: string }) {
  log.info(`Received demo v8 action: "${input.actionName}" at tick ${backgroundTicks}`);
  return {
    success: true,
    message: `Triggered action "${input.actionName}" (Worker tick #${backgroundTicks})`,
  };
}
