import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  getUppidiFleetSettingsStorage,
  resetUppidiFleetSettingsStorageInstance,
} from "./settings.js";

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  HOME: process.env.HOME,
  REAL_HOME: process.env.REAL_HOME,
  PASEO_HOME: process.env.PASEO_HOME,
};

function restoreEnv(): void {
  if (originalEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.NODE_ENV;
  if (originalEnv.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = originalEnv.HOME;
  if (originalEnv.REAL_HOME === undefined) delete process.env.REAL_HOME;
  else process.env.REAL_HOME = originalEnv.REAL_HOME;
  if (originalEnv.PASEO_HOME === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = originalEnv.PASEO_HOME;
}

afterEach(() => {
  resetUppidiFleetSettingsStorageInstance();
  restoreEnv();
});

describe("uppidi-fleet settings storage host-home anchoring (#1158)", () => {
  it("anchors the default file to the host plugin-data dir when HOME is an agent-mux profile", () => {
    process.env.NODE_ENV = "production";
    process.env.HOME = "/home/user/.agent-mux/profiles/antigravity/pufaysokt";
    process.env.REAL_HOME = "/home/user";
    delete process.env.PASEO_HOME;
    resetUppidiFleetSettingsStorageInstance();

    const storage = getUppidiFleetSettingsStorage();
    assert.equal(
      storage.filePath,
      join("/home/user", ".paseo", "plugin-data", "xpufx", "uppidi-fleet", "settings.json"),
    );
  });

  it("honors PASEO_HOME as the canonical paseo root", () => {
    process.env.NODE_ENV = "production";
    process.env.PASEO_HOME = "/srv/paseo/.paseo";
    resetUppidiFleetSettingsStorageInstance();

    const storage = getUppidiFleetSettingsStorage();
    assert.equal(
      storage.filePath,
      join("/srv/paseo/.paseo", "plugin-data", "xpufx", "uppidi-fleet", "settings.json"),
    );
  });

  it("lets an explicit baseDir override win", () => {
    const storage = getUppidiFleetSettingsStorage({ baseDir: "/custom/base" });
    assert.equal(storage.filePath, join("/custom/base", "uppidi-fleet", "settings.json"));
  });
});
