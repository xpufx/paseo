import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { defineSettingsContract } from "../shared/settings.js";
import { PluginStorage } from "../server/storage.js";
import { registerSettingsRpc } from "../server/settings.js";
import { createMockServerContext } from "../testing/mock-server.js";

describe("Settings Architecture (Shared & Server)", () => {
  const testDir = path.join(
    os.tmpdir(),
    `paseo-settings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const TestSettingsSchema = z.object({
    showCpu: z.boolean().default(true),
    interval: z.number().min(1).max(60).default(3),
    theme: z.enum(["light", "dark", "auto"]).default("auto"),
  });

  it("defines typed get, update, and reset RPC contracts with computed defaults", () => {
    const contract = defineSettingsContract({
      name: "top.settings",
      schema: TestSettingsSchema,
      description: "top monitoring settings",
    });

    expect(contract.name).toBe("top.settings");
    expect(contract.get.name).toBe("top.settings.get");
    expect(contract.update.name).toBe("top.settings.update");
    expect(contract.reset.name).toBe("top.settings.reset");
    expect(contract.defaultSettings).toEqual({
      showCpu: true,
      interval: 3,
      theme: "auto",
    });
  });

  it("normalizes special characters in contract name", () => {
    const contract = defineSettingsContract({
      name: "MyPlugin:Settings@v1",
      schema: TestSettingsSchema,
    });

    expect(contract.name).toBe("myplugin_settings_v1");
    expect(contract.get.name).toBe("myplugin_settings_v1.get");
  });

  it("PluginStorage automatically fills defaults and validates using Zod schema", () => {
    const storage = new PluginStorage("test-plugin", "settings.json", {
      baseDir: testDir,
      schema: TestSettingsSchema,
    });

    // When file does not exist, returns schema defaults
    expect(storage.exists()).toBe(false);
    expect(storage.read()).toEqual({
      showCpu: true,
      interval: 3,
      theme: "auto",
    });

    // Write a partial state directly to disk (simulating an older plugin version)
    const filePath = storage.filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ showCpu: false }), "utf8");

    // Read should parse through schema and fill in interval=3 and theme="auto"
    const loaded = storage.read();
    expect(loaded).toEqual({
      showCpu: false,
      interval: 3,
      theme: "auto",
    });
  });

  it("registers get, update, and reset RPC handlers on mock server context", async () => {
    const server = createMockServerContext();
    const contract = defineSettingsContract({
      name: "test.settings",
      schema: TestSettingsSchema,
    });

    const storage = new PluginStorage("test-plugin", "state.json", {
      baseDir: testDir,
      schema: contract.schema,
    });

    let updatedEvent: any = null;
    let resetEvent: any = null;

    registerSettingsRpc(server, contract, storage, {
      onUpdate: (newSettings) => {
        updatedEvent = newSettings;
      },
      onReset: (defaultSettings) => {
        resetEvent = defaultSettings;
      },
    });

    // 1. Initial GET
    const initial = await server.callRpc(contract.get, undefined);
    expect(initial).toEqual({
      showCpu: true,
      interval: 3,
      theme: "auto",
    });

    // 2. Partial UPDATE
    const updated = await server.callRpc(contract.update, {
      interval: 5,
      theme: "dark",
    });

    expect(updated).toEqual({
      showCpu: true,
      interval: 5,
      theme: "dark",
    });
    expect(updatedEvent).toEqual(updated);
    expect(storage.read()).toEqual(updated);

    // 3. RESET
    const resetResult = await server.callRpc(contract.reset, undefined);
    expect(resetResult).toEqual({
      showCpu: true,
      interval: 3,
      theme: "auto",
    });
    expect(resetEvent).toEqual(resetResult);
    expect(storage.read()).toEqual(resetResult);
  });
  it("does not overwrite previously modified settings with schema defaults during partial update", async () => {
    const server = createMockServerContext();
    const contract = defineSettingsContract({
      name: "test.settings",
      schema: TestSettingsSchema,
    });

    const storage = new PluginStorage("test-plugin", "isolated.json", {
      baseDir: testDir,
      schema: contract.schema,
    });

    registerSettingsRpc(server, contract, storage);

    // Initial state has showCpu: true
    expect(storage.read().showCpu).toBe(true);

    // Turn off showCpu
    await server.callRpc(contract.update, { showCpu: false });
    expect(storage.read().showCpu).toBe(false);

    // Now update ONLY interval to 10. showCpu must NOT revert to schema default (true)
    await server.callRpc(contract.update, { interval: 10 });
    const current = storage.read();
    expect(current.interval).toBe(10);
    expect(current.showCpu).toBe(false);
  });
});