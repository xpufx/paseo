import { join } from "node:path";
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
} from "../shared/contracts.js";

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
