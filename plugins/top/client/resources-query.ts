import {
  useAutoRefreshQuery,
  type UseAutoRefreshQueryOptions,
} from "./vendor/paseo-plugin-helper/index";
import {
  getSystemResourcesRpc,
  type SystemResources,
} from "../shared/resources";

interface TopResourceQueryInput {
  directory?: string;
}

/**
 * Keep all Top surfaces on the same React Query key for a workspace.
 * Selective field requests created separate caches and let each pill start
 * its own poller, even though the views consume one host snapshot.
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
  const input: TopResourceQueryInput = directory ? { directory } : {};
  return useAutoRefreshQuery(getSystemResourcesRpc, input, {
    defaultRate: "5s",
    isOpen: true,
    ...options,
  });
}
