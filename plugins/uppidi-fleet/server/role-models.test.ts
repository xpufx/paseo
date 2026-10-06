import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_ROLE_MODELS,
  defaultRoleModelsConfigPath,
  handleUppidiSetRoleModel,
  legacyRoleModelsConfigPaths,
  loadSavedRoleModels,
  migrateLegacyRoleModelsConfig,
  saveRoleModels,
} from "./role-models.js";

const originalEnv = {
  HOME: process.env.HOME,
  REAL_HOME: process.env.REAL_HOME,
  UPPIDI_FLEET_ROLE_MODELS_CONFIG: process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG,
};

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (originalEnv.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = originalEnv.HOME;
  if (originalEnv.REAL_HOME === undefined) delete process.env.REAL_HOME;
  else process.env.REAL_HOME = originalEnv.REAL_HOME;
  if (originalEnv.UPPIDI_FLEET_ROLE_MODELS_CONFIG === undefined) {
    delete process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG;
  } else {
    process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG = originalEnv.UPPIDI_FLEET_ROLE_MODELS_CONFIG;
  }
});

function roleConfig(primaryModel: string) {
  return { role: "orchestrator", primaryModel, fallbackGroup: [primaryModel] };
}

describe("role-models scoped config path (#1012)", () => {
  it("stores role models under the plugin data dir, not the bare home", () => {
    assert.equal(
      defaultRoleModelsConfigPath("/home/user"),
      path.join(
        "/home/user",
        ".paseo",
        "plugin-data",
        "xpufx",
        "uppidi-fleet",
        "role-models.json",
      ),
    );
  });

  it("enumerates legacy unscoped configs in migration priority order", () => {
    assert.deepEqual(legacyRoleModelsConfigPaths("/home/user"), [
      "/home/user/uppidi-fleet-role-models.json",
      "/home/user/uppidi-fleet-role-models.json.bak",
      "/home/user/.paseo/uppidi-fleet-role-models.json",
      "/home/user/.paseo/uppidi-fleet-role-models.json.bak",
    ]);
  });
});

describe("role-models legacy migration (#1012)", () => {
  it("copies the legacy home config to the scoped path once", () => {
    const home = makeTempDir("paseo-role-models-home-");
    const legacy = path.join(home, "uppidi-fleet-role-models.json");
    fs.writeFileSync(legacy, JSON.stringify({ orchestrator: roleConfig("legacy/model") }));
    const target = defaultRoleModelsConfigPath(home);

    assert.equal(migrateLegacyRoleModelsConfig(target, legacyRoleModelsConfigPaths(home)), true);
    assert.ok(fs.existsSync(target));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(target, "utf8")),
      JSON.parse(fs.readFileSync(legacy, "utf8")),
    );
    assert.ok(fs.existsSync(legacy), "the legacy file is left in place");

    fs.writeFileSync(target, JSON.stringify({ orchestrator: roleConfig("scoped/model") }));
    assert.equal(migrateLegacyRoleModelsConfig(target, legacyRoleModelsConfigPaths(home)), false);
    assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).orchestrator.primaryModel, "scoped/model");
  });

  it("falls back to the legacy .paseo config and .bak siblings", () => {
    const home = makeTempDir("paseo-role-models-legacy-");
    const bak = path.join(home, ".paseo", "uppidi-fleet-role-models.json.bak");
    fs.mkdirSync(path.dirname(bak), { recursive: true });
    fs.writeFileSync(bak, JSON.stringify({ orchestrator: roleConfig("bak/model") }));

    const target = defaultRoleModelsConfigPath(home);
    assert.equal(migrateLegacyRoleModelsConfig(target, legacyRoleModelsConfigPaths(home)), true);
    assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).orchestrator.primaryModel, "bak/model");
  });

  it("skips malformed legacy files and returns false when none are usable", () => {
    const home = makeTempDir("paseo-role-models-malformed-");
    fs.writeFileSync(path.join(home, "uppidi-fleet-role-models.json"), "{not json");
    const target = defaultRoleModelsConfigPath(home);

    assert.equal(migrateLegacyRoleModelsConfig(target, legacyRoleModelsConfigPaths(home)), false);
    assert.equal(fs.existsSync(target), false);
  });

  it("loadSavedRoleModels migrates on first read and merges the built-in defaults", () => {
    const home = makeTempDir("paseo-role-models-load-");
    fs.writeFileSync(
      path.join(home, "uppidi-fleet-role-models.json"),
      JSON.stringify({ orchestrator: roleConfig("legacy/model") }),
    );
    process.env.HOME = home;
    delete process.env.REAL_HOME;
    delete process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG;

    const roles = loadSavedRoleModels();
    assert.equal(roles.orchestrator.primaryModel, "legacy/model");
    assert.equal(roles["front-desk"].primaryModel, DEFAULT_ROLE_MODELS["front-desk"].primaryModel);
    assert.ok(fs.existsSync(defaultRoleModelsConfigPath(home)));
  });

  it("honors UPPIDI_FLEET_ROLE_MODELS_CONFIG for reads and writes", () => {
    const dir = makeTempDir("paseo-role-models-override-");
    const target = path.join(dir, "custom-role-models.json");
    process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG = target;

    saveRoleModels({ ...DEFAULT_ROLE_MODELS, orchestrator: roleConfig("override/model") });
    assert.equal(fs.existsSync(target), true);
    assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).orchestrator.primaryModel, "override/model");
    assert.equal(loadSavedRoleModels().orchestrator.primaryModel, "override/model");
  });
});

describe("role-model fallback round-trip (#1011)", () => {
  it("persists the primary and the full fallbackGroup, and clears it when emptied", async () => {
    const dir = makeTempDir("paseo-role-models-roundtrip-");
    const target = path.join(dir, "role-models.json");
    process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG = target;
    const ctx = {} as never;

    const set = await handleUppidiSetRoleModel(
      {
        role: "orchestrator",
        primaryModel: "pi/commandcode/deepseek/deepseek-v4-flash",
        fallbackGroup: [
          "pi/commandcode/deepseek/deepseek-v4-flash",
          "antigravity/gemini-3.8-flash-low",
        ],
      },
      ctx,
    );
    assert.equal(set.ok, true);
    assert.deepEqual(loadSavedRoleModels().orchestrator.fallbackGroup, [
      "pi/commandcode/deepseek/deepseek-v4-flash",
      "antigravity/gemini-3.8-flash-low",
    ]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(target, "utf8")).orchestrator.fallbackGroup,
      [
        "pi/commandcode/deepseek/deepseek-v4-flash",
        "antigravity/gemini-3.8-flash-low",
      ],
    );

    // Removing the last fallback persists an empty group, not the stale one.
    const cleared = await handleUppidiSetRoleModel(
      {
        role: "orchestrator",
        primaryModel: "antigravity/gemini-3.8-flash-low",
        fallbackGroup: [],
      },
      ctx,
    );
    assert.equal(cleared.ok, true);
    assert.deepEqual(loadSavedRoleModels().orchestrator.fallbackGroup, []);
  });
});
