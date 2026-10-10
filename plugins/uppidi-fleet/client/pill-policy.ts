export type FleetPillId =
  | "shortId"
  | "role"
  | "state"
  | "issue"
  | "model"
  | "worktree"
  | "parentage"
  | "labels"
  | "dirtyWarning"
  | "branchWarning"
  | "queuedHooks"
  | "orchestratorCount"
  | "workerCount";

export type AgentRoleKind = "front-desk" | "orchestrator" | "coding-agent";

export interface PillVisibilityPolicy {
  readonly defaultPills: readonly FleetPillId[];
  readonly subPills: readonly FleetPillId[];
}

export const FLEET_PILL_POLICY: Record<AgentRoleKind, PillVisibilityPolicy> = {
  "front-desk": {
    defaultPills: ["state", "role"],
    subPills: ["shortId", "model", "worktree", "labels"],
  },
  orchestrator: {
    defaultPills: ["state", "dirtyWarning", "branchWarning"],
    subPills: ["shortId", "role", "model", "worktree", "parentage", "labels"],
  },
  "coding-agent": {
    defaultPills: ["state", "issue"],
    subPills: ["shortId", "model", "worktree", "parentage", "labels"],
  },
};
