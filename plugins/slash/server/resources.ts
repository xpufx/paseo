import { PluginStorage, createPluginLogger } from "paseo-plugin-helper/server";
import {
  KNOWN_OPEN_TARGETS,
  SEED_COMMANDS,
  interpolateTemplate,
  slashSettingsContract,
  type CommandBundle,
  type SlashCommand,
  type SlashSettings,
} from "../shared/resources";
import { PLUGIN_VERSION as SLASH_PLUGIN_VERSION } from "../shared/version";
import { orchestrateHandover } from "./orchestrate";

export const log = createPluginLogger("slash", { version: SLASH_PLUGIN_VERSION });

const DEFAULTS: SlashSettings = { prefix: "slash-", commands: SEED_COMMANDS };

const settingsStorage = new PluginStorage<SlashSettings>("slash", "settings.json", {
  schema: slashSettingsContract.schema,
});

async function readSettings(): Promise<SlashSettings> {
  const data = await settingsStorage.readAsync();
  if (!data.commands || data.commands.length === 0) {
    return { ...data, commands: SEED_COMMANDS };
  }
  return data;
}

export async function handleGetSettings(): Promise<SlashSettings> {
  return readSettings();
}

export async function handleUpdateSettings(patch: Partial<SlashSettings>): Promise<SlashSettings> {
  if (patch.prefix !== undefined && !/^[a-z0-9-]*$/.test(patch.prefix)) {
    throw new Error("prefix may only contain lowercase letters, digits, and dashes");
  }
  return settingsStorage.updateAsync((prev) => ({ ...prev, ...patch }));
}

export async function handleResetSettings(): Promise<SlashSettings> {
  settingsStorage.reset();
  return DEFAULTS;
}

export async function handleListCommands(): Promise<{ commands: SlashCommand[] }> {
  const settings = await readSettings();
  return { commands: settings.commands.filter((c) => c.enabled) };
}

export function handleListCatalog(): { commands: SlashCommand[] } {
  return { commands: SEED_COMMANDS };
}

export function handleListOperations(): { rpc: string[]; open: string[] } {
  return { rpc: allowedOperations(), open: [...KNOWN_OPEN_TARGETS] };
}

export interface OperationContext {
  agentId?: string;
}

type OperationHandler = (params: Record<string, unknown>, context: OperationContext) => unknown;

const SAFE_OPERATIONS: Record<string, OperationHandler> = {
  "slash.ping": () => ({ ok: true, version: SLASH_PLUGIN_VERSION }),
  "slash.echo": (params) => ({ echo: params }),
  "slash.orchestrate": (_params, context) => {
    if (!context.agentId) throw new Error("orchestrate requires a caller agent id");
    return orchestrateHandover(context.agentId);
  },
};

export function allowedOperations(): string[] {
  return Object.keys(SAFE_OPERATIONS);
}

export async function runOperation(
  operation: string,
  params: Record<string, unknown>,
  context: OperationContext = {},
): Promise<unknown> {
  const handler = SAFE_OPERATIONS[operation];
  if (!handler) {
    throw new Error(`rpc operation not allowlisted: ${operation}`);
  }
  return handler(params, context);
}

export async function handleRunCommand(input: { name: string; args: string; agentId?: string }) {
  const settings = await readSettings();
  const command = settings.commands.find((c) => c.enabled && c.name === input.name);
  if (!command) {
    throw new Error(`unknown or disabled command: ${input.name}`);
  }
  if (command.action.verb === "send") {
    return { verb: "send" as const, prompt: interpolateTemplate(command.action.template, input.args) };
  }
  if (command.action.verb === "open") {
    return { verb: "open" as const, target: command.action.target };
  }
  const result = await runOperation(command.action.operation, command.action.params ?? {}, {
    agentId: input.agentId,
  });
  return { verb: "rpc" as const, result };
}

export async function handleExportBundle(): Promise<{ bundle: CommandBundle }> {
  const settings = await readSettings();
  return {
    bundle: {
      bundle: "slash-commands",
      version: 1,
      commands: settings.commands.filter((c) => c.enabled),
    },
  };
}

export async function handleImportBundle(input: {
  bundle: CommandBundle;
  overwrite: boolean;
}): Promise<{ commands: SlashCommand[] }> {
  const settings = await readSettings();
  const existing = new Map(settings.commands.map((c) => [c.name, c]));
  for (const incoming of input.bundle.commands) {
    if (existing.has(incoming.name) && !input.overwrite) continue;
    existing.set(incoming.name, incoming);
  }
  const commands = [...existing.values()];
  await settingsStorage.updateAsync((prev) => ({ ...prev, commands }));
  return { commands };
}
