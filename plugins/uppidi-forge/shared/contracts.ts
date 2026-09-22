import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

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
  name: "uppidi-forge.issues",
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
  name: "uppidi-forge.hook-status",
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
  name: "uppidi-forge.hook-queues",
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
  name: "uppidi-forge.hook-pause",
  description: "Pause one or all repository queues",
  input: HookQueueActionInputSchema,
  output: HookQueueActionOutputSchema,
});

export const uppidiHookResumeContract = defineContract({
  name: "uppidi-forge.hook-resume",
  description: "Resume one or all repository queues",
  input: HookQueueActionInputSchema,
  output: HookQueueActionOutputSchema,
});

export const uppidiHookDrainContract = defineContract({
  name: "uppidi-forge.hook-drain",
  description: "Drain/discard queued messages for a repository",
  input: HookQueueActionInputSchema,
  output: HookQueueActionOutputSchema,
});

// Hook Service Management (Issue #368)
export const HookServiceStatusOutputSchema = z.object({
  ok: z.boolean(),
  active: z.boolean(),
  state: z.string(),
  description: z.string().optional(),
  pid: z.number().optional(),
  error: z.string().optional(),
});
export type HookServiceStatusOutput = z.infer<typeof HookServiceStatusOutputSchema>;

export const uppidiHookServiceStatusContract = defineContract({
  name: "uppidi-forge.hook-service-status",
  description: "Inspect systemd user service status for forgejo-hook.service",
  input: z.object({}),
  output: HookServiceStatusOutputSchema,
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
  name: "uppidi-forge.hook-service-action",
  description: "Start/Stop/Restart the forgejo-hook systemd service",
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
  name: "uppidi-forge.hook-log-tail",
  description: "Tail journal log lines for forgejo-hook.service",
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
  "failed:quota-exhausted", // Failed/aborted due to usage/quota limit
  "failed:spawn",           // Failed during process or session spawn
  "failed:timeout",         // Execution or connection timeout
  "failed:error",           // General agent crash or unhandled error
  "unknown",                // Fallback when signals cannot resolve
]);
export type DeterministicAgentState = z.infer<typeof DeterministicAgentStateSchema>;

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
  deterministicState: DeterministicAgentStateSchema.default("unknown"),
  stateDetail: z.string().optional(),
  attributedWork: UppidiAgentWorkSchema.nullable().optional(),
  usage: UppidiAgentUsageSchema.nullable().optional(),
});
export type UppidiAgent = z.infer<typeof UppidiAgentSchema>;

export interface UppidiAgentTreeNode {
  agent: UppidiAgent;
  depth: number;
  children: UppidiAgentTreeNode[];
}

export const UppidiAgentTreeNodeSchema: z.ZodType<UppidiAgentTreeNode> = z.lazy(() =>
  z.object({
    agent: UppidiAgentSchema,
    depth: z.number(),
    children: z.array(UppidiAgentTreeNodeSchema).default([]),
  })
);

export const UppidiAgentsOutputSchema = z.object({
  ok: z.boolean(),
  frontDesk: z.array(UppidiAgentSchema).default([]),
  orchestrators: z.array(UppidiAgentSchema).default([]),
  workers: z.array(UppidiAgentSchema).default([]),
  tree: z.array(UppidiAgentTreeNodeSchema).default([]),
  totalCount: z.number().default(0),
  runningCount: z.number().default(0),
  idleCount: z.number().default(0),
  errorCount: z.number().default(0),
  error: z.string().optional(),
});
export type UppidiAgentsOutput = z.infer<typeof UppidiAgentsOutputSchema>;

export const uppidiAgentsContract = defineContract({
  name: "uppidi-forge.agents",
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
  name: "uppidi-forge.role-models",
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
  name: "uppidi-forge.set-role-model",
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
  name: "uppidi-forge.runners",
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
  name: "uppidi-forge.metrics",
  description: "Get autonomous fleet capability and task benchmark metrics matrix (platform#18)",
  input: UppidiFleetMetricsInputSchema,
  output: UppidiFleetMetricsOutputSchema,
});
