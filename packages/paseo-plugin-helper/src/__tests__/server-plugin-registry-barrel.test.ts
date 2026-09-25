import { describe, it, expect, vi, beforeEach } from "vitest";
import * as serverBarrel from "../server/index.js";
import { clearPluginCache } from "../server/plugins.js";
import * as processModule from "../server/process.js";

/**
 * Guards the public barrel surface that plugin code imports from
 * `paseo-plugin-helper/server`. A refactor that only updates plugins.ts or only
 * updates index.ts would otherwise pass every unit test while shipping a
 * missing export.
 */
describe("paseo-plugin-helper/server barrel exports", () => {
  beforeEach(() => {
    clearPluginCache();
    vi.restoreAllMocks();
  });

  it("exports the plugin registry presence API", () => {
    expect(typeof serverBarrel.listPlugins).toBe("function");
    expect(typeof serverBarrel.isPluginInstalled).toBe("function");
    expect(typeof serverBarrel.clearPluginCache).toBe("function");
  });

  it("presence API is usable through the barrel against a daemon surface", async () => {
    vi.spyOn(processModule, "safeSpawn").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([{ id: "x-comms", status: "running", enabled: true }]),
      stderr: "",
      signal: null,
      durationMs: 10,
    });

    await expect(serverBarrel.listPlugins({ paseo: {} }, { forceRefresh: true })).resolves.toEqual([
      { id: "x-comms", status: "running", enabled: true },
    ]);
    await expect(serverBarrel.isPluginInstalled({ paseo: {} }, "x-comms")).resolves.toBe(true);
  });
});
