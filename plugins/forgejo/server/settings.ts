import {
  PluginStorage,
  createPluginLogger,
  createSettingsHandlers,
} from "./vendor/paseo-plugin-helper/index.ts";
import {
  FORGEJO_PLUGIN_ID,
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

/** Explicit remote URL pinned for a workspace directory, if any. */
export async function storedRemoteForDirectory(
  directory: string | undefined,
): Promise<string | undefined> {
  if (!directory) return undefined;
  const settings = await forgejoStorage.readAsync();
  const pinned = settings.remotesByDirectory?.[directory];
  return typeof pinned === "string" && pinned.trim() ? pinned.trim() : undefined;
}
