import { describe, it, expect, vi, beforeEach } from "vitest";
import { triggerHaptic } from "../client/utils/haptics.js";

describe("client/utils/haptics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes navigator.vibrate with correct pattern", () => {
    const vibrateMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate: vibrateMock },
      configurable: true,
      writable: true,
    });

    const res = triggerHaptic("light");
    expect(res).toBe(true);
    expect(vibrateMock).toHaveBeenCalledWith(10);

    triggerHaptic("success");
    expect(vibrateMock).toHaveBeenCalledWith([15, 40, 20]);
  });

  it("returns false without error when vibrate is not present", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
      writable: true,
    });

    const res = triggerHaptic("medium");
    expect(res).toBe(false);
  });
});
