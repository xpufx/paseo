import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os, { tmpdir } from "node:os";
import { PluginStorage, type PluginStorageOptions } from "paseo-plugin-helper/server";
import {
  uppidiFleetSettingsContract,
  type UppidiFleetSettings,
} from "../shared/contracts.js";

export interface LegacyRouterConfig {
  host?: string;
  port?: number;
  enrolledRepos?: string[];
  mutedRepos?: string[];
  secret?: string;
}

export function getLegacyRouterConfig(customPath?: string): LegacyRouterConfig {
  if (process.env.NODE_ENV === "test" && !process.env.FORGE_HOOK_CONFIG && !customPath) {
    return {};
  }
  const home = process.env.HOME ?? os.homedir();
  const candidatePaths = customPath
    ? [customPath]
    : [
        process.env.FORGE_HOOK_CONFIG,
        join(home, ".config", "uppidi-fleet", "router-config.json"),
        join(home, ".config", "uppidi-forge", "router-config.json"),
      ].filter(Boolean) as string[];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return {
            host:
              typeof parsed.host === "string" && parsed.host.trim()
                ? parsed.host.trim()
                : undefined,
            port:
              typeof parsed.port === "number" && !isNaN(parsed.port)
                ? parsed.port
                : undefined,
            enrolledRepos: Array.isArray(parsed.enrolledRepos)
              ? parsed.enrolledRepos.filter((r: unknown) => typeof r === "string")
              : undefined,
            mutedRepos: Array.isArray(parsed.mutedRepos)
              ? parsed.mutedRepos.filter((r: unknown) => typeof r === "string")
              : undefined,
            secret:
              typeof parsed.secret === "string" ? parsed.secret : undefined,
          };
        }
      } catch {
        // ignore corrupted legacy config file
      }
    }
  }

  return {};
}

export function migrateLegacyConfigIfNeeded(
  storage: PluginStorage<UppidiFleetSettings>,
  customLegacyPath?: string,
): boolean {
  try {
    const fileExists = existsSync(storage.filePath);
    const legacy = getLegacyRouterConfig(customLegacyPath);
    const hasLegacy =
      legacy.host !== undefined ||
      legacy.port !== undefined ||
      legacy.enrolledRepos !== undefined ||
      legacy.mutedRepos !== undefined;

    if (!fileExists) {
      if (hasLegacy) {
        const initial: UppidiFleetSettings = {
          hookHost: legacy.host ?? "127.0.0.1",
          hookPort: legacy.port ?? 8099,
          density: "dense",
          enrolledRepos: legacy.enrolledRepos ?? [],
          mutedRepos: legacy.mutedRepos ?? [],
        };
        storage.write(initial);
        return true;
      }
      return false;
    }

    // File exists, check if hookHost or hookPort or repo lists are missing in the existing json
    const rawContent = readFileSync(storage.filePath, "utf8");
    const parsed = JSON.parse(rawContent);
    const patch: Partial<UppidiFleetSettings> = {};

    if (parsed.hookHost === undefined && legacy.host) {
      patch.hookHost = legacy.host;
    }
    if (parsed.hookPort === undefined && legacy.port) {
      patch.hookPort = legacy.port;
    }
    if (parsed.enrolledRepos === undefined && legacy.enrolledRepos) {
      patch.enrolledRepos = legacy.enrolledRepos;
    }
    if (parsed.mutedRepos === undefined && legacy.mutedRepos) {
      patch.mutedRepos = legacy.mutedRepos;
    }

    if (Object.keys(patch).length > 0) {
      storage.update((prev) => ({ ...prev, ...patch }));
      return true;
    }
  } catch {
    // ignore migration errors
  }

  return false;
}

let settingsStorageInstance: PluginStorage<UppidiFleetSettings> | null = null;

export function getUppidiFleetSettingsStorage(
  options?: PluginStorageOptions<UppidiFleetSettings>,
): PluginStorage<UppidiFleetSettings> {
  if (!settingsStorageInstance || options) {
    const isTestMode = process.env.NODE_ENV === "test" && !process.env.FORGE_HOOK_CONFIG;
    const baseDir =
      options?.baseDir ??
      (isTestMode ? join(tmpdir(), `paseo-uppidi-fleet-test-${process.pid}`) : undefined);
    const storage = new PluginStorage<UppidiFleetSettings>(
      "uppidi-fleet",
      "settings.json",
      {
        schema: uppidiFleetSettingsContract.schema,
        defaultData: uppidiFleetSettingsContract.defaultSettings,
        ...options,
        ...(baseDir ? { baseDir } : {}),
      },
    );
    migrateLegacyConfigIfNeeded(storage);
    if (!options && !isTestMode) {
      settingsStorageInstance = storage;
    }
    return storage;
  }
  return settingsStorageInstance;
}

export function resetUppidiFleetSettingsStorageInstance(): void {
  settingsStorageInstance = null;
}
