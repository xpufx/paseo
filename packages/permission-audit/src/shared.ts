import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

export const PermissionDecisionSchema = z.enum(["pending", "allow", "deny"]);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

export const PermissionAuditEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  agentId: z.string().min(1),
  agentTitle: z.string().optional(),
  agentModel: z.string().optional(),
  agentProvider: z.string().optional(),
  agentMode: z.string().optional(),
  agentCwd: z.string().optional(),
  kind: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
  decision: PermissionDecisionSchema,
  updatedInput: z.unknown().optional(),
  denyReason: z.string().optional(),
});
export type PermissionAuditEntry = z.infer<typeof PermissionAuditEntrySchema>;

export const TOOL_CALL_RECORD_TYPE = "tool_call";

export const ToolCallOutcomeSchema = z.enum(["success", "failure", "canceled"]);
export type ToolCallOutcome = z.infer<typeof ToolCallOutcomeSchema>;

/**
 * A tool invocation captured from the `agent.turn_ended` timeline. Shares the
 * permission entry's attribution fields and is appended to the same JSONL log;
 * `recordType` discriminates the two on read.
 */
export const ToolCallAuditEntrySchema = z.object({
  recordType: z.literal(TOOL_CALL_RECORD_TYPE),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  turnId: z.string().optional(),
  /** Index of the item in the turn timeline; orders calls that share a timestamp. */
  sequence: z.number().int().nonnegative().optional(),
  agentId: z.string().min(1),
  agentTitle: z.string().optional(),
  agentModel: z.string().optional(),
  agentProvider: z.string().optional(),
  agentMode: z.string().optional(),
  agentCwd: z.string().optional(),
  kind: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
  outcome: ToolCallOutcomeSchema,
  error: z.unknown().optional(),
  result: z.unknown().optional(),
});
export type ToolCallAuditEntry = z.infer<typeof ToolCallAuditEntrySchema>;

export const AuditRecordSchema = z.union([
  ToolCallAuditEntrySchema,
  PermissionAuditEntrySchema,
]);
export type AuditRecord = z.infer<typeof AuditRecordSchema>;

export function isToolCallEntry(record: AuditRecord): record is ToolCallAuditEntry {
  return (record as { recordType?: unknown }).recordType === TOOL_CALL_RECORD_TYPE;
}

export function isPermissionEntry(record: AuditRecord): record is PermissionAuditEntry {
  return !isToolCallEntry(record);
}

/** Stable identity for dedupe: call ids and request ids share a namespace. */
export function auditRecordKey(record: AuditRecord): string {
  return `${isToolCallEntry(record) ? TOOL_CALL_RECORD_TYPE : "permission"}:${record.id}`;
}

export const AuditRecordTypeSchema = z.enum(["permission", TOOL_CALL_RECORD_TYPE]);
export type AuditRecordType = z.infer<typeof AuditRecordTypeSchema>;

export const PermissionQueryFilterSchema = z.object({
  agentId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  decision: PermissionDecisionSchema.optional(),
  outcome: ToolCallOutcomeSchema.optional(),
  recordType: AuditRecordTypeSchema.optional(),
  kind: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type PermissionQueryFilter = z.input<typeof PermissionQueryFilterSchema>;

const auditQueryOutput = z.object({
  entries: z.array(AuditRecordSchema),
  total: z.number().int().nonnegative(),
});

export const permissionAuditQuery = defineContract({
  name: "permission-audit.query",
  description: "Query logged permission decisions, filtered by agent, model, date range, or decision",
  input: PermissionQueryFilterSchema,
  output: auditQueryOutput,
});

export const permissionLoggerQuery = defineContract({
  name: "permission-logger.query",
  description: "Query logged permission decisions, filtered by agent, model, date range, or decision",
  input: PermissionQueryFilterSchema,
  output: auditQueryOutput,
});

export const PERMISSION_AUDIT_PLUGIN_ID = "permission-logger";
export const PERMISSION_AUDIT_FILENAME = "permissions.jsonl";

export interface PermissionLogPaths {
  primary: string;
  legacy: string;
}
