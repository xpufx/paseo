import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PluginStorage } from "../server/storage.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("PluginStorage", () => {
  const testDir = path.join(os.tmpdir(), `paseo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("returns defaultData if file does not exist", () => {
    const storage = new PluginStorage("test-plugin", "state.json", {
      baseDir: testDir,
      defaultData: { count: 0, users: [] },
    });

    expect(storage.exists()).toBe(false);
    expect(storage.read()).toEqual({ count: 0, users: [] });
  });

  it("writes and reads state atomically", () => {
    const storage = new PluginStorage<{ count: number; theme: string }>("test-plugin", "state.json", {
      baseDir: testDir,
    });

    storage.write({ count: 42, theme: "dark" });
    expect(storage.exists()).toBe(true);
    expect(storage.read()).toEqual({ count: 42, theme: "dark" });
  });

  it("supports synchronous updater function", () => {
    const storage = new PluginStorage<{ counter: number }>("test-plugin", "state.json", {
      baseDir: testDir,
      defaultData: { counter: 10 },
    });

    const result = storage.update((prev) => ({ counter: prev.counter + 5 }));
    expect(result.counter).toBe(15);
    expect(storage.read().counter).toBe(15);
  });

  it("supports async read, write, and update", async () => {
    const storage = new PluginStorage<{ name: string }>("test-plugin", "async.json", {
      baseDir: testDir,
    });

    await storage.writeAsync({ name: "Alice" });
    const read = await storage.readAsync();
    expect(read.name).toBe("Alice");

    const updated = await storage.updateAsync((prev) => ({ name: `${prev.name} Smith` }));
    expect(updated.name).toBe("Alice Smith");
  });

  it("resets and removes backing file", () => {
    const storage = new PluginStorage("test-plugin", "reset.json", { baseDir: testDir });
    storage.write({ ok: true });
    expect(storage.exists()).toBe(true);
    storage.reset();
    expect(storage.exists()).toBe(false);
  });
});
