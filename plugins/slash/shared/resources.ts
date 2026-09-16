import {
  defineContract,
  defineSettingsContract,
} from "./vendor/paseo-plugin-helper/index";
import { z } from "zod";

export const SLASH_VERSION = "0.1.0";

export const SUGGESTED_PREFIX = "xpufx-";

export const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const COMMAND_NAME_HINT =
  "Lowercase letters, digits, and dashes; must start with a letter or digit.";

export const SendActionSchema = z.object({
  verb: z.literal("send"),
  template: z.string().min(1).max(8000),
});
export type SendAction = z.infer<typeof SendActionSchema>;

export const OpenActionSchema = z.object({
  verb: z.literal("open"),
  target: z.string().min(1).max(200),
});
export type OpenAction = z.infer<typeof OpenActionSchema>;

export const RpcActionSchema = z.object({
  verb: z.literal("rpc"),
  operation: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type RpcAction = z.infer<typeof RpcActionSchema>;

export const SlashActionSchema = z.discriminatedUnion("verb", [
  SendActionSchema,
  OpenActionSchema,
  RpcActionSchema,
]);
export type SlashAction = z.infer<typeof SlashActionSchema>;

export const SlashCommandSchema = z.object({
  name: z.string().min(1).max(64).regex(COMMAND_NAME_PATTERN),
  title: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  enabled: z.boolean().default(true),
  action: SlashActionSchema,
});
export type SlashCommand = z.infer<typeof SlashCommandSchema>;

export const SlashSettingsSchema = z.object({
  prefix: z.string().max(32).default(""),
  commands: z.array(SlashCommandSchema).default([]),
});
export type SlashSettings = z.infer<typeof SlashSettingsSchema>;

export const slashSettingsContract = defineSettingsContract({
  name: "slash.settings",
  schema: SlashSettingsSchema,
  description: "S/ash command repository and custom command facilities",
});

export const CommandBundleSchema = z.object({
  bundle: z.literal("slash-commands"),
  version: z.literal(1),
  commands: z.array(SlashCommandSchema).min(1).max(200),
});
export type CommandBundle = z.infer<typeof CommandBundleSchema>;

export function interpolateTemplate(template: string, args: string): string {
  return template.includes("{args}")
    ? template.replaceAll("{args}", args)
    : args
      ? `${template} ${args}`
      : template;
}

export function withPrefix(prefix: string, name: string): string {
  return prefix ? `${prefix}${name}` : name;
}

export const SEED_COMMANDS: SlashCommand[] = [
  {
    name: "review",
    title: "Review",
    description: "Send a code-review prompt for the current diff",
    enabled: true,
    action: { verb: "send", template: "Review the current changes: {args}" },
  },
  {
    name: "console",
    title: "Console",
    description: "Open the S/ash output console",
    enabled: true,
    action: { verb: "open", target: "slash-console" },
  },
  {
    name: "ping",
    title: "Ping",
    description: "Safe no-op backend operation proving the rpc verb",
    enabled: true,
    action: { verb: "rpc", operation: "slash.ping", params: {} },
  },
];

export type SlashVerb = SlashAction["verb"];

export interface SlashCommandDraft {
  name: string;
  title: string;
  description: string;
  enabled: boolean;
  verb: SlashVerb;
  template: string;
  target: string;
  operation: string;
}

export type CommandDraftErrorField = "name" | "title" | "description" | "action";
export type CommandDraftErrors = Partial<Record<CommandDraftErrorField, string>>;

export function emptyCommandDraft(): SlashCommandDraft {
  return {
    name: "",
    title: "",
    description: "",
    enabled: true,
    verb: "send",
    template: "",
    target: "",
    operation: "",
  };
}

export function draftFromCommand(command: SlashCommand): SlashCommandDraft {
  const draft: SlashCommandDraft = {
    ...emptyCommandDraft(),
    name: command.name,
    title: command.title,
    description: command.description,
    enabled: command.enabled,
    verb: command.action.verb,
  };
  if (command.action.verb === "send") draft.template = command.action.template;
  else if (command.action.verb === "open") draft.target = command.action.target;
  else draft.operation = command.action.operation;
  return draft;
}

export function commandFromDraft(draft: SlashCommandDraft): SlashCommand {
  const base = {
    name: draft.name.trim(),
    title: draft.title.trim(),
    description: draft.description,
    enabled: draft.enabled,
  };
  if (draft.verb === "send") return { ...base, action: { verb: "send", template: draft.template } };
  if (draft.verb === "open") return { ...base, action: { verb: "open", target: draft.target } };
  return { ...base, action: { verb: "rpc", operation: draft.operation, params: {} } };
}

export function validateCommandDraft(
  draft: SlashCommandDraft,
  takenNames: readonly string[] = [],
): { errors: CommandDraftErrors; command?: SlashCommand } {
  const parsed = SlashCommandSchema.safeParse(commandFromDraft(draft));
  if (!parsed.success) {
    const errors: CommandDraftErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "name" || key === "title" || key === "description") {
        errors[key] ??= issue.message;
      } else if (key === "action") {
        errors.action ??= issue.message;
      }
    }
    return { errors };
  }
  if (takenNames.includes(parsed.data.name)) {
    return { errors: { name: "A command with this name already exists" } };
  }
  return { errors: {}, command: parsed.data };
}

export function upsertCommand(
  commands: readonly SlashCommand[],
  originalName: string | null,
  next: SlashCommand,
): SlashCommand[] {
  if (originalName === null) return [...commands, next];
  return commands.map((command) => (command.name === originalName ? next : command));
}

export function removeCommandByName(commands: readonly SlashCommand[], name: string): SlashCommand[] {
  return commands.filter((command) => command.name !== name);
}

export function missingCatalogCommands(
  commands: readonly SlashCommand[],
  catalog: readonly SlashCommand[],
): SlashCommand[] {
  const present = new Set(commands.map((command) => command.name));
  return catalog.filter((command) => !present.has(command.name));
}

export function actionSummary(action: SlashAction): string {
  if (action.verb === "send") return "send";
  if (action.verb === "open") return `open → ${action.target}`;
  return `rpc → ${action.operation}`;
}

export const listCommandsRpc = defineContract({
  name: "slash.commands.list",
  description: "List effective slash commands with prefix applied",
  input: z.object({}).default({}),
  output: z.object({ commands: z.array(SlashCommandSchema) }),
});

export const catalogRpc = defineContract({
  name: "slash.catalog.list",
  description: "List the shipped seed command catalog without touching settings",
  input: z.object({}).default({}),
  output: z.object({ commands: z.array(SlashCommandSchema) }),
});

export const runCommandRpc = defineContract({
  name: "slash.commands.run",
  description: "Run one slash command by name; send/open resolve client-side, rpc runs here",
  input: z.object({ name: z.string(), args: z.string().default("") }),
  output: z.object({
    verb: z.enum(["send", "open", "rpc"]),
    prompt: z.string().optional(),
    target: z.string().optional(),
    result: z.unknown().optional(),
  }),
});

export const exportBundleRpc = defineContract({
  name: "slash.bundle.export",
  description: "Export enabled commands as a shareable bundle document",
  input: z.object({}).default({}),
  output: z.object({ bundle: CommandBundleSchema }),
});

export const importBundleRpc = defineContract({
  name: "slash.bundle.import",
  description: "Validate and merge a shared command bundle into settings",
  input: z.object({ bundle: CommandBundleSchema, overwrite: z.boolean().default(false) }),
  output: z.object({ commands: z.array(SlashCommandSchema) }),
});
