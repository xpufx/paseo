import {
  PluginStorage,
  createPluginLogger,
  createSettingsHandlers,
} from "./vendor/paseo-plugin-helper/index.ts";
import {
  FORGEJO_PLUGIN_ID,
  activeForgeForDirectory,
  forgejoSettingsContract,
  type ForgejoSettings,
} from "../shared/issues.js";

export const log = createPluginLogger(FORGEJO_PLUGIN_ID);

export const forgejoStorage = new PluginStorage<ForgejoSettings>(
  FORGEJO_PLUGIN_ID,
  "settings.json",
  { schema: forgejoSettingsContract.schema },
);

export const settingsHandlers = createSettingsHandlers(
  forgejoSettingsContract,
  forgejoStorage,
  {
    onUpdate: (newSettings) => {
      log.info("Forgejo settings updated via RPC:", newSettings);
    },
    onReset: () => {
      log.info("Forgejo settings reset to default values");
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
  const settings = await forgejoStorage.readAsync();
  return activeForgeForDirectory(settings, directory) ?? undefined;
}

/** Daemon-side API token for a Forgejo host. Never leaves the server. */
export async function tokenForHost(host: string): Promise<string | undefined> {
  const settings = await forgejoStorage.readAsync();
  const token = settings.tokensByHost?.[host];
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}
