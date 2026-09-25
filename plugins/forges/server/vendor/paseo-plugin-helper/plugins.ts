import { safeSpawn } from "./process";
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

/** Normalized presence record returned to plugin code by `listPlugins(context)`. */
export interface PluginPresence {
  id: string;
  status: string;
  enabled: boolean;
}

/**
 * Minimal structural view of the daemon plugin surface a plugin may reach
 * through `context.paseo`. Current SDK `PaseoApi` exposes no plugins actions,
 * so this stays optional and duck-typed; when absent the helper falls back to
 * the daemon's existing `paseo plugin ls --json` query.
 */
export interface PaseoPluginsSurface {
  list(): Promise<unknown>;
}

/**
 * Handler/hook context shape plugin server code passes to the presence API.
 * `paseo` stays `unknown` so the real `PluginHandlerContext` (whose `paseo` is
 * the SDK `PaseoApi`) is assignable even though current SDK builds expose no
 * plugins actions; the surface is duck-typed at call time.
 */
export interface PluginRegistryContext {
  paseo?: unknown;
}

export interface PluginQueryOptions {
  cacheTtlMs?: number;
  forceRefresh?: boolean;
}

interface PresenceCache {
  at: number;
  plugins: PluginPresence[];
}

let cachedPlugins: PaseoPluginInfo[] | null = null;
let lastFetchTime = 0;
let cachedPresence: PresenceCache | null = null;

/**
 * Clears the in-memory plugin list and presence caches.
 */
