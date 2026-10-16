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
  DEFAULT_AUTHORIZED_OPERATORS,
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
  isStageLabel,
  isAuthorizedOperator,
  getStagePredecessor,
  getStageSuccessor,
  getStageRejection,
  verifyStageArtifact,
  evaluateStageTransition,
  formatTransitionRejectionComment,
  formatHumanGateSummaryComment,
  handleUppidiEvaluateTransition,
  loadSavedPlaybooks,
  parseActor,
  resetPlaybooksStorageInstance,
  resolveNextStage,
  savePlaybooks,
  validatePlaybookProfile,
  type ArtifactVerificationContext,
} from "./playbooks.js";
import { HookRouter, handleSpawnAgent } from "./hook-router.js";
import { appendAuditReceipt } from "./audit-receipts.js";

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

describe("deterministic stage transition guards & artifact enforcement (#1404)", () => {
  const light = DEFAULT_PLAYBOOKS_CONFIG.profiles.Light;
  const medium = DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium;

  it("distinguishes valid stage labels with isStageLabel", () => {
    assert.equal(isStageLabel("stage/spec"), true);
    assert.equal(isStageLabel("stage/merge"), true);
    assert.equal(isStageLabel("stage/verify"), true);
    assert.equal(isStageLabel("stage/unknown"), false);
    assert.equal(isStageLabel("state/review"), false);
    assert.equal(isStageLabel(null), false);
    assert.equal(isStageLabel(123), false);
  });

  it("verifies authorized operator identity with isAuthorizedOperator", () => {
    assert.equal(isAuthorizedOperator("okcode"), true);
    assert.equal(isAuthorizedOperator("oktay"), true);
    assert.equal(isAuthorizedOperator("OKCODE"), true);
    assert.equal(isAuthorizedOperator("xpufx"), false);
    assert.equal(isAuthorizedOperator("autonomous-agent"), false);
    assert.equal(isAuthorizedOperator("random-user"), false);
    assert.equal(isAuthorizedOperator("alice", ["alice", "bob"]), true);
    assert.equal(isAuthorizedOperator("xpufx", ["xpufx"]), false);
  });

  it("resolves stage predecessors, successors, and rejections correctly", () => {
    assert.equal(getStagePredecessor("stage/spec", light), null);
    assert.equal(getStagePredecessor("stage/spec-audit", light), "stage/spec");
    assert.equal(getStagePredecessor("stage/merge", light), "stage/review");
    assert.equal(getStagePredecessor("stage/verify", light), "stage/merge");

    assert.equal(getStageSuccessor("stage/spec", light), "stage/spec-audit");
    assert.equal(getStageSuccessor("stage/review", light), "stage/merge");
    assert.equal(getStageRejection("stage/review", light), "stage/code");
    assert.equal(getStageRejection("stage/spec", light), null);
  });

  it("validates exit artifact: spec_checklist requires markdown checklist", () => {
    const emptyCtx: ArtifactVerificationContext = { repo: "org/repo", issueNumber: 42, issueBody: "No checklist here" };
    const validCtx: ArtifactVerificationContext = { repo: "org/repo", issueNumber: 42, issueBody: "## Spec\n- [ ] Task 1\n- [x] Task 2" };
    const commentCtx: ArtifactVerificationContext = {
      repo: "org/repo",
      issueNumber: 42,
      issueBody: "Details",
      comments: [{ body: "Here is the plan:\n- [ ] Step 1" }],
    };

    assert.equal(verifyStageArtifact("spec_checklist", "stage/spec", emptyCtx, light).verified, false);
    assert.equal(verifyStageArtifact("spec_checklist", "stage/spec", validCtx, light).verified, true);
    assert.equal(verifyStageArtifact("spec_checklist", "stage/spec", commentCtx, light).verified, true);
  });

  it("validates exit artifact: spec_audit_approval requires operator in Medium and auditor in Light", () => {
    const unapprovedCtx: ArtifactVerificationContext = { repo: "org/repo", issueNumber: 42 };
    const operatorCtx: ArtifactVerificationContext = { repo: "org/repo", issueNumber: 42, actor: "okcode" };
    const auditorCtx: ArtifactVerificationContext = {
      repo: "org/repo",
      issueNumber: 42,
      actor: "xpufx",
      comments: [{ body: "<!-- spec-audit:approved --> LGTM" }],
    };

    // In Medium, spec-audit is human-gated
    assert.equal(verifyStageArtifact("spec_audit_approval", "stage/spec-audit", unapprovedCtx, medium).verified, false);
    assert.equal(verifyStageArtifact("spec_audit_approval", "stage/spec-audit", auditorCtx, medium).verified, false);
    assert.equal(verifyStageArtifact("spec_audit_approval", "stage/spec-audit", operatorCtx, medium).verified, true);

    // In Light, spec-audit is autonomous
    assert.equal(verifyStageArtifact("spec_audit_approval", "stage/spec-audit", unapprovedCtx, light).verified, false);
    assert.equal(verifyStageArtifact("spec_audit_approval", "stage/spec-audit", auditorCtx, light).verified, true);
  });

  it("validates exit artifact: worktree_provisioned requires wip label or worktree comment", () => {
    const unprovisioned: ArtifactVerificationContext = { repo: "org/repo", issueNumber: 42 };
    const withLabel: ArtifactVerificationContext = { repo: "org/repo", issueNumber: 42, labels: ["state/wip"] };
    const withComment: ArtifactVerificationContext = {
      repo: "org/repo",
      issueNumber: 42,
      comments: [{ body: "Workspace: /home/dev-user/.paseo/worktrees/abc/feat-1404" }],
    };

    assert.equal(verifyStageArtifact("worktree_provisioned", "stage/dispatch", unprovisioned, light).verified, false);
    assert.equal(verifyStageArtifact("worktree_provisioned", "stage/dispatch", withLabel, light).verified, true);
    assert.equal(verifyStageArtifact("worktree_provisioned", "stage/dispatch", withComment, light).verified, true);
  });

  it("validates exit artifact: pull_request requires linked PR", () => {
    const noPr: ArtifactVerificationContext = { repo: "org/repo", issueNumber: 42 };
    const withPr: ArtifactVerificationContext = { repo: "org/repo", issueNumber: 42, pullRequest: { number: 101, merged: false } };
    const withPrNum: ArtifactVerificationContext = { repo: "org/repo", issueNumber: 42, prNumber: 101 };

    assert.equal(verifyStageArtifact("pull_request", "stage/code", noPr, light).verified, false);
    assert.equal(verifyStageArtifact("pull_request", "stage/code", withPr, light).verified, true);
    assert.equal(verifyStageArtifact("pull_request", "stage/code", withPrNum, light).verified, true);
  });

  it("validates exit artifact: audit_receipt requires approved aud_* receipt", () => {
    const tempDir = makeTempDir("playbooks-audit-art-");
    const auditsFile = path.join(tempDir, "audits.jsonl");

    const unapproved: ArtifactVerificationContext = {
      repo: "xpufx-org/paseo",
      issueNumber: 42,
      prNumber: 99,
      headCommit: "commit-abc",
      auditsFilePath: auditsFile,
    };
    assert.equal(verifyStageArtifact("audit_receipt", "stage/review", unapproved, light).verified, false);

    // Record non-approved receipt (changes_requested)
    appendAuditReceipt(
      {
        repo: "xpufx-org/paseo",
        pr: 99,
        headCommit: "commit-abc",
        iteration: 1,
        actors: {
          auditor: { agentId: "auditor-1", role: "reviewer", model: "test" },
          author: { agentId: "worker-1", role: "coding-agent" },
        },
        verdict: "changes_requested",
        taxonomy: ["test_failure"],
        summary: "Need changes",
        verification: {
          workerClaimed: "passed",
          auditorVerified: "failed",
          checksRun: ["typecheck"],
          isolatedEnv: true,
        },
      },
      { filePath: auditsFile },
    );
    assert.equal(verifyStageArtifact("audit_receipt", "stage/review", unapproved, light).verified, false);

    // Record approved receipt
    appendAuditReceipt(
      {
        repo: "xpufx-org/paseo",
        pr: 99,
        headCommit: "commit-abc",
        iteration: 1,
        actors: {
          auditor: { agentId: "auditor-1", role: "reviewer", model: "test" },
          author: { agentId: "worker-1", role: "coding-agent" },
        },
        verdict: "approved",
        taxonomy: [],
        summary: "Looks good",
        verification: {
          workerClaimed: "passed",
          auditorVerified: "passed",
          checksRun: ["typecheck"],
          isolatedEnv: true,
        },
      },
      { filePath: auditsFile },
    );
    assert.equal(verifyStageArtifact("audit_receipt", "stage/review", unapproved, light).verified, true);
  });

  it("rejects illegal stage skip from stage/spec to stage/merge", () => {
    const decision = evaluateStageTransition({
      profile: light,
      fromStage: "stage/spec",
      toStage: "stage/merge",
      actor: "xpufx",
      context: { repo: "org/repo", issueNumber: 1 },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.actionTaken, "rejected");
    assert.match(decision.reason, /Illegal stage transition from stage\/spec to stage\/merge/);
  });

  it("rejects transition to stage/merge when audit receipt is missing", () => {
    const decision = evaluateStageTransition({
      profile: light,
      fromStage: "stage/review",
      toStage: "stage/merge",
      actor: "xpufx",
      context: { repo: "org/repo", issueNumber: 1, prNumber: 5, headCommit: "sha-1" },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.missingArtifact, "audit_receipt");
    assert.match(decision.reason, /missing required exit artifact 'audit_receipt'/);
  });

  it("approves transition to stage/merge when approved aud_* receipt is provided", () => {
    const decision = evaluateStageTransition({
      profile: light,
      fromStage: "stage/review",
      toStage: "stage/merge",
      actor: "xpufx",
      context: {
        repo: "org/repo",
        issueNumber: 1,
        prNumber: 5,
        headCommit: "sha-1",
        auditReceipt: {
          v: 1,
          auditId: "aud_12345",
          timestamp: new Date().toISOString(),
          repo: "org/repo",
          pr: 5,
          headCommit: "sha-1",
          iteration: 1,
          actors: {
            auditor: { agentId: "aud-1", role: "reviewer", model: "model" },
            author: { agentId: "worker-1", role: "coding-agent" },
          },
          verdict: "approved",
          taxonomy: [],
          verification: {
            workerClaimed: "passed",
            auditorVerified: "passed",
            checksRun: ["typecheck"],
            isolatedEnv: true,
          },
          summary: "Pre-flight audit passed",
        },
      },
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.actionTaken, "allowed");
    assert.equal(decision.verifiedArtifact, "audit_receipt");
  });

  it("allows backward stage rejection transitions", () => {
    const decision = evaluateStageTransition({
      profile: light,
      fromStage: "stage/review",
      toStage: "stage/code",
      actor: "xpufx",
      context: { repo: "org/repo", issueNumber: 1 },
    });
    assert.equal(decision.allowed, true);
    assert.match(decision.reason, /rejection transition/);
  });

  it("formats clean rejection and human gate summary comments", () => {
    const rejection = formatTransitionRejectionComment({
      allowed: false,
      reason: "Missing aud_* receipt",
      fromStage: "stage/review",
      toStage: "stage/merge",
      profile: "Light",
      requiresHumanGate: false,
      actor: "xpufx",
      isOperatorAuthorized: false,
      missingArtifact: "audit_receipt",
    });
    assert.match(rejection, /### 🛑 Stage Transition Rejected: Illegal Transition to `stage\/merge`/);
    assert.match(rejection, /Missing Required Artifact/);

    const humanGate = formatHumanGateSummaryComment("stage/spec-audit", medium);
    assert.match(humanGate, /### ⏸️ Human Gate Active: `stage\/spec-audit` Awaiting Operator Action/);
    assert.match(humanGate, /human:operator/);
  });

  it("handleUppidiEvaluateTransition RPC evaluates transitions correctly", async () => {
    const res = await handleUppidiEvaluateTransition({
      repo: "xpufx-org/paseo",
      issue: 42,
      fromStage: "stage/spec",
      toStage: "stage/merge",
      actor: "xpufx",
      profile: "Light",
    });
    assert.equal(res.ok, true);
    assert.equal(res.decision.allowed, false);
    assert.match(res.decision.reason, /Illegal stage transition/);
  });
});

describe("human-in-the-loop gating & sender verification (#1404)", () => {
  const medium = DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium;

  it("identifies human-gated stages in Medium profile (spec-audit, review, verify)", () => {
    assert.equal(isHumanGatedStage(medium.stages["stage/spec-audit"]), true);
    assert.equal(isHumanGatedStage(medium.stages["stage/review"]), true);
    assert.equal(isHumanGatedStage(medium.stages["stage/verify"]), true);
    assert.equal(isHumanGatedStage(medium.stages["stage/spec"]), false);
    assert.equal(isHumanGatedStage(medium.stages["stage/dispatch"]), false);
    assert.equal(isHumanGatedStage(medium.stages["stage/code"]), false);
    assert.equal(isHumanGatedStage(medium.stages["stage/merge"]), false);
  });

  it("flags target stage as human_gated when entering spec-audit in Medium profile", () => {
    const decision = evaluateStageTransition({
      profile: medium,
      fromStage: "stage/spec",
      toStage: "stage/spec-audit",
      actor: "xpufx",
      context: {
        repo: "org/repo",
        issueNumber: 1,
        issueBody: "- [ ] Write specs",
      },
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.requiresHumanGate, true);
    assert.equal(decision.actionTaken, "human_gated");
    assert.match(decision.reason, /human-gated/);
  });

  it("rejects unauthorized actor (xpufx) attempting to advance out of human-gated stage in Medium profile", () => {
    const decision = evaluateStageTransition({
      profile: medium,
      fromStage: "stage/spec-audit",
      toStage: "stage/dispatch",
      actor: "xpufx",
      context: {
        repo: "org/repo",
        issueNumber: 1,
        comments: [{ body: "- [x] Done" }],
      },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.isOperatorAuthorized, false);
    assert.equal(decision.actionTaken, "unauthorized");
    assert.match(decision.reason, /requires an authorized operator signature; actor 'xpufx' is unauthorized/);
  });

  it("allows authorized operator (okcode / oktay) to advance out of human-gated stage in Medium profile", () => {
    const decision = evaluateStageTransition({
      profile: medium,
      fromStage: "stage/spec-audit",
      toStage: "stage/dispatch",
      actor: "okcode",
      context: {
        repo: "org/repo",
        issueNumber: 1,
        actor: "okcode",
        comments: [{ body: "/approve spec checklist" }],
      },
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.isOperatorAuthorized, true);
    assert.equal(decision.actionTaken, "allowed");
    assert.match(decision.reason, /approved/);
  });
});

describe("HookRouter stage guard & human gate integration (#1404)", () => {
  it("intercepts illegal stage skip via runStageTransitionGuard and returns rejection result", async () => {
    const router = new HookRouter(null, { isTestMode: true, stageGuardEnabled: true });
    const payload = {
      action: "labeled",
      repository: { full_name: "xpufx-org/paseo" },
      issue: { number: 42, labels: [{ name: "stage/spec" }, { name: "playbook/light" }] },
      label: { name: "stage/merge" },
      sender: { login: "xpufx" },
    };

    const outcome = await router.runStageTransitionGuard(payload, "issues");
    assert.equal(outcome.acted, true);
    assert.equal(outcome.allowed, false);
    assert.equal(outcome.rejected, true);
    assert.match(outcome.reason, /Illegal stage transition/);
  });

  it("intercepts stage/merge transition without audit receipt and rejects", async () => {
    const router = new HookRouter(null, { isTestMode: true, stageGuardEnabled: true });
    const payload = {
      action: "labeled",
      repository: { full_name: "xpufx-org/paseo" },
      issue: { number: 42, labels: [{ name: "stage/review" }, { name: "playbook/light" }] },
      label: { name: "stage/merge" },
      sender: { login: "xpufx" },
    };

    const outcome = await router.runStageTransitionGuard(payload, "issues");
    assert.equal(outcome.acted, true);
    assert.equal(outcome.allowed, false);
    assert.equal(outcome.rejected, true);
    assert.match(outcome.reason, /missing required exit artifact 'audit_receipt'/);
  });

  it("activates human gate on human-gated stage transition and halts worker spawning", async () => {
    const router = new HookRouter(null, { isTestMode: true, stageGuardEnabled: true });
    const payload = {
      action: "labeled",
      repository: { full_name: "xpufx-org/paseo" },
      issue: {
        number: 100,
        body: "- [ ] Checklist item 1",
        labels: [{ name: "stage/spec" }, { name: "playbook/medium" }],
      },
      label: { name: "stage/spec-audit" },
      sender: { login: "xpufx" },
    };

    const outcome = await router.runStageTransitionGuard(payload, "issues");
    assert.equal(outcome.acted, true);
    assert.equal(outcome.allowed, true);
    assert.equal(outcome.humanGated, true);
    assert.equal(router.isIssueHumanGated("xpufx-org/paseo", 100), true);

    // Attempting to spawn worker on this gated ticket is halted
    let spawnAttempted = false;
    const spawnResult = await handleSpawnAgent(
      { role: "worker", repo: "xpufx-org/paseo", issueIndex: 100 },
      {
        spawnAgent: async () => {
          spawnAttempted = true;
          return { id: "should-not-spawn" };
        },
        isIssueHumanGated: (r, idx) => router.isIssueHumanGated(r, idx),
      },
    );

    assert.equal(spawnResult.ok, false);
    assert.equal(spawnResult.errorCode, "human_gate_active");
    assert.match(spawnResult.error || "", /gated by human:operator; autonomous agent spawning halted/);
    assert.equal(spawnAttempted, false);
  });

  it("clears human gate when authorized operator advances the stage", async () => {
    const router = new HookRouter(null, { isTestMode: true, stageGuardEnabled: true });
    router.setHumanGate("xpufx-org/paseo", 100, "stage/spec-audit", "Medium");
    assert.equal(router.isIssueHumanGated("xpufx-org/paseo", 100), true);

    const advancePayload = {
      action: "labeled",
      repository: { full_name: "xpufx-org/paseo" },
      issue: {
        number: 100,
        labels: [{ name: "stage/spec-audit" }, { name: "playbook/medium" }],
      },
      label: { name: "stage/dispatch" },
      sender: { login: "okcode" },
    };

    const outcome = await router.runStageTransitionGuard(advancePayload, "issues");
    assert.equal(outcome.acted, true);
    assert.equal(outcome.allowed, true);
    assert.equal(router.isIssueHumanGated("xpufx-org/paseo", 100), false);
  });
});

describe("Light vs Medium simulated end-to-end lifecycle harness (#1404)", () => {
  const light = DEFAULT_PLAYBOOKS_CONFIG.profiles.Light;
  const medium = DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium;

  it("simulates full Light profile stage progression from spec to done with autonomous actors", () => {
    let currentStage: any = "stage/spec";
    const context: ArtifactVerificationContext = {
      repo: "xpufx-org/paseo",
      issueNumber: 50,
      issueBody: "- [ ] Step 1\n- [ ] Step 2",
      actor: "xpufx",
      comments: [
        { body: "<!-- spec-audit:approved --> Specification approved by auditor" },
        { body: "Workspace: /worktrees/wks_123" },
        { body: "PR Opened: #200" },
        { body: "Squash merge completed to main" },
      ],
      labels: ["state/wip", "confirmed-done"],
      pullRequest: { number: 200, headCommit: "head-sha", merged: true },
      auditReceipt: {
        v: 1,
        auditId: "aud_full_light",
        timestamp: new Date().toISOString(),
        repo: "xpufx-org/paseo",
        pr: 200,
        headCommit: "head-sha",
        iteration: 1,
        actors: {
          auditor: { agentId: "auditor-1", role: "reviewer", model: "flash" },
          author: { agentId: "worker-1", role: "coding-agent" },
        },
        verdict: "approved",
        taxonomy: [],
        verification: {
          workerClaimed: "passed",
          auditorVerified: "passed",
          checksRun: ["typecheck"],
          isolatedEnv: true,
        },
        summary: "Audit approved",
      },
    };

    // Progression: spec -> spec-audit -> dispatch -> code -> review -> merge -> verify
    const steps: Array<[any, any]> = [
      ["stage/spec", "stage/spec-audit"],
      ["stage/spec-audit", "stage/dispatch"],
      ["stage/dispatch", "stage/code"],
      ["stage/code", "stage/review"],
      ["stage/review", "stage/merge"],
      ["stage/merge", "stage/verify"],
    ];

    for (const [from, to] of steps) {
      const decision = evaluateStageTransition({
        profile: light,
        fromStage: from,
        toStage: to,
        actor: "xpufx",
        context,
      });
      assert.equal(decision.allowed, true, `Transition ${from} -> ${to} should be allowed in Light`);
      assert.equal(decision.requiresHumanGate, false, `Stage ${to} should not be human gated in Light`);
      currentStage = to;
    }
    assert.equal(currentStage, "stage/verify");
  });

  it("simulates full Medium profile stage progression with human gates at spec-audit, review, verify", () => {
    const context: ArtifactVerificationContext = {
      repo: "xpufx-org/paseo",
      issueNumber: 60,
      issueBody: "- [ ] Step 1\n- [ ] Step 2",
      comments: [
        { body: "Workspace: /worktrees/wks_456" },
        { body: "PR Opened: #300" },
      ],
      labels: ["state/wip", "confirmed-done"],
      pullRequest: { number: 300, headCommit: "head-300", merged: true, approved: true },
      auditReceipt: {
        v: 1,
        auditId: "aud_medium_1",
        timestamp: new Date().toISOString(),
        repo: "xpufx-org/paseo",
        pr: 300,
        headCommit: "head-300",
        iteration: 1,
        actors: {
          auditor: { agentId: "operator", role: "operator", model: "human" },
          author: { agentId: "worker-1", role: "coding-agent" },
        },
        verdict: "approved",
        taxonomy: [],
        verification: {
          workerClaimed: "passed",
          auditorVerified: "passed",
          checksRun: ["typecheck"],
          isolatedEnv: true,
        },
        summary: "Operator PR audit approved",
      },
    };

    // Step 1: spec -> spec-audit (human gate activates)
    const step1 = evaluateStageTransition({
      profile: medium,
      fromStage: "stage/spec",
      toStage: "stage/spec-audit",
      actor: "xpufx",
      context,
    });
    assert.equal(step1.allowed, true);
    assert.equal(step1.requiresHumanGate, true);
    assert.equal(step1.actionTaken, "human_gated");

    // Step 2: Attempting advance by xpufx fails
    const step2Unauth = evaluateStageTransition({
      profile: medium,
      fromStage: "stage/spec-audit",
      toStage: "stage/dispatch",
      actor: "xpufx",
      context,
    });
    assert.equal(step2Unauth.allowed, false);
    assert.equal(step2Unauth.actionTaken, "unauthorized");

    // Step 2: Authorized operator advances to dispatch
    const step2Auth = evaluateStageTransition({
      profile: medium,
      fromStage: "stage/spec-audit",
      toStage: "stage/dispatch",
      actor: "okcode",
      context: { ...context, actor: "okcode" },
    });
    assert.equal(step2Auth.allowed, true);
    assert.equal(step2Auth.requiresHumanGate, false);

    // Step 3: dispatch -> code (autonomous)
    const step3 = evaluateStageTransition({
      profile: medium,
      fromStage: "stage/dispatch",
      toStage: "stage/code",
      actor: "xpufx",
      context,
    });
    assert.equal(step3.allowed, true);
    assert.equal(step3.requiresHumanGate, false);

    // Step 4: code -> review (human gate activates)
    const step4 = evaluateStageTransition({
      profile: medium,
      fromStage: "stage/code",
      toStage: "stage/review",
      actor: "xpufx",
      context,
    });
    assert.equal(step4.allowed, true);
    assert.equal(step4.requiresHumanGate, true);
    assert.equal(step4.actionTaken, "human_gated");

    // Step 5: Advance review -> merge by authorized operator
    const step5 = evaluateStageTransition({
      profile: medium,
      fromStage: "stage/review",
      toStage: "stage/merge",
      actor: "oktay",
      context: { ...context, actor: "oktay" },
    });
    assert.equal(step5.allowed, true);
    assert.equal(step5.requiresHumanGate, false);

    // Step 6: merge -> verify (human gate activates)
    const step6 = evaluateStageTransition({
      profile: medium,
      fromStage: "stage/merge",
      toStage: "stage/verify",
      actor: "xpufx",
      context,
    });
    assert.equal(step6.allowed, true);
    assert.equal(step6.requiresHumanGate, true);
    assert.equal(step6.actionTaken, "human_gated");
  });
});
