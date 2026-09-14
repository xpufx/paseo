import {
  defineContract,
  defineSettingsContract,
} from "./vendor/paseo-plugin-helper/index";
import { z } from "zod";

export const SLASH_VERSION = "0.1.0";

export const SUGGESTED_PREFIX = "xpufx-";

const namePattern = /^[a-z0-9][a-z0-9-]*$/;

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
  name: z.string().min(1).max(64).regex(namePattern),
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
  description: "Slash command repository and custom command facilities",
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
    description: "Open the slash output console",
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

export const listCommandsRpc = defineContract({
  name: "slash.commands.list",
  description: "List effective slash commands with prefix applied",
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
