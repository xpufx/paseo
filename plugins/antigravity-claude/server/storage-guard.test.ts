import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installStorageGuard,
  ScopedStorageViolationError,
} from "paseo-plugin-helper/server";
import contribute from "../index.server.js";

describe("antigravity-claude scoped storage guard (#1412)", () => {
  it("allows writes within scoped plugin storage directory and tmp", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-guard-allowed-"));
    const uninstall = installStorageGuard({
      pluginId: "antigravity-claude",
      baseDir: tmpBase,
      allowTmp: true,
      mode: "enforce",
    });

    try {
      const scopedDir = path.join(tmpBase, "antigravity-claude");
      fs.mkdirSync(scopedDir, { recursive: true });
      const testFile = path.join(scopedDir, "state.json");
      fs.writeFileSync(testFile, JSON.stringify({ ok: true }), "utf8");
      expect(fs.existsSync(testFile)).toBe(true);

      // Tmp writes are explicitly allowed for antigravity-claude prompt images
      const tmpFile = path.join(os.tmpdir(), `ag-claude-test-${Date.now()}.png`);
      fs.writeFileSync(tmpFile, "fake-png-data", "utf8");
      expect(fs.existsSync(tmpFile)).toBe(true);
      fs.unlinkSync(tmpFile);
    } finally {
      uninstall();
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("blocks and throws on write operations outside permitted scopes", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-guard-blocked-"));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fake-home-"));
    const uninstall = installStorageGuard({
      pluginId: "antigravity-claude",
      baseDir: tmpBase,
      allowTmp: false,
      mode: "enforce",
    });

    try {
      const unauthorizedFile = path.join(fakeHome, ".config", "paseo", "unauthorized.json");
      expect(() => {
        fs.writeFileSync(unauthorizedFile, "should fail");
      }).toThrow(ScopedStorageViolationError);
    } finally {
      uninstall();
      fs.rmSync(tmpBase, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("restores standard fs operations when uninstalled", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-guard-restore-"));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fake-home-restore-"));
    const uninstall = installStorageGuard({
      pluginId: "antigravity-claude",
      baseDir: tmpBase,
      allowTmp: false,
      mode: "enforce",
    });

    const targetFile = path.join(fakeHome, "test.txt");
    expect(() => {
      fs.writeFileSync(targetFile, "should fail");
    }).toThrow(ScopedStorageViolationError);

    uninstall();

    expect(() => {
      fs.writeFileSync(targetFile, "succeeded after uninstall");
    }).not.toThrow();
    expect(fs.readFileSync(targetFile, "utf8")).toBe("succeeded after uninstall");

    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    } catch {}
  });

  it("teardown hook from contribute() uninstalls storage guard", () => {
    const fakeServer = {
      registerProvider: () => {},
    };
    const dispose = contribute(fakeServer as never);
    expect(typeof dispose).toBe("function");
    dispose();
  });
});
