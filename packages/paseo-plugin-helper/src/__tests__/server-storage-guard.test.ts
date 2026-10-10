import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  installStorageGuard,
  ScopedStorageViolationError,
} from "../server/storage-guard.js";

describe("installStorageGuard", () => {
  let uninstall: (() => void) | null = null;
  const pluginId = "test-guard-plugin";
  const namespace = "plugin-data/xpufx";
  const validStorageDir = path.join(os.homedir(), ".paseo", namespace, pluginId);
  const validTmpDir = path.join(os.tmpdir(), `guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const forbiddenDir = path.join(os.homedir(), ".paseo", "logs");

  beforeEach(() => {
    fs.mkdirSync(validTmpDir, { recursive: true });
  });

  afterEach(() => {
    if (uninstall) {
      uninstall();
      uninstall = null;
    }
    if (fs.existsSync(validTmpDir)) {
      fs.rmSync(validTmpDir, { recursive: true, force: true });
    }
    if (fs.existsSync(validStorageDir)) {
      fs.rmSync(validStorageDir, { recursive: true, force: true });
    }
    const testFile = path.join(forbiddenDir, "forbidden-file.txt");
    if (fs.existsSync(testFile)) {
      try {
        fs.unlinkSync(testFile);
      } catch {
        // ignore
      }
    }
  });

  it("allows writes to plugin storage and tmpdir", () => {
    uninstall = installStorageGuard({
      pluginId,
      namespace,
      allowTmp: true,
    });

    fs.mkdirSync(validStorageDir, { recursive: true });
    const targetInStorage = path.join(validStorageDir, "state.json");
    fs.writeFileSync(targetInStorage, JSON.stringify({ ok: true }), "utf8");
    expect(fs.readFileSync(targetInStorage, "utf8")).toBe(JSON.stringify({ ok: true }));

    const targetInTmp = path.join(validTmpDir, "temp.txt");
    fs.writeFileSync(targetInTmp, "temp content", "utf8");
    expect(fs.readFileSync(targetInTmp, "utf8")).toBe("temp content");
  });

  it("blocks sync fs writes outside allowed directories in enforce mode", () => {
    uninstall = installStorageGuard({
      pluginId,
      namespace,
      allowTmp: true,
    });

    const forbiddenPath = path.join(forbiddenDir, "forbidden-file.txt");

    expect(() => {
      fs.writeFileSync(forbiddenPath, "evil");
    }).toThrow(ScopedStorageViolationError);

    expect(() => {
      fs.mkdirSync(path.join(forbiddenDir, "sub"), { recursive: true });
    }).toThrow(ScopedStorageViolationError);

    expect(() => {
      fs.appendFileSync(forbiddenPath, "more");
    }).toThrow(ScopedStorageViolationError);

    expect(() => {
      fs.unlinkSync(forbiddenPath);
    }).toThrow(ScopedStorageViolationError);

    expect(() => {
      fs.rmSync(forbiddenPath, { force: true });
    }).toThrow(ScopedStorageViolationError);
  });

  it("blocks async fsp writes outside allowed directories in enforce mode", async () => {
    uninstall = installStorageGuard({
      pluginId,
      namespace,
      allowTmp: true,
    });

    const forbiddenPath = path.join(forbiddenDir, "forbidden-async.txt");

    await expect(fsp.writeFile(forbiddenPath, "evil")).rejects.toThrow(
      ScopedStorageViolationError,
    );

    await expect(fsp.mkdir(path.join(forbiddenDir, "sub"))).rejects.toThrow(
      ScopedStorageViolationError,
    );

    await expect(fsp.appendFile(forbiddenPath, "more")).rejects.toThrow(
      ScopedStorageViolationError,
    );

    await expect(fsp.unlink(forbiddenPath)).rejects.toThrow(
      ScopedStorageViolationError,
    );

    await expect(fsp.rm(forbiddenPath, { force: true })).rejects.toThrow(
      ScopedStorageViolationError,
    );
  });


  it("supports warn mode without throwing", () => {
    let violationLogged: any = null;
    uninstall = installStorageGuard({
      pluginId,
      namespace,
      mode: "warn",
      onViolation: (v) => {
        violationLogged = v;
      },
    });

    const forbiddenPath = path.join(forbiddenDir, "nonexistent-warn.txt");
    // Should invoke onViolation and not throw ScopedStorageViolationError
    try {
      fs.unlinkSync(forbiddenPath);
    } catch (err: any) {
      // Normal ENOENT is expected, but not ScopedStorageViolationError
      expect(err).not.toBeInstanceOf(ScopedStorageViolationError);
    }

    expect(violationLogged).not.toBeNull();
    expect(violationLogged.path).toBe(forbiddenPath);
    expect(violationLogged.operation).toBe("unlinkSync");
  });

  it("restores original methods cleanly after uninstall", () => {
    uninstall = installStorageGuard({
      pluginId,
      namespace,
      allowTmp: false,
    });

    const targetInTmp = path.join(validTmpDir, "test-uninstall.txt");
    expect(() => {
      fs.writeFileSync(targetInTmp, "should fail before uninstall");
    }).toThrow(ScopedStorageViolationError);

    uninstall();
    uninstall = null;

    // After uninstall, writeFileSync should succeed
    expect(() => {
      fs.writeFileSync(targetInTmp, "succeeds after uninstall");
    }).not.toThrow();
    expect(fs.readFileSync(targetInTmp, "utf8")).toBe("succeeds after uninstall");
  });
});
