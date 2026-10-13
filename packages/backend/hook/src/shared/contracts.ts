import { z } from "zod";

// ── NormalizedEvent schema ───────────────────────────────────────────

export const NormalizedEventSchema = z.object({
  id: z.string(),
  forge: z.enum(["forgejo", "gitea", "github", "gitlab"]),
  action: z.string(),
  repository: z.string(),
  ref: z.string().optional(),
  commits: z.array(z.string()).optional(),
  issueNumber: z.number().int().optional(),
  pullRequestNumber: z.number().int().optional(),
  sender: z.string(),
  timestamp: z.string(),
  raw: z.record(z.string(), z.unknown()),
});

export type NormalizedEventInput = z.infer<typeof NormalizedEventSchema>;
export type NormalizedEventOutput = z.infer<typeof NormalizedEventSchema>;

// ── Signature validation schemas ─────────────────────────────────────

export const SignatureHeaderSchema = z.object({
  value: z.string(),
  name: z.string(),
});

export const ValidateSignatureParamsSchema = z.object({
  payload: z.string(),
  secretOrToken: z.string(),
  header: SignatureHeaderSchema.optional(),
  provider: z.enum(["forgejo", "github", "gitlab"]).optional(),
});

// ── Queue model schemas ──────────────────────────────────────────────

export const QueuedHookEventSchema = NormalizedEventSchema.extend({
  seq: z.number().int(),
  enqueuedAt: z.number(),
  retries: z.number().int(),
} as const);

export const QueueStatsSchema = z.object({
  pending: z.number().int(),
  processing: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
});

export const QueueStateSchema = z.enum(["idle", "paused", "processing"]);
