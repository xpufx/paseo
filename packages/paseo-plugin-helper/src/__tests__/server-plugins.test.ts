import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listPlugins,
  getPluginInfo,
  isPluginInstalled,
  isPluginEnabled,
  isPluginRunning,
  clearPluginCache,
} from "../server/plugins.js";
import * as processModule from "../server/process.js";

describe("Server Plugins Query Helper", () => {
  beforeEach(() => {
    clearPluginCache();
    vi.restoreAllMocks();
  });

  const mockPlugins = [
    {
      id: "mcp-tools",
      path: "/home/user/code/mcp",
      enabled: false,
      status: "disabled",
      source: "directory",
    },
    {
      id: "top",
      path: "/home/user/code/top",
      enabled: true,
      status: "running",
      source: "directory",
    },
    {
      id: "broken-plugin",
      path: "/home/user/code/broken",
      enabled: true,
      status: "failed",
      error: "Crash on startup",
    },
  ];

  it("lists all plugins from CLI output", async () => {
    vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(mockPlugins),
      stderr: "",
      signal: null,
      durationMs: 10,
    });

    const plugins = await listPlugins();
    expect(plugins).toHaveLength(3);
    expect(plugins[0].id).toBe("mcp-tools");
    expect(plugins[1].id).toBe("top");
  });

  it("filters plugins by enabled, disabled, and running", async () => {
    vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(mockPlugins),
      stderr: "",
      signal: null,
      durationMs: 10,
    });

    const enabled = await listPlugins({ filter: "enabled" });
    expect(enabled.map((p) => p.id)).toEqual(["top", "broken-plugin"]);

    const disabled = await listPlugins({ filter: "disabled" });
    expect(disabled.map((p) => p.id)).toEqual(["mcp-tools"]);

    const running = await listPlugins({ filter: "running" });
    expect(running.map((p) => p.id)).toEqual(["top"]);

    const failed = await listPlugins({ filter: "failed" });
    expect(failed.map((p) => p.id)).toEqual(["broken-plugin"]);
  });

  it("utilizes cache within TTL duration and forceRefresh bypasses it", async () => {
    const spawnSpy = vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(mockPlugins),
      stderr: "",
      signal: null,
      durationMs: 10,
    });

    await listPlugins({ cacheTtlMs: 5000 });
    await listPlugins({ cacheTtlMs: 5000 });
    expect(spawnSpy).toHaveBeenCalledTimes(1);

    await listPlugins({ forceRefresh: true });
    expect(spawnSpy).toHaveBeenCalledTimes(2);
  });

  it("getPluginInfo returns matching plugin or null", async () => {
    vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(mockPlugins),
      stderr: "",
      signal: null,
      durationMs: 10,
    });

    const top = await getPluginInfo("top");
    expect(top).not.toBeNull();
    expect(top?.status).toBe("running");

    const nonExistent = await getPluginInfo("unknown-plugin");
    expect(nonExistent).toBeNull();
  });

  it("isPluginInstalled, isPluginEnabled, isPluginRunning check predicates correctly", async () => {
    vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(mockPlugins),
      stderr: "",
      signal: null,
      durationMs: 10,
    });

    expect(await isPluginInstalled("top")).toBe(true);
    expect(await isPluginInstalled("unknown")).toBe(false);

    expect(await isPluginEnabled("top")).toBe(true);
    expect(await isPluginEnabled("mcp-tools")).toBe(false);

    expect(await isPluginRunning("top")).toBe(true);
    expect(await isPluginRunning("broken-plugin")).toBe(false);
    expect(await isPluginRunning("mcp-tools")).toBe(false);
  });
});

