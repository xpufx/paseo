import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  PluginStorage,
  resolveHostHome,
  type PluginStorageOptions,
} from "paseo-plugin-helper/server";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  CANONICAL_PLAYBOOK_STAGES,
  PlaybooksConfigSchema,
  PlaybookProfileSchema,
  type PlaybookActor,
  type PlaybookProfile,
  type PlaybooksConfig,
  type PlaybookStageDefinition,
  type PlaybookStageName,
  type UppidiPlaybooksInput,
  type UppidiPlaybooksOutput,
  type UppidiSetPlaybookInput,
  type UppidiSetPlaybookOutput,
  type StageTransitionDecision,
  type UppidiEvaluateTransitionInput,
  type UppidiEvaluateTransitionOutput,
  type UppidiFleetAuditReceipt,
  PlaybookTransitionEventSchema,
  type PlaybookTransitionEvent,
  type PlaybookStageMetricSummary,
  type PlaybookProfileMetricSummary,
  type PlaybookMetricsReport,
  type UppidiPlaybookMetricsInput,
  type UppidiPlaybookMetricsOutput,
} from "../shared/contracts.js";
import { findAuditReceipt } from "./audit-receipts.js";

export type { StageTransitionDecision };


export const PLAYBOOKS_CONFIG_FILENAME = "playbooks.json";

export const DEFAULT_LIGHT_STAGES: Record<PlaybookStageName, PlaybookStageDefinition> = {
  "stage/spec": {
    stage: "stage/spec",
    actor: "autonomous:spec-agent",
    entry_precondition: "assigned_issue",
    exit_artifact: "spec_checklist",
    next_stage: {
      success: "stage/spec-audit",
      rejection: null,
    },
    description: "Draft technical specification and checklist",
  },
  "stage/spec-audit": {
    stage: "stage/spec-audit",
    actor: "autonomous:spec-auditor",
    entry_precondition: "spec_checklist",
    exit_artifact: "spec_audit_approval",
    next_stage: {
      success: "stage/dispatch",
      rejection: "stage/spec",
    },
    description: "Autonomous audit of specification checklist",
  },
  "stage/dispatch": {
    stage: "stage/dispatch",
    actor: "autonomous:orchestrator",
    entry_precondition: "spec_audit_approval",
    exit_artifact: "worktree_provisioned",
    next_stage: {
      success: "stage/code",
      rejection: null,
    },
    description: "Provision worktree workspace and assign coding agent",
  },
  "stage/code": {
    stage: "stage/code",
    actor: "autonomous:coding-agent",
    entry_precondition: "worktree_provisioned",
    exit_artifact: "pull_request",
    next_stage: {
      success: "stage/review",
      rejection: null,
    },
    description: "Implement feature or fix, run tests, and open pull request",
  },
  "stage/review": {
    stage: "stage/review",
    actor: "autonomous:code-auditor",
    entry_precondition: "pull_request",
    exit_artifact: "audit_receipt",
    next_stage: {
      success: "stage/merge",
      rejection: "stage/code",
    },
    description: "Autonomous code review and audit receipt issuance",
  },
  "stage/merge": {
    stage: "stage/merge",
    actor: "autonomous:orchestrator",
    entry_precondition: "audit_receipt",
    exit_artifact: "squash_commit",
    next_stage: {
      success: "stage/verify",
      rejection: "stage/code",
    },
    description: "Verify audit receipt and squash merge PR to main",
  },
  "stage/verify": {
    stage: "stage/verify",
    actor: "autonomous:orchestrator",
    entry_precondition: "squash_commit",
    exit_artifact: "acceptance_verification",
    next_stage: {
      success: "stage/done",
      rejection: "stage/code",
    },
    description: "Autonomous verification and issue resolution",
  },
};

export const DEFAULT_MEDIUM_STAGES: Record<PlaybookStageName, PlaybookStageDefinition> = {
  "stage/spec": {
    stage: "stage/spec",
    actor: "autonomous:spec-agent",
    entry_precondition: "assigned_issue",
    exit_artifact: "spec_checklist",
    next_stage: {
      success: "stage/spec-audit",
      rejection: null,
    },
    description: "Draft technical specification and checklist",
  },
  "stage/spec-audit": {
    stage: "stage/spec-audit",
    actor: "human:operator",
    entry_precondition: "spec_checklist",
    exit_artifact: "spec_audit_approval",
    next_stage: {
      success: "stage/dispatch",
      rejection: "stage/spec",
    },
    description: "Operator approval gate for specification checklist",
  },
  "stage/dispatch": {
    stage: "stage/dispatch",
    actor: "autonomous:orchestrator",
    entry_precondition: "spec_audit_approval",
    exit_artifact: "worktree_provisioned",
    next_stage: {
      success: "stage/code",
      rejection: null,
    },
    description: "Provision worktree workspace and assign coding agent",
  },
  "stage/code": {
    stage: "stage/code",
    actor: "autonomous:coding-agent",
    entry_precondition: "worktree_provisioned",
    exit_artifact: "pull_request",
    next_stage: {
      success: "stage/review",
      rejection: null,
    },
    description: "Implement feature or fix, run tests, and open pull request",
  },
  "stage/review": {
    stage: "stage/review",
    actor: "human:operator",
    entry_precondition: "pull_request",
    exit_artifact: "audit_receipt",
    next_stage: {
      success: "stage/merge",
      rejection: "stage/code",
    },
    description: "Operator review gate for pull request approval",
  },
  "stage/merge": {
    stage: "stage/merge",
    actor: "autonomous:orchestrator",
    entry_precondition: "audit_receipt",
    exit_artifact: "squash_commit",
    next_stage: {
      success: "stage/verify",
      rejection: "stage/code",
    },
    description: "Squash merge PR to main following operator approval",
  },
  "stage/verify": {
    stage: "stage/verify",
    actor: "human:operator",
    entry_precondition: "squash_commit",
    exit_artifact: "acceptance_verification",
    next_stage: {
      success: "stage/done",
      rejection: "stage/code",
    },
    description: "Operator acceptance testing and final issue closure",
  },
};

