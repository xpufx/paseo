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
  resetPlaybookMetricsStorageInstance,
  resolveNextStage,
  savePlaybooks,
  validatePlaybookProfile,
  extractStageFromLabels,
  evaluatePrecondition,
  canAdvanceStage,
  recordPlaybookTransitionMetric,
  getPlaybookMetricsReport,
  handleUppidiPlaybookMetrics,
  type ArtifactVerificationContext,
} from "./playbooks.js";
import {
  uppidiPlaybookMetricsContract,
} from "../shared/contracts.js";
import {
  runIssuesCheck,
  classifyCandidate,
  type ForgejoIssue,
  type IssuesCheckIo,
} from "./issues-check.js";
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
  resetPlaybookMetricsStorageInstance();
  delete process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR;
  delete process.env.UPPIDI_FLEET_PLAYBOOKS_METRICS_BASE_DIR;
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

  it("verifies DEFAULT_AUTHORIZED_OPERATORS has only okcode", () => {
    assert.deepEqual(DEFAULT_AUTHORIZED_OPERATORS, ["okcode"]);
  });

  it("verifies authorized operator identity with isAuthorizedOperator", () => {
    assert.equal(isAuthorizedOperator("okcode"), true);
    assert.equal(isAuthorizedOperator("oktay"), false);
    assert.equal(isAuthorizedOperator("oktay", ["oktay"]), true);
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

  it("allows authorized operator (okcode) to advance out of human-gated stage in Medium profile", () => {
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
      actor: "okcode",
      context: { ...context, actor: "okcode" },
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

describe("playbook stage extraction and precondition evaluation (Phase 3 #1405)", () => {
  it("extracts canonical stage from labels accurately", () => {
    assert.equal(extractStageFromLabels(["stage/spec", "priority/urgent"]), "stage/spec");
    assert.equal(extractStageFromLabels(["STAGE/CODE", "kind/bug"]), "stage/code");
    assert.equal(extractStageFromLabels(["state/review", "stage/review"]), "stage/review");
    assert.equal(extractStageFromLabels(["kind/feature", "attention/user"]), null);
    assert.equal(extractStageFromLabels([]), null);
  });

  it("evaluates entry preconditions across Light and Medium stages", () => {
    const light = DEFAULT_PLAYBOOKS_CONFIG.profiles.Light;
    const medium = DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium;

    // stage/spec entry precondition is assigned_issue
    assert.equal(evaluatePrecondition("stage/spec", { issueNumber: 1 }, light).satisfied, true);
    assert.equal(evaluatePrecondition("stage/spec", { issueNumber: 1 }, medium).satisfied, true);

    // stage/spec-audit in Light (autonomous:spec-auditor) requires spec_checklist
    assert.equal(evaluatePrecondition("stage/spec-audit", { issueNumber: 1 }, light).satisfied, false);
    assert.equal(evaluatePrecondition("stage/spec-audit", { issueNumber: 1, specChecklist: true }, light).satisfied, true);
    assert.equal(evaluatePrecondition("stage/spec-audit", { issueNumber: 1, artifacts: ["spec_checklist"] }, light).satisfied, true);

    // stage/spec-audit in Medium also requires spec_checklist
    assert.equal(evaluatePrecondition("stage/spec-audit", { issueNumber: 1 }, medium).satisfied, false);
    assert.equal(evaluatePrecondition("stage/spec-audit", { issueNumber: 1, specChecklist: true }, medium).satisfied, true);

    // stage/dispatch requires spec_audit_pass / operator_approval
    assert.equal(evaluatePrecondition("stage/dispatch", { issueNumber: 1 }, medium).satisfied, false);
    assert.equal(evaluatePrecondition("stage/dispatch", { issueNumber: 1, operatorApproval: true }, medium).satisfied, true);

    // stage/code requires issue_dispatched
    assert.equal(evaluatePrecondition("stage/code", { issueNumber: 1, issueDispatched: true }, medium).satisfied, true);

    // stage/review requires code_worker_pr
    assert.equal(evaluatePrecondition("stage/review", { issueNumber: 1 }, medium).satisfied, false);
    assert.equal(evaluatePrecondition("stage/review", { issueNumber: 1, pullRequestNumber: 123 }, medium).satisfied, true);

    // stage/merge requires audit_receipt
    assert.equal(evaluatePrecondition("stage/merge", { issueNumber: 1 }, medium).satisfied, false);
    assert.equal(evaluatePrecondition("stage/merge", { issueNumber: 1, auditReceipt: { auditId: "aud_test", verdict: "approved" } as any }, medium).satisfied, true);

    // stage/verify requires pr_merged
    assert.equal(evaluatePrecondition("stage/verify", { issueNumber: 1 }, medium).satisfied, false);
    assert.equal(evaluatePrecondition("stage/verify", { issueNumber: 1, prMerged: true }, medium).satisfied, true);
  });

  it("evaluates canAdvanceStage and identifies next stage and human gate requirements", () => {
    const light = DEFAULT_PLAYBOOKS_CONFIG.profiles.Light;
    const medium = DEFAULT_PLAYBOOKS_CONFIG.profiles.Medium;

    // stage/spec with spec_checklist satisfied -> advances to stage/spec-audit
    const specAdvanceLight = canAdvanceStage("stage/spec", { issueNumber: 1, specChecklist: true }, light);
    assert.equal(specAdvanceLight.canAdvance, true);
    assert.equal(specAdvanceLight.nextStage, "stage/spec-audit");
    assert.equal(specAdvanceLight.requiresHumanGate, false);

    const specAdvanceMedium = canAdvanceStage("stage/spec", { issueNumber: 1, specChecklist: true }, medium);
    assert.equal(specAdvanceMedium.canAdvance, true);
    assert.equal(specAdvanceMedium.nextStage, "stage/spec-audit");
    assert.equal(specAdvanceMedium.requiresHumanGate, true); // spec-audit is human-gated in Medium

    // stage/code with worker PR opened -> advances to stage/review
    const codeAdvanceLight = canAdvanceStage("stage/code", { issueNumber: 1, pullRequestNumber: 42, pullRequest: { number: 42, merged: false } }, light);
    assert.equal(codeAdvanceLight.canAdvance, true);
    assert.equal(codeAdvanceLight.nextStage, "stage/review");
    assert.equal(codeAdvanceLight.requiresHumanGate, false);

    const codeAdvanceMedium = canAdvanceStage("stage/code", { issueNumber: 1, pullRequestNumber: 42, pullRequest: { number: 42, merged: false } }, medium);
    assert.equal(codeAdvanceMedium.canAdvance, true);
    assert.equal(codeAdvanceMedium.nextStage, "stage/review");
    assert.equal(codeAdvanceMedium.requiresHumanGate, true); // review is human-gated in Medium
  });
});

describe("issues-check stage filtering and candidate classification (Phase 3 #1405)", () => {
  function makeIssue(
    number: number,
    labels: string[],
    updatedAt = "2026-09-20T10:00:00Z",
  ): ForgejoIssue {
    return {
      number,
      state: "open",
      updated_at: updatedAt,
      labels: labels.map((name) => ({ name })),
    };
  }

  function mockIo(issues: ForgejoIssue[]): IssuesCheckIo {
    return {
      getOpenIssues: async () => ({ ok: true, issues }),
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async () => true,
      loadCache: async () => ({}),
      saveCache: async () => {},
    };
  }

  it("filters board check issues by playbook stage", async () => {
    const issues = [
      makeIssue(1, ["stage/code", "kind/feature"]),
      makeIssue(2, ["stage/spec", "kind/feature"]),
      makeIssue(3, ["stage/code", "state/1-wip"]),
      makeIssue(4, ["stage/review", "kind/feature"]),
    ];

    const outcome = await runIssuesCheck({
      hostname: "forge.test",
      repo: "org/repo",
      all: true,
      stage: "stage/code",
      io: mockIo(issues),
    });

    const candidateNumbers = outcome.rankedCandidates.map((c) => c.number);
    assert.ok(candidateNumbers.includes(1));
    assert.ok(candidateNumbers.includes(3));
    assert.equal(candidateNumbers.includes(2), false);
    assert.equal(candidateNumbers.includes(4), false);
  });

  it("classifies candidate dispatchability based on entry preconditions", () => {
    // Autonomous stage/code without preconditions satisfied
    const issueCode = makeIssue(10, ["stage/code"]);
    const classification1 = classifyCandidate(issueCode, new Set(["stage/code"]));
    // stage/code without context dispatch info is not dispatchable yet
    assert.equal(classification1.is_dispatchable, false);

    // Autonomous stage/spec (initial stage) has entry precondition met
    const issueSpec = makeIssue(11, ["stage/spec"]);
    const classification2 = classifyCandidate(issueSpec, new Set(["stage/spec"]));
    assert.equal(classification2.is_dispatchable, true);
    assert.equal(classification2.category, "dispatchable");

    // Human-gated stage (stage/spec-audit in Medium) activates user_attention
    const issueAudit = makeIssue(12, ["stage/spec-audit"]);
    const classification3 = classifyCandidate(issueAudit, new Set(["stage/spec-audit"]));
    assert.equal(classification3.is_dispatchable, false);
    assert.equal(classification3.category, "user_attention");
  });
});

describe("HookRouter board sweep integration & automated stage progression (Phase 3 #1405)", () => {
  it("sweepBoard populates queuedCandidates and stageTransitions", async () => {
    const tempDir = makeTempDir("sweep-test-");
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR = tempDir;
    process.env.UPPIDI_FLEET_PLAYBOOKS_METRICS_BASE_DIR = tempDir;

    const router = new HookRouter();
    const testIssues: ForgejoIssue[] = [
      {
        number: 101,
        state: "open",
        updated_at: "2026-09-20T10:00:00Z",
        labels: [{ name: "stage/spec" }, { name: "playbook/light" }],
      },
      {
        number: 102,
        state: "open",
        updated_at: "2026-09-20T10:00:00Z",
        labels: [{ name: "stage/spec-audit" }],
      },
    ];

    const io: IssuesCheckIo = {
      getOpenIssues: async () => ({ ok: true, issues: testIssues }),
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async () => true,
      loadCache: async () => ({}),
      saveCache: async () => {},
    };

    const result = await router.sweepBoard(["org/repo"], io, { explicit: true });
    assert.equal(result.ok, true);
    assert.equal(result.swept, 1);
    assert.ok(result.queuedCandidates);
    assert.ok(result.queuedCandidates.some((q) => q.number === 101 && q.stage === "stage/spec"));
  });

  it("advances stage autonomously from stage/code to stage/review in Light profile on PR open", async () => {
    const tempDir = makeTempDir("advance-light-");
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR = tempDir;
    process.env.UPPIDI_FLEET_PLAYBOOKS_METRICS_BASE_DIR = tempDir;

    const router = new HookRouter(null, { isTestMode: true, stageGuardEnabled: true });
    const result = await router.advanceStageOnArtifact("org/repo", 201, {
      type: "pull_request.opened",
      actor: "worker-agent-1",
      labels: ["stage/code", "playbook/light"],
      pullRequestNumber: 50,
    });

    assert.equal(result.acted, true);
    assert.equal(result.allowed, true);
    assert.equal(result.humanGated, false);
    assert.equal(result.decision?.fromStage, "stage/code");
    assert.equal(result.decision?.toStage, "stage/review");
  });

  it("advances stage to human gate from stage/code to stage/review in Medium profile on PR open", async () => {
    const tempDir = makeTempDir("advance-medium-");
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR = tempDir;
    process.env.UPPIDI_FLEET_PLAYBOOKS_METRICS_BASE_DIR = tempDir;

    const router = new HookRouter(null, { isTestMode: true, stageGuardEnabled: true });
    const result = await router.advanceStageOnArtifact("org/repo", 202, {
      type: "pull_request.opened",
      actor: "worker-agent-1",
      labels: ["stage/code"], // Medium is default
      pullRequestNumber: 51,
    });

    assert.equal(result.acted, true);
    assert.equal(result.allowed, true);
    assert.equal(result.humanGated, true);
    assert.equal(result.decision?.fromStage, "stage/code");
    assert.equal(result.decision?.toStage, "stage/review");

    // Check active human gates
    assert.equal(router.isIssueHumanGated("org/repo", 202), true);
    const gates = router.listActiveHumanGates();
    assert.ok(gates.some((g) => (g.repo === "org/repo" || g.repo.endsWith("/org/repo")) && g.issue === 202 && g.stage === "stage/review"));
  });

  it("advances stage from stage/merge to stage/verify on PR merge", async () => {
    const tempDir = makeTempDir("advance-merge-");
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR = tempDir;
    process.env.UPPIDI_FLEET_PLAYBOOKS_METRICS_BASE_DIR = tempDir;

    const router = new HookRouter(null, { isTestMode: true, stageGuardEnabled: true });
    const result = await router.advanceStageOnArtifact("org/repo", 203, {
      type: "pull_request.closed",
      actor: "orchestrator",
      labels: ["stage/merge", "playbook/light"],
      merged: true,
      pullRequestNumber: 52,
    });

    assert.equal(result.acted, true);
    assert.equal(result.allowed, true);
    assert.equal(result.decision?.fromStage, "stage/merge");
    assert.equal(result.decision?.toStage, "stage/verify");
  });
});

describe("playbook telemetry & metrics reporting (Phase 3 #1405)", () => {
  it("records stage transition metrics across Light and Medium playbooks", () => {
    const tempDir = makeTempDir("metrics-test-");
    resetPlaybookMetricsStorageInstance();
    process.env.UPPIDI_FLEET_PLAYBOOKS_METRICS_BASE_DIR = tempDir;

    // Record Light transition (autonomous)
    recordPlaybookTransitionMetric({
      repo: "org/repo",
      issue: 301,
      profile: "Light",
      fromStage: "stage/code",
      toStage: "stage/review",
      actor: "worker-agent",
      isHumanGate: false,
      durationMs: 120000,
    });

    // Record Medium transition (human-gated with latency)
    recordPlaybookTransitionMetric({
      repo: "org/repo",
      issue: 302,
      profile: "Medium",
      fromStage: "stage/code",
      toStage: "stage/review",
      actor: "worker-agent",
      isHumanGate: true,
      durationMs: 150000,
      gateLatencyMs: 300000,
    });

    // Record rework transition in Medium
    recordPlaybookTransitionMetric({
      repo: "org/repo",
      issue: 302,
      profile: "Medium",
      fromStage: "stage/review",
      toStage: "stage/code",
      actor: "okcode",
      isHumanGate: false,
      isRework: true,
      durationMs: 60000,
    });

    const report = getPlaybookMetricsReport();
    assert.equal(report.ok, true);
    assert.equal(report.eventsCount, 3);

    // Verify Light profile metrics
    const lightSummary = report.profiles.Light;
    assert.ok(lightSummary);
    assert.equal(lightSummary.totalTransitions, 1);
    assert.equal(lightSummary.totalDurationMs, 120000);
    assert.equal(lightSummary.reworkCount, 0);

    // Verify Medium profile metrics
    const mediumSummary = report.profiles.Medium;
    assert.ok(mediumSummary);
    assert.equal(mediumSummary.totalTransitions, 2);
    assert.equal(mediumSummary.reworkCount, 1);
    assert.equal(mediumSummary.totalGateLatencyMs, 300000);
  });

  it("answers uppidiPlaybookMetricsContract RPC handler", async () => {
    const tempDir = makeTempDir("rpc-metrics-");
    resetPlaybookMetricsStorageInstance();
    process.env.UPPIDI_FLEET_PLAYBOOKS_METRICS_BASE_DIR = tempDir;

    recordPlaybookTransitionMetric({
      repo: "org/repo",
      issue: 401,
      profile: "Light",
      fromStage: "stage/spec",
      toStage: "stage/spec-audit",
      actor: "spec-agent",
      isHumanGate: false,
      durationMs: 45000,
    });

    const result = await handleUppidiPlaybookMetrics({ profile: "Light" });
    assert.equal(result.ok, true);
    assert.equal(result.eventsCount, 1);
    assert.ok(result.profiles.Light);
    assert.equal(result.profiles.Light.totalTransitions, 1);
  });
});

describe("human gate non-stalling invariant (Phase 3 #1405)", () => {
  it("human-gated stage marks user_attention on specific issue without stalling other candidates in sweep", async () => {
    const tempDir = makeTempDir("non-stalling-");
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR = tempDir;
    process.env.UPPIDI_FLEET_PLAYBOOKS_METRICS_BASE_DIR = tempDir;

    const router = new HookRouter();
    const testIssues: ForgejoIssue[] = [
      // Issue 501: human-gated stage (stage/spec-audit in Medium)
      {
        number: 501,
        state: "open",
        updated_at: "2026-09-20T10:00:00Z",
        labels: [{ name: "stage/spec-audit" }],
      },
      // Issue 502: autonomous stage with precondition met (stage/spec in Light)
      {
        number: 502,
        state: "open",
        updated_at: "2026-09-20T10:00:00Z",
        labels: [{ name: "stage/spec" }, { name: "playbook/light" }],
      },
    ];

    const io: IssuesCheckIo = {
      getOpenIssues: async () => ({ ok: true, issues: testIssues }),
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async () => true,
      loadCache: async () => ({}),
      saveCache: async () => {},
    };

    const sweepResult = await router.sweepBoard(["org/repo"], io, { explicit: true });
    assert.equal(sweepResult.ok, true);

    // Issue 502 must be queued and ready to dispatch even though Issue 501 is human-gated
    assert.ok(sweepResult.queuedCandidates);
    const queuedNumbers = sweepResult.queuedCandidates.map((q) => q.number);
    assert.ok(queuedNumbers.includes(502), "Autonomous issue 502 must be queued despite human gate on 501");
    assert.equal(queuedNumbers.includes(501), false, "Human-gated issue 501 must not be queued for autonomous dispatch");
  });
});
