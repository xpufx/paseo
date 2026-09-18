import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

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

export const HookFrontDeskSchema = z
  .object({
    version: z.number().optional(),
    agentId: z.string().nullable().optional(),
    updatedAt: z.string().optional(),
    by: z.string().optional(),
  })
  .nullable()
  .optional();
export type HookFrontDesk = z.infer<typeof HookFrontDeskSchema>;

export const HookStatusOutputSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
  version: z.number().optional(),
  uptime: z.number().optional(),
  frontDesk: HookFrontDeskSchema,
  paused: z.array(z.string()).default([]),
  totalQueued: z.number().default(0),
  repoCount: z.number().default(0),
  error: z.string().optional(),
});
export type HookStatusOutput = z.infer<typeof HookStatusOutputSchema>;

export const HookQueuesOutputSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
  version: z.number().optional(),
  uptime: z.number().optional(),
  frontDesk: HookFrontDeskSchema,
  paused: z.array(z.string()).default([]),
  queues: z.array(HookQueueItemSchema).default([]),
  error: z.string().optional(),
});
export type HookQueuesOutput = z.infer<typeof HookQueuesOutputSchema>;

export const HookPauseInputSchema = z.object({
  hookUrl: z.string().optional(),
  repo: z.string().optional(),
});
export type HookPauseInput = z.infer<typeof HookPauseInputSchema>;

export const HookPauseOutputSchema = z.object({
  ok: z.boolean(),
  paused: z.string().optional(),
  allPaused: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type HookPauseOutput = z.infer<typeof HookPauseOutputSchema>;

export const HookResumeInputSchema = z.object({
  hookUrl: z.string().optional(),
  repo: z.string().optional(),
});
export type HookResumeInput = z.infer<typeof HookResumeInputSchema>;

export const HookResumeOutputSchema = z.object({
  ok: z.boolean(),
  resumed: z.string().optional(),
  allPaused: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type HookResumeOutput = z.infer<typeof HookResumeOutputSchema>;

export const HookDrainInputSchema = z.object({
  hookUrl: z.string().optional(),
  repo: z.string().optional(),
});
export type HookDrainInput = z.infer<typeof HookDrainInputSchema>;

export const HookDrainOutputSchema = z.object({
  ok: z.boolean(),
  draining: z.string().optional(),
  error: z.string().optional(),
});
export type HookDrainOutput = z.infer<typeof HookDrainOutputSchema>;

export const hookStatusContract = defineContract({
  name: "forge.hook-status",
  description: "Read overall status and front desk registration from the forgejo-hook daemon",
  input: z.object({ hookUrl: z.string().optional() }),
  output: HookStatusOutputSchema,
});

export const hookQueuesContract = defineContract({
  name: "forge.hook-queues",
  description: "Read all repo queues, depths, orchestrators, and messages from the forgejo-hook daemon",
  input: z.object({ hookUrl: z.string().optional() }),
  output: HookQueuesOutputSchema,
});

export const hookPauseContract = defineContract({
  name: "forge.hook-pause",
  description: "Pause queue delivery for a specific repo or all repos",
  input: HookPauseInputSchema,
  output: HookPauseOutputSchema,
});

export const hookResumeContract = defineContract({
  name: "forge.hook-resume",
  description: "Resume queue delivery for a specific repo or all repos",
  input: HookResumeInputSchema,
  output: HookResumeOutputSchema,
});

export const hookDrainContract = defineContract({
  name: "forge.hook-drain",
  description: "Force immediate queue drain for a specific repo or all repos",
  input: HookDrainInputSchema,
  output: HookDrainOutputSchema,
});
