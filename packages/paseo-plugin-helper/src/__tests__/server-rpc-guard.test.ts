import { describe, it, expect, vi } from "vitest";
import { guardRpcHandler, createLoopWatchdog } from "../server/rpc-guard.js";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("server/rpc-guard", () => {
  it("passes fast handler results through", async () => {
    const guarded = guardRpcHandler(async (input?: { n?: number }) => (input?.n ?? 0) + 1);
    await expect(guarded({ n: 1 })).resolves.toBe(2);
    expect(guarded.inflight()).toBe(0);
  });

  it("times out slow handlers", async () => {
    const onTimeout = vi.fn();
    const guarded = guardRpcHandler(
      async () => {
        await tick(200);
        return "late";
      },
      { timeoutMs: 30, onTimeout },
    );
    await expect(guarded()).rejects.toThrow(/timed out|Timeout/i);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(guarded.inflight()).toBe(0);
  });

  it("sheds load when saturated and serves stale when provided", async () => {
    const onSaturated = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const guarded = guardRpcHandler(() => gate.then(() => "slow"), {
      maxInflight: 1,
      onSaturated,
      getStale: () => "stale",
    });
    const pending = guarded();
    await tick(10);
    await expect(guarded()).resolves.toBe("stale");
    expect(onSaturated).toHaveBeenCalledOnce();
    release();
    await expect(pending).resolves.toBe("slow");
  });

  it("rejects when saturated with no stale available", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const guarded = guardRpcHandler(() => gate.then(() => "slow"), { maxInflight: 1 });
    const pending = guarded();
    await tick(10);
    await expect(guarded()).rejects.toThrow(/saturated/);
    release();
    await expect(pending).resolves.toBe("slow");
  });

  it("watchdog reports blocked event loop", async () => {
    const onLag = vi.fn();
    const stop = createLoopWatchdog({ thresholdMs: 40, intervalMs: 15, onLag });
    const start = Date.now();
    while (Date.now() - start < 80) {
      // busy block
    }
    await tick(60);
    stop();
    expect(onLag.mock.calls.length).toBeGreaterThan(0);
  });

  it("watchdog stays quiet on a healthy loop", async () => {
    const onLag = vi.fn();
    const stop = createLoopWatchdog({ thresholdMs: 500, intervalMs: 15, onLag });
    await tick(60);
    stop();
    expect(onLag).not.toHaveBeenCalled();
  });
});
