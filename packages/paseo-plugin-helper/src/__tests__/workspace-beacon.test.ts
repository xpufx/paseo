import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WorkspaceBeacon,
  createWorkspaceBeacon,
  resolveBeaconLabelName,
  normalizeBeaconColor,
  DEFAULT_BEACON_LABEL_PREFIX,
} from "../server/workspace-beacon.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolveBeaconLabelName", () => {
  it("applies default beacon: prefix", () => {
    expect(resolveBeaconLabelName("ready")).toBe("beacon:ready");
    expect(DEFAULT_BEACON_LABEL_PREFIX).toBe("beacon:");
  });

  it("does not double-prefix already-namespaced names (case-insensitive)", () => {
    expect(resolveBeaconLabelName("beacon:ready")).toBe("beacon:ready");
    expect(resolveBeaconLabelName("BEACON:ready")).toBe("BEACON:ready");
  });

  it("supports custom prefix and empty prefix", () => {
    expect(resolveBeaconLabelName("ready", "status-")).toBe("status-ready");
    expect(resolveBeaconLabelName("ready", "")).toBe("ready");
  });
});

describe("normalizeBeaconColor", () => {
  it("accepts daemon palette colors case-insensitively", () => {
    expect(normalizeBeaconColor("red")).toBe("red");
    expect(normalizeBeaconColor("Blue")).toBe("blue");
  });

  it("rejects unknown colors and passes through undefined", () => {
    expect(normalizeBeaconColor("chartreuse")).toBeUndefined();
    expect(normalizeBeaconColor(undefined)).toBeUndefined();
  });
});

describe("WorkspaceBeacon.set", () => {
  it("assigns namespaced label via daemon client", async () => {
    const setWorkspaceLabel = vi.fn().mockResolvedValue(undefined);
    const beacon = new WorkspaceBeacon({
      daemonClient: { setWorkspaceLabel },
    });
    const result = await beacon.set({ workspaceId: "wks_1", name: "ready", color: "blue" });
    expect(result.labelApplied).toBe(true);
    expect(result.labelName).toBe("beacon:ready");
    expect(setWorkspaceLabel).toHaveBeenCalledWith({
      workspaceId: "wks_1",
      label: { name: "beacon:ready", color: "blue" },
      assigned: true,
    });
  });

  it("reflects titleSuffix via workspaceHandle.setTitle()", async () => {
    const setTitle = vi.fn();
    const beacon = new WorkspaceBeacon({
      workspaceHandle: { setTitle },
      baseTitle: "my workspace",
    });
    const result = await beacon.set({ workspaceId: "wks_1", name: "ready", titleSuffix: " ● busy" });
    expect(result.titleApplied).toBe(true);
    expect(result.title).toBe("my workspace ● busy");
    expect(setTitle).toHaveBeenCalledWith("my workspace ● busy");
  });

  it("sets explicit title directly", async () => {
    const setTitle = vi.fn();
    const beacon = new WorkspaceBeacon({ workspaceHandle: { setTitle } });
    const result = await beacon.set({ workspaceId: "wks_1", name: "x", title: "custom" });
    expect(setTitle).toHaveBeenCalledWith("custom");
    expect(result.title).toBe("custom");
  });

  it("never throws when host APIs are missing", async () => {
    const beacon = new WorkspaceBeacon({});
    await expect(beacon.set({ workspaceId: "wks_1", name: "ready" })).resolves.toMatchObject({
      labelApplied: false,
      titleApplied: false,
    });
  });

  it("never throws when host APIs reject", async () => {
    const beacon = new WorkspaceBeacon({
      workspaceHandle: { setTitle: () => Promise.reject(new Error("nope")) },
      daemonClient: { setWorkspaceLabel: () => Promise.reject(new Error("nope")) },
    });
    await expect(beacon.set({ workspaceId: "w", name: "n", titleSuffix: "!" })).resolves.toMatchObject({
      labelApplied: false,
      titleApplied: false,
    });
  });

  it("never throws when socket lacks label mutation", async () => {
    const beacon = new WorkspaceBeacon({ daemonClient: {} });
    await expect(beacon.set({ workspaceId: "w", name: "n" })).resolves.toMatchObject({
      labelApplied: false,
    });
  });
});

