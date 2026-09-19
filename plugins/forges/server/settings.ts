import {
  PluginStorage,
  createPluginLogger,
  createSettingsHandlers,
} from "paseo-plugin-helper/server";
import {
  FORGES_PLUGIN_ID,
  activeForgeForDirectory,
  forgeSettingsContract,
  type ForgeSettings,
} from "../shared/issues.js";

export const log = createPluginLogger(FORGES_PLUGIN_ID);

export const forgeStorage = new PluginStorage<ForgeSettings>(
  FORGES_PLUGIN_ID,
  "settings.json",
  { schema: forgeSettingsContract.schema },
);

export const settingsHandlers = createSettingsHandlers(
  forgeSettingsContract,
  forgeStorage,
  {
    onUpdate: (newSettings) => {
      log.info("Forge settings updated via RPC:", newSettings);
    },
    onReset: () => {
      log.info("Forge settings reset to default values");
    },
  },
);

/**
 * Explicit forge target selected for a workspace directory, if any. Reflects
 * the per-workspace `activeForgeByDirectory` choice, falling back to the legacy
 * single remote override when no selection was ever made (issue #137).
 */
export async function storedForgeSelection(
  directory: string | undefined,
): Promise<string | undefined> {
  if (!directory) return undefined;
  const settings = await forgeStorage.readAsync();
  return activeForgeForDirectory(settings, directory) ?? undefined;
}

/** Daemon-side API token for a forge host. Never leaves the server. */
export async function tokenForHost(host: string): Promise<string | undefined> {
  const settings = await forgeStorage.readAsync();
  const token = settings.tokensByHost?.[host];
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}
