import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CANONICAL_PLAYBOOK_STAGES,
  PlaybookActorSchema,
  PlaybookProfileSchema,
  PlaybooksConfigSchema,
  PlaybookStageNameSchema,
  StageSuccessorSchema,
  type PlaybookProfile,
  type PlaybooksConfig,
} from "../shared/contracts.js";
import {
  DEFAULT_LIGHT_STAGES,
  DEFAULT_MEDIUM_STAGES,
  DEFAULT_PLAYBOOKS_CONFIG,
  defaultPlaybooksConfigPath,
  getOrderedStages,
  getPlaybookProfile,
  getPlaybooksStorage,
  handleUppidiPlaybooks,
  handleUppidiSetPlaybook,
  isAutonomousActor,
  isAutonomousStage,
  isHumanActor,
  isHumanGatedStage,
  loadSavedPlaybooks,
  parseActor,
  resetPlaybooksStorageInstance,
  resolveNextStage,
  savePlaybooks,
  validatePlaybookProfile,
} from "./playbooks.js";

const WORKSPACE_TMP = path.join(process.cwd(), ".tmp");
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  if (!fs.existsSync(WORKSPACE_TMP)) {
    fs.mkdirSync(WORKSPACE_TMP, { recursive: true });
  }
  const dir = fs.mkdtempSync(path.join(WORKSPACE_TMP, prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetPlaybooksStorageInstance();
  delete process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("playbook stage schema and progression contracts (#1403, #1270)", () => {
  it("defines the 7 canonical stages in required progression order", () => {
    assert.deepEqual(CANONICAL_PLAYBOOK_STAGES, [
      "stage/spec",
      "stage/spec-audit",
      "stage/dispatch",
      "stage/code",
      "stage/review",
      "stage/merge",
      "stage/verify",
    ]);

    for (const stage of CANONICAL_PLAYBOOK_STAGES) {
      assert.equal(PlaybookStageNameSchema.parse(stage), stage);
    }
    assert.throws(() => PlaybookStageNameSchema.parse("stage/unknown"));
  });

  it("validates StageSuccessor schema strictly", () => {
    const valid = StageSuccessorSchema.parse({
      success: "stage/dispatch",
      rejection: "stage/spec",
    });
    assert.equal(valid.success, "stage/dispatch");
    assert.equal(valid.rejection, "stage/spec");

    const terminal = StageSuccessorSchema.parse({
      success: null,
      rejection: null,
    });
    assert.equal(terminal.success, null);

    assert.throws(() =>
      StageSuccessorSchema.parse({
        success: "stage/dispatch",
        extra_key: "forbidden",
      }),
    );
  });

  it("validates PlaybookActor schema for human:operator and autonomous:<role>", () => {
    assert.equal(PlaybookActorSchema.parse("human:operator"), "human:operator");
    assert.equal(PlaybookActorSchema.parse("autonomous:coding-agent"), "autonomous:coding-agent");
    assert.equal(PlaybookActorSchema.parse("autonomous:spec-agent"), "autonomous:spec-agent");
    assert.equal(PlaybookActorSchema.parse("autonomous:code-auditor"), "autonomous:code-auditor");

    assert.throws(() => PlaybookActorSchema.parse("human:unknown"));
    assert.throws(() => PlaybookActorSchema.parse("autonomous:"));
    assert.throws(() => PlaybookActorSchema.parse("operator"));
    assert.throws(() => PlaybookActorSchema.parse(""));
  });

  it("parses actor types and roles via parseActor", () => {
    assert.deepEqual(parseActor("human:operator"), { type: "human", role: "operator" });
    assert.deepEqual(parseActor("autonomous:spec-agent"), { type: "autonomous", role: "spec-agent" });
    assert.deepEqual(parseActor("autonomous:orchestrator"), { type: "autonomous", role: "orchestrator" });

    assert.throws(() => parseActor("invalid-actor"));
    assert.throws(() => parseActor("autonomous:"));
  });

  it("distinguishes human and autonomous actors with predicates", () => {
    assert.equal(isHumanActor("human:operator"), true);
    assert.equal(isHumanActor("autonomous:coding-agent"), false);

    assert.equal(isAutonomousActor("autonomous:coding-agent"), true);
    assert.equal(isAutonomousActor("human:operator"), false);
  });
});

describe("default playbook profiles (Light vs Medium) (#1403, #1270)", () => {
  it("defaults to Medium profile in DEFAULT_PLAYBOOKS_CONFIG", () => {
    assert.equal(DEFAULT_PLAYBOOKS_CONFIG.defaultProfile, "Medium");
    assert.ok(DEFAULT_PLAYBOOKS_CONFIG.profiles.Light);
    assert.ok(DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium);
  });

  it("configures Light profile for full autonomy across all 7 stages", () => {
    const light = DEFAULT_PLAYBOOKS_CONFIG.profiles.Light;
    assert.equal(light.name, "Light");

    for (const stageName of CANONICAL_PLAYBOOK_STAGES) {
      const stage = light.stages[stageName];
      assert.ok(stage, `Stage ${stageName} must be defined in Light`);
      assert.equal(stage.stage, stageName);
      assert.ok(isAutonomousStage(stage), `${stageName} must be autonomous in Light`);
      assert.equal(isHumanGatedStage(stage), false);
      assert.ok(stage.entry_precondition.length > 0);
      assert.ok(stage.exit_artifact.length > 0);
    }

    assert.equal(light.stages["stage/spec"].actor, "autonomous:spec-agent");
    assert.equal(light.stages["stage/spec-audit"].actor, "autonomous:spec-auditor");
    assert.equal(light.stages["stage/dispatch"].actor, "autonomous:orchestrator");
    assert.equal(light.stages["stage/code"].actor, "autonomous:coding-agent");
    assert.equal(light.stages["stage/review"].actor, "autonomous:code-auditor");
    assert.equal(light.stages["stage/merge"].actor, "autonomous:orchestrator");
    assert.equal(light.stages["stage/verify"].actor, "autonomous:orchestrator");
  });

  it("configures Medium profile with human gates at spec-audit, review, and verify", () => {
    const medium = DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium;
    assert.equal(medium.name, "Medium");

    for (const stageName of CANONICAL_PLAYBOOK_STAGES) {
      const stage = medium.stages[stageName];
      assert.ok(stage, `Stage ${stageName} must be defined in Medium`);
      assert.equal(stage.stage, stageName);
      assert.ok(stage.entry_precondition.length > 0);
      assert.ok(stage.exit_artifact.length > 0);
    }

    // Human gates
    assert.equal(medium.stages["stage/spec-audit"].actor, "human:operator");
    assert.equal(isHumanGatedStage(medium.stages["stage/spec-audit"]), true);

    assert.equal(medium.stages["stage/review"].actor, "human:operator");
    assert.equal(isHumanGatedStage(medium.stages["stage/review"]), true);

    assert.equal(medium.stages["stage/verify"].actor, "human:operator");
    assert.equal(isHumanGatedStage(medium.stages["stage/verify"]), true);

    // Autonomous stages in Medium
    assert.equal(medium.stages["stage/spec"].actor, "autonomous:spec-agent");
    assert.equal(isAutonomousStage(medium.stages["stage/spec"]), true);

    assert.equal(medium.stages["stage/dispatch"].actor, "autonomous:orchestrator");
    assert.equal(isAutonomousStage(medium.stages["stage/dispatch"]), true);

    assert.equal(medium.stages["stage/code"].actor, "autonomous:coding-agent");
    assert.equal(isAutonomousStage(medium.stages["stage/code"]), true);

    assert.equal(medium.stages["stage/merge"].actor, "autonomous:orchestrator");
    assert.equal(isAutonomousStage(medium.stages["stage/merge"]), true);
  });

  it("verifies entry preconditions and exit artifacts across pipeline", () => {
    const medium = DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium;

    assert.equal(medium.stages["stage/spec"].entry_precondition, "assigned_issue");
    assert.equal(medium.stages["stage/spec"].exit_artifact, "spec_checklist");

    assert.equal(medium.stages["stage/spec-audit"].entry_precondition, "spec_checklist");
    assert.equal(medium.stages["stage/spec-audit"].exit_artifact, "spec_audit_approval");

    assert.equal(medium.stages["stage/dispatch"].entry_precondition, "spec_audit_approval");
    assert.equal(medium.stages["stage/dispatch"].exit_artifact, "worktree_provisioned");

    assert.equal(medium.stages["stage/code"].entry_precondition, "worktree_provisioned");
    assert.equal(medium.stages["stage/code"].exit_artifact, "pull_request");

    assert.equal(medium.stages["stage/review"].entry_precondition, "pull_request");
    assert.equal(medium.stages["stage/review"].exit_artifact, "audit_receipt");

    assert.equal(medium.stages["stage/merge"].entry_precondition, "audit_receipt");
    assert.equal(medium.stages["stage/merge"].exit_artifact, "squash_commit");

    assert.equal(medium.stages["stage/verify"].entry_precondition, "squash_commit");
    assert.equal(medium.stages["stage/verify"].exit_artifact, "acceptance_verification");
  });

  it("resolves next stage for success and rejection outcomes", () => {
    const medium = DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium;

    assert.equal(resolveNextStage(medium.stages["stage/spec"], "success"), "stage/spec-audit");
    assert.equal(resolveNextStage(medium.stages["stage/spec"], "rejection"), null);

    assert.equal(resolveNextStage(medium.stages["stage/spec-audit"], "success"), "stage/dispatch");
    assert.equal(resolveNextStage(medium.stages["stage/spec-audit"], "rejection"), "stage/spec");

    assert.equal(resolveNextStage(medium.stages["stage/code"], "success"), "stage/review");
    assert.equal(resolveNextStage(medium.stages["stage/code"], "rejection"), null);

    assert.equal(resolveNextStage(medium.stages["stage/review"], "success"), "stage/merge");
    assert.equal(resolveNextStage(medium.stages["stage/review"], "rejection"), "stage/code");

    assert.equal(resolveNextStage(medium.stages["stage/verify"], "success"), "stage/done");
    assert.equal(resolveNextStage(medium.stages["stage/verify"], "rejection"), "stage/code");
  });

  it("returns stages in canonical progression order via getOrderedStages", () => {
    const ordered = getOrderedStages(DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium);
    assert.equal(ordered.length, 7);
    assert.deepEqual(
      ordered.map((s) => s.stage),
      CANONICAL_PLAYBOOK_STAGES,
    );
  });
});

describe("playbook profile validation and integrity (#1403)", () => {
  it("validates valid profiles without throwing", () => {
    assert.doesNotThrow(() => validatePlaybookProfile(DEFAULT_PLAYBOOKS_CONFIG.profiles.Light));
    assert.doesNotThrow(() => validatePlaybookProfile(DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium));
  });

  it("rejects profiles missing canonical stages", () => {
    const incomplete: PlaybookProfile = {
      name: "Incomplete",
      stages: { ...DEFAULT_LIGHT_STAGES },
    };
    delete (incomplete.stages as any)["stage/verify"];

    assert.throws(
      () => validatePlaybookProfile(incomplete),
      /missing required canonical stage "stage\/verify"/,
    );
  });

  it("rejects profiles where stage key does not match definition name", () => {
    const mismatched: PlaybookProfile = {
      name: "Mismatched",
      stages: {
        ...DEFAULT_LIGHT_STAGES,
        "stage/spec": {
          ...DEFAULT_LIGHT_STAGES["stage/spec"],
          stage: "stage/code" as any,
        },
      },
    };

    assert.throws(
      () => validatePlaybookProfile(mismatched),
      /does not match stage definition name/,
    );
  });

  it("rejects profiles with invalid actor formats", () => {
    const badActor: PlaybookProfile = {
      name: "BadActor",
      stages: {
        ...DEFAULT_LIGHT_STAGES,
        "stage/spec": {
          ...DEFAULT_LIGHT_STAGES["stage/spec"],
          actor: "invalid:actor" as any,
        },
      },
    };

    assert.throws(() => validatePlaybookProfile(badActor));
  });
});

describe("playbook storage, defaults, and persistence (#1403)", () => {
  it("resolves default scoped path under plugin data dir", () => {
    const expected = path.join(
      "/home/testuser",
      ".paseo",
      "plugin-data",
      "xpufx",
      "uppidi-fleet",
      "playbooks.json",
    );
    assert.equal(defaultPlaybooksConfigPath("/home/testuser"), expected);
  });

  it("loads defaults when storage is empty", () => {
    const tempDir = makeTempDir("playbooks-empty-");
    const loaded = loadSavedPlaybooks({ baseDir: tempDir });
    assert.equal(loaded.defaultProfile, "Medium");
    assert.ok(loaded.profiles.Light);
    assert.ok(loaded.profiles.Medium);
  });

  it("saves and retrieves custom playbook profiles atomically", () => {
    const tempDir = makeTempDir("playbooks-save-");
    const customConfig: PlaybooksConfig = {
      defaultProfile: "Light",
      profiles: {
        ...DEFAULT_PLAYBOOKS_CONFIG.profiles,
        CustomGated: {
          name: "CustomGated",
          description: "Custom gated workflow",
          stages: DEFAULT_MEDIUM_STAGES,
        },
      },
    };

    savePlaybooks(customConfig, { baseDir: tempDir });

    const loaded = loadSavedPlaybooks({ baseDir: tempDir });
    assert.equal(loaded.defaultProfile, "Light");
    assert.ok(loaded.profiles.CustomGated);
    assert.equal(loaded.profiles.CustomGated.name, "CustomGated");
  });

  it("rejects saving when defaultProfile does not exist in profiles", () => {
    const tempDir = makeTempDir("playbooks-invalid-default-");
    const invalidConfig: PlaybooksConfig = {
      defaultProfile: "NonExistent",
      profiles: DEFAULT_PLAYBOOKS_CONFIG.profiles,
    };

    assert.throws(
      () => savePlaybooks(invalidConfig, { baseDir: tempDir }),
      /Default profile "NonExistent" does not exist/,
    );
  });

  it("retrieves profiles via getPlaybookProfile or fails loud", () => {
    const profile = getPlaybookProfile("Light", DEFAULT_PLAYBOOKS_CONFIG);
    assert.equal(profile.name, "Light");

    const defaultProfile = getPlaybookProfile(undefined, DEFAULT_PLAYBOOKS_CONFIG);
    assert.equal(defaultProfile.name, "Medium");

    assert.throws(
      () => getPlaybookProfile("UnknownProfile", DEFAULT_PLAYBOOKS_CONFIG),
      /Playbook profile "UnknownProfile" not found/,
    );
  });
});

describe("RPC handlers: handleUppidiPlaybooks & handleUppidiSetPlaybook (#1403)", () => {
  it("handleUppidiPlaybooks returns all profiles by default", async () => {
    const tempDir = makeTempDir("playbooks-rpc-list-");
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR = tempDir;

    const res = await handleUppidiPlaybooks({});
    assert.equal(res.ok, true);
    assert.equal(res.defaultProfile, "Medium");
    assert.ok(res.profiles.Light);
    assert.ok(res.profiles.Medium);
  });

  it("handleUppidiPlaybooks returns specific profile when requested", async () => {
    const tempDir = makeTempDir("playbooks-rpc-single-");
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR = tempDir;

    const res = await handleUppidiPlaybooks({ profile: "Light" });
    assert.equal(res.ok, true);
    assert.ok(res.profiles.Light);
    assert.equal(res.profiles.Medium, undefined);
  });

  it("handleUppidiPlaybooks returns error for unknown profile", async () => {
    const tempDir = makeTempDir("playbooks-rpc-err-");
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR = tempDir;

    const res = await handleUppidiPlaybooks({ profile: "NonExistent" });
    assert.equal(res.ok, false);
    assert.match(res.error || "", /Playbook profile "NonExistent" not found/);
  });

  it("handleUppidiSetPlaybook validates and saves a new profile", async () => {
    const tempDir = makeTempDir("playbooks-rpc-set-");
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR = tempDir;

    const newProfile: PlaybookProfile = {
      name: "AutonomousFast",
      description: "Fast-track autonomous profile",
      stages: DEFAULT_LIGHT_STAGES,
    };

    const res = await handleUppidiSetPlaybook({
      profile: newProfile,
      setDefault: true,
    });
    assert.equal(res.ok, true);

    const check = await handleUppidiPlaybooks({});
    assert.equal(check.defaultProfile, "AutonomousFast");
    assert.ok(check.profiles.AutonomousFast);
  });

  it("handleUppidiSetPlaybook rejects invalid profile", async () => {
    const tempDir = makeTempDir("playbooks-rpc-set-err-");
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR = tempDir;

    const invalidProfile: any = {
      name: "Broken",
      stages: {},
    };

    const res = await handleUppidiSetPlaybook({
      profile: invalidProfile,
    });
    assert.equal(res.ok, false);
    assert.ok(res.error);
  });
});