describe("WorkspaceBeacon.blink", () => {
  it("alternates between two states and cleans up timer automatically", async () => {
    const setWorkspaceLabel = vi.fn().mockResolvedValue(undefined);
    const beacon = createWorkspaceBeacon({ daemonClient: { setWorkspaceLabel } });
    const handle = beacon.blink({
      workspaceId: "wks_1",
      a: { name: "one", color: "blue" },
      b: { name: "two", color: "red" },
      intervalMs: 1000,
      rounds: 4,
    });
    await vi.advanceTimersByTimeAsync(5000);
    await handle.done;
    const names = setWorkspaceLabel.mock.calls.map((c) => (c[0] as { label: { name: string } }).label.name);
    expect(names).toEqual(["beacon:one", "beacon:two", "beacon:one", "beacon:two"]);
    expect(beacon.activeBlinks).toBe(0);
  });

  it("stop() cancels the timer early", async () => {
    const setWorkspaceLabel = vi.fn().mockResolvedValue(undefined);
    const beacon = new WorkspaceBeacon({ daemonClient: { setWorkspaceLabel } });
    const handle = beacon.blink({
      workspaceId: "wks_9",
      a: { name: "a" },
      b: { name: "b" },
      intervalMs: 1000,
      rounds: 100,
    });
    expect(beacon.activeBlinks).toBe(1);
    handle.stop();
    await handle.done;
    expect(beacon.activeBlinks).toBe(0);
    const countAfterStop = setWorkspaceLabel.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(setWorkspaceLabel.mock.calls.length).toBe(countAfterStop);
  });

  it("replaces a running blink for the same workspace", async () => {
    const setWorkspaceLabel = vi.fn().mockResolvedValue(undefined);
    const beacon = new WorkspaceBeacon({ daemonClient: { setWorkspaceLabel } });
    const first = beacon.blink({ workspaceId: "w", a: { name: "a" }, b: { name: "b" }, intervalMs: 100, rounds: 100 });
    expect(beacon.activeBlinks).toBe(1);
    const second = beacon.blink({
      workspaceId: "w",
      a: { name: "c" },
      b: { name: "d" },
      intervalMs: 100,
      rounds: 2,
    });
    await first.done;
    const advance = vi.advanceTimersByTimeAsync(500);
    await second.done;
    await advance;
    expect(beacon.activeBlinks).toBe(0);
    second.stop();
  });
});

describe("WorkspaceBeacon.clear", () => {
  it("detaches label and restores original title", async () => {
    const setTitle = vi.fn();
    const setWorkspaceLabel = vi.fn().mockResolvedValue(undefined);
    const beacon = new WorkspaceBeacon({
      workspaceHandle: { setTitle },
      daemonClient: { setWorkspaceLabel },
      baseTitle: "base",
    });
    await beacon.set({ workspaceId: "wks_1", name: "ready", titleSuffix: " ● busy" });
    expect(setTitle).toHaveBeenCalledWith("base ● busy");
    const result = await beacon.clear({ workspaceId: "wks_1", name: "ready" });
    expect(result.labelCleared).toBe(true);
    expect(result.titleRestored).toBe(true);
    expect(setWorkspaceLabel).toHaveBeenLastCalledWith({
      workspaceId: "wks_1",
      label: { name: "beacon:ready" },
      assigned: false,
    });
    expect(setTitle).toHaveBeenLastCalledWith("base");
  });

  it("falls back to removeWorkspaceLabel when setWorkspaceLabel is absent", async () => {
    const removeWorkspaceLabel = vi.fn().mockResolvedValue(undefined);
    const beacon = new WorkspaceBeacon({ daemonClient: { removeWorkspaceLabel } });
    const result = await beacon.clear({ workspaceId: "w", name: "x" });
    expect(result.labelCleared).toBe(true);
    expect(removeWorkspaceLabel).toHaveBeenCalledWith({ workspaceId: "w", name: "beacon:x" });
  });

  it("never throws without host support", async () => {
    const beacon = new WorkspaceBeacon({});
    await expect(beacon.clear({ workspaceId: "w", name: "x" })).resolves.toEqual({
      labelCleared: false,
      titleRestored: false,
    });
  });

  it("stopAll clears running blink timers", () => {
    const beacon = new WorkspaceBeacon({ daemonClient: { setWorkspaceLabel: vi.fn() } });
    beacon.blink({ workspaceId: "w", a: { name: "a" }, b: { name: "b" }, intervalMs: 1000 });
    expect(beacon.activeBlinks).toBe(1);
    beacon.stopAll();
    expect(beacon.activeBlinks).toBe(0);
  });
});
