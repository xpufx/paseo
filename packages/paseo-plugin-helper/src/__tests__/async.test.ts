import { describe, it, expect } from "vitest";
import { withTimeout, TimeoutError } from "../shared/async.js";

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("success"), 20);
    });

    const result = await withTimeout(fastPromise, 100);
    expect(result).toBe("success");
  });

  it("rejects with TimeoutError when promise exceeds duration", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("late"), 100);
    });

    await expect(withTimeout(slowPromise, 20, "Network call")).rejects.toThrow(TimeoutError);
    await expect(withTimeout(slowPromise, 20, "Network call")).rejects.toThrow(
      "Network call timed out after 20ms"
    );
  });
});
