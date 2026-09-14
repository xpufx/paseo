import { safeSpawn } from "./process.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface PaseoPluginInfo {
  id: string;
  path: string;
  enabled: boolean;
  status: "running" | "disabled" | "failed" | string;
  source?: "directory" | "git" | string;
  remote?: string;
  ref?: string;
  commit?: string;
  error?: string;
}

export type PluginStatusFilter = "all" | "enabled" | "disabled" | "running" | "failed";

export interface ListPluginsOptions {
  /** Filter results by status or enablement. Defaults to "all". */
  filter?: PluginStatusFilter;
  /** In-memory TTL cache duration in milliseconds. Defaults to 5000ms. */
  cacheTtlMs?: number;
  /** If true, bypasses the in-memory cache and queries the daemon fresh. */
  forceRefresh?: boolean;
}

let cachedPlugins: PaseoPluginInfo[] | null = null;
let lastFetchTime = 0;

/**
 * Clears the in-memory plugin list cache.
 */
export function clearPluginCache(): void {
  cachedPlugins = null;
  lastFetchTime = 0;
}

/**
 * Reads configured plugins fallback from ~/.paseo/config.json when CLI is unavailable.
 */
function readConfigPluginsFallback(): PaseoPluginInfo[] {
  try {
    const configPath = path.join(os.homedir(), ".paseo", "config.json");
    if (!fs.existsSync(configPath)) return [];
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const pluginsObj = parsed?.plugins;
    if (!pluginsObj || typeof pluginsObj !== "object") return [];

    return Object.entries(pluginsObj).map(([id, val]: [string, any]) => {
      const isEnabled = val?.enabled !== false;
      return {
        id,
        path: val?.path ?? "",
        enabled: isEnabled,
        status: isEnabled ? "unknown" : "disabled",
        source: val?.source,
        remote: val?.remote,
        ref: val?.ref,
        commit: val?.commit,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Lists plugins from the Paseo daemon, with optional filtering and TTL caching.
 * Primary mechanism uses 'paseo plugin ls --json', with fallback to ~/.paseo/config.json.
 */
export async function listPlugins(options: ListPluginsOptions = {}): Promise<PaseoPluginInfo[]> {
  const { filter = "all", cacheTtlMs = 5000, forceRefresh = false } = options;
  const now = Date.now();

  if (!forceRefresh && cachedPlugins && now - lastFetchTime < cacheTtlMs) {
    return applyFilter(cachedPlugins, filter);
  }

  let plugins: PaseoPluginInfo[] = [];

  try {
    const result = await safeSpawn("paseo", ["plugin", "ls", "--json"], { timeoutMs: 3000 });
    if (result.code === 0 && result.stdout.trim()) {
      plugins = JSON.parse(result.stdout.trim());
    } else {
      plugins = readConfigPluginsFallback();
    }
  } catch {
    plugins = readConfigPluginsFallback();
  }

  cachedPlugins = plugins;
  lastFetchTime = now;

  return applyFilter(plugins, filter);
}

function applyFilter(plugins: PaseoPluginInfo[], filter: PluginStatusFilter): PaseoPluginInfo[] {
  switch (filter) {
    case "enabled":
      return plugins.filter((p) => p.enabled);
    case "disabled":
      return plugins.filter((p) => !p.enabled);
    case "running":
      return plugins.filter((p) => p.status === "running");
    case "failed":
      return plugins.filter((p) => p.status === "failed");
    case "all":
    default:
      return plugins;
  }
}

/**
 * Retrieves metadata for a specific plugin by ID.
 * Returns null if the plugin is not installed or found.
 */
export async function getPluginInfo(
  pluginId: string,
  options?: { cacheTtlMs?: number; forceRefresh?: boolean },
): Promise<PaseoPluginInfo | null> {
  const plugins = await listPlugins(options);
  return plugins.find((p) => p.id === pluginId) ?? null;
}

/**
 * Checks whether a plugin is installed in Paseo.
 */
export async function isPluginInstalled(
  pluginId: string,
  options?: { cacheTtlMs?: number; forceRefresh?: boolean },
): Promise<boolean> {
  const info = await getPluginInfo(pluginId, options);
  return info !== null;
}

/**
 * Checks whether a plugin is installed and marked as enabled in Paseo.
 */
export async function isPluginEnabled(
  pluginId: string,
  options?: { cacheTtlMs?: number; forceRefresh?: boolean },
): Promise<boolean> {
  const info = await getPluginInfo(pluginId, options);
  return info !== null && info.enabled;
}

/**
 * Checks whether a plugin is currently running in the Paseo daemon.
 */
export async function isPluginRunning(
  pluginId: string,
  options?: { cacheTtlMs?: number; forceRefresh?: boolean },
): Promise<boolean> {
  const info = await getPluginInfo(pluginId, options);
  return info !== null && info.status === "running";
}