describe("Server Plugin Presence API (context-aware)", () => {
  beforeEach(() => {
    clearPluginCache();
    vi.restoreAllMocks();
  });

  const contextPlugins = [
    { id: "x-comms", status: "running", enabled: true },
    { id: "forges", status: "disabled", enabled: false },
    { id: "broken", status: "failed", enabled: true },
  ];

  function contextWith(list: () => Promise<unknown>) {
    return { paseo: { plugins: { list } } };
  }

  it("listPlugins(context) returns normalized presence records", async () => {
    const list = vi.fn().mockResolvedValue(contextPlugins);
    const plugins = await listPlugins(contextWith(list), { forceRefresh: true });

    expect(plugins).toEqual([
      { id: "x-comms", status: "running", enabled: true },
      { id: "forges", status: "disabled", enabled: false },
      { id: "broken", status: "failed", enabled: true },
    ]);
  });

  it("isPluginInstalled(context, id) is true only for running+enabled", async () => {
    const list = vi.fn().mockResolvedValue(contextPlugins);

    expect(await isPluginInstalled(contextWith(list), "x-comms", { forceRefresh: true })).toBe(true);
    expect(await isPluginInstalled(contextWith(list), "forges")).toBe(false);
    expect(await isPluginInstalled(contextWith(list), "broken")).toBe(false);
    expect(await isPluginInstalled(contextWith(list), "not-there")).toBe(false);
  });

  it("falls back to the daemon CLI surface when context.paseo.plugins is absent", async () => {
    const spawnSpy = vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(contextPlugins),
      stderr: "",
      signal: null,
      durationMs: 10,
    });

    const plugins = await listPlugins({ paseo: {} }, { forceRefresh: true });
    expect(spawnSpy).toHaveBeenCalledWith("paseo", ["plugin", "ls", "--json"], expect.anything());
    expect(plugins.map((p) => p.id)).toEqual(["x-comms", "forges", "broken"]);
    expect(await isPluginInstalled({ paseo: {} }, "x-comms")).toBe(true);
    expect(await isPluginInstalled({ paseo: {} }, "forges")).toBe(false);
  });

  it("tolerates absence: daemon failure resolves to [] and false, never throws", async () => {
    vi.spyOn(processModule, "safeSpawn").mockRejectedValue(new Error("daemon down"));

    await expect(listPlugins({ paseo: {} }, { forceRefresh: true })).resolves.toEqual([]);
    await expect(isPluginInstalled({ paseo: {} }, "x-comms")).resolves.toBe(false);
  });

  it("tolerates a missing context entirely (null/undefined)", async () => {
    vi.spyOn(processModule, "safeSpawn").mockRejectedValue(new Error("daemon down"));

    await expect(listPlugins(null, { forceRefresh: true })).resolves.toEqual([]);
    await expect(isPluginInstalled(undefined, "x-comms")).resolves.toBe(false);
  });

  it("tolerates a throwing context surface", async () => {
    const throwing = contextWith(async () => {
      throw new Error("surface exploded");
    });
    await expect(listPlugins(throwing, { forceRefresh: true })).resolves.toEqual([]);
    await expect(isPluginInstalled(throwing, "x-comms")).resolves.toBe(false);
  });

  it("caches the daemon fallback within TTL and forceRefresh bypasses it", async () => {
    const spawnSpy = vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(contextPlugins),
      stderr: "",
      signal: null,
      durationMs: 10,
    });

    await listPlugins({ paseo: {} }, { cacheTtlMs: 5000 });
    await listPlugins({ paseo: {} }, { cacheTtlMs: 5000 });
    expect(spawnSpy).toHaveBeenCalledTimes(1);

    await listPlugins({ paseo: {} }, { forceRefresh: true });
    expect(spawnSpy).toHaveBeenCalledTimes(2);
  });

  it("does not cache a caller-supplied context surface across contexts", async () => {
    const first = vi.fn().mockResolvedValue([{ id: "x-comms", status: "running", enabled: true }]);
    const second = vi.fn().mockResolvedValue([]);

    await expect(listPlugins(contextWith(first), { cacheTtlMs: 5000 })).resolves.toHaveLength(1);
    await expect(listPlugins(contextWith(second), { cacheTtlMs: 5000 })).resolves.toEqual([]);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy option-object form on the full-metadata path", async () => {
    vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([
        { id: "top", path: "/x", enabled: true, status: "running" },
      ]),
      stderr: "",
      signal: null,
      durationMs: 10,
    });

    const plugins = await listPlugins({ filter: "running" });
    expect(plugins).toHaveLength(1);
    expect(plugins[0].path).toBe("/x");
  });
});
