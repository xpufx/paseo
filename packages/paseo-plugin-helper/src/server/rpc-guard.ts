import { withTimeout, TimeoutError } from "../shared/async.js";

export interface RpcGuardOptions<T> {
  timeoutMs?: number;
  maxInflight?: number;
  getStale?: () => T | null | undefined;
  onTimeout?: (info: { timeoutMs: number; inflight: number }) => void;
  onSaturated?: (info: { maxInflight: number }) => void;
}

export interface GuardedRpcHandler<TInput, TOutput> {
  (input?: TInput): Promise<TOutput>;
  inflight(): number;
}

export function guardRpcHandler<TInput, TOutput>(
  handler: (input?: TInput) => Promise<TOutput> | TOutput,
  options: RpcGuardOptions<TOutput> = {},
): GuardedRpcHandler<TInput, TOutput> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxInflight = options.maxInflight ?? 4;
  let inflight = 0;

  const guarded = (async (input?: TInput): Promise<TOutput> => {
    if (inflight >= maxInflight) {
      options.onSaturated?.({ maxInflight });
      const stale = options.getStale?.();
      if (stale != null) {
        return stale;
      }
      throw new Error(
        `RPC handler saturated (${inflight} inflight, cap ${maxInflight}): shedding load`,
      );
    }
    inflight += 1;
    try {
      return await withTimeout(
        Promise.resolve().then(() => handler(input)),
        timeoutMs,
        "RPC handler",
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        options.onTimeout?.({ timeoutMs, inflight });
      }
      throw err;
    } finally {
      inflight -= 1;
    }
  }) as GuardedRpcHandler<TInput, TOutput>;
  guarded.inflight = () => inflight;
  return guarded;
}

export interface LoopWatchdogOptions {
  thresholdMs?: number;
  intervalMs?: number;
  onLag?: (lagMs: number) => void;
}

export function createLoopWatchdog(options: LoopWatchdogOptions = {}): () => void {
  const thresholdMs = options.thresholdMs ?? 1000;
  const intervalMs = options.intervalMs ?? 1000;
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const lagMs = now - last - intervalMs;
    last = now;
    if (lagMs >= thresholdMs) {
      options.onLag?.(lagMs);
    }
  }, intervalMs);
  if (typeof (timer as unknown as { unref?: unknown }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
  }
  return () => clearInterval(timer);
}
