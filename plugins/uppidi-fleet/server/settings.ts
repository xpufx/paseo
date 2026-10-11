import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PluginStorage,
  resolvePaseoHome,
  type PluginStorageOptions,
} from "paseo-plugin-helper/server";
import {
  uppidiFleetSettingsContract,
  type UppidiFleetSettings,
} from "../shared/contracts.js";

let settingsStorageInstance: PluginStorage<UppidiFleetSettings> | null = null;

/** True when running inside a test runner, test script, or test environment (#1238). */
export function isTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "test") return true;
  if (env.NODE_ENV === "production" || env.NODE_ENV === "development") return false;
  if (Boolean(env.TEST)) return true;
  if (env.npm_lifecycle_event?.includes("test")) return true;
  if (
    typeof process !== "undefined" &&
    Array.isArray(process.argv) &&
    process.argv.some((arg) => arg.includes(".test.") || arg.includes("--test"))
  ) {
    return true;
  }
  return false;
}

export function getUppidiFleetSettingsStorage(
  options?: PluginStorageOptions<UppidiFleetSettings>,
): PluginStorage<UppidiFleetSettings> {
  if (!settingsStorageInstance || options) {
    const testActive = isTestMode();
    const baseDir =
      options?.baseDir ??
      (testActive
        ? join(tmpdir(), `paseo-uppidi-fleet-test-${process.pid}`)
        : join(resolvePaseoHome(), "plugin-data", "xpufx"));
    const storage = new PluginStorage<UppidiFleetSettings>(
      "uppidi-fleet",
      "settings.json",
      {
        schema: uppidiFleetSettingsContract.schema,
        defaultData: uppidiFleetSettingsContract.defaultSettings,
        ...options,
        baseDir,
      },
    );
    if (!options && !testActive) {
      settingsStorageInstance = storage;
    }
    return storage;
  }
  return settingsStorageInstance;
}

export function resetUppidiFleetSettingsStorageInstance(): void {
  settingsStorageInstance = null;
}
