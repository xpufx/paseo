import * as pluginClient from "@getpaseo/plugin/client";
import type { PluginHostSummary } from "@getpaseo/plugin/client";

/**
 * The desktop host bundle supplies `useHosts`/`getPaseoClient`; the mobile
 * bundle omits them, so a direct named call throws `useHosts is not a
 * function` and takes the whole surface with it (#1043, #1057-G). These seams
 * reach the primitives through a feature-detected namespace so a surface
 * degrades to "no hosts" instead of crashing the plugin.
 */

/** The host summary shape `useHosts()` returns (the SDK's `PluginHostSummary`). */
export type OptionalHostSummary = PluginHostSummary;

/** The borrowed per-host client `getPaseoClient(serverId)` returns. */
export type OptionalPaseoClient = ReturnType<typeof pluginClient.getPaseoClient>;

interface MultiHostPrimitives {
  useHosts?: () => readonly PluginHostSummary[];
  getPaseoClient?: (serverId: string) => OptionalPaseoClient;
}

/**
 * Read a function export without tripping a test runner's module-mock `get`
 * trap. A partial mock throws when an unlisted export is read; `Object.keys`
 * only asks for the keys the module has, so an absent primitive reads as
 * `undefined` on mock and real host alike.
 */
function readFunction<T>(source: unknown, key: string): T | undefined {
  if (source === null || typeof source !== "object") return undefined;
  if (!Object.keys(source).includes(key)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "function" ? (value as T) : undefined;
}

const hostPrimitives: MultiHostPrimitives = {
  useHosts: readFunction(pluginClient, "useHosts"),
  getPaseoClient: readFunction(pluginClient, "getPaseoClient"),
};
const EMPTY_HOSTS: readonly PluginHostSummary[] = [];
const noHosts = () => EMPTY_HOSTS;

// Hook identity is module-constant, so a given host calls the same function on
// every render and the hook order never changes.
const useHosts = hostPrimitives.useHosts ?? noHosts;

/** True when the running host supplies the multi-host primitives. */
export function isMultiHostSupported(): boolean {
  return (
    typeof hostPrimitives.useHosts === "function" &&
    typeof hostPrimitives.getPaseoClient === "function"
  );
}

/**
 * `useHosts()` when the host supplies it, otherwise an empty host list, so a
 * surface that enumerates hosts degrades instead of crashing the bundle.
 */
export function useOptionalHosts(): readonly PluginHostSummary[] {
  return useHosts();
}

/** Borrow an online host's API, or `undefined` when the host omits the seam. */
export function getOptionalPaseoClient(serverId: string): OptionalPaseoClient | undefined {
  return hostPrimitives.getPaseoClient?.(serverId);
}
