import { z } from "zod";
import { defineRpc, type PluginRpcContract } from "@getpaseo/plugin";

/**
 * Wire contracts for the `worktree-install` surface.
 *
 * The field set is deliberately identical to the data `uppidi-fleet` serves
 * (see `docs/INVENTORY.md` §B.9, §C.3, §D.1-2): the brief for #629 is a
 * presentation change, not a data change, so anything the legacy surface
 * rendered has to survive the trip. What differs is the *shape of the code* —
 * this plugin owns its contracts rather than importing another plugin's.
 */

const RPC_NAME = /^[a-z][a-z0-9._-]*$/;

/**
 * Contract declaration with a description attached, matching the shape
 * `paseo-plugin-helper/shared` exposes. Declared locally so the plugin has no
 * runtime dependency on the shared helper at all (see README "Dependency
 * resolution").
 */
export function defineContract<TName extends string, TInput extends z.ZodType, TOutput extends z.ZodType>(
  options: { name: TName; input: TInput; output: TOutput; description?: string },
): PluginRpcContract<TInput, TOutput> & { readonly description?: string } {
  const contract = defineRpc({ name: options.name, input: options.input, output: options.output });
  if (!RPC_NAME.test(contract.name)) {
    throw new Error(`Invalid plugin RPC method: ${options.name}`);
  }
  if (options.description) {
    Object.defineProperty(contract, "description", {
      value: options.description,
      enumerable: true,
      writable: false,
    });
  }
  return contract as PluginRpcContract<TInput, TOutput> & { readonly description?: string };
}

export const AttentionLabelSchema = z.enum([
  "attention/0-orchestrator",
  "attention/1-agent",
  "attention/2-user",
]);
export type AttentionLabel = z.infer<typeof AttentionLabelSchema>;

export const AgentCategorySchema = z.enum(["front-desk", "orchestrator", "worker"]);
export type AgentCategory = z.infer<typeof AgentCategorySchema>;

export const AgentStateSchema = z.enum([
  "working",
  "running",
  "sleeping",
  "idle:waiting",
  "idle:quota-exhausted",
  "attention-required",
  "permission-prompt",
  "failed:quota-exhausted",
  "failed:spawn",
  "failed:timeout",
  "failed:error",
  "unknown",
]);
export type AgentState = z.infer<typeof AgentStateSchema>;

/** Provider-agnostic lifecycle projection over the finer-grained `AgentState`. */
export const LifecycleStateSchema = z.enum([
  "running",
  "waiting_for_input",
  "idle",
  "errored",
  "completed",
]);
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

export const AttentionReasonSchema = z.enum(["finished", "error", "permission", "input"]);
export type AttentionReason = z.infer<typeof AttentionReasonSchema>;

export const PendingPermissionSchema = z.object({
  id: z.string(),
  requestId: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  tool: z.string().optional(),
  kind: z.string().optional(),
  description: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  scope: z.string().optional(),
});
export type PendingPermission = z.infer<typeof PendingPermissionSchema>;

export const BlockDetailSchema = z.object({
  requiredPermissionId: z.string().optional(),
  scope: z.string().optional(),
  action: z.string().optional(),
  command: z.string(),
});
export type BlockDetail = z.infer<typeof BlockDetailSchema>;

export const AgentUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
});
export type AgentUsage = z.infer<typeof AgentUsageSchema>;

export const AgentMetricsSchema = z.object({
  contextUsedTokens: z.number().optional(),
  contextMaxTokens: z.number().optional(),
  cachedTokens: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  costUsd: z.number().optional(),
  activeTurnStartedAt: z.string().optional(),
  attentionTimestamp: z.string().optional(),
});
export type AgentMetrics = z.infer<typeof AgentMetricsSchema>;

export const AgentWorkSchema = z.object({
  repo: z.string().optional(),
  issue: z.number().optional(),
  slug: z.string().optional(),
  branch: z.string().optional(),
});
export type AgentWork = z.infer<typeof AgentWorkSchema>;

