import { z } from "zod";
import { defineContract, defineSettingsContract } from "paseo-plugin-helper/shared";

export const AttentionLabelSchema = z.enum([
  "attention/0-orchestrator",
  "attention/1-agent",
  "attention/2-user",
]);
export type AttentionLabel = z.infer<typeof AttentionLabelSchema>;

export const StateLabelSchema = z.enum([
  "state/0-triage",
  "state/1-wip",
  "state/2-review",
  "state/3-verify",
  "state/4-done",
]);
export type StateLabel = z.infer<typeof StateLabelSchema>;

export const UppidiIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  repo: z.string(),
  status: z.enum(["Backlog", "In progress", "Review", "Done"]),
  attention: AttentionLabelSchema.default("attention/1-agent"),
  branch: z.string().optional(),
  comments: z.number().default(0),
  labels: z.array(z.string()).default([]),
  url: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type UppidiIssue = z.infer<typeof UppidiIssueSchema>;

export const UppidiIssuesInputSchema = z.object({
  directory: z.string().optional(),
  repo: z.string().optional(),
  state: z.enum(["open", "closed", "all"]).default("open"),
});
export type UppidiIssuesInput = z.infer<typeof UppidiIssuesInputSchema>;

export const UppidiIssuesOutputSchema = z.object({
  ok: z.boolean(),
  repo: z.string().nullable().default(null),
  issues: z.array(UppidiIssueSchema).default([]),
  openCount: z.number().default(0),
  inFlightCount: z.number().default(0),
  reviewCount: z.number().default(0),
  needsYouCount: z.number().default(0),
  error: z.string().optional(),
});
export type UppidiIssuesOutput = z.infer<typeof UppidiIssuesOutputSchema>;

export const uppidiIssuesContract = defineContract({
  name: "uppidi-fleet.issues",
  description: "Get repository issues parsed for the single-surface Uppidi dashboard",
  input: UppidiIssuesInputSchema,
  output: UppidiIssuesOutputSchema,
});

export const HookQueueMessageSchema = z.object({
  id: z.string(),
  ts: z.number().nullable().optional(),
  preview: z.string(),
});
export type HookQueueMessage = z.infer<typeof HookQueueMessageSchema>;

export const HookQueueItemSchema = z.object({
  key: z.string(),
  depth: z.number(),
  dropped: z.number().default(0),
  paused: z.boolean(),
  isBusy: z.boolean(),
  busyAttempts: z.number().default(0),
  orchestrator: z
    .object({
      agentId: z.string().nullable().optional(),
      updatedAt: z.string().optional(),
      by: z.string().optional(),
    })
    .nullable()
    .optional(),
  messages: z.array(HookQueueMessageSchema).default([]),
});
export type HookQueueItem = z.infer<typeof HookQueueItemSchema>;

export const HookStatusOutputSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
  version: z.number().optional(),
  uptime: z.number().optional(),
  frontDesk: z
    .object({
      version: z.number().optional(),
      agentId: z.string().nullable().optional(),
      updatedAt: z.string().optional(),
      by: z.string().optional(),
    })
    .nullable()
    .optional(),
  paused: z.array(z.string()).default([]),
  totalQueued: z.number().default(0),
  repoCount: z.number().default(0),
  error: z.string().optional(),
});
export type HookStatusOutput = z.infer<typeof HookStatusOutputSchema>;

export const uppidiHookStatusContract = defineContract({
  name: "uppidi-fleet.hook-status",
  description: "Get running forgejo-hook status, active frontdesk, and queued totals",
  input: z.object({ hookUrl: z.string().optional() }),
  output: HookStatusOutputSchema,
});

export const HookQueuesOutputSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
  uptime: z.number().optional(),
  paused: z.array(z.string()).default([]),
  queues: z.array(HookQueueItemSchema).default([]),
  error: z.string().optional(),
});
export type HookQueuesOutput = z.infer<typeof HookQueuesOutputSchema>;

export const uppidiHookQueuesContract = defineContract({
  name: "uppidi-fleet.hook-queues",
  description: "Get detailed queues per repository from forgejo-hook",
  input: z.object({ hookUrl: z.string().optional() }),
  output: HookQueuesOutputSchema,
});

export const HookQueueActionInputSchema = z.object({
  hookUrl: z.string().optional(),
  repo: z.string().optional(),
});
export type HookQueueActionInput = z.infer<typeof HookQueueActionInputSchema>;

export const HookQueueActionOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type HookQueueActionOutput = z.infer<typeof HookQueueActionOutputSchema>;

export const uppidiHookPauseContract = defineContract({
  name: "uppidi-fleet.hook-pause",
  description: "Pause one or all repository queues",
  input: HookQueueActionInputSchema,
  output: HookQueueActionOutputSchema,
});

export const uppidiHookResumeContract = defineContract({
  name: "uppidi-fleet.hook-resume",
  description: "Resume one or all repository queues",
  input: HookQueueActionInputSchema,
  output: HookQueueActionOutputSchema,
});