export const DEFAULT_PLAYBOOKS_CONFIG: PlaybooksConfig = {
  defaultProfile: "Medium",
  profiles: {
    Light: {
      name: "Light",
      description: "Full autonomy workflow without human-in-the-loop approval gates",
      stages: DEFAULT_LIGHT_STAGES,
    },
    Medium: {
      name: "Medium",
      description: "Human-in-the-loop gated workflow requiring operator approval at spec audit, review, and verification",
      stages: DEFAULT_MEDIUM_STAGES,
    },
  },
};

let playbooksStorageInstance: PluginStorage<PlaybooksConfig> | null = null;

export function defaultPlaybooksConfigPath(home?: string): string {
  if (home !== undefined) {
    return join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", PLAYBOOKS_CONFIG_FILENAME);
  }
  const custom = (process.env.PASEO_HOME || "").trim();
  const root = custom || join(resolveHostHome(), ".paseo");
  return join(root, "plugin-data", "xpufx", "uppidi-fleet", PLAYBOOKS_CONFIG_FILENAME);
}

export function getPlaybooksStorage(
  options?: PluginStorageOptions<PlaybooksConfig>,
): PluginStorage<PlaybooksConfig> {
  const baseDirOverride = process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR?.trim();
  const effectiveOptions: PluginStorageOptions<PlaybooksConfig> = {
    schema: PlaybooksConfigSchema,
    defaultData: DEFAULT_PLAYBOOKS_CONFIG,
    ...(baseDirOverride ? { baseDir: baseDirOverride } : {}),
    ...options,
  };

  if (!playbooksStorageInstance || options || baseDirOverride) {
    const storage = new PluginStorage<PlaybooksConfig>(
      "uppidi-fleet",
      PLAYBOOKS_CONFIG_FILENAME,
      effectiveOptions,
    );
    if (!options && !baseDirOverride) {
      playbooksStorageInstance = storage;
    }
    return storage;
  }
  return playbooksStorageInstance;
}

export function resetPlaybooksStorageInstance(): void {
  playbooksStorageInstance = null;
}

export function isHumanActor(actor: PlaybookActor | string): boolean {
  return actor === "human:operator";
}

export function isAutonomousActor(actor: PlaybookActor | string): boolean {
  return typeof actor === "string" && actor.startsWith("autonomous:");
}

export function parseActor(actor: PlaybookActor | string): { type: "human" | "autonomous"; role: string } {
  if (actor === "human:operator") {
    return { type: "human", role: "operator" };
  }
  if (typeof actor === "string" && actor.startsWith("autonomous:")) {
    const role = actor.slice("autonomous:".length);
    if (!role) {
      throw new Error(`Invalid autonomous actor role in "${actor}"`);
    }
    return { type: "autonomous", role };
  }
  throw new Error(`Invalid actor format: "${actor}". Expected "human:operator" or "autonomous:<role>"`);
}

export function isHumanGatedStage(stage: PlaybookStageDefinition): boolean {
  return isHumanActor(stage.actor);
}

export function isAutonomousStage(stage: PlaybookStageDefinition): boolean {
  return isAutonomousActor(stage.actor);
}

export function resolveNextStage(
  stage: PlaybookStageDefinition,
  outcome: "success" | "rejection",
): string | null {
  if (outcome === "success") {
    return stage.next_stage.success;
  }
  return stage.next_stage.rejection ?? null;
}

export function getOrderedStages(profile: PlaybookProfile): PlaybookStageDefinition[] {
  return CANONICAL_PLAYBOOK_STAGES.map((st) => profile.stages[st]).filter(Boolean);
}

export function validatePlaybookProfile(profile: PlaybookProfile): void {
  if (!profile || typeof profile !== "object") {
    throw new Error("Invalid playbook profile: expected an object");
  }
  for (const canonicalStage of CANONICAL_PLAYBOOK_STAGES) {
    const stageDef = profile.stages?.[canonicalStage];
    if (!stageDef) {
      throw new Error(
        `Playbook profile "${profile.name}" missing required canonical stage "${canonicalStage}"`,
      );
    }
    if (stageDef.stage !== canonicalStage) {
      throw new Error(
        `Stage key "${canonicalStage}" does not match stage definition name "${stageDef.stage}"`,
      );
    }
    parseActor(stageDef.actor);
  }
  PlaybookProfileSchema.parse(profile);
}

export function loadSavedPlaybooks(
  options?: PluginStorageOptions<PlaybooksConfig>,
): PlaybooksConfig {
  try {
    const storage = getPlaybooksStorage(options);
    if (storage.exists()) {
      const data = storage.read();
      const parsed = PlaybooksConfigSchema.safeParse(data);
      if (parsed.success) {
        return {
          defaultProfile: parsed.data.defaultProfile || DEFAULT_PLAYBOOKS_CONFIG.defaultProfile,
          profiles: {
            ...DEFAULT_PLAYBOOKS_CONFIG.profiles,
            ...parsed.data.profiles,
          },
        };
      }
    }
  } catch (err) {
    if (options || process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR) {
      throw err;
    }
  }
  return { ...DEFAULT_PLAYBOOKS_CONFIG };
}