export const AgentSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  name: z.string(),
  category: AgentCategorySchema,
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
  parentCategory: AgentCategorySchema.optional(),
  deterministicState: AgentStateSchema.default("unknown"),
  stateDetail: z.string().optional(),
  lifecycleState: LifecycleStateSchema.optional(),
  blockDetail: BlockDetailSchema.nullable().optional(),
  attributedWork: AgentWorkSchema.nullable().optional(),
  usage: AgentUsageSchema.nullable().optional(),
  metrics: AgentMetricsSchema.nullable().optional(),
  lastError: z.string().nullable().optional(),
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
  pendingPermissions: z.array(PendingPermissionSchema).optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: AttentionReasonSchema.nullable().optional(),
});
export type FleetAgent = z.infer<typeof AgentSchema>;

export interface AgentNode {
  agent: FleetAgent;
  depth: number;
  children: AgentNode[];
}

export const FleetOutputSchema = z.object({
  ok: z.boolean(),
  frontDesk: z.array(AgentSchema).default([]),
  orchestrators: z.array(AgentSchema).default([]),
  workers: z.array(AgentSchema).default([]),
  tree: z.array(z.unknown()).default([]),
  enrolledRepos: z.array(z.string()).default([]),
  mutedRepos: z.array(z.string()).default([]),
  repoQueuedHooks: z.record(z.string(), z.number()).default({}),
  totalCount: z.number().default(0),
  runningCount: z.number().default(0),
  idleCount: z.number().default(0),
  errorCount: z.number().default(0),
  error: z.string().optional(),
});
export type FleetOutput = z.infer<typeof FleetOutputSchema>;

export const fleetContract = defineContract({
  name: "worktree-install.fleet",
  description: "Fleet roster grouped into a parent/child tree with derived state",
  input: z.object({}),
  output: FleetOutputSchema,
});

// --- Tickets -------------------------------------------------------------

export const TicketStatusSchema = z.enum(["Backlog", "In progress", "Review", "Done"]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const TicketSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  repo: z.string(),
  status: TicketStatusSchema,
  attention: AttentionLabelSchema.default("attention/1-agent"),
  branch: z.string().optional(),
  comments: z.number().default(0),
  labels: z.array(z.string()).default([]),
  url: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const TicketBoardOutputSchema = z.object({
  ok: z.boolean(),
  repo: z.string().nullable().default(null),
  tickets: z.array(TicketSchema).default([]),
  openCount: z.number().default(0),
  inFlightCount: z.number().default(0),
  reviewCount: z.number().default(0),
  needsYouCount: z.number().default(0),
  error: z.string().optional(),
});
export type TicketBoardOutput = z.infer<typeof TicketBoardOutputSchema>;

export const ticketBoardContract = defineContract({
  name: "worktree-install.tickets",
  description: "Board tickets with derived status and attention ownership",
  input: z.object({
    host: z.string().optional(),
    repo: z.string().optional(),
    state: z.enum(["open", "closed", "all"]).default("open"),
  }),
  output: TicketBoardOutputSchema,
});

// --- Queue ---------------------------------------------------------------

export const QueueMessageSchema = z.object({
  id: z.string(),
  ts: z.number().nullable().optional(),
  preview: z.string(),
});
export type QueueMessage = z.infer<typeof QueueMessageSchema>;

export const RepoQueueSchema = z.object({
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
  messages: z.array(QueueMessageSchema).default([]),
});
export type RepoQueue = z.infer<typeof RepoQueueSchema>;

/** Presentation-level bucket; not part of the wire shape. */
export type QueuePreset = "all" | "pending-processing" | "dead-failed";


export const RouterStatusOutputSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
  version: z.number().optional(),
  uptime: z.number().optional(),
  url: z.string().nullable().default(null),
  active: z.boolean().default(false),
  state: z.string().default("unknown"),
  host: z.string().optional(),
  port: z.number().optional(),
  configuredHost: z.string().optional(),
  configuredPort: z.number().optional(),
  availableInterfaces: z.array(z.string()).default([]),
  frontDeskAgentId: z.string().nullable().default(null),
  paused: z.array(z.string()).default([]),
  totalQueued: z.number().default(0),
  repoCount: z.number().default(0),
  capabilities: z
    .object({ xCommsInstalled: z.boolean().default(false) })
    .default({ xCommsInstalled: false }),
  error: z.string().optional(),
});
export type RouterStatusOutput = z.infer<typeof RouterStatusOutputSchema>;

