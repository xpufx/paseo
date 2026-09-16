import {
  useAutoRefreshQuery,
  useRpcQuery,
  sharedSnapshotKey,
  normalizeSnapshotScope,
  type UseAutoRefreshQueryOptions,
} from "./vendor/paseo-plugin-helper/index";
import {
  getSystemResourcesRpc,
  getCustomPillsRpc,
  type SystemResources,
} from "../shared/resources";

interface TopResourceQueryInput {
  directory?: string;
}

const EMPTY_PARAMS = {};

export { normalizeSnapshotScope };

/**
 * The single workspace-scoped resource snapshot path for Top.
 *
 * Pill, modal, and surface consumers share one React Query cache identity
 * per workspace (host-wide when no directory is known). The key carries no
 * selective `fields`: field-specific keys fragmented the cache and gave
 * every visible pill its own poller even though all views consume one host
 * snapshot. Selective field collection stays available on the server RPC
 * for genuinely cheaper paths, and the expensive MCP/plugin detection there
 * remains behind its long-lived cache/in-flight guard.
 *
 * Custom-pill configuration/state polling is a different data source and
 * keeps its own query (`top.custom-pills.get` / `top.custom-pills.list`).
 *
 * Polling is lifecycle-aware by mount: the query only runs while a consumer
 * is mounted, and pass `isOpen: false` to pause a mounted-but-hidden view.
 */
export function useTopResourceQuery(
  directory?: string | null,
  options?: Omit<
    UseAutoRefreshQueryOptions<SystemResources>,
    "defaultRate" | "isOpen"
  > & {
    defaultRate?: UseAutoRefreshQueryOptions<SystemResources>["defaultRate"];
    isOpen?: boolean;
  },
) {
  const [, keyInput] = sharedSnapshotKey(
    getSystemResourcesRpc.name,
    directory,
  );
  const input: TopResourceQueryInput = keyInput;
  return useAutoRefreshQuery(getSystemResourcesRpc, input, {
    defaultRate: "5s",
    isOpen: true,
    ...options,
  });
}

/**
 * Custom-pill state snapshot shared by the live pill label and its
 * drilldown modal. Both poll the same `top.custom-pills.get` payload on the
 * same cadence, so they read one query instead of registering two pollers.
 */
export function useCustomPillsQuery() {
  return useRpcQuery(getCustomPillsRpc, EMPTY_PARAMS, { refetchInterval: 3000 });
}
