import { PluginStorage, createPluginLogger } from "./vendor/paseo-plugin-helper/index";
import {
  SEED_COMMANDS,
  interpolateTemplate,
  slashSettingsContract,
  type CommandBundle,
  type SlashCommand,
  type SlashSettings,
} from "../shared/resources";
import { PLUGIN_VERSION as SLASH_PLUGIN_VERSION } from "../shared/version";

export const log = createPluginLogger("slash", { version: SLASH_PLUGIN_VERSION });

const DEFAULTS: SlashSettings = { prefix: "", commands: SEED_COMMANDS };

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

const SAFE_OPERATIONS: Record<string, (params: Record<string, unknown>) => unknown> = {
  "slash.ping": () => ({ ok: true, version: SLASH_PLUGIN_VERSION }),
  "slash.echo": (params) => ({ echo: params }),
};

export function allowedOperations(): string[] {
  return Object.keys(SAFE_OPERATIONS);
}

export async function handleRunCommand(input: { name: string; args: string }) {
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
  const handler = SAFE_OPERATIONS[command.action.operation];
  if (!handler) {
    throw new Error(`rpc operation not allowlisted: ${command.action.operation}`);
  }
  return { verb: "rpc" as const, result: handler(command.action.params ?? {}) };
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
