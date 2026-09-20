/**
 * SDK 0.9.0-beta.2 exposes plugin update methods on DaemonClient, but plugins
 * receive only PaseoApi through getPaseoClient(serverId). PaseoApi deliberately
 * omits those methods, so a plugin cannot safely choose a host or mutate an
 * installation on the daemon's behalf.
 */
export const NATIVE_PLUGIN_UPDATE_BLOCKER =
  "Paseo SDK 0.9.0-beta.2 does not expose plugin update preview/proposal/apply/reload on plugin-facing PaseoApi.";

export type ManagedPluginSource = "git" | "npm" | "directory" | "unknown";

export interface NativePluginUpdateCapability {
  supported: false;
  source: ManagedPluginSource;
  /** No serverId is accepted: selecting another configured host would be unsafe. */
  hostTarget: null;
  blocker: typeof NATIVE_PLUGIN_UPDATE_BLOCKER;
}

/**
 * Formal, source-independent fallback for every installation kind. Do not turn
 * useHosts() or getPaseoClient(serverId) into a lifecycle substitute: neither
 * grants the absent plugin-management API, and a selected server could be the
 * wrong daemon for this plugin installation.
 */
export function nativePluginUpdateCapability(source: string | null | undefined): NativePluginUpdateCapability {
  const normalized: ManagedPluginSource =
    source === "git" || source === "npm" || source === "directory" ? source : "unknown";
  return { supported: false, source: normalized, hostTarget: null, blocker: NATIVE_PLUGIN_UPDATE_BLOCKER };
}