export function savePlaybooks(
  config: PlaybooksConfig,
  options?: PluginStorageOptions<PlaybooksConfig>,
): void {
  const parsed = PlaybooksConfigSchema.parse(config);
  if (!parsed.profiles[parsed.defaultProfile]) {
    throw new Error(
      `Default profile "${parsed.defaultProfile}" does not exist in configured profiles`,
    );
  }
  for (const profile of Object.values(parsed.profiles)) {
    validatePlaybookProfile(profile);
  }
  const storage = getPlaybooksStorage(options);
  storage.write(parsed);
}

export function getPlaybookProfile(
  profileName?: string,
  config: PlaybooksConfig = loadSavedPlaybooks(),
): PlaybookProfile {
  const target = profileName?.trim() || config.defaultProfile;
  const profile = config.profiles[target];
  if (!profile) {
    throw new Error(`Playbook profile "${target}" not found in playbooks configuration`);
  }
  return profile;
}

export async function handleUppidiPlaybooks(
  input: UppidiPlaybooksInput,
  _context?: PluginHandlerContext,
): Promise<UppidiPlaybooksOutput> {
  try {
    const config = loadSavedPlaybooks();
    if (input.profile) {
      const profile = config.profiles[input.profile];
      if (!profile) {
        return {
          ok: false,
          defaultProfile: config.defaultProfile,
          profiles: config.profiles,
          error: `Playbook profile "${input.profile}" not found`,
        };
      }
      return {
        ok: true,
        defaultProfile: config.defaultProfile,
        profiles: { [input.profile]: profile },
      };
    }
    return {
      ok: true,
      defaultProfile: config.defaultProfile,
      profiles: config.profiles,
    };
  } catch (err: any) {
    return {
      ok: false,
      defaultProfile: DEFAULT_PLAYBOOKS_CONFIG.defaultProfile,
      profiles: DEFAULT_PLAYBOOKS_CONFIG.profiles,
      error: err?.message || String(err),
    };
  }
}

