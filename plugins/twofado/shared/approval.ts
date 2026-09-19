import { z } from "zod";
import { defineContract, defineSettingsContract } from "paseo-plugin-helper/shared";

export const notificationTargets = ["telegram", "paseo", "both"] as const;
export type NotificationTarget = (typeof notificationTargets)[number];

export const pendingList = defineContract({
  name: "approval.list",
  input: z.object({ socketPath: z.string().min(1).optional() }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        argv: z.array(z.string()),
        host: z.string(),
        caller: z.string(),
        cwd: z.string(),
        expiresIn: z.number(),
        step: z.enum(["initial", "confirm"]).default("initial"),
        confirmOf: z.string().optional(),
        kind: z.string().optional(),
        link: z.string().optional(),
        summary: z.string().optional(),
        acked: z.boolean().optional(),
        ackBy: z.string().optional(),
        authUrl: z.string().optional(),
        preview: z
          .object({
            resolvedBinary: z.string().optional(),
            targetCwd: z.string().optional(),
            affectedCount: z.number().optional(),
            samplePaths: z.array(z.string()).optional(),
            riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
            riskReason: z.string().optional(),
          })
          .optional(),
      }),
    ),
  }),
  description: "List unexpired, undecided 2fado requests",
});

export const verdict = defineContract({
  name: "approval.verdict",
  input: z.object({
    id: z.string(),
    decision: z.enum(["approve", "deny"]),
    socketPath: z.string().min(1).optional(),
  }),
  output: z.object({ recorded: z.boolean() }),
  description: "Record an approve/deny verdict for a 2fado request",
});

export const approvalAck = defineContract({
  name: "approval.ack",
  input: z.object({
    id: z.string().min(1),
    socketPath: z.string().min(1).optional(),
  }),
  output: z.object({ acked: z.boolean() }),
  description: "Acknowledge a notify-only 2fado petition (non-binding visibility signal)",
});

export const recentList = defineContract({
  name: "approval.recent",
  input: z.object({
    socketPath: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        argv: z.array(z.string()),
        cwd: z.string(),
        decision: z.string(),
        by: z.string(),
        exit: z.number(),
        output: z.string(),
        step: z.enum(["initial", "confirm"]).optional(),
        confirmOf: z.string().optional(),
        kind: z.string().optional(),
        link: z.string().optional(),
        summary: z.string().optional(),
        acked: z.boolean().optional(),
        ackBy: z.string().optional(),
        authUrl: z.string().optional(),
      }),
    ),
  }),
  description: "List recently decided 2fado requests with execution results",
});

export const approvalStatus = defineContract({
  name: "approval.status",
  input: z.object({
    id: z.string().min(1),
    socketPath: z.string().min(1).optional(),
  }),
  output: z.object({
    id: z.string(),
    status: z.enum([
      "not_found",
      "pending",
      "confirming",
      "running",
      "completed",
      "denied",
      "timeout",
      "client_aborted",
      "confirmation_timeout",
      "acked",
    ]),
    argv: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    expiresIn: z.number().optional(),
    decision: z.string().optional(),
    by: z.string().optional(),
    exit: z.number(),
    output: z.string().optional(),
    step: z.string().optional(),
    confirmOf: z.string().optional(),
    kind: z.string().optional(),
    link: z.string().optional(),
    summary: z.string().optional(),
    acked: z.boolean().optional(),
    ackBy: z.string().optional(),
    ackAt: z.number().optional(),
    authUrl: z.string().optional(),
  }),
  description: "Query status and execution outcome of a 2fado request by ID",
});

export const approvalTelegramInfo = defineContract({
  name: "approval.telegram_info",
  input: z.object({
    socketPath: z.string().min(1).optional(),
  }),
  output: z.object({
    configured: z.boolean(),
    botUsername: z.string().optional(),
    chatId: z.string().optional(),
    approvers: z.array(z.string()).default([]),
    status: z.enum(["connected", "disconnected", "unconfigured", "error"]).default("unconfigured"),
    error: z.string().optional(),
    notificationTarget: z.enum(notificationTargets).default("both"),
  }),
  description: "Query Telegram bot connectivity status and recipient metadata",
});

export const approvalTelegramSetConfig = defineContract({
  name: "approval.telegram_set_config",
  input: z.object({
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    approvers: z.array(z.string()).optional(),
    notificationTarget: z.enum(notificationTargets).optional(),
    socketPath: z.string().min(1).optional(),
  }),
  output: z.object({
    success: z.boolean(),
    botUsername: z.string().optional(),
    error: z.string().optional(),
  }),
  description: "Send updated Telegram recipient credentials to 2fadod",
});

export const daemonHealth = defineContract({
  name: "approval.health",
  input: z.object({ socketPath: z.string().min(1).optional() }),
  output: z.object({
    reachable: z.boolean(),
    version: z.string().optional(),
    pid: z.number().optional(),
  }),
  description: "Probe 2fadod reachability via version handshake",
});

export interface PolicyAddRuleParams {
  target: "whitelist" | "blacklist";
  match_type: "exact" | "base" | "custom";
  pattern: string[];
  socketPath?: string;
}
export interface PolicyAddRuleResult {
  success: boolean;
  error?: string;
  rules_count?: number;
}

export const policyAddRule = defineContract({
  name: "approval.policy_add_rule",
  input: z.object({
    target: z.enum(["whitelist", "blacklist"]),
    match_type: z.enum(["exact", "base", "custom"]),
    pattern: z.array(z.string()),
    socketPath: z.string().min(1).optional(),
  }),
  output: z.object({
    success: z.boolean(),
    error: z.string().optional(),
    rules_count: z.number().optional(),
  }),
  description: "Persist a policy rule derived from an approval item",
});

export type ApprovalApi = {
  policyAddRule(params: PolicyAddRuleParams): Promise<PolicyAddRuleResult>;
};

export function migrateLegacyNotificationTarget(input: unknown): {
  data: Record<string, unknown>;
  changed: boolean;
} {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { data: {}, changed: false };
  }
  const record = input as Record<string, unknown>;
  if (!("telegramFallback" in record)) {
    return { data: record, changed: false };
  }
  const { telegramFallback, notificationTarget, ...rest } = record;
  if (notificationTarget !== undefined) {
    return { data: { ...rest, notificationTarget }, changed: true };
  }
  return {
    data: { ...rest, notificationTarget: telegramFallback === false ? "paseo" : "both" },
    changed: true,
  };
}

const settingsSchema = z.object({
  socketPath: z
    .string()
    .trim()
    .min(1, "Enter the 2fadod socket path")
    .default("/tmp/2fado.sock")
    .describe("2fadod socket"),
  notificationTarget: z
    .enum(notificationTargets)
    .default("both")
    .describe("Notification target"),
  telegramBotToken: z.string().default("").describe("Telegram bot token"),
  telegramChatId: z.string().default("").describe("Telegram chat ID"),
  telegramApprovers: z.string().default("").describe("Telegram approvers"),
});

export type ApprovalSettingsValues = z.output<typeof settingsSchema>;

export const approvalSettings = defineSettingsContract<ApprovalSettingsValues>({
  name: "twofado.settings",
  schema: settingsSchema,
  description: "2fado approval settings",
});
