import { z } from "zod";
import {
  AgentCategorySchema,
  AgentLifecycleStateSchema,
  AgentRoleDivergenceSchema,
  DeterministicAgentStateSchema,
  FleetAgentSchema,
  FleetAgentTreeNodeSchema,
  FleetOutputSchema,
  HookQueueItemSchema,
  FrontDeskActivityItemSchema,
} from "../client/types.js";

// ---------------------------------------------------------------------------
// 1. Generic RPC Contract Interface
// ---------------------------------------------------------------------------

export interface RpcContract<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  name: string;
  description?: string;
  input: TInput;
  output: TOutput;
}

export function defineContract<TName extends string, TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(options: {
  name: TName;
  description?: string;
  input: TInput;
  output: TOutput;
}): RpcContract<TInput, TOutput> {
  return options;
}

// ---------------------------------------------------------------------------
// 2. Query Contracts: Fleet Roster & Agents
// ---------------------------------------------------------------------------

export const FleetRosterInputSchema = z
  .object({
    repo: z.string().optional(),
    project: z.string().optional(),
    enrolledRepos: z.array(z.string()).optional(),
    mutedRepos: z.array(z.string()).optional(),
    pausedRepos: z.array(z.string()).optional(),
  })
  .optional()
  .default({});
export type FleetRosterInput = z.infer<typeof FleetRosterInputSchema>;

export const fleetRosterContract = defineContract({
  name: "fleet.roster",
  description: "Read canonical fleet agent roster, state machine, worktree graph, and health summary",
  input: FleetRosterInputSchema,
  output: FleetOutputSchema,
});

// ---------------------------------------------------------------------------
// 3. Mutation Contracts: Agent Lifecycle & Fleet Control
// ---------------------------------------------------------------------------

export const ArchiveAgentInputSchema = z.object({
  agentId: z.string().min(1),
  notify: z.boolean().optional(),
});
export type ArchiveAgentInput = z.infer<typeof ArchiveAgentInputSchema>;

export const ArchiveAgentOutputSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type ArchiveAgentOutput = z.infer<typeof ArchiveAgentOutputSchema>;

export const archiveAgentContract = defineContract({
  name: "fleet.archive-agent",
  description: "Archive a specific fleet agent by ID",
  input: ArchiveAgentInputSchema,
  output: ArchiveAgentOutputSchema,
});

export const ArchiveInactiveAgentsInputSchema = z
  .object({
    beforeHours: z.number().int().positive().optional(),
  })
  .optional()
  .default({});
export type ArchiveInactiveAgentsInput = z.infer<typeof ArchiveInactiveAgentsInputSchema>;

export const ArchiveInactiveAgentsOutputSchema = z.object({
  ok: z.boolean(),
  archivedCount: z.number().default(0),
  error: z.string().optional(),
});
export type ArchiveInactiveAgentsOutput = z.infer<typeof ArchiveInactiveAgentsOutputSchema>;

export const archiveInactiveAgentsContract = defineContract({
  name: "fleet.archive-inactive",
  description: "Archive all inactive or completed workers across the fleet",
  input: ArchiveInactiveAgentsInputSchema,
  output: ArchiveInactiveAgentsOutputSchema,
});

export const CreateFrontDeskInputSchema = z
  .object({
    model: z.string().optional(),
  })
  .optional()
  .default({});
export type CreateFrontDeskInput = z.infer<typeof CreateFrontDeskInputSchema>;

export const CreateFrontDeskOutputSchema = z.object({
  ok: z.boolean(),
  agentId: z.string().optional(),
  error: z.string().optional(),
});
export type CreateFrontDeskOutput = z.infer<typeof CreateFrontDeskOutputSchema>;

export const createFrontDeskContract = defineContract({
  name: "fleet.create-front-desk",
  description: "Spawn or ensure the singleton Front Desk liaison agent",
  input: CreateFrontDeskInputSchema,
  output: CreateFrontDeskOutputSchema,
});

export const replaceFrontDeskContract = defineContract({
  name: "fleet.replace-front-desk",
  description: "Archive the active Front Desk liaison and spawn a fresh replacement",
  input: CreateFrontDeskInputSchema,
  output: CreateFrontDeskOutputSchema,
});

export const AddOrchestratorInputSchema = z.object({
  repo: z.string().min(1),
  model: z.string().optional(),
});
export type AddOrchestratorInput = z.infer<typeof AddOrchestratorInputSchema>;

export const AddOrchestratorOutputSchema = z.object({
  ok: z.boolean(),
  agentId: z.string().optional(),
  error: z.string().optional(),
});
export type AddOrchestratorOutput = z.infer<typeof AddOrchestratorOutputSchema>;

export const addOrchestratorContract = defineContract({
  name: "fleet.add-orchestrator",
  description: "Spawn or ensure a supervisor orchestrator for an enrolled repository",
  input: AddOrchestratorInputSchema,
  output: AddOrchestratorOutputSchema,
});

export const replaceOrchestratorContract = defineContract({
  name: "fleet.replace-orchestrator",
  description: "Archive the active orchestrator for an enrolled repository and spawn a fresh replacement",
  input: AddOrchestratorInputSchema,
  output: AddOrchestratorOutputSchema,
});

export const ToggleRepoPauseInputSchema = z.object({
  repo: z.string().min(1),
  paused: z.boolean().optional(),
});
export type ToggleRepoPauseInput = z.infer<typeof ToggleRepoPauseInputSchema>;

export const ToggleRepoPauseOutputSchema = z.object({
  ok: z.boolean(),
  paused: z.boolean(),
  repo: z.string(),
  error: z.string().optional(),
});
export type ToggleRepoPauseOutput = z.infer<typeof ToggleRepoPauseOutputSchema>;

export const toggleRepoPauseContract = defineContract({
  name: "fleet.toggle-repo-pause",
  description: "Pause or unpause hook processing for a repository",
  input: ToggleRepoPauseInputSchema,
  output: ToggleRepoPauseOutputSchema,
});

export const FleetHaltInputSchema = z
  .object({
    reason: z.string().optional(),
  })
  .optional()
  .default({});
export type FleetHaltInput = z.infer<typeof FleetHaltInputSchema>;

export const FleetHaltOutputSchema = z.object({
  ok: z.boolean(),
  halted: z.boolean(),
  error: z.string().optional(),
});
export type FleetHaltOutput = z.infer<typeof FleetHaltOutputSchema>;

export const fleetHaltContract = defineContract({
  name: "fleet.halt",
  description: "Halt all fleet turns and suspend active queues",
  input: FleetHaltInputSchema,
  output: FleetHaltOutputSchema,
});

export const fleetResumeContract = defineContract({
  name: "fleet.resume",
  description: "Resume fleet operations and reactivate paused queues",
  input: FleetHaltInputSchema,
  output: FleetHaltOutputSchema,
});

export const FleetTeardownInputSchema = z
  .object({
    force: z.boolean().optional(),
  })
  .optional()
  .default({});
export type FleetTeardownInput = z.infer<typeof FleetTeardownInputSchema>;

export const FleetTeardownOutputSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type FleetTeardownOutput = z.infer<typeof FleetTeardownOutputSchema>;

export const fleetTeardownContract = defineContract({
  name: "fleet.teardown",
  description: "Teardown and archive all non-essential workers across the fleet",
  input: FleetTeardownInputSchema,
  output: FleetTeardownOutputSchema,
});
