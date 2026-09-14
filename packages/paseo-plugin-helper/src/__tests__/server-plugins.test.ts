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