export async function handleUppidiSetPlaybook(
  input: UppidiSetPlaybookInput,
  _context?: PluginHandlerContext,
): Promise<UppidiSetPlaybookOutput> {
  try {
    validatePlaybookProfile(input.profile);
    const config = loadSavedPlaybooks();
    const updatedProfiles = {
      ...config.profiles,
      [input.profile.name]: input.profile,
    };
    const defaultProfile = input.setDefault ? input.profile.name : config.defaultProfile;
    const newConfig: PlaybooksConfig = {
      defaultProfile,
      profiles: updatedProfiles,
    };
    savePlaybooks(newConfig);
    return {
      ok: true,
      message: `Playbook profile "${input.profile.name}" saved successfully`,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Transition guards, artifact enforcement & human gate handling (#1404)
// ──────────────────────────────────────────────────────────────────────────

export const DEFAULT_AUTHORIZED_OPERATORS = ["okcode", "oktay"] as const;

export function isStageLabel(label: unknown): label is PlaybookStageName {
  return typeof label === "string" && (CANONICAL_PLAYBOOK_STAGES as readonly string[]).includes(label);
}

export function isAuthorizedOperator(
  actor: string,
  authorizedOperators: readonly string[] = DEFAULT_AUTHORIZED_OPERATORS,
): boolean {
  if (!actor || typeof actor !== "string") return false;
  const normalized = actor.trim().toLowerCase();
  // Shared agent actor xpufx is never an authorized human operator
  if (normalized === "xpufx") return false;
  return authorizedOperators.some((op) => op.trim().toLowerCase() === normalized);
}

export function getStagePredecessor(
  stage: PlaybookStageName,
  _profile?: PlaybookProfile,
): PlaybookStageName | null {
  const index = CANONICAL_PLAYBOOK_STAGES.indexOf(stage);
  if (index <= 0) return null;
  return CANONICAL_PLAYBOOK_STAGES[index - 1];
}

export function getStageSuccessor(
  stage: PlaybookStageName,
  profile: PlaybookProfile,
): PlaybookStageName | null {
  const stageDef = profile.stages[stage];
  return (stageDef?.next_stage.success as PlaybookStageName) ?? null;
}

export function getStageRejection(
  stage: PlaybookStageName,
  profile: PlaybookProfile,
): PlaybookStageName | null {
  const stageDef = profile.stages[stage];
  return (stageDef?.next_stage.rejection as PlaybookStageName) ?? null;
}

export interface ArtifactVerificationContext {
  repo?: string;
  issueNumber?: number;
  issueBody?: string;
  comments?: Array<{ body?: string; user?: { login?: string }; created_at?: string }>;
  pullRequest?: {
    number: number;
    headCommit?: string;
    merged?: boolean;
    state?: string;
    approved?: boolean;
  } | null;
  prNumber?: number;
  pullRequestNumber?: number;
  headCommit?: string;
  auditsFilePath?: string;
  labels?: string[];
  actor?: string;
  auditReceipt?: UppidiFleetAuditReceipt | null;
  specChecklist?: boolean;
  operatorApproval?: boolean;
  specAuditPass?: boolean;
  issueDispatched?: boolean;
  prApproved?: boolean;
  prMerged?: boolean;
  artifacts?: string[];
}

export function verifyStageArtifact(
  artifact: string,
  stage: PlaybookStageName,
  context: ArtifactVerificationContext,
  profile: PlaybookProfile,
  authorizedOperators: readonly string[] = DEFAULT_AUTHORIZED_OPERATORS,
): { verified: boolean; detail?: string } {
  switch (artifact) {
    case "assigned_issue": {
      if (context.issueNumber && context.issueNumber > 0) {
        return { verified: true, detail: `Issue #${context.issueNumber} assigned` };
      }
      return { verified: false, detail: "No valid assigned issue found" };
    }
    case "spec_checklist": {
      const CHECKLIST_REGEX = /-\s*\[[ xX]\]\s+/;
      const hasInBody = typeof context.issueBody === "string" && CHECKLIST_REGEX.test(context.issueBody);
      const hasInComments = Array.isArray(context.comments) && context.comments.some((c) => typeof c.body === "string" && CHECKLIST_REGEX.test(c.body));
      const hasFlag = Boolean((context as any).specChecklist) || (Array.isArray((context as any).artifacts) && (context as any).artifacts.includes("spec_checklist"));
      if (hasInBody || hasInComments || hasFlag) {
        return { verified: true, detail: "Specification checklist present in ticket body or comments" };
      }
      return { verified: false, detail: "Specification checklist (- [ ] or - [x]) missing in ticket body and comments" };
    }
    case "spec_audit_approval": {
      const stageDef = profile.stages[stage];
      if (stageDef && isHumanGatedStage(stageDef)) {
        // Human operator approval required
        const isOperatorActor = Boolean(context.actor && isAuthorizedOperator(context.actor, authorizedOperators));
        const hasApprovalLabel = Boolean(context.labels?.includes("spec/approved"));
        const hasApprovalFlag = Boolean((context as any).operatorApproval);
        const hasOperatorComment = Array.isArray(context.comments) && context.comments.some((c) => {
          const author = c.user?.login ?? "";
          if (!isAuthorizedOperator(author, authorizedOperators)) return false;
          const body = c.body?.toLowerCase() ?? "";
          return (
            body.includes("/approve") ||
            body.includes("lgtm") ||
            body.includes("approved") ||
            body.includes("spec-audit:approved") ||
            body.includes("green-light")
          );
        });
        if (isOperatorActor || hasApprovalLabel || hasApprovalFlag || hasOperatorComment) {
          return { verified: true, detail: "Specification audit approved by authorized operator" };
        }
        return { verified: false, detail: "Specification audit approval missing from authorized operator" };
      } else {
        // Autonomous auditor approval
        const hasApprovalLabel = Boolean(context.labels?.includes("spec/approved"));
        const hasApprovalFlag = Boolean((context as any).specAuditPass || (context as any).operatorApproval);
        const hasApprovalComment = Array.isArray(context.comments) && context.comments.some((c) => {
          const body = c.body?.toLowerCase() ?? "";
          return body.includes("spec-audit:approved") || body.includes("spec audit approved") || body.includes("specification audit approved");
        });
        if (hasApprovalLabel || hasApprovalFlag || hasApprovalComment) {
          return { verified: true, detail: "Specification audit approved by autonomous auditor" };
        }
        return { verified: false, detail: "Specification audit approval comment or label missing" };
      }
    }
    case "worktree_provisioned": {
      const hasWipLabel = Boolean(context.labels?.includes("state/wip"));
      const hasDispatchedFlag = Boolean((context as any).issueDispatched);
      const hasWorktreeComment = Array.isArray(context.comments) && context.comments.some((c) => {
        const body = c.body ?? "";
        return body.includes("Workspace:") || body.includes("Worktree:") || body.includes("wks_") || body.includes("/worktrees/");
      });
      if (hasWipLabel || hasDispatchedFlag || hasWorktreeComment) {
        return { verified: true, detail: "Worktree workspace provisioned" };
      }
      return { verified: false, detail: "Worktree provisioning artifact missing (expected state/wip label or worktree allocation record)" };
    }
    case "pull_request": {
      const hasPrObject = Boolean(context.pullRequest && context.pullRequest.number > 0);
      const hasPrNumber = Boolean(context.prNumber && context.prNumber > 0);
      const hasPrFlag = Boolean((context as any).pullRequestNumber && (context as any).pullRequestNumber > 0);
      const hasPrComment = Array.isArray(context.comments) && context.comments.some((c) => {
        const body = c.body ?? "";
        return body.includes("PR Opened") || body.includes("Pull Request:") || body.includes("pull_request");
      });
      if (hasPrObject || hasPrNumber || hasPrFlag || hasPrComment) {
        return { verified: true, detail: "Pull request linked and verified" };
      }
      return { verified: false, detail: "Pull request artifact missing" };
    }
    case "audit_receipt": {
      // 1. Direct receipt object in context
      if (context.auditReceipt) {
        if (context.auditReceipt.verdict === "approved" && context.auditReceipt.auditId.startsWith("aud_")) {
          return { verified: true, detail: `Approved audit receipt ${context.auditReceipt.auditId}` };
        }
        return { verified: false, detail: `Audit receipt ${context.auditReceipt.auditId} has verdict '${context.auditReceipt.verdict}', not 'approved'` };
      }
      // 2. Lookup in audits file if repo and commit/pr are present
      const pr = context.prNumber ?? context.pullRequest?.number;
      const commit = context.headCommit ?? context.pullRequest?.headCommit;
      if (context.repo && pr && commit) {
        try {
          const receipt = findAuditReceipt({ repo: context.repo, pr, commit }, { filePath: context.auditsFilePath });
          if (receipt) {
            if (receipt.verdict === "approved" && receipt.auditId.startsWith("aud_")) {
              return { verified: true, detail: `Approved audit receipt ${receipt.auditId}` };
            }
            return { verified: false, detail: `Audit receipt ${receipt.auditId} has verdict '${receipt.verdict}', not 'approved'` };
          }
        } catch {
          // ignore lookup failure and continue to operator check
        }
      }
      // 3. In Medium profile with human review gate: operator direct approval
      const stageDef = profile.stages[stage];
      if (stageDef && isHumanGatedStage(stageDef)) {
        if (context.actor && isAuthorizedOperator(context.actor, authorizedOperators)) {
          if (context.pullRequest?.approved || context.pullRequest?.merged) {
            return { verified: true, detail: `Operator ${context.actor} approved pull request directly` };
          }
        }
      }
      return { verified: false, detail: "Missing approved audit receipt (aud_*) or operator PR approval" };
    }
    case "squash_commit": {
      if (context.pullRequest?.merged === true || Boolean((context as any).prMerged) || context.labels?.includes("stage/verify")) {
        return { verified: true, detail: "Squash commit merged to main" };
      }
      const hasMergeComment = Array.isArray(context.comments) && context.comments.some((c) => {
        const body = c.body?.toLowerCase() ?? "";
        return body.includes("squash merge") || body.includes("merged pr") || body.includes("merge completed");
      });
      if (hasMergeComment) {
        return { verified: true, detail: "Squash merge recorded in comments" };
      }
      return { verified: false, detail: "Squash commit artifact missing (pull request not merged)" };
    }
    case "acceptance_verification": {
      const hasDoneLabel = Boolean(context.labels?.includes("confirmed-done") || context.labels?.includes("state/done"));
      const isOperator = Boolean(context.actor && isAuthorizedOperator(context.actor, authorizedOperators));
      if (hasDoneLabel || isOperator) {
        return { verified: true, detail: "Acceptance verification confirmed" };
      }
      return { verified: false, detail: "Acceptance verification missing (expected confirmed-done label or operator signoff)" };
    }
    default:
      return { verified: false, detail: `Unknown exit artifact "${artifact}"` };
  }
}

export interface EvaluateTransitionInput {
  profile: PlaybookProfile;
  fromStage: PlaybookStageName | null;
  toStage: PlaybookStageName;
  actor: string;
  context: ArtifactVerificationContext;
  authorizedOperators?: readonly string[];
}

export function evaluateStageTransition(
  input: EvaluateTransitionInput,
): StageTransitionDecision {
  const { profile, toStage, actor, context } = input;
  const authorizedOperators = input.authorizedOperators ?? DEFAULT_AUTHORIZED_OPERATORS;
  const isOperatorAuthorized = isAuthorizedOperator(actor, authorizedOperators);

  let fromStage = input.fromStage;
  if (!fromStage) {
    if (toStage === "stage/spec") {
      const targetIsHumanGated = isHumanGatedStage(profile.stages[toStage]);
      return {
        allowed: true,
        reason: "Initial entry into canonical pipeline at stage/spec",
        fromStage: null,
        toStage,
        profile: profile.name,
        requiresHumanGate: targetIsHumanGated,
        actor,
        isOperatorAuthorized,
        verifiedArtifact: "assigned_issue",
        actionTaken: targetIsHumanGated ? "human_gated" : "allowed",
      };
    }
    fromStage = getStagePredecessor(toStage, profile);
    if (!fromStage) {
      return {
        allowed: false,
        reason: `Cannot infer source stage for "${toStage}"`,
        fromStage: null,
        toStage,
        profile: profile.name,
        requiresHumanGate: false,
        actor,
        isOperatorAuthorized,
        verifiedArtifact: null,
        actionTaken: "rejected",
      };
    }
  }

  if (fromStage === toStage) {
    const targetIsHumanGated = isHumanGatedStage(profile.stages[toStage]);
    return {
      allowed: true,
      reason: `Already at stage ${toStage}`,
      fromStage,
      toStage,
      profile: profile.name,
      requiresHumanGate: targetIsHumanGated,
      actor,
      isOperatorAuthorized,
      verifiedArtifact: null,
      actionTaken: "allowed",
    };
  }

  const fromStageDef = profile.stages[fromStage];
  const toStageDef = profile.stages[toStage];
  if (!fromStageDef || !toStageDef) {
    return {
      allowed: false,
      reason: `Invalid stage: "${!fromStageDef ? fromStage : toStage}" not found in profile "${profile.name}"`,
      fromStage,
      toStage,
      profile: profile.name,
      requiresHumanGate: false,
      actor,
      isOperatorAuthorized,
      verifiedArtifact: null,
      actionTaken: "rejected",
    };
  }

  const isSuccessTransition = toStage === fromStageDef.next_stage.success;
  const isRejectionTransition = toStage === fromStageDef.next_stage.rejection;

  if (!isSuccessTransition && !isRejectionTransition) {
    return {
      allowed: false,
      reason: `Illegal stage transition from ${fromStage} to ${toStage}: expected next stage ${fromStageDef.next_stage.success}${fromStageDef.next_stage.rejection ? ` or rejection to ${fromStageDef.next_stage.rejection}` : ""}`,
      fromStage,
      toStage,
      profile: profile.name,
      requiresHumanGate: false,
      actor,
      isOperatorAuthorized,
      verifiedArtifact: null,
      actionTaken: "rejected",
    };
  }

  // Rejection backward transition
  if (isRejectionTransition) {
    const targetIsHumanGated = isHumanGatedStage(toStageDef);
    return {
      allowed: true,
      reason: `Stage rejection transition from ${fromStage} back to ${toStage}`,
      fromStage,
      toStage,
      profile: profile.name,
      requiresHumanGate: targetIsHumanGated,
      actor,
      isOperatorAuthorized,
      verifiedArtifact: null,
      actionTaken: targetIsHumanGated ? "human_gated" : "allowed",
    };
  }

  // Forward transition:
  // 1. Sender verification on human-gated fromStage
  if (isHumanGatedStage(fromStageDef)) {
    if (!isOperatorAuthorized) {
      return {
        allowed: false,
        reason: `Stage ${fromStage} is gated by human:operator. Transition to ${toStage} requires an authorized operator signature; actor '${actor}' is unauthorized`,
        fromStage,
        toStage,
        profile: profile.name,
        requiresHumanGate: true,
        actor,
        isOperatorAuthorized: false,
        verifiedArtifact: null,
        actionTaken: "unauthorized",
      };
    }
  }

  // 2. Required exit artifact enforcement
  const requiredArtifact = fromStageDef.exit_artifact;
  const artifactResult = verifyStageArtifact(requiredArtifact, fromStage, context, profile, authorizedOperators);
  if (!artifactResult.verified) {
    return {
      allowed: false,
      reason: `Transition from ${fromStage} to ${toStage} rejected: missing required exit artifact '${requiredArtifact}' (${artifactResult.detail ?? "not satisfied"})`,
      fromStage,
      toStage,
      profile: profile.name,
      requiresHumanGate: false,
      actor,
      isOperatorAuthorized,
      verifiedArtifact: null,
      missingArtifact: requiredArtifact,
      actionTaken: "rejected",
    };
  }

  // 3. Target stage human-gate evaluation
  const targetIsHumanGated = isHumanGatedStage(toStageDef);
  if (targetIsHumanGated) {
    return {
      allowed: true,
      reason: `Transition to ${toStage} accepted; stage is human-gated (human:operator) awaiting operator action`,
      fromStage,
      toStage,
      profile: profile.name,
      requiresHumanGate: true,
      actor,
      isOperatorAuthorized,
      verifiedArtifact: requiredArtifact,
      actionTaken: "human_gated",
    };
  }

  return {
    allowed: true,
    reason: `Transition from ${fromStage} to ${toStage} approved; verified artifact '${requiredArtifact}'`,
    fromStage,
    toStage,
    profile: profile.name,
    requiresHumanGate: false,
    actor,
    isOperatorAuthorized,
    verifiedArtifact: requiredArtifact,
    actionTaken: "allowed",
  };
}

export function formatTransitionRejectionComment(decision: StageTransitionDecision): string {
  return [
    `### 🛑 Stage Transition Rejected: Illegal Transition to \`${decision.toStage}\``,
    "",
    `The transition from \`${decision.fromStage ?? "unknown"}\` to \`${decision.toStage}\` was rejected by the Playbook State Machine:`,
    `- **Profile**: \`${decision.profile}\``,
    `- **Actor**: \`${decision.actor}\``,
    `- **Reason**: ${decision.reason}`,
    decision.missingArtifact ? `- **Missing Required Artifact**: \`${decision.missingArtifact}\`` : "",
    "",
    "The label has been reset to preserve deterministic stage progression.",
  ].filter(Boolean).join("\n");
}

export function formatHumanGateSummaryComment(
  stage: PlaybookStageName,
  profile: PlaybookProfile,
  decision?: StageTransitionDecision,
): string {
  const stageDef = profile.stages[stage];
  return [
    `### ⏸️ Human Gate Active: \`${stage}\` Awaiting Operator Action`,
    "",
    `This stage maps to \`human:operator\` under profile **\`${profile.name}\`**. Autonomous agent spawning is halted until operator verification.`,
    "",
    `- **Stage**: \`${stage}\``,
    `- **Actor**: \`human:operator\``,
    `- **Entry Precondition Verified**: \`${stageDef?.entry_precondition ?? "verified"}\``,
    `- **Required Exit Artifact**: \`${stageDef?.exit_artifact ?? "operator_approval"}\``,
    stageDef?.description ? `- **Stage Description**: ${stageDef.description}` : "",
    decision?.verifiedArtifact ? `- **Preceding Artifact**: \`${decision.verifiedArtifact}\`` : "",
    "",
    "Execution is yielded. Please inspect the deliverable and verify or advance the workflow to unblock the next stage.",
  ].filter(Boolean).join("\n");
}

export async function handleUppidiEvaluateTransition(
  input: UppidiEvaluateTransitionInput,
  _context?: PluginHandlerContext,
): Promise<UppidiEvaluateTransitionOutput> {
  try {
    const config = loadSavedPlaybooks();
    const profile = getPlaybookProfile(input.profile, config);
    const decision = evaluateStageTransition({
      profile,
      fromStage: input.fromStage ?? null,
      toStage: input.toStage,
      actor: input.actor,
      context: {
        repo: input.repo,
        issueNumber: input.issue,
        prNumber: input.prNumber,
        headCommit: input.headCommit,
        actor: input.actor,
      },
    });
    return {
      ok: true,
      decision,
    };
  } catch (err: any) {
    return {
      ok: false,
      decision: {
        allowed: false,
        reason: err?.message || String(err),
        fromStage: input.fromStage ?? null,
        toStage: input.toStage,
        profile: input.profile ?? "Medium",
        requiresHumanGate: false,
        actor: input.actor,
        isOperatorAuthorized: false,
        actionTaken: "rejected",
      },
      error: err?.message || String(err),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Stage progression & precondition helpers (#1405)
// ──────────────────────────────────────────────────────────────────────────

export function extractStageFromLabels(labels: readonly string[]): PlaybookStageName | null {
  for (const label of labels) {
    if (typeof label !== "string") continue;
    const lower = label.trim().toLowerCase();
    for (const canonical of CANONICAL_PLAYBOOK_STAGES) {
      if (lower === canonical) {
        return canonical;
      }
    }
  }
  return null;
}

export function evaluatePrecondition(
  stage: PlaybookStageName,
  context: ArtifactVerificationContext,
  profile: PlaybookProfile,
  authorizedOperators: readonly string[] = DEFAULT_AUTHORIZED_OPERATORS,
): { satisfied: boolean; precondition: string; detail?: string } {
  const stageDef = profile.stages[stage];
  if (!stageDef) {
    return { satisfied: false, precondition: "unknown", detail: `Stage "${stage}" not defined in profile "${profile.name}"` };
  }
  const precondition = stageDef.entry_precondition;
  if (precondition === "assigned_issue") {
    const verified = Boolean(context.issueNumber && context.issueNumber > 0);
    return {
      satisfied: verified,
      precondition,
      detail: verified ? `Issue #${context.issueNumber} assigned` : "No valid issue number found",
    };
  }
  const predecessor = getStagePredecessor(stage, profile);
  const result = verifyStageArtifact(
    precondition,
    predecessor ?? stage,
    context,
    profile,
    authorizedOperators,
  );
  return {
    satisfied: result.verified,
    precondition,
    detail: result.detail,
  };
}

export function canAdvanceStage(
  currentStage: PlaybookStageName,
  context: ArtifactVerificationContext,
  profile: PlaybookProfile,
  authorizedOperators: readonly string[] = DEFAULT_AUTHORIZED_OPERATORS,
): { canAdvance: boolean; nextStage: PlaybookStageName | null; reason: string; requiresHumanGate?: boolean } {
  const stageDef = profile.stages[currentStage];
  if (!stageDef) {
    return {
      canAdvance: false,
      nextStage: null,
      reason: `Stage "${currentStage}" not found in profile "${profile.name}"`,
    };
  }
  const requiredArtifact = stageDef.exit_artifact;
  const artifactResult = verifyStageArtifact(
    requiredArtifact,
    currentStage,
    context,
    profile,
    authorizedOperators,
  );
  if (!artifactResult.verified) {
    return {
      canAdvance: false,
      nextStage: null,
      reason: `Exit artifact '${requiredArtifact}' not satisfied: ${artifactResult.detail ?? "unverified"}`,
    };
  }
  const nextStage = stageDef.next_stage.success as PlaybookStageName;
  const targetDef = profile.stages[nextStage];
  const requiresHumanGate = Boolean(targetDef && isHumanGatedStage(targetDef));
  return {
    canAdvance: true,
    nextStage,
    requiresHumanGate,
    reason: `Exit artifact '${requiredArtifact}' verified; ready to advance to ${nextStage}`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Telemetry & metrics storage and aggregation (#1405)
// ──────────────────────────────────────────────────────────────────────────

export const PLAYBOOK_METRICS_FILENAME = "playbook-metrics.json";

export const PlaybookMetricsPayloadSchema = z.object({
  events: z.array(PlaybookTransitionEventSchema).default([]),
}).strict();
export type PlaybookMetricsPayload = z.infer<typeof PlaybookMetricsPayloadSchema>;

export const DEFAULT_PLAYBOOK_METRICS_PAYLOAD: PlaybookMetricsPayload = {
  events: [],
};

let playbookMetricsStorageInstance: PluginStorage<PlaybookMetricsPayload> | null = null;

export function defaultPlaybookMetricsPath(home?: string): string {
  if (home !== undefined) {
    return join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", PLAYBOOK_METRICS_FILENAME);
  }
  const custom = (process.env.PASEO_HOME || "").trim();
  const root = custom || join(resolveHostHome(), ".paseo");
  return join(root, "plugin-data", "xpufx", "uppidi-fleet", PLAYBOOK_METRICS_FILENAME);
}

export function getPlaybookMetricsStorage(
  options?: PluginStorageOptions<PlaybookMetricsPayload>,
): PluginStorage<PlaybookMetricsPayload> {
  const baseDirOverride = (
    process.env.UPPIDI_FLEET_PLAYBOOKS_METRICS_BASE_DIR ||
    process.env.UPPIDI_FLEET_PLAYBOOKS_BASE_DIR
  )?.trim();
  const effectiveOptions: PluginStorageOptions<PlaybookMetricsPayload> = {
    schema: PlaybookMetricsPayloadSchema,
    defaultData: DEFAULT_PLAYBOOK_METRICS_PAYLOAD,
    ...(baseDirOverride ? { baseDir: baseDirOverride } : {}),
    ...options,
  };

  if (!playbookMetricsStorageInstance || options || baseDirOverride) {
    const storage = new PluginStorage<PlaybookMetricsPayload>(
      "uppidi-fleet",
      PLAYBOOK_METRICS_FILENAME,
      effectiveOptions,
    );
    if (!options && !baseDirOverride) {
      playbookMetricsStorageInstance = storage;
    }
    return storage;
  }
  return playbookMetricsStorageInstance;
}

export function resetPlaybookMetricsStorageInstance(): void {
  playbookMetricsStorageInstance = null;
}

export function recordPlaybookTransitionMetric(
  input: {
    repo: string;
    issue: number;
    profile: string;
    fromStage: PlaybookStageName | null;
    toStage: PlaybookStageName;
    actor: string;
    timestamp?: number;
    durationMs?: number;
    isHumanGate?: boolean;
    gateLatencyMs?: number;
    isRework?: boolean;
  },
  options?: PluginStorageOptions<PlaybookMetricsPayload>,
): PlaybookTransitionEvent {
  const storage = getPlaybookMetricsStorage(options);
  const data = storage.exists() ? storage.read() : { ...DEFAULT_PLAYBOOK_METRICS_PAYLOAD };
  const timestamp = input.timestamp ?? Date.now();

  // Find previous event for this repo and issue to derive duration & gate latency
  let durationMs = input.durationMs;
  let gateLatencyMs = input.gateLatencyMs;
  const previousEvents = data.events.filter(
    (e) => e.repo === input.repo && e.issue === input.issue,
  );
  const lastEvent = previousEvents.length > 0 ? previousEvents[previousEvents.length - 1] : null;

  if (durationMs === undefined && lastEvent) {
    durationMs = Math.max(0, timestamp - lastEvent.timestamp);
    if (lastEvent.isHumanGate) {
      gateLatencyMs = durationMs;
    }
  }

  // Detect rework: backward stage transition in the canonical pipeline
  let isRework = input.isRework;
  if (isRework === undefined && input.fromStage && input.toStage) {
    const fromIdx = CANONICAL_PLAYBOOK_STAGES.indexOf(input.fromStage);
    const toIdx = CANONICAL_PLAYBOOK_STAGES.indexOf(input.toStage);
    if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx) {
      isRework = true;
    } else {
      isRework = false;
    }
  }

  const event: PlaybookTransitionEvent = {
    id: `pbevt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    repo: input.repo,
    issue: input.issue,
    profile: input.profile,
    fromStage: input.fromStage,
    toStage: input.toStage,
    actor: input.actor,
    timestamp,
    ...(durationMs !== undefined ? { durationMs } : {}),
    isHumanGate: Boolean(input.isHumanGate),
    ...(gateLatencyMs !== undefined ? { gateLatencyMs } : {}),
    isRework: Boolean(isRework),
  };

  const updatedEvents = [...data.events, event];
  storage.write({ events: updatedEvents });
  return event;
}

export function getPlaybookMetricsReport(
  filters?: { profile?: string; stage?: PlaybookStageName },
  options?: PluginStorageOptions<PlaybookMetricsPayload>,
): PlaybookMetricsReport {
  const storage = getPlaybookMetricsStorage(options);
  const data = storage.exists() ? storage.read() : { ...DEFAULT_PLAYBOOK_METRICS_PAYLOAD };
  let events = data.events;

  if (filters?.profile) {
    events = events.filter((e) => e.profile.toLowerCase() === filters.profile!.toLowerCase());
  }
  if (filters?.stage) {
    events = events.filter((e) => e.toStage === filters.stage || e.fromStage === filters.stage);
  }

  // Group events by profile
  const profileGroups: Record<string, PlaybookTransitionEvent[]> = {
    Light: [],
    Medium: [],
  };
  for (const e of events) {
    if (!profileGroups[e.profile]) {
      profileGroups[e.profile] = [];
    }
    profileGroups[e.profile].push(e);
  }

  const profilesSummary: Record<string, PlaybookProfileMetricSummary> = {};

  for (const [prof, profEvents] of Object.entries(profileGroups)) {
    const stageSummaries: Record<PlaybookStageName, PlaybookStageMetricSummary> = {} as any;
    for (const canonicalStage of CANONICAL_PLAYBOOK_STAGES) {
      stageSummaries[canonicalStage] = {
        stage: canonicalStage,
        count: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        reworkCount: 0,
        gateLatencyMs: 0,
        avgGateLatencyMs: 0,
      };
    }

    let profTotalDuration = 0;
    let profDurationCount = 0;
    let profReworkCount = 0;
    let profTotalGateLatency = 0;
    let profGateCount = 0;

    for (const ev of profEvents) {
      const stageKey = ev.toStage;
      const stageSummary = stageSummaries[stageKey];
      if (stageSummary) {
        stageSummary.count += 1;
        if (typeof ev.durationMs === "number") {
          stageSummary.totalDurationMs += ev.durationMs;
          profTotalDuration += ev.durationMs;
          profDurationCount += 1;
        }
        if (ev.isRework) {
          stageSummary.reworkCount += 1;
          profReworkCount += 1;
        }
        if (typeof ev.gateLatencyMs === "number" && ev.gateLatencyMs > 0) {
          stageSummary.gateLatencyMs += ev.gateLatencyMs;
          profTotalGateLatency += ev.gateLatencyMs;
          profGateCount += 1;
        }
      }
    }

    for (const stageSummary of Object.values(stageSummaries)) {
      if (stageSummary.count > 0) {
        stageSummary.avgDurationMs = Math.round(stageSummary.totalDurationMs / stageSummary.count);
        stageSummary.avgGateLatencyMs = Math.round(stageSummary.gateLatencyMs / stageSummary.count);
      }
    }

    profilesSummary[prof] = {
      profile: prof,
      totalTransitions: profEvents.length,
      totalDurationMs: profTotalDuration,
      avgDurationMs: profDurationCount > 0 ? Math.round(profTotalDuration / profDurationCount) : 0,
      reworkCount: profReworkCount,
      totalGateLatencyMs: profTotalGateLatency,
      avgGateLatencyMs: profGateCount > 0 ? Math.round(profTotalGateLatency / profGateCount) : 0,
      stages: stageSummaries,
    };
  }

  return {
    ok: true,
    profiles: profilesSummary,
    eventsCount: events.length,
    updatedAt: new Date().toISOString(),
  };
}

export async function handleUppidiPlaybookMetrics(
  input: UppidiPlaybookMetricsInput,
  _context?: PluginHandlerContext,
): Promise<UppidiPlaybookMetricsOutput> {
  try {
    const report = getPlaybookMetricsReport({
      profile: input.profile,
      stage: input.stage,
    });
    return report;
  } catch (err: any) {
    return {
      ok: false,
      profiles: {},
      eventsCount: 0,
      updatedAt: new Date().toISOString(),
      error: err?.message || String(err),
    };
  }
}

