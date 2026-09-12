import {
  createPluginLogger,
  createPeriodicTask,
  findAvailablePort,
  getSystemMetrics,
  PluginStorage,
  createSettingsHandlers,
  createWorkspaceBeacon,
  type BeaconDaemonClient,
} from "paseo-plugin-helper/server";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
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

export const demoBeacon = createWorkspaceBeacon();

function extractDaemonClient(paseo: PluginHandlerContext["paseo"]): BeaconDaemonClient | null {
  const candidate = paseo as unknown as Record<string, unknown>;
  if (typeof candidate["setWorkspaceLabel"] === "function") {
    return candidate as unknown as BeaconDaemonClient;
  }
  for (const key of ["daemonClient", "client", "daemon"]) {
    const nested = candidate[key] as Record<string, unknown> | undefined;
    if (nested && typeof nested["setWorkspaceLabel"] === "function") {
      return nested as unknown as BeaconDaemonClient;
    }
  }
  return paseo as unknown as BeaconDaemonClient;
}

function wireBeaconForWorkspace(paseo: PluginHandlerContext["paseo"], workspaceId: string): void {
  demoBeacon.setOptions({
    workspaceHandle: {
      setTitle: (title: string) => paseo.workspaces.ref(workspaceId).setTitle(title),
    },
    daemonClient: extractDaemonClient(paseo),
  });
}

async function resolveBaseTitle(
  paseo: PluginHandlerContext["paseo"],
  workspaceId: string,
): Promise<void> {
  try {
    const handle = paseo.workspaces.ref(workspaceId);
    const snapshot = handle.current() ?? (await handle.refresh());
    const baseTitle = (snapshot as { title?: unknown } | null)?.title;
    if (typeof baseTitle === "string" && baseTitle.length > 0) {
      demoBeacon.setOptions({ baseTitle });
    }
  } catch {
    // Best-effort only; beacon falls back to stored/original title.
  }
}

export async function handleDemoBeaconSet(
  input: { workspaceId: string; name: string; color: string },
  context: PluginHandlerContext,
) {
  wireBeaconForWorkspace(context.paseo, input.workspaceId);
  await resolveBaseTitle(context.paseo, input.workspaceId);
  const result = await demoBeacon.set({
    workspaceId: input.workspaceId,
    name: input.name,
    color: input.color,
    titleSuffix: ` \u25CF ${input.name}`,
  });
  log.info(`Demo beacon set "${input.name}" (${input.color}) on ${input.workspaceId}`);
  return {
    success: true,
    message: `Beacon "${input.name}" (${input.color}) applied`,
    labelApplied: result.labelApplied,
    titleApplied: result.titleApplied,
  };
}

export async function handleDemoBeaconBlink(
  input: { workspaceId: string; rounds: number },
  context: PluginHandlerContext,
) {
  wireBeaconForWorkspace(context.paseo, input.workspaceId);
  await resolveBaseTitle(context.paseo, input.workspaceId);
  demoBeacon.blink({
    workspaceId: input.workspaceId,
    a: { name: "DEMO:ACTIVE", color: "emerald", titleSuffix: " \u25CF DEMO:ACTIVE" },
    b: { name: "DEMO:ACTIVE", color: "orange", titleSuffix: " \u25CF DEMO:ACTIVE" },
    intervalMs: 1000,
    rounds: input.rounds,
  });
  log.info(`Demo beacon blink started on ${input.workspaceId} for ${input.rounds} rounds`);
  return {
    success: true,
    message: `Beacon blinking emerald <-> orange for ${input.rounds} rounds`,
  };
}

export async function handleDemoBeaconClear(
  input: { workspaceId: string; name: string },
  context: PluginHandlerContext,
) {
  wireBeaconForWorkspace(context.paseo, input.workspaceId);
  const result = await demoBeacon.clear({ workspaceId: input.workspaceId, name: input.name });
  log.info(`Demo beacon cleared on ${input.workspaceId}`);
  return {
    success: true,
    message: "Beacon cleared, original title restored",
    labelCleared: result.labelCleared,
    titleRestored: result.titleRestored,
  };
}
