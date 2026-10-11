import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installStorageGuard, ScopedStorageViolationError } from "../server/vendor/paseo-plugin-helper/storage-guard.js";

describe("wellbeing scoped storage guard (#1187)", () => {
  it("allows writes within scoped plugin storage directory", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "wellbeing-guard-allowed-"));
    const uninstall = installStorageGuard({
      pluginId: "wellbeing",
      baseDir: tmpBase,
      allowTmp: true,
      mode: "enforce",
    });

    try {
      const scopedDir = path.join(tmpBase, "wellbeing");
      fs.mkdirSync(scopedDir, { recursive: true });
      const testFile = path.join(scopedDir, "wellbeing-state.json");
      fs.writeFileSync(testFile, JSON.stringify({ ok: true }), "utf8");
      assert.equal(fs.existsSync(testFile), true);
    } finally {
      uninstall();
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("blocks and throws on write operations outside permitted scopes", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "wellbeing-guard-blocked-"));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fake-home-"));
    const uninstall = installStorageGuard({
      pluginId: "wellbeing",
      baseDir: tmpBase,
      allowTmp: false,
      mode: "enforce",
    });

    try {
      const unauthorizedFile = path.join(fakeHome, ".config", "paseo", "wellbeing-state.json");
      assert.throws(
        () => {
          fs.writeFileSync(unauthorizedFile, "should fail");
        },
        (err: unknown) => {
          return (
            err instanceof ScopedStorageViolationError &&
            err.attemptedPath.includes("wellbeing-state.json") &&
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
});
