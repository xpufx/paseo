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
