import { z } from "zod";
import { defineContract, defineSettingsContract } from "paseo-plugin-helper/shared";

export const notificationTargets = ["telegram", "paseo", "both"] as const;
export type NotificationTarget = (typeof notificationTargets)[number];

/**
 * One selectable answer on an `ask` petition. 2fado stores options as plain
 * strings; the server assigns `id` (the option's 0-based index) when mapping
 * so the client can round-trip an identity without trusting array position.
 */
export const approvalOption = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type ApprovalOption = z.infer<typeof approvalOption>;

/** Ask-petition fields shared by list, recent, and status payloads. */
const askFields = {
  question: z.string().optional(),
  options: z.array(approvalOption).optional(),
  multiSelect: z.boolean().optional(),
  allowWriteIn: z.boolean().optional(),
  recommendedIndex: z.number().int().optional(),
  selection: z.string().optional(),
  selectionIdx: z.number().int().optional(),
};

export function isAskPetition(kind: string | undefined): boolean {
  return kind === "ask";
}

export function isNotifyPetition(kind: string | undefined): boolean {
  return kind === "notify";
}

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
        ...askFields,
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

/**
 * Submit an answer to an `ask` petition. Mirrors 2fado's first-selection-wins
 * `SelectionRecord` (verbatim `selection` label + 0-based `selectionIdx`).
 *
 * A write-in carries the operator's free text in `selection` with no index;
 * a multi-select joins the chosen labels with ", " (2fado's runtime is
 * single-select today — see `docs/backend-api.md` in the 2fado repository).
 */
export const approvalSelect = defineContract({
  name: "approval.select",
  input: z.object({
    id: z.string().min(1),
    selection: z.string().min(1),
    selectionIdx: z.number().int().min(0).optional(),
    writeIn: z.boolean().optional(),
    socketPath: z.string().min(1).optional(),
  }),
  output: z.object({
    selected: z.boolean(),
    error: z.string().optional(),
  }),
  description: "Submit an ask-petition option selection or write-in answer",
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
        ...askFields,
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
      "selected",
      "cancelled",
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
    ...askFields,
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
    ops: z.array(z.string()).default([]),
    // Omitted (undefined) when the op list could not be enumerated: the client
    // must not warn about a missing `select` op on an unprobed daemon.
    supportsSelect: z.boolean().optional(),
  }),
  description: "Probe 2fadod reachability and advertised socket ops",
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