export const uppidiHookDrainContract = defineContract({
  name: "uppidi-fleet.hook-drain",
  description: "Drain/discard queued messages for a repository",
  input: HookQueueActionInputSchema,
  output: HookQueueActionOutputSchema,
});

// Hook Service Management (Issue #368, Issue #427)
export const HookServiceStatusOutputSchema = z.object({
  ok: z.boolean(),
  active: z.boolean(),
  state: z.string(),
  description: z.string().optional(),
  pid: z.number().optional(),
  host: z.string().optional(),
  configuredHost: z.string().optional(),
  port: z.number().optional(),
  configuredPort: z.number().optional(),
  availableInterfaces: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type HookServiceStatusOutput = z.infer<typeof HookServiceStatusOutputSchema>;

export const uppidiHookServiceStatusContract = defineContract({
  name: "uppidi-fleet.hook-service-status",
  description: "Inspect bundled hook router service status",
  input: z.object({}),
  output: HookServiceStatusOutputSchema,
});

export const HookServiceConfigInputSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  restart: z.boolean().default(true),
});
export type HookServiceConfigInput = z.infer<typeof HookServiceConfigInputSchema>;

export const HookServiceConfigOutputSchema = z.object({
  ok: z.boolean(),
  configuredHost: z.string(),
  configuredPort: z.number(),
  activeHost: z.string(),
  activePort: z.number(),
  restarted: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type HookServiceConfigOutput = z.infer<typeof HookServiceConfigOutputSchema>;

export const uppidiHookConfigureContract = defineContract({
  name: "uppidi-fleet.hook-configure",
  description: "Configure host listen address and port for bundled hook service",
  input: HookServiceConfigInputSchema,
  output: HookServiceConfigOutputSchema,
});

export const HookServiceActionInputSchema = z.object({
  action: z.enum(["start", "stop", "restart", "reload"]),
});
export type HookServiceActionInput = z.infer<typeof HookServiceActionInputSchema>;

export const HookServiceActionOutputSchema = z.object({
  ok: z.boolean(),
  action: z.string(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type HookServiceActionOutput = z.infer<typeof HookServiceActionOutputSchema>;

export const uppidiHookServiceActionContract = defineContract({
  name: "uppidi-fleet.hook-service-action",
  description: "Start/Stop/Restart the bundled hook router service",
  input: HookServiceActionInputSchema,
  output: HookServiceActionOutputSchema,
});

// Hook Log Tail (Issue #365)
export const HookLogTailInputSchema = z.object({
  lines: z.number().int().positive().default(50),
});
export type HookLogTailInput = z.infer<typeof HookLogTailInputSchema>;

export const HookLogTailOutputSchema = z.object({
  ok: z.boolean(),
  lines: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type HookLogTailOutput = z.infer<typeof HookLogTailOutputSchema>;

export const uppidiHookLogTailContract = defineContract({
  name: "uppidi-fleet.hook-log-tail",
  description: "Tail log lines for bundled hook router",
  input: HookLogTailInputSchema,
  output: HookLogTailOutputSchema,
});

// Agents & Fleet Tree View (Issue #367, Issue #385)
export const UppidiAgentCategorySchema = z.enum(["front-desk", "orchestrator", "worker"]);
export type UppidiAgentCategory = z.infer<typeof UppidiAgentCategorySchema>;

export const DeterministicAgentStateSchema = z.enum([
  "working",                // Running with attributed work: e.g. #385
  "running",                // Running general task without specific issue attribution
  "sleeping",               // Idle orchestrator/frontdesk inactive > 15 minutes
  "idle:waiting",           // Idle agent waiting for turn/prompt
  "idle:quota-exhausted",   // Idle due to model quota exhaustion cooldown
  "attention-required",     // Blocked awaiting operator input/decision (#534)
  "permission-prompt",      // Blocked on a pending tool/permission request (#534)
  "failed:quota-exhausted", // Failed/aborted due to usage/quota limit
  "failed:spawn",           // Failed during process or session spawn
  "failed:timeout",         // Execution or connection timeout
  "failed:error",           // General agent crash or unhandled error
  "unknown",                // Fallback when signals cannot resolve
]);
export type DeterministicAgentState = z.infer<typeof DeterministicAgentStateSchema>;

/**
 * Canonical subagent lifecycle contract (#537). A first-class, provider-agnostic
 * projection over the finer-grained `deterministicState`. This **extends** the
 * #534 blocked states rather than renaming them: `permission-prompt` and
 * `attention-required` both project to `waiting_for_input`, while the full
 * `deterministicState` keeps rendering in the fleet UI.
 */
export const AgentLifecycleStateSchema = z.enum([
  "running",
  "waiting_for_input",
  "idle",
  "errored",
  "completed",
]);
export type AgentLifecycleState = z.infer<typeof AgentLifecycleStateSchema>;

/** Projects a deterministic fleet state onto the canonical lifecycle contract. */
export function deriveLifecycleState(state: DeterministicAgentState): AgentLifecycleState {
  switch (state) {
    case "permission-prompt":
    case "attention-required":
      return "waiting_for_input";
    case "working":
    case "running":
      return "running";
    case "failed:quota-exhausted":
    case "failed:spawn":
    case "failed:timeout":
    case "failed:error":
      return "errored";
    case "idle:quota-exhausted":
    case "idle:waiting":
    case "sleeping":
      return "idle";
    case "unknown":
    default:
      return "idle";
  }
}

/** True when a lifecycle state means the agent is blocked awaiting clearance. */
export function isBlockedLifecycleState(state: AgentLifecycleState): boolean {
  return state === "waiting_for_input";
}

/**
 * Resolves the canonical lifecycle state from a payload, falling back to the
 * deterministic projection when `lifecycleState` was not populated (#537).
 */
export function resolveAgentLifecycleState(agent: {
  lifecycleState?: AgentLifecycleState | null;
  deterministicState?: DeterministicAgentState | null;
} | null | undefined): AgentLifecycleState {
  if (!agent) return "idle";
  if (agent.lifecycleState) return agent.lifecycleState;
  return deriveLifecycleState(agent.deterministicState ?? "unknown");
}

export interface DeterministicStateConfig {
  state: DeterministicAgentState;
  color: string;
  badgeVariant: "success" | "info" | "warning" | "danger" | "neutral";
  dotVariant: "success" | "info" | "warning" | "danger" | "neutral";
  stateIcon: string;
  categoryIcon: string;
  pulse: boolean;
  label: string;
}

export function getAgentCategoryIcon(category?: UppidiAgentCategory | string): string {
  switch (category) {
    case "front-desk":
      return "Inbox";
    case "orchestrator":
      return "Network";
    case "worker":
      return "Terminal";
    default:
      return "Bot";
  }
}

export function getDeterministicStateConfig(
  state: DeterministicAgentState,
  category?: UppidiAgentCategory | string
): DeterministicStateConfig {
  let color = "#6b7280"; // neutral/gray
  let badgeVariant: "success" | "info" | "warning" | "danger" | "neutral" = "neutral";
  let dotVariant: "success" | "info" | "warning" | "danger" | "neutral" = "neutral";
  let stateIcon = "HelpCircle";
  let pulse = false;
  let label = "Unknown";

  switch (state) {
    case "working":
      color = "#10b981"; // success/emerald
      badgeVariant = "success";
      dotVariant = "success";
      stateIcon = "Bot";
      pulse = true;
      label = "Working";
      break;
    case "running":
      color = "#3b82f6"; // info/blue
      badgeVariant = "info";
      dotVariant = "info";
      stateIcon = "Play";
      pulse = false;
      label = "Running";
      break;
    case "sleeping":
      color = "#a855f7"; // neutral/muted/purple
      badgeVariant = "neutral";
      dotVariant = "neutral";
      stateIcon = "Moon";
      pulse = false;
      label = "Sleeping";
      break;
    case "idle:waiting":
      color = "#9ca3af"; // neutral/gray
      badgeVariant = "neutral";
      dotVariant = "neutral";
      stateIcon = "Clock";
      pulse = false;
      label = "Waiting";
      break;
    case "idle:quota-exhausted":
      color = "#f59e0b"; // warning/amber
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "Hourglass";
      pulse = false;
      label = "Quota Cooldown";
      break;
    case "permission-prompt":
      color = "#f59e0b"; // warning/amber
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "ShieldAlert";
      pulse = true;
      label = "Permission Needed";
      break;
    case "attention-required":
      color = "#f59e0b"; // warning/amber
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "BellRing";
      pulse = true;
      label = "Awaiting Input";
      break;
    case "failed:quota-exhausted":
      color = "#f97316"; // warning/orange
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "AlertTriangle";
      pulse = false;
      label = "Quota Exhausted";
      break;
    case "failed:spawn":
    case "failed:timeout":
    case "failed:error":
      color = "#ef4444"; // danger/error/red
      badgeVariant = "danger";
      dotVariant = "danger";
      stateIcon = "AlertOctagon";
      pulse = false;
      label = "Failed";
      break;
    case "unknown":
    default:
      color = "#6b7280"; // neutral/gray
      badgeVariant = "neutral";
      dotVariant = "neutral";
      stateIcon = "HelpCircle";
      pulse = false;
      label = "Unknown";
      break;
  }

  return {
    state,
    color,
    badgeVariant,
    dotVariant,
    stateIcon,
    categoryIcon: getAgentCategoryIcon(category),
    pulse,
    label,
  };
}

export const UppidiAgentWorkSchema = z.object({
  repo: z.string().optional(),
  issue: z.number().optional(),
  slug: z.string().optional(),
  branch: z.string().optional(),
});
export type UppidiAgentWork = z.infer<typeof UppidiAgentWorkSchema>;

export const UppidiAgentUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
});
export type UppidiAgentUsage = z.infer<typeof UppidiAgentUsageSchema>;

/** Daemon attention reason for an agent awaiting operator input (#534). */
export const AgentAttentionReasonSchema = z.enum(["finished", "error", "permission", "input"]);
export type AgentAttentionReason = z.infer<typeof AgentAttentionReasonSchema>;

/**
 * A pending tool/permission request surfaced by the Paseo daemon (#534).
 * Mirrors the daemon `AgentPermissionRequest` shape closely enough for the
 * fleet queue to render a prompt and an adjudication command.
 */
export const PendingPermissionSchema = z.object({
  id: z.string(),
  requestId: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  tool: z.string().optional(),
  kind: z.string().optional(),
  description: z.string().optional(),
  /** Provider-native request input parameters (may carry the target path). */
  input: z.record(z.string(), z.unknown()).optional(),
  /** Target scope/path the request applies to, extracted from `input` (#537). */
  scope: z.string().optional(),
});
export type PendingPermission = z.infer<typeof PendingPermissionSchema>;

const SCOPE_INPUT_KEYS = [
  "path",
  "paths",
  "directory",
  "directories",
  "dir",
  "cwd",
  "target",
  "scope",
  "file_path",
  "filePath",
  "file",
] as const;

const SCOPE_DESCRIPTION_PREFIX = /^\s*scope\s*:\s*/i;

function coerceScopeValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map(coerceScopeValue)
      .filter((v): v is string => Boolean(v));
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  return undefined;
}

/**
 * Extracts the target scope/path from a pending permission request (#537).
 * Prefers a recognized input key (`path`, `directory`, …); falls back to a
 * daemon `description` of the form `Scope: <path>` (the `external_directory`
 * shape) and finally to any `description`. Returns undefined when nothing
 * usable is present.
 */
export function extractPermissionScope(
  permission: Pick<PendingPermission, "input" | "description" | "scope">,
): string | undefined {
  const explicit = permission.scope?.trim();
  if (explicit) return explicit;
  const input = permission.input;
  if (input && typeof input === "object") {
    for (const key of SCOPE_INPUT_KEYS) {
      const found = coerceScopeValue((input as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }
  const description = permission.description?.trim();
  if (!description) return undefined;
  const scoped = description.replace(SCOPE_DESCRIPTION_PREFIX, "").trim();
  return scoped || undefined;
}

/**
 * Structured block detail for a child agent awaiting input (#537): which
 * permission request is blocking it, the target scope, the tool/action, and
 * the exact adjudication command. Null when the agent is not blocked on a
 * single resolvable permission request.
 */
export const AgentBlockDetailSchema = z.object({
  /** Required permission request id (`paseo permit allow <agent> <id>`). */
  requiredPermissionId: z.string().optional(),
  /** Target scope/path the permission applies to, when the daemon exposes it. */
  scope: z.string().optional(),
  /** Human-readable action/tool label for the request. */
  action: z.string().optional(),
  /** Suggested adjudication command, e.g. `paseo permit allow <agent> <req>`. */
  command: z.string(),
});
export type AgentBlockDetail = z.infer<typeof AgentBlockDetailSchema>;

/**
 * Builds the structured block detail from an agent's pending permissions
 * (#537). Uses the first pending request as the required one and surfaces both
 * its scope and a ready-to-run adjudication command.
 */
export function buildAgentBlockDetail(
  agentId: string,
  permissions: PendingPermission[] | null | undefined,
): AgentBlockDetail | undefined {
  if (!Array.isArray(permissions) || permissions.length === 0) return undefined;
  const permission = permissions[0]!;
  const reqId = permission.id || permission.requestId;
  const detail: AgentBlockDetail = {
    command: getPermissionAdjudicationCommand(agentId, permission),
  };
  if (reqId) detail.requiredPermissionId = reqId;
  const scope = extractPermissionScope(permission);
  if (scope) detail.scope = scope;
  const action = getPendingPermissionAction(permission);
  if (action) detail.action = action;
  return detail;
}

/** Human-readable label for a pending permission prompt (#534). */
export function getPendingPermissionAction(permission: PendingPermission): string {
  return (
    permission.title?.trim() ||
    permission.tool?.trim() ||
    permission.name?.trim() ||
    permission.kind?.trim() ||
    "tool permission"
  );
}

/** Front Desk adjudication command to allow a pending permission request (#534). */
export function getPermissionAdjudicationCommand(
  agentId: string,
  permission?: PendingPermission | null,
): string {
  const reqId = permission?.id || permission?.requestId;
  return reqId ? `paseo permit allow ${agentId} ${reqId}` : `paseo permit allow ${agentId}`;
}

/**
 * An agent needs prominent attention when it has a pending permission prompt or
 * a non-benign attention flag set by the daemon (#534). Benign `finished`
 * signals are ignored so completed workers do not scream for an operator.
 */
export function agentRequiresAttention(agent: {
  pendingPermissions?: PendingPermission[] | null;
  requiresAttention?: boolean;
  attentionReason?: AgentAttentionReason | string | null;
} | null | undefined): boolean {
  if (!agent) return false;
  const permissions = Array.isArray(agent.pendingPermissions) ? agent.pendingPermissions : [];
  if (permissions.length > 0) return true;
  if (agent.requiresAttention !== true) return false;
  return agent.attentionReason !== "finished";
}

/** Reason string rendered alongside the Awaiting Input badge (#534). */
export function getAgentAttentionReason(agent: {
  attentionReason?: AgentAttentionReason | string | null;
}): string | undefined {
  const reason = agent.attentionReason;
  if (!reason) return undefined;
  switch (reason) {
    case "permission":
      return "permission request";
    case "input":
      return "operator input";
    case "error":
      return "error";
    case "finished":
      return "finished";
    default:
      return String(reason);
  }
}

export const UppidiAgentSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  name: z.string(),
  category: UppidiAgentCategorySchema,
  provider: z.string().optional(),
  model: z.string().nullable().optional(),
  status: z.string(),
  cwd: z.string().optional(),
  created: z.string().optional(),
  updatedAt: z.string().optional(),
  lastActivityAt: z.string().nullable().optional(),
  workspaceId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  parentName: z.string().optional(),
  parentCategory: UppidiAgentCategorySchema.optional(),
  deterministicState: DeterministicAgentStateSchema.default("unknown"),
  stateDetail: z.string().optional(),
  /**
   * Canonical subagent lifecycle state projected from `deterministicState`
   * (#537). Optional so legacy/partial payloads stay parseable; the server's
   * `normalizeRawAgent` always populates it — use `resolveAgentLifecycleState`
   * when reading raw payloads.
   */
  lifecycleState: AgentLifecycleStateSchema.optional(),
  /** Structured block detail when `lifecycleState === "waiting_for_input"` (#537). */
  blockDetail: AgentBlockDetailSchema.nullable().optional(),
  attributedWork: UppidiAgentWorkSchema.nullable().optional(),
  usage: UppidiAgentUsageSchema.nullable().optional(),
  url: z.string().optional(),
  worktree: z.string().optional(),
  project: z.string().optional(),
  isEnrolled: z.boolean().optional(),
  isMuted: z.boolean().optional(),
  hasOrchestrator: z.boolean().optional(),
  queuedHooksCount: z.number().optional(),
  isDetached: z.boolean().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  isMainDirty: z.boolean().optional(),
  mainDirtySummary: z.string().optional(),
  /** Pending daemon permission prompts blocking this agent (#534). */
  pendingPermissions: z.array(PendingPermissionSchema).optional(),
  /** True when the agent is blocked awaiting operator clearance (#534). */
  requiresAttention: z.boolean().optional(),
  /** Daemon-provided contextual reason for the attention flag (#534). */
  attentionReason: AgentAttentionReasonSchema.nullable().optional(),
});
export type UppidiAgent = z.infer<typeof UppidiAgentSchema>;

export interface UppidiAgentTreeNode {
  agent: UppidiAgent;
  depth: number;
  children: UppidiAgentTreeNode[];
  isEnrolled?: boolean;
  isMuted?: boolean;
  hasOrchestrator?: boolean;
  queuedHooksCount?: number;
  isDetached?: boolean;
}

export const UppidiAgentTreeNodeSchema: z.ZodType<UppidiAgentTreeNode> = z.lazy(() =>
  z.object({
    agent: UppidiAgentSchema,
    depth: z.number(),
    children: z.array(UppidiAgentTreeNodeSchema).default([]),
    isEnrolled: z.boolean().optional(),
    isMuted: z.boolean().optional(),
    hasOrchestrator: z.boolean().optional(),
    queuedHooksCount: z.number().optional(),
    isDetached: z.boolean().optional(),
  })
);

export const UppidiAgentsOutputSchema = z.object({
  ok: z.boolean(),
  frontDesk: z.array(UppidiAgentSchema).default([]),
  orchestrators: z.array(UppidiAgentSchema).default([]),
  workers: z.array(UppidiAgentSchema).default([]),
  tree: z.array(UppidiAgentTreeNodeSchema).default([]),
  enrolledRepos: z.array(z.string()).default([]),
  mutedRepos: z.array(z.string()).default([]),
  repoQueuedHooks: z.record(z.string(), z.number()).default({}),
  totalCount: z.number().default(0),
  runningCount: z.number().default(0),
  idleCount: z.number().default(0),
  errorCount: z.number().default(0),
  error: z.string().optional(),
});
export type UppidiAgentsOutput = z.infer<typeof UppidiAgentsOutputSchema>;

export const uppidiAgentsContract = defineContract({
  name: "uppidi-fleet.agents",
  description: "Get active Paseo agents grouped into tree hierarchy: Frontdesk, Orchestrators, and Workers",
  input: z.object({}),
  output: UppidiAgentsOutputSchema,
});

// Role Model Configuration (Issue #371)
export const RoleModelConfigSchema = z.object({
  role: z.string(),
  primaryModel: z.string(),
  fallbackGroup: z.array(z.string()).default([]),
});
export type RoleModelConfig = z.infer<typeof RoleModelConfigSchema>;

export const UppidiRoleModelsOutputSchema = z.object({
  ok: z.boolean(),
  roles: z.record(z.string(), RoleModelConfigSchema).default({}),
  availableModels: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type UppidiRoleModelsOutput = z.infer<typeof UppidiRoleModelsOutputSchema>;

export const uppidiRoleModelsContract = defineContract({
  name: "uppidi-fleet.role-models",
  description: "Get model and fallback group configuration for each agent role",
  input: z.object({}),
  output: UppidiRoleModelsOutputSchema,
});

export const UppidiSetRoleModelInputSchema = z.object({
  role: z.string(),
  primaryModel: z.string(),
  fallbackGroup: z.array(z.string()).optional(),
});
export type UppidiSetRoleModelInput = z.infer<typeof UppidiSetRoleModelInputSchema>;

export const UppidiSetRoleModelOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type UppidiSetRoleModelOutput = z.infer<typeof UppidiSetRoleModelOutputSchema>;

export const uppidiSetRoleModelContract = defineContract({
  name: "uppidi-fleet.set-role-model",
  description: "Set primary model and optional fallback group for an agent role",
  input: UppidiSetRoleModelInputSchema,
  output: UppidiSetRoleModelOutputSchema,
});

// CI Runner List and Status (Issue #366)
export const UppidiRunnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  labels: z.array(z.string()).default([]),
  lastSeen: z.string().optional(),
  lastJob: z.string().optional(),
});
export type UppidiRunner = z.infer<typeof UppidiRunnerSchema>;

export const UppidiRunnersOutputSchema = z.object({
  ok: z.boolean(),
  runners: z.array(UppidiRunnerSchema).default([]),
  totalCount: z.number().default(0),
  onlineCount: z.number().default(0),
  error: z.string().optional(),
});
export type UppidiRunnersOutput = z.infer<typeof UppidiRunnersOutputSchema>;

export const uppidiRunnersContract = defineContract({
  name: "uppidi-fleet.runners",
  description: "Get CI runner fleet status and labels for repository actions",
  input: z.object({}),
  output: UppidiRunnersOutputSchema,
});

// Autonomous Fleet Capability & Benchmark Metrics (Issue #373 / Platform #18)
export const TaskProfileMetricsSchema = z.object({
  taskProfile: z.string(),
  taskProfileLabel: z.string(),
  description: z.string(),
  trialsCount: z.number().default(0),
  passRate: z.number().default(0),
  reworkRate: z.number().default(0),
  medianWallMs: z.number().default(0),
  confidence: z.enum(["high", "moderate", "low", "inconclusive"]).default("high"),
  failureBreakdown: z.object({
    quota: z.number().default(0),
    timeout: z.number().default(0),
    toolFailure: z.number().default(0),
    checkFailure: z.number().default(0),
  }),
  advisory: z.string(),
});
export type TaskProfileMetrics = z.infer<typeof TaskProfileMetricsSchema>;

export const CandidateModelMetricsSchema = z.object({
  model: z.string(),
  provider: z.string(),
  configProfile: z.string().default("default"),
  overallPassRate: z.number().default(0),
  totalTrials: z.number().default(0),
  medianWallMs: z.number().default(0),
  recommendedRoles: z.array(z.string()).default([]),
  profiles: z.array(TaskProfileMetricsSchema).default([]),
});
export type CandidateModelMetrics = z.infer<typeof CandidateModelMetricsSchema>;

export const UppidiFleetMetricsInputSchema = z.object({
  taskProfile: z.string().optional(),
  model: z.string().optional(),
});
export type UppidiFleetMetricsInput = z.infer<typeof UppidiFleetMetricsInputSchema>;

export const UppidiFleetMetricsOutputSchema = z.object({
  ok: z.boolean(),
  candidates: z.array(CandidateModelMetricsSchema).default([]),
  taskProfiles: z.array(z.string()).default([]),
  totalEvaluatedTrials: z.number().default(0),
  privacyNotice: z.string().default(""),
  updatedAt: z.string().optional(),
  error: z.string().optional(),
});
export type UppidiFleetMetricsOutput = z.infer<typeof UppidiFleetMetricsOutputSchema>;

export const uppidiFleetMetricsContract = defineContract({
  name: "uppidi-fleet.metrics",
  description: "Get autonomous fleet capability and task benchmark metrics matrix (platform#18)",
  input: UppidiFleetMetricsInputSchema,
  output: UppidiFleetMetricsOutputSchema,
});

// Agent Archive Contracts (Issue #402)
export const UppidiArchiveAgentInputSchema = z.object({
  agentId: z.string(),
});
export type UppidiArchiveAgentInput = z.infer<typeof UppidiArchiveAgentInputSchema>;

export const UppidiArchiveAgentOutputSchema = z.object({
  ok: z.boolean(),
  agentId: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type UppidiArchiveAgentOutput = z.infer<typeof UppidiArchiveAgentOutputSchema>;

export const uppidiArchiveAgentContract = defineContract({
  name: "uppidi-fleet.archive-agent",
  description: "Archive an individual Paseo agent",
  input: UppidiArchiveAgentInputSchema,
  output: UppidiArchiveAgentOutputSchema,
});

export const UppidiArchiveInactiveAgentsInputSchema = z.object({
  agentIds: z.array(z.string()).optional(),
});
export type UppidiArchiveInactiveAgentsInput = z.infer<typeof UppidiArchiveInactiveAgentsInputSchema>;

export const UppidiArchiveInactiveAgentsOutputSchema = z.object({
  ok: z.boolean(),
  archivedCount: z.number().default(0),
  archivedIds: z.array(z.string()).default([]),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type UppidiArchiveInactiveAgentsOutput = z.infer<typeof UppidiArchiveInactiveAgentsOutputSchema>;

export const uppidiArchiveInactiveAgentsContract = defineContract({
  name: "uppidi-fleet.archive-inactive-agents",
  description: "Bulk archive inactive, closed, or failed agents (never running, working, or orchestrator/frontdesk)",
  input: UppidiArchiveInactiveAgentsInputSchema,
  output: UppidiArchiveInactiveAgentsOutputSchema,
});

// Front Desk & Orchestrator Lifecycle + Muting Contracts (Issue #426)
export const UppidiCreateFrontDeskInputSchema = z.object({
  model: z.string().optional(),
  prompt: z.string().optional(),
  title: z.string().optional(),
});
export type UppidiCreateFrontDeskInput = z.infer<typeof UppidiCreateFrontDeskInputSchema>;

export const UppidiCreateFrontDeskOutputSchema = z.object({
  ok: z.boolean(),
  agentId: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type UppidiCreateFrontDeskOutput = z.infer<typeof UppidiCreateFrontDeskOutputSchema>;

export const uppidiCreateFrontDeskContract = defineContract({
  name: "uppidi-fleet.create-front-desk",
  description: "Create a fresh Front Desk liaison session",
  input: UppidiCreateFrontDeskInputSchema,
  output: UppidiCreateFrontDeskOutputSchema,
});

export const UppidiReplaceFrontDeskInputSchema = z.object({
  existingAgentId: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  title: z.string().optional(),
});
export type UppidiReplaceFrontDeskInput = z.infer<typeof UppidiReplaceFrontDeskInputSchema>;

export const UppidiReplaceFrontDeskOutputSchema = z.object({
  ok: z.boolean(),
  oldAgentId: z.string().optional(),
  agentId: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type UppidiReplaceFrontDeskOutput = z.infer<typeof UppidiReplaceFrontDeskOutputSchema>;

export const uppidiReplaceFrontDeskContract = defineContract({
  name: "uppidi-fleet.replace-front-desk",
  description: "Retire/archive existing Front Desk session and spawn a fresh one",
  input: UppidiReplaceFrontDeskInputSchema,
  output: UppidiReplaceFrontDeskOutputSchema,
});

export const UppidiAddOrchestratorInputSchema = z.object({
  repo: z.string(),
  workspacePath: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  title: z.string().optional(),
});
export type UppidiAddOrchestratorInput = z.infer<typeof UppidiAddOrchestratorInputSchema>;

export const UppidiAddOrchestratorOutputSchema = z.object({
  ok: z.boolean(),
  repo: z.string(),
  agentId: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type UppidiAddOrchestratorOutput = z.infer<typeof UppidiAddOrchestratorOutputSchema>;

export const uppidiAddOrchestratorContract = defineContract({
  name: "uppidi-fleet.add-orchestrator",
  description: "Provision an orchestrator in a repository workspace",
  input: UppidiAddOrchestratorInputSchema,
  output: UppidiAddOrchestratorOutputSchema,
});

export const UppidiReplaceOrchestratorInputSchema = z.object({
  repo: z.string(),
  existingAgentId: z.string().optional(),
  workspacePath: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  title: z.string().optional(),
});
export type UppidiReplaceOrchestratorInput = z.infer<typeof UppidiReplaceOrchestratorInputSchema>;

export const UppidiReplaceOrchestratorOutputSchema = z.object({
  ok: z.boolean(),
  repo: z.string(),
  oldAgentId: z.string().optional(),
  agentId: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type UppidiReplaceOrchestratorOutput = z.infer<typeof UppidiReplaceOrchestratorOutputSchema>;

export const uppidiReplaceOrchestratorContract = defineContract({
  name: "uppidi-fleet.replace-orchestrator",
  description: "Retire/archive existing orchestrator session and spawn a new one",
  input: UppidiReplaceOrchestratorInputSchema,
  output: UppidiReplaceOrchestratorOutputSchema,
});

export const UppidiToggleRepoMuteInputSchema = z.object({
  repo: z.string(),
  muted: z.boolean().optional(),
});
export type UppidiToggleRepoMuteInput = z.infer<typeof UppidiToggleRepoMuteInputSchema>;

export const UppidiToggleRepoMuteOutputSchema = z.object({
  ok: z.boolean(),
  repo: z.string(),
  isMuted: z.boolean(),
  mutedRepos: z.array(z.string()).default([]),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type UppidiToggleRepoMuteOutput = z.infer<typeof UppidiToggleRepoMuteOutputSchema>;

export const uppidiToggleRepoMuteContract = defineContract({
  name: "uppidi-fleet.toggle-repo-mute",
  description: "Toggle per-repository webhook muting / circuit breaker",
  input: UppidiToggleRepoMuteInputSchema,
  output: UppidiToggleRepoMuteOutputSchema,
});

// Uppidi Fleet Plugin Settings Contract (Issue #444)
export const uppidiFleetSettingsSchema = z.object({
  hookHost: z.string().default("127.0.0.1"),
  hookPort: z.number().int().min(1).max(65535).default(8099),
  enrolledRepos: z.array(z.string()).default([]),
  mutedRepos: z.array(z.string()).default([]),
});
export type UppidiFleetSettings = z.infer<typeof uppidiFleetSettingsSchema>;

export const uppidiFleetSettingsContract = defineSettingsContract({
  name: "uppidi-fleet.settings",
  description: "Uppidi Fleet plugin settings",
  schema: uppidiFleetSettingsSchema,
});

/**
 * Extracts a concise workspace or worktree slug from an agent record.
 * Supports worktree paths (~/.paseo/worktrees/<id>/<slug>), cwd repo paths,
 * attributed work slugs/branches, labels, or workspace IDs.
 */
export function extractAgentWorktree(agent: {
  worktree?: string;
  cwd?: string;
  workspaceId?: string;
  labels?: Record<string, string>;
  attributedWork?: { slug?: string; branch?: string } | null;
  name?: string;
  title?: string;
}): string | undefined {
  if (agent.worktree && agent.worktree.trim()) return agent.worktree.trim();
  if (agent.labels?.["worktree"] && agent.labels["worktree"].trim()) return agent.labels["worktree"].trim();
  if (agent.labels?.["branch"] && agent.labels["branch"].trim()) return agent.labels["branch"].trim();

  if (agent.cwd) {
    const cwd = agent.cwd.trim();
    const wtMatch = cwd.match(/worktrees\/[^/]+\/([^/]+)/);
    if (wtMatch && wtMatch[1]) {
      return wtMatch[1];
    }
    const codeMatch = cwd.match(/\/code\/([^/]+)/);
    if (codeMatch && codeMatch[1]) {
      return codeMatch[1];
    }
    const parts = cwd.split("/").filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  if (agent.attributedWork?.slug) return agent.attributedWork.slug;
  if (agent.attributedWork?.branch) return agent.attributedWork.branch;

  if (agent.workspaceId) {
    return agent.workspaceId.length > 12 ? agent.workspaceId.slice(0, 12) : agent.workspaceId;
  }

  return undefined;
}

/** Canonical repository for an agent, keyed by Paseo workspaceId. */
export type WorkspaceProjectMap = Record<string, string>;

/** Sentinel bucket for agents with no authoritative project metadata. */
export const DEFAULT_PROJECT = "Default Project";

/**
 * Extracts an agent's project identifier (e.g. "xpufx-org/paseo") from
 * authoritative metadata only (#530):
 *   1. An already-resolved `project` field.
 *   2. Canonical workspace mapping (`workspaceId` -> repository).
 *   3. Explicit agent labels (`repo` / `project`).
 *   4. Parent hierarchy inheritance (`parentProject`).
 * Falls back to "Default Project" when no authoritative source is available.
 *
 * Title and cwd regex heuristics are intentionally not used: they misassign
 * worktree workers and ad-hoc agents into detached ghost projects.
 */
export function extractAgentProject(
  agent: {
    project?: string;
    labels?: Record<string, string>;
    workspaceId?: string;
    /** Accepted for call-site compatibility but intentionally not consulted (#530). */
    attributedWork?: { repo?: string } | null;
    name?: string;
    title?: string;
    cwd?: string;
  },
  parentProject?: string,
  workspaceProjectMap?: WorkspaceProjectMap
): string {
  if (agent.project && agent.project.trim() && agent.project.trim() !== DEFAULT_PROJECT) {
    return agent.project.trim();
  }

  if (agent.workspaceId && workspaceProjectMap) {
    const mapped = workspaceProjectMap[agent.workspaceId];
    if (mapped && mapped.trim()) return mapped.trim();
  }

  if (agent.labels?.["repo"] && agent.labels["repo"].trim()) return agent.labels["repo"].trim();
  if (agent.labels?.["project"] && agent.labels["project"].trim()) return agent.labels["project"].trim();

  if (parentProject && parentProject.trim() && parentProject.trim() !== DEFAULT_PROJECT) {
    return parentProject.trim();
  }

  return DEFAULT_PROJECT;
}


