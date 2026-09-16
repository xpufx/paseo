import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPeriodicTask } from "../server/task.js";
import { createPluginLogger } from "../server/logger.js";

function loggerAt(minLevel: "debug" | "info") {
  return createPluginLogger("test", { banner: false, version: "0.0.0-test", minLevel });
}

describe("server/task", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs periodic ticks on schedule", async () => {
    const fn = vi.fn();
    const task = createPeriodicTask({
      intervalMs: 1000,
      task: fn,
    });

    expect(fn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    task.stop();
    expect(task.isRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respects runImmediately option", async () => {
    const fn = vi.fn();
    const task = createPeriodicTask({
      intervalMs: 1000,
      runImmediately: true,
      task: fn,
    });

    expect(fn).toHaveBeenCalledTimes(1);
    task.stop();
  });

  it("applies exponential backoff on error without crashing", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Network glitch"));
    const onError = vi.fn();

    const task = createPeriodicTask({
      intervalMs: 1000,
      task: fn,
      onError,
    });

    // 1st tick at 1000ms -> fails -> next interval = 1000 * 1.5 = 1500ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    // Advancing 1000ms should not trigger yet (needs 1500ms)
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advancing remaining 500ms -> 2nd tick
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);

    task.stop();
  });

  it("keeps suppressed errors silent at info level", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const task = createPeriodicTask({
      intervalMs: 1000,
      task: () => {
        throw new Error("boom");
      },
      logger: loggerAt("info"),
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(spy).not.toHaveBeenCalled();

    task.stop();
    spy.mockRestore();
  });

  it("routes suppressed errors through the logger at debug level", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const task = createPeriodicTask({
      intervalMs: 1000,
      task: () => {
        throw new Error("boom");
      },
      logger: loggerAt("debug"),
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("suppressed error (failure 1): boom"),
    );

    task.stop();
    spy.mockRestore();
  });

  it("reports a throwing onError handler through the logger", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const task = createPeriodicTask({
      intervalMs: 1000,
      task: () => {
        throw new Error("boom");
      },
      onError: () => {
        throw new Error("handler-broke");
      },
      logger: loggerAt("debug"),
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("onError handler failed: handler-broke"),
    );

    task.stop();
    spy.mockRestore();
  });
});
