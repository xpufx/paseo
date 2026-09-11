import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPeriodicTask } from "../server/task.js";

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
});
