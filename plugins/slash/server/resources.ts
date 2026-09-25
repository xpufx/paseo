import { createPluginLogger } from "paseo-plugin-helper/server";
import {
  KNOWN_OPEN_TARGETS,
  SEED_COMMANDS,
  mergeOperationBindings,
  interpolateTemplate,
  type CommandBundle,
  type RpcOperationBinding,
  type SlashCommand,
  type SlashSettings,
} from "../shared/resources";
import { PLUGIN_VERSION as SLASH_PLUGIN_VERSION } from "../shared/version";
import { orchestrateHandover } from "./orchestrate";
import { DEFAULT_SLASH_SETTINGS, getSlashSettingsStorage } from "./settings";

export const log = createPluginLogger("slash", { version: SLASH_PLUGIN_VERSION });

const DEFAULTS: SlashSettings = DEFAULT_SLASH_SETTINGS;

const settingsStorage = getSlashSettingsStorage();

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

export async function handleListOperations(): Promise<{ rpc: string[]; open: string[] }> {
  return { rpc: await allowedOperations(), open: [...KNOWN_OPEN_TARGETS] };
}

export interface OperationContext {
  agentId?: string;
}

/** A primitive is a built-in code handler; operation bindings are the data that name it. */
type OperationPrimitive = (
  params: Record<string, unknown>,
  context: OperationContext,
  target?: string,
) => unknown;

const PRIMITIVES: Record<string, OperationPrimitive> = {
  "slash.ping": () => ({ ok: true, version: SLASH_PLUGIN_VERSION }),
  "slash.echo": (params) => ({ echo: params }),
  "slash.orchestrate": (_params, context, target) => {
    if (!context.agentId) throw new Error("orchestrate requires a caller agent id");
    return orchestrateHandover(context.agentId, target);
  },
};

/** Bindings = seed defaults merged with the user's settings additions/overrides. */
async function resolveOperationBindings(): Promise<RpcOperationBinding[]> {
  const settings = await readSettings();
  return mergeOperationBindings(settings.operationBindings);
}

export async function allowedOperations(): Promise<string[]> {
  return (await resolveOperationBindings()).map((binding) => binding.name);
}

export async function runOperation(
  operation: string,
  params: Record<string, unknown>,
  context: OperationContext = {},
): Promise<unknown> {
  const binding = (await resolveOperationBindings()).find((entry) => entry.name === operation);
  if (!binding) {
    throw new Error(`rpc operation not allowlisted: ${operation}`);
  }
  const primitive = PRIMITIVES[binding.primitive];
  if (!primitive) {
    throw new Error(`rpc operation binding "${operation}" references unknown primitive: ${binding.primitive}`);
  }
  return primitive({ ...binding.params, ...params }, context, binding.target);
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
