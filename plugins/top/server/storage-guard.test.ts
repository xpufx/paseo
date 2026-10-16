import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  installStorageGuard,
  ScopedStorageViolationError,
  discoverCustomPillConfigs,
  resolvePaseoHome,
} from "paseo-plugin-helper/server";
import {
  CUSTOM_PILLS_DIR,
  getLegacyPillsDir,
  migrateLegacyCustomPills,
} from "./resources.js";
import contribute from "../index.server.js";

describe("top storage guard and scoped storage (#1409)", () => {
  it("CUSTOM_PILLS_DIR resolves to scoped plugin storage", () => {
    const expected = path.join(
      resolvePaseoHome(),
      "plugin-data",
      "xpufx",
      "top",
      "pills",
    );
    assert.equal(CUSTOM_PILLS_DIR, expected);
  });

  it("enables storage guard without throwing runtime exceptions", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "top-guard-test-"));
    let uninstall: (() => void) | null = null;
    try {
      uninstall = installStorageGuard({
        pluginId: "top",
        baseDir: tmpBase,
        allowTmp: true,
        mode: "enforce",
      });
      assert.equal(typeof uninstall, "function");

      // Scoped write inside allowed plugin directory
      const scopedDir = path.join(tmpBase, "top", "pills");
      fs.mkdirSync(scopedDir, { recursive: true });
      const testFile = path.join(scopedDir, "metric.jsonc");
      fs.writeFileSync(
        testFile,
        JSON.stringify({ id: "test", title: "Test", command: "echo 1" }),
        "utf8",
      );
      assert.equal(fs.existsSync(testFile), true);
    } finally {
      if (uninstall) uninstall();
      try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      } catch {}
    }
  });

  it("blocks and throws on write operations outside permitted scopes when guard is active", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "top-guard-blocked-"));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fake-home-"));
    let uninstall: (() => void) | null = null;
    try {
      uninstall = installStorageGuard({
        pluginId: "top",
        baseDir: tmpBase,
        allowTmp: false,
        mode: "enforce",
      });

      const forbiddenFile = path.join(fakeHome, ".paseo", "top", "pills", "stray.json");
      assert.throws(
        () => {
          fs.writeFileSync(forbiddenFile, "forbidden");
        },
        (err: unknown) => {
          return (
            err instanceof ScopedStorageViolationError &&
            err.code === "ERR_SCOPED_STORAGE_VIOLATION" &&
            err.message.includes("Scoped storage violation")
          );
        },
      );
    } finally {
      if (uninstall) uninstall();
      try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
        fs.rmSync(fakeHome, { recursive: true, force: true });
      } catch {}
    }
  });

  it("restores original filesystem methods when uninstalled", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "top-guard-restore-"));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fake-home-restore-"));
    const uninstall = installStorageGuard({
      pluginId: "top",
      baseDir: tmpBase,
      allowTmp: false,
      mode: "enforce",
    });

    const targetFile = path.join(fakeHome, "test.txt");
    assert.throws(() => {
      fs.writeFileSync(targetFile, "should fail");
    });

    uninstall();

    // After uninstall, the write should succeed without throwing
    assert.doesNotThrow(() => {
      fs.writeFileSync(targetFile, "succeeded after uninstall");
    });
    assert.equal(fs.readFileSync(targetFile, "utf8"), "succeeded after uninstall");

    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    } catch {}
  });

  it("custom pills CRUD operates cleanly inside scoped storage under active storage guard", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "top-crud-test-"));
    const scopedPillsDir = path.join(tmpBase, "top", "pills");
    let uninstall: (() => void) | null = null;

    try {
      uninstall = installStorageGuard({
        pluginId: "top",
        baseDir: tmpBase,
        allowTmp: true,
        mode: "enforce",
      });

      // CREATE
      fs.mkdirSync(scopedPillsDir, { recursive: true });
      const pillFile = path.join(scopedPillsDir, "custom-pill.jsonc");
      const pillContent = {
        id: "scoped-custom-pill",
        title: "Scoped Pill",
        compactTitle: "Scoped",
        icon: "Cpu",
        command: "echo 42",
        suffix: "%",
        intervalMs: 5000,
        timeoutMs: 2000,
      };
      fs.writeFileSync(pillFile, JSON.stringify(pillContent, null, 2), "utf8");
      assert.equal(fs.existsSync(pillFile), true);

      // READ / DISCOVER
      const discovered = await discoverCustomPillConfigs(scopedPillsDir);
      assert.equal(discovered.length, 1);
      assert.equal(discovered[0].id, "scoped-custom-pill");
      assert.equal(discovered[0].title, "Scoped Pill");
      assert.equal(discovered[0].command, "echo 42");

      // UPDATE
      const updatedContent = {
        ...pillContent,
        title: "Updated Scoped Pill",
        suffix: "ms",
      };
      fs.writeFileSync(pillFile, JSON.stringify(updatedContent, null, 2), "utf8");
      const reDiscovered = await discoverCustomPillConfigs(scopedPillsDir);
      assert.equal(reDiscovered.length, 1);
      assert.equal(reDiscovered[0].title, "Updated Scoped Pill");
      assert.equal(reDiscovered[0].suffix, "ms");

      // DELETE
      fs.unlinkSync(pillFile);
      assert.equal(fs.existsSync(pillFile), false);
      const emptyDiscovered = await discoverCustomPillConfigs(scopedPillsDir);
      assert.equal(emptyDiscovered.length, 0);
    } finally {
      if (uninstall) uninstall();
      try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      } catch {}
    }
  });

  it("migrates pills from legacy directory into scoped storage and cleans up legacy files", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "top-migration-test-"));
    const legacyDir = path.join(tmpBase, "legacy", ".paseo", "top", "pills");
    const targetDir = path.join(tmpBase, "scoped", "plugin-data", "xpufx", "top", "pills");

    fs.mkdirSync(legacyDir, { recursive: true });

    const pill1Path = path.join(legacyDir, "disk-check.jsonc");
    const pill1Data = JSON.stringify({
      id: "disk-check",
      title: "Disk Check",
      command: "df -h",
    });
    fs.writeFileSync(pill1Path, pill1Data, "utf8");

    const pill2Path = path.join(legacyDir, "memory-check.json");
    const pill2Data = JSON.stringify({
      id: "memory-check",
      title: "Mem Check",
      command: "free -m",
    });
    fs.writeFileSync(pill2Path, pill2Data, "utf8");

    assert.equal(fs.existsSync(pill1Path), true);
    assert.equal(fs.existsSync(pill2Path), true);

    // Run migration
    migrateLegacyCustomPills(legacyDir, targetDir);

    // Verify files copied to target
    assert.equal(fs.existsSync(path.join(targetDir, "disk-check.jsonc")), true);
    assert.equal(fs.existsSync(path.join(targetDir, "memory-check.json")), true);
    assert.equal(
      fs.readFileSync(path.join(targetDir, "disk-check.jsonc"), "utf8"),
      pill1Data,
    );
    assert.equal(
      fs.readFileSync(path.join(targetDir, "memory-check.json"), "utf8"),
      pill2Data,
    );

    // Verify legacy directory cleaned up
    assert.equal(fs.existsSync(legacyDir), false);

    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {}
  });

  it("migrateLegacyCustomPills handles non-existent or empty legacy directory gracefully", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "top-migration-noop-"));
    const nonExistent = path.join(tmpBase, "nonexistent");
    const targetDir = path.join(tmpBase, "target");

    // Non-existent directory should not throw
    assert.doesNotThrow(() => {
      migrateLegacyCustomPills(nonExistent, targetDir);
    });
    assert.equal(fs.existsSync(targetDir), false);

    // Empty directory should not throw and not create target
    const emptyDir = path.join(tmpBase, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    assert.doesNotThrow(() => {
      migrateLegacyCustomPills(emptyDir, targetDir);
    });

    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {}
  });

  it("server contribute initializes storage guard and disposal hook cleanly", () => {
    const handledContracts: unknown[] = [];
    const eventSubscriptions: Record<string, Function[]> = {};

    const mockServer = {
      handle: (contract: unknown) => {
        handledContracts.push(contract);
      },
      on: (event: string, handler: Function) => {
        eventSubscriptions[event] = eventSubscriptions[event] || [];
        eventSubscriptions[event].push(handler);
        return () => {
          const idx = eventSubscriptions[event].indexOf(handler);
          if (idx >= 0) eventSubscriptions[event].splice(idx, 1);
        };
      },
    } as unknown as PluginServerContext;

    const cleanup = contribute(mockServer);
    assert.equal(typeof cleanup, "function");
    assert.ok(handledContracts.length > 0);

    // Verify cleanup hook runs without throwing
    assert.doesNotThrow(() => {
      cleanup();
    });
  });
});
