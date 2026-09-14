import { useState, useMemo } from "react";
import type { PluginRpcContract } from "../shared/rpc.js";
import { useRpcQuery, type RpcQueryOptions } from "./query.js";
import type { RpcInput, RpcOutput } from "../shared/rpc.js";

export type RefreshRate =
  | "1s"
  | "2s"
  | "5s"
  | "10s"
  | "15s"
  | "30s"
  | "60s"
  | "5m"
  | "paused";

export const REFRESH_INTERVALS: Record<RefreshRate, number | false> = {
  "1s": 1000,
  "2s": 2000,
  "5s": 5000,
  "10s": 10000,
  "15s": 15000,
  "30s": 30000,
  "60s": 60000,
  "5m": 300000,
  paused: false,
};

export interface UseAutoRefreshQueryOptions<TOutput> extends RpcQueryOptions<TOutput> {
  defaultRate?: RefreshRate;
  /**
   * Custom interval in milliseconds (overrides preset rates when not paused).
   */
  customIntervalMs?: number;
  /**
   * Whether the containing modal or panel is actively open/visible.
   * If false, background refetching is automatically paused to conserve mobile CPU and battery.
   */
  isOpen?: boolean;
}

/**
 * Enhanced React Query hook for live polling metrics.
 * Automatically halts background polling when modal/panel is closed (`isOpen === false`),
 * and provides state controls for user-selectable refresh intervals ("1s", "5s", "30s", "paused", etc.).
 */
export function useAutoRefreshQuery<
  TContract extends PluginRpcContract<any, any>,
  TInput = RpcInput<TContract>,
  TOutput = RpcOutput<TContract>,
>(
  contract: TContract,
  input: TInput,
  options?: UseAutoRefreshQueryOptions<TOutput>,
) {
  const { defaultRate = "2s", customIntervalMs, isOpen = true, ...queryOptions } = options ?? {};
  const [rate, setRate] = useState<RefreshRate>(defaultRate);

  const effectiveInterval = useMemo<number | false>(() => {
    if (!isOpen || rate === "paused") return false;
    if (typeof customIntervalMs === "number" && customIntervalMs > 0) {
      return customIntervalMs;
    }
    return REFRESH_INTERVALS[rate] ?? false;
  }, [isOpen, rate, customIntervalMs]);

  const query = useRpcQuery(contract, input, {
    ...queryOptions,
    refetchInterval: effectiveInterval,
  });

  return {
    ...query,
    rate,
    setRate,
    isPolling: effectiveInterval !== false,
    effectiveInterval,
  };
}
