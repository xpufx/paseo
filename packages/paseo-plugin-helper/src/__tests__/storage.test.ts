import { describe, it, expect, afterEach } from "vitest";
import { PluginStorage, DEFAULT_NAMESPACE_README } from "../server/storage.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("PluginStorage Scoped Namespace and Auditing (#49)", () => {
  const testBase = path.join(os.tmpdir(), `paseo-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  afterEach(() => {
    if (fs.existsSync(testBase)) {
      fs.rmSync(testBase, { recursive: true, force: true });
    }
  });

  it("defaults to scoped ~/.paseo/plugin-data/xpufx/<pluginId> path", () => {
    const storage = new PluginStorage("my-plugin", "settings.json");
    const expectedDir = path.join(os.homedir(), ".paseo", "plugin-data", "xpufx", "my-plugin");
    const expectedFile = path.join(expectedDir, "settings.json");

    expect(storage.pluginDir).toBe(expectedDir);
    expect(storage.filePath).toBe(expectedFile);
  });

  it("automatically generates README.md in the namespace directory when directory is provisioned", () => {
    const namespaceDir = path.join(testBase, "custom-ns");
    const storage = new PluginStorage("test-plugin", "data.json", {
      baseDir: namespaceDir,
    });

    expect(fs.existsSync(path.join(namespaceDir, "README.md"))).toBe(false);

    storage.write({ hello: "world" });

    const readmePath = path.join(namespaceDir, "README.md");
    expect(fs.existsSync(readmePath)).toBe(true);
    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toBe(DEFAULT_NAMESPACE_README);
    expect(content).toContain("# Paseo Plugins Storage (xpufx)");
  });

  it("audits storage consumption via getStorageStats() and getStats()", async () => {
    const pluginDir = path.join(testBase, "audit-plugin");
    const storage = new PluginStorage<{ key: string }>("audit-plugin", "main.json", {
      baseDir: testBase,
    });

    const emptyStats = await storage.getStorageStats();
    expect(emptyStats.fileCount).toBe(0);
    expect(emptyStats.totalBytes).toBe(0);
    expect(emptyStats.lastModified).toBeNull();
    expect(emptyStats.path).toBe(pluginDir);

    await storage.writeAsync({ key: "alpha" });
    // Write an additional file
    const secondFile = path.join(pluginDir, "extra.txt");
    fs.writeFileSync(secondFile, "1234567890", "utf8");

    const stats = await storage.getStorageStats();
    expect(stats.fileCount).toBe(2);
    expect(stats.totalBytes).toBeGreaterThan(10);
    expect(stats.lastModified).toBeInstanceOf(Date);

    // Alias test
    const aliasStats = await storage.getStats();
    expect(aliasStats.fileCount).toBe(stats.fileCount);
    expect(aliasStats.totalBytes).toBe(stats.totalBytes);
  });

  it("returns defaults when no state file exists", () => {
    const storage = new PluginStorage<{ version: number }>("missing-plugin", "config.json", {
      baseDir: path.join(testBase, "plugin-data", "xpufx"),
      defaultData: { version: 1 },
    });

    expect(storage.exists()).toBe(false);
    expect(storage.read()).toEqual({ version: 1 });
  });

  it("async reads return defaults when no state file exists", async () => {
    const storage = new PluginStorage<{ asyncVal: number }>("missing-async-plugin", "async-config.json", {
      baseDir: path.join(testBase, "plugin-data", "xpufx"),
      defaultData: { asyncVal: 42 },
    });

    const data = await storage.readAsync();
    expect(data).toEqual({ asyncVal: 42 });
  });
});
