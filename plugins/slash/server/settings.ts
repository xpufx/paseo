import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginStorage, type PluginStorageOptions } from "paseo-plugin-helper/server";
import {
  SEED_COMMANDS,
  SEED_OPERATION_BINDINGS,
  slashSettingsContract,
  type SlashSettings,
} from "../shared/resources";

export const DEFAULT_SLASH_SETTINGS: SlashSettings = {
  prefix: "slash-",
  commands: SEED_COMMANDS,
  operationBindings: SEED_OPERATION_BINDINGS,
  hookUrl: "",
  hookSecretFile: "",
};

let settingsStorageInstance: PluginStorage<SlashSettings> | null = null;

/**
 * Slash settings storage. Under NODE_ENV=test (and no explicit baseDir) it is
 * isolated to a per-process temp namespace so daemon settings are never read or
 * written by unit tests — mirroring the uppidi-fleet settings factory.
 */
export function getSlashSettingsStorage(
  options?: PluginStorageOptions<SlashSettings>,
): PluginStorage<SlashSettings> {
  if (!settingsStorageInstance || options) {
    const isTestMode = process.env.NODE_ENV === "test" && !options?.baseDir;
    const baseDir =
      options?.baseDir ??
      (isTestMode ? join(tmpdir(), `paseo-slash-test-${process.pid}`) : undefined);
    const storage = new PluginStorage<SlashSettings>("slash", "settings.json", {
      schema: slashSettingsContract.schema,
      defaultData: DEFAULT_SLASH_SETTINGS,
      ...options,
      ...(baseDir ? { baseDir } : {}),
    });
    if (!options && !isTestMode) {
      settingsStorageInstance = storage;
    }
    return storage;
  }
  return settingsStorageInstance;
}

export function resetSlashSettingsStorageInstance(): void {
  settingsStorageInstance = null;
}
