import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PluginStorage,
  ScopedStorageViolationError,
  installStorageGuard,
  resolvePaseoHome,
} from "paseo-plugin-helper/server";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute, { migrateLegacySettingsFile } from "../index.server";
import { resolveCompanionBinDir } from "../scripts/install-companion.mjs";
import { approvalSettings, type ApprovalSettingsValues } from "../shared/approval";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe("twofado storage guard (#1410)", () => {
  it("permits writes inside scoped plugin storage directory", () => {
    const tmpBase = makeTempDir("twofado-guard-allowed-");
    const uninstall = installStorageGuard({
      pluginId: "twofado",
      baseDir: tmpBase,
      allowTmp: true,
      mode: "enforce",
    });

    try {
      const scopedDir = path.join(tmpBase, "twofado");
      fs.mkdirSync(scopedDir, { recursive: true });
      const testFile = path.join(scopedDir, "settings.json");
      fs.writeFileSync(testFile, JSON.stringify({ ok: true }), "utf8");
      expect(fs.existsSync(testFile)).toBe(true);
    } finally {
      uninstall();
    }
  });

  it("blocks writes outside permitted scopes when guard is active", () => {
    const tmpBase = makeTempDir("twofado-guard-blocked-");
    const fakeHome = makeTempDir("twofado-fake-home-");
    const uninstall = installStorageGuard({
      pluginId: "twofado",
      baseDir: tmpBase,
      allowTmp: false,
      mode: "enforce",
    });

    try {
      const forbiddenFile = path.join(fakeHome, ".paseo", "twofado-stray.json");
      expect(() => {
        fs.writeFileSync(forbiddenFile, "forbidden content");
      }).toThrowError(ScopedStorageViolationError);
    } finally {
      uninstall();
    }
  });

  it("restores standard filesystem behavior after uninstalling guard", () => {
    const tmpBase = makeTempDir("twofado-guard-uninstall-");
    const fakeHome = makeTempDir("twofado-fake-home2-");
    const uninstall = installStorageGuard({
      pluginId: "twofado",
      baseDir: tmpBase,
      allowTmp: false,
      mode: "enforce",
    });

    uninstall();

    const allowedFile = path.join(fakeHome, "test.json");
    fs.writeFileSync(allowedFile, "allowed now", "utf8");
    expect(fs.existsSync(allowedFile)).toBe(true);
  });
});

describe("twofado companion install path resolution (#1410)", () => {
  it("resolves default binDir inside scoped plugin storage rather than repo root", () => {
    const resolved = resolveCompanionBinDir();
    const expected = path.join(resolvePaseoHome(), "plugin-data", "xpufx", "twofado", "bin");
    expect(resolved).toBe(expected);
  });

  it("respects explicit options.binDir override when provided", () => {
    const custom = "/custom/twofado/bin";
    const resolved = resolveCompanionBinDir({ binDir: custom });
    expect(resolved).toBe(path.resolve(custom));
  });

  it("respects process.env.TWOFADO_BIN_DIR override when set", () => {
    const original = process.env.TWOFADO_BIN_DIR;
    try {
      process.env.TWOFADO_BIN_DIR = "/env/twofado/bin";
      const resolved = resolveCompanionBinDir();
      expect(resolved).toBe(path.resolve("/env/twofado/bin"));
    } finally {
      if (original === undefined) {
        delete process.env.TWOFADO_BIN_DIR;
      } else {
        process.env.TWOFADO_BIN_DIR = original;
      }
    }
  });
});

describe("twofado settings migration (#1410)", () => {
  it("migrates legacy telegramFallback to notificationTarget via storage.save()", () => {
    const tmpBase = makeTempDir("twofado-migration-test-");
    const storage = new PluginStorage<ApprovalSettingsValues>("twofado", "settings.json", {
      baseDir: tmpBase,
      defaultData: approvalSettings.defaultSettings,
      schema: approvalSettings.schema,
    });

    const pluginDir = path.join(tmpBase, "twofado");
    fs.mkdirSync(pluginDir, { recursive: true });
    const legacyPayload = {
      telegramFallback: false,
      autoStartDaemon: false,
      socketPath: "/run/test.sock",
    };
    fs.writeFileSync(storage.filePath, JSON.stringify(legacyPayload, null, 2), "utf8");

    migrateLegacySettingsFile(storage);

    const migrated = storage.read();
    expect(migrated.notificationTarget).toBe("paseo");
    expect("telegramFallback" in (migrated as Record<string, unknown>)).toBe(false);
  });

  it("leaves modern settings intact when notificationTarget already present", () => {
    const tmpBase = makeTempDir("twofado-migration-noop-");
    const storage = new PluginStorage<ApprovalSettingsValues>("twofado", "settings.json", {
      baseDir: tmpBase,
      defaultData: approvalSettings.defaultSettings,
      schema: approvalSettings.schema,
    });

    const pluginDir = path.join(tmpBase, "twofado");
    fs.mkdirSync(pluginDir, { recursive: true });
    const modernPayload = {
      notificationTarget: "telegram",
      autoStartDaemon: true,
      socketPath: "/run/modern.sock",
    };
    fs.writeFileSync(storage.filePath, JSON.stringify(modernPayload, null, 2), "utf8");

    migrateLegacySettingsFile(storage);

    const after = storage.read();
    expect(after.notificationTarget).toBe("telegram");
    expect(after.autoStartDaemon).toBe(true);
  });
});

describe("twofado index.server contribute (#1410)", () => {
  it("initializes storage guard and returns functional cleanup hook", () => {
    const handledContracts: unknown[] = [];
    const mockContext = {
      handle: vi.fn((contract: unknown) => {
        handledContracts.push(contract);
      }),
    } as unknown as PluginServerContext;

    const cleanup = contribute(mockContext);
    expect(typeof cleanup).toBe("function");
    expect(handledContracts.length).toBeGreaterThanOrEqual(14);

    expect(() => {
      cleanup();
    }).not.toThrow();
  });
});
