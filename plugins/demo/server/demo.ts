import {
  createPluginLogger,
  createPeriodicTask,
  findAvailablePort,
  getSystemMetrics,
  getAgentIdentity,
  PluginStorage,
  createSettingsHandlers,
  createWorkspaceBeacon,
  type BeaconDaemonClient,
} from "./vendor/paseo-plugin-helper/index";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { demoSettingsContract, type DemoData, type DemoSettings } from "../shared/demo.js";
import { PLUGIN_VERSION } from "../shared/version.js";

export const log = createPluginLogger("helper-demo");

export const demoStorage = new PluginStorage<DemoSettings>("helper-demo", "settings.json", {
  schema: demoSettingsContract.schema,
});

export const settingsHandlers = createSettingsHandlers(demoSettingsContract, demoStorage, {
  onUpdate: (newSettings) => {
    log.info("Demo settings updated via RPC:", newSettings);
  },
  onReset: () => {
    log.info("Demo settings reset to default values");
  },
});

let daemonPort = 4280;
let backgroundTicks = 0;

findAvailablePort(4280, 20).then((port) => {
  daemonPort = port;
  log.info(`Showcase demo background service verified on port: ${port}`);
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
  log.info(`Received demo action: "${input.actionName}" at tick ${backgroundTicks}`);
  return {
    success: true,
    message: `Triggered action "${input.actionName}" (Worker tick #${backgroundTicks})`,
  };
}

export async function handleGetAgentIdentity() {
  const identity = await getAgentIdentity();
  return { identity };
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
  if (demoBeacon.hasOriginalTitle(workspaceId)) {
    return;
  }
  try {
    const handle = paseo.workspaces.ref(workspaceId);
    const snapshot = handle.current() ?? (await handle.refresh());
    let rawTitle = (snapshot as { title?: unknown; name?: unknown } | null)?.title;
    if (typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
      rawTitle = (snapshot as { name?: unknown } | null)?.name as string | undefined;
    }
    if (typeof rawTitle === "string" && rawTitle.trim().length > 0) {
      // Strip any leftover beacon suffix if present from previous run
      const cleaned = rawTitle.replace(/\s*[●🟢🟠○◉].*$/, "").trim();
      const finalTitle = cleaned.length > 0 ? cleaned : rawTitle;
      demoBeacon.setOriginalTitle(workspaceId, finalTitle);
      demoBeacon.setOptions({ baseTitle: finalTitle });
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
    titleSuffix: ` 🟢 ${input.name}`,
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
    a: { name: "DEMO:ACTIVE", color: "emerald", titleSuffix: " 🟢 RUNNING" },
    b: { name: "DEMO:WAITING", color: "orange", titleSuffix: " 🟠 WAITING" },
    intervalMs: 1000,
    rounds: input.rounds,
    restoreOnDone: true,
  });
  log.info(`Demo beacon blink started on ${input.workspaceId} for ${input.rounds} rounds`);
  return {
    success: true,
    message: `Beacon blinking 🟢 RUNNING <-> 🟠 WAITING for ${input.rounds} rounds (auto-restores)`,
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