export const routerStatusContract = defineContract({
  name: "worktree-install.router-status",
  description: "Read-only health of the Forgejo webhook router and the repo it serves",
  input: z.object({ hookUrl: z.string().optional() }),
  output: RouterStatusOutputSchema,
});

export const QueueOutputSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
  uptime: z.number().optional(),
  paused: z.array(z.string()).default([]),
  queues: z.array(RepoQueueSchema).default([]),
  error: z.string().optional(),
});
export type QueueOutput = z.infer<typeof QueueOutputSchema>;

export const queueContract = defineContract({
  name: "worktree-install.queue",
  description: "Per-repository webhook message queues",
  input: z.object({ hookUrl: z.string().optional() }),
  output: QueueOutputSchema,
});

export const QueueActionOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type QueueActionOutput = z.infer<typeof QueueActionOutputSchema>;

export const QueueActionInputSchema = z.object({
  hookUrl: z.string().optional(),
  repo: z.string().optional(),
});
export type QueueActionInput = z.infer<typeof QueueActionInputSchema>;

export const queuePauseContract = defineContract({
  name: "worktree-install.queue-pause",
  description: "Pause one or all repository queues",
  input: QueueActionInputSchema,
  output: QueueActionOutputSchema,
});

export const queueResumeContract = defineContract({
  name: "worktree-install.queue-resume",
  description: "Resume one or all repository queues",
  input: QueueActionInputSchema,
  output: QueueActionOutputSchema,
});

export const queueDrainContract = defineContract({
  name: "worktree-install.queue-drain",
  description: "Discard queued messages for a repository",
  input: QueueActionInputSchema,
  output: QueueActionOutputSchema,
});

// --- Fleet lifecycle actions --------------------------------------------

export const ActionOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
  archivedCount: z.number().optional(),
  isMuted: z.boolean().optional(),
  mutedRepos: z.array(z.string()).optional(),
});
export type ActionOutput = z.infer<typeof ActionOutputSchema>;

export const archiveAgentContract = defineContract({
  name: "worktree-install.archive-agent",
  description: "Archive one fleet agent",
  input: z.object({ agentId: z.string() }),
  output: ActionOutputSchema,
});

export const archiveInactiveAgentsContract = defineContract({
  name: "worktree-install.archive-inactive-agents",
  description: "Bulk archive terminal-state workers",
  input: z.object({ agentIds: z.array(z.string()).optional() }),
  output: ActionOutputSchema,
});

export const createFrontDeskContract = defineContract({
  name: "worktree-install.create-front-desk",
  description: "Spawn a fleet liaison session",
  input: z.object({
    model: z.string().optional(),
    prompt: z.string().optional(),
    title: z.string().optional(),
  }),
  output: ActionOutputSchema,
});

export const replaceFrontDeskContract = defineContract({
  name: "worktree-install.replace-front-desk",
  description: "Retire the current liaison session and spawn a fresh one",
  input: z.object({
    existingAgentId: z.string().optional(),
    model: z.string().optional(),
    prompt: z.string().optional(),
    title: z.string().optional(),
  }),
  output: ActionOutputSchema,
});

export const addOrchestratorContract = defineContract({
  name: "worktree-install.add-orchestrator",
  description: "Provision an orchestrator for a repository",
  input: z.object({
    repo: z.string(),
    cwd: z.string().optional(),
    model: z.string().optional(),
    prompt: z.string().optional(),
  }),
  output: ActionOutputSchema,
});

export const replaceOrchestratorContract = defineContract({
  name: "worktree-install.replace-orchestrator",
  description: "Retire a repository's orchestrator and spawn a new one",
  input: z.object({
    repo: z.string(),
    existingAgentId: z.string().optional(),
    cwd: z.string().optional(),
    model: z.string().optional(),
    prompt: z.string().optional(),
  }),
  output: ActionOutputSchema,
});

export const muteRepoContract = defineContract({
  name: "worktree-install.mute-repo",
  description: "Toggle per-repository webhook muting",
  input: z.object({ repo: z.string(), muted: z.boolean().optional() }),
  output: ActionOutputSchema,
});