export function clearPluginCache(): void {
  cachedPlugins = null;
  lastFetchTime = 0;
  cachedPresence = null;
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
 * Queries the daemon's authoritative plugin list through the CLI RPC that the
 * daemon already serves ('paseo plugin ls --json'). Returns null when the daemon
 * is unreachable or answers with a non-array payload, so callers can choose
 * their own fallback instead of parsing filesystem state.
 */
async function fetchDaemonPluginInfo(): Promise<PaseoPluginInfo[] | null> {
  try {
    const result = await safeSpawn("paseo", ["plugin", "ls", "--json"], { timeoutMs: 3000 });
    if (result.code === 0 && result.stdout.trim()) {
      const parsed: unknown = JSON.parse(result.stdout.trim());
      return Array.isArray(parsed) ? (parsed as PaseoPluginInfo[]) : null;
    }
  } catch {
    // Unreachable daemon / malformed payload: report absence, never throw.
  }
  return null;
}

/**
 * Lists full plugin metadata from the Paseo daemon, with optional filtering and
 * TTL caching. Primary mechanism uses 'paseo plugin ls --json', with fallback to
 * ~/.paseo/config.json.
 */
async function listPluginInfo(options: ListPluginsOptions = {}): Promise<PaseoPluginInfo[]> {
  const { filter = "all", cacheTtlMs = 5000, forceRefresh = false } = options;
  const now = Date.now();

  if (!forceRefresh && cachedPlugins && now - lastFetchTime < cacheTtlMs) {
    return applyFilter(cachedPlugins, filter);
  }

  const fromDaemon = await fetchDaemonPluginInfo();
  const plugins = fromDaemon ?? readConfigPluginsFallback();

  cachedPlugins = plugins;
  lastFetchTime = now;

  return applyFilter(plugins, filter);
}

function isRegistryContext(value: unknown): value is PluginRegistryContext {
  return !!value && typeof value === "object" && "paseo" in (value as Record<string, unknown>);
}

/** Coerces a daemon plugin list (SDK shape) into normalized presence records. */
function normalizePresence(raw: unknown): PluginPresence[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginPresence[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : null;
    if (!id) continue;
    const enabled = rec.enabled !== false;
    const status =
      typeof rec.status === "string" ? rec.status : enabled ? "unknown" : "disabled";
    out.push({ id, status, enabled });
  }
  return out;
}

/**
 * Resolves plugin presence through the sanctioned daemon channel. Prefers a
 * `context.paseo.plugins.list()` SDK surface when one exists; otherwise falls
 * back to the daemon's existing plugin-list RPC. Any failure — no context, no
 * surface, unreachable daemon, malformed payload — resolves to `[]`.
 *
 * Only the daemon-fallback result is cached (the CLI spawn is the real cost);
 * a caller-supplied context surface is always consulted fresh so different
 * contexts never observe each other's cached presence.
 */
async function listPluginPresence(
  context: PluginRegistryContext | null | undefined,
  options: PluginQueryOptions = {},
): Promise<PluginPresence[]> {
  const { cacheTtlMs = 5000, forceRefresh = false } = options;
  const now = Date.now();
  const surface = readPluginsSurface(context?.paseo);

  if (!surface) {
    if (!forceRefresh && cachedPresence && now - cachedPresence.at < cacheTtlMs) {
      return cachedPresence.plugins;
    }
    const plugins = normalizePresence(await fetchDaemonPluginInfo());
    cachedPresence = { at: now, plugins };
    return plugins;
  }

  try {
    return normalizePresence(await surface.list());
  } catch {
    return [];
  }
}

/** Duck-types `context.paseo.plugins.list()` without assuming the SDK shape. */
function readPluginsSurface(paseo: unknown): PaseoPluginsSurface | null {
  if (!paseo || typeof paseo !== "object") return null;
  const plugins = (paseo as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== "object") return null;
  const list = (plugins as { list?: unknown }).list;
  return typeof list === "function" ? (plugins as PaseoPluginsSurface) : null;
}

/**
 * Lists plugins. Called with a plugin/handler `context`, returns normalized
 * presence records `{ id, status, enabled }` resolved through the daemon (see
 * `listPluginPresence`); absence tolerates to `[]`. Called without a context,
 * returns the legacy full `PaseoPluginInfo[]` metadata list.
 */
export function listPlugins(
  context: PluginRegistryContext | null | undefined,
  options?: PluginQueryOptions,
): Promise<PluginPresence[]>;
export function listPlugins(options?: ListPluginsOptions): Promise<PaseoPluginInfo[]>;
export async function listPlugins(
  contextOrOptions?: PluginRegistryContext | ListPluginsOptions | null,
  maybeOptions: PluginQueryOptions = {},
): Promise<PluginPresence[] | PaseoPluginInfo[]> {
  // A registry context is an object carrying `paseo`, or an explicitly passed
  // null context (the "caller has no context" case, which tolerates to []). A
  // bare option object (no `paseo` key), or no argument at all, stays on the
  // legacy full-metadata path.
  if (isRegistryContext(contextOrOptions) || contextOrOptions === null) {
    return listPluginPresence(contextOrOptions, maybeOptions);
  }
  return listPluginInfo(contextOrOptions ?? {});
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
 *
 * Two forms:
 * - `isPluginInstalled(pluginId, options?)` — legacy metadata query: true when
 *   the plugin appears in the full plugin list at all.
 * - `isPluginInstalled(context, id, options?)` — presence query: true only when
 *   the plugin is usable (present, enabled, and status "running"). Anything else
 *   — absent, disabled, failed, unknown — resolves to false. A missing daemon
 *   surface tolerates to false, never throws.
 */
export function isPluginInstalled(
  pluginId: string,
  options?: PluginQueryOptions,
): Promise<boolean>;
export function isPluginInstalled(
  context: PluginRegistryContext | null | undefined,
  id: string,
  options?: PluginQueryOptions,
): Promise<boolean>;
export async function isPluginInstalled(
  contextOrId: PluginRegistryContext | string | null | undefined,
  idOrOptions?: string | PluginQueryOptions,
  maybeOptions: PluginQueryOptions = {},
): Promise<boolean> {
  if (typeof contextOrId === "string") {
    const info = await getPluginInfo(contextOrId, idOrOptions as PluginQueryOptions | undefined);
    return info !== null;
  }

  const id = typeof idOrOptions === "string" ? idOrOptions : "";
  if (!id) return false;

  const plugins = await listPluginPresence(contextOrId, maybeOptions);
  const match = plugins.find((p) => p.id === id);
  return !!match && match.enabled && match.status === "running";
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
