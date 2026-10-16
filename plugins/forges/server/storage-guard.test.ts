import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installStorageGuard,
  ScopedStorageViolationError,
} from "paseo-plugin-helper/server";
import contribute from "../index.server.ts";

describe("forges scoped storage guard (#1412)", () => {
  it("allows writes within scoped plugin storage directory", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "forges-guard-allowed-"));
    const uninstall = installStorageGuard({
      pluginId: "forges",
      baseDir: tmpBase,
      allowTmp: true,
      mode: "enforce",
    });

    try {
      const scopedDir = path.join(tmpBase, "forges");
      fs.mkdirSync(scopedDir, { recursive: true });
      const testFile = path.join(scopedDir, "state.json");
      fs.writeFileSync(testFile, JSON.stringify({ ok: true }), "utf8");
      assert.equal(fs.existsSync(testFile), true);
    } finally {
      uninstall();
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("blocks and throws on write operations outside permitted scopes", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "forges-guard-blocked-"));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fake-home-"));
    const uninstall = installStorageGuard({
      pluginId: "forges",
      baseDir: tmpBase,
      allowTmp: false,
      mode: "enforce",
    });

    try {
      const unauthorizedFile = path.join(fakeHome, ".config", "paseo", "unauthorized.json");
      assert.throws(
        () => {
          fs.writeFileSync(unauthorizedFile, "should fail");
        },
        (err: unknown) => {
          return (
            err instanceof ScopedStorageViolationError &&
            err.code === "ERR_SCOPED_STORAGE_VIOLATION" &&
            err.message.includes("Scoped storage violation")
          );
        }
      );
    } finally {
      uninstall();
      fs.rmSync(tmpBase, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("restores standard fs operations when uninstalled", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "forges-guard-restore-"));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fake-home-restore-"));
    const uninstall = installStorageGuard({
      pluginId: "forges",
      baseDir: tmpBase,
      allowTmp: false,
      mode: "enforce",
    });

    const targetFile = path.join(fakeHome, "test.txt");
    assert.throws(() => {
      fs.writeFileSync(targetFile, "should fail");
    });

    uninstall();

    assert.doesNotThrow(() => {
      fs.writeFileSync(targetFile, "succeeded after uninstall");
    });
    assert.equal(fs.readFileSync(targetFile, "utf8"), "succeeded after uninstall");

    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    } catch {}
  });

  it("teardown hook from contribute() uninstalls storage guard", () => {
    const fakeServer = {
      handle: () => {},
      before: () => {},
      on: () => {},
    };
    const dispose = contribute(fakeServer as never);
    assert.equal(typeof dispose, "function");
    dispose();
  });
});
