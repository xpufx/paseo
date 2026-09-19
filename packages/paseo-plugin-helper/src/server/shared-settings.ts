import fs from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";
import { defineSettingsContract, type SettingsContract } from "../shared/settings.js";
import { PluginStorage } from "./storage.js";
import {
  createSettingsHandlers,
  registerSettingsRpc,
  type HandleableServerContext,
  type RegisterSettingsRpcOptions,
} from "./settings.js";

export interface SharedPluginSettingsOptions<TSettings extends Record<string, any>> {
  suite: string;
  filename?: string;
  schema: ZodType<TSettings> & { partial?: () => ZodType<Partial<TSettings>> };
  defaultData?: Partial<TSettings>;
  contract?: SettingsContract<TSettings>;
  contractName?: string;
  description?: string;
  namespace?: string;
  baseDir?: string;
  watchDebounceMs?: number;
}

export type SharedSettingsListener<TSettings> = (settings: TSettings) => void;

export interface SharedPluginSettings<TSettings extends Record<string, any>> {
  readonly suite: string;
  readonly contract: SettingsContract<TSettings>;
  readonly storage: PluginStorage<TSettings>;
  readonly filePath: string;
  get(): Promise<TSettings>;
  update(patch: Partial<TSettings>): Promise<TSettings>;
  reset(): Promise<TSettings>;
  read(): TSettings;
  reload(): TSettings;
  subscribe(listener: SharedSettingsListener<TSettings>): () => void;
  watch(listener: SharedSettingsListener<TSettings>): () => void;
  register(
    context: HandleableServerContext,
    options?: RegisterSettingsRpcOptions<TSettings>,
  ): void;
  createHandlers(options?: RegisterSettingsRpcOptions<TSettings>): {
    get: () => Promise<TSettings>;
    update: (input: unknown) => Promise<TSettings>;
    reset: () => Promise<TSettings>;
  };
  dispose(): void;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Creates a suite-scoped settings store shared across independent sibling plugins.
 * Every plugin in the suite points at the same file
 * (`~/.paseo/plugin-data/xpufx/<suite>/<filename>`) through an atomic PluginStorage,
 * so an update written by Plugin A is immediately readable by Plugin B.
 */
export function createSharedPluginSettings<TSettings extends Record<string, any>>(
  options: SharedPluginSettingsOptions<TSettings>,
): SharedPluginSettings<TSettings> {
  const {
    suite,
    filename = "settings.json",
    schema,
    defaultData,
    description,
    namespace,
    baseDir,
    watchDebounceMs = 25,
  } = options;
  const contractName = options.contractName ?? `${suite}.shared-settings`;

  const contract =
    options.contract ??
    defineSettingsContract({
      name: contractName,
      schema,
      ...(defaultData !== undefined ? { defaultData } : {}),
      ...(description !== undefined ? { description } : {}),
    });

  const storage = new PluginStorage<TSettings>(suite, filename, {
    ...(namespace !== undefined ? { namespace } : {}),
    ...(baseDir !== undefined ? { baseDir } : {}),
    schema: contract.schema,
    defaultData: contract.defaultSettings,
  });

  const listeners = new Set<SharedSettingsListener<TSettings>>();
  let watcher: fs.FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let lastSnapshot = "";

  function snapshot(): string {
    return safeSerialize(storage.read());
  }

  function emitIfChanged(): void {
    const next = storage.read();
    const nextSnapshot = safeSerialize(next);
    if (nextSnapshot !== lastSnapshot) {
      lastSnapshot = nextSnapshot;
      for (const listener of [...listeners]) {
        try {
          listener(next);
        } catch {
          // Listener errors must not break sibling notification fan-out
        }
      }
    }
  }

  function scheduleEmit(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    // @ts-ignore
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        emitIfChanged();
      } catch {
        // Disk reads may race atomic renames; next event retries
      }
    }, watchDebounceMs);
  }

  function ensureWatcher(): void {
    if (watcher) return;
    const dir = path.dirname(storage.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    lastSnapshot = snapshot();
    watcher = fs.watch(dir, (_event, watchedFile) => {
      if (watchedFile && watchedFile.toString() !== path.basename(storage.filePath)) return;
      scheduleEmit();
    });
    watcher.on("error", () => {});
    if (typeof (watcher as unknown as { unref?: () => void }).unref === "function") {
      (watcher as unknown as { unref: () => void }).unref();
    }
  }

  function disposeWatcher(): void {
    if (debounceTimer) {
// @ts-ignore
    clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {}
      watcher = null;
    }
  }

  function subscribe(listener: SharedSettingsListener<TSettings>): () => void {
    listeners.add(listener);
    try {
      ensureWatcher();
    } catch {
      // Watching is best-effort; polling via reload() still works
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) disposeWatcher();
    };
  }

  return {
    suite,
    contract,
    storage,
    filePath: storage.filePath,

    async get(): Promise<TSettings> {
      return storage.readAsync();
    },

    async update(patch: Partial<TSettings>): Promise<TSettings> {
      const updated = await storage.updateAsync((current) => ({
        ...current,
        ...patch,
      }));
      lastSnapshot = safeSerialize(updated);
      for (const listener of [...listeners]) {
        try {
          listener(updated);
        } catch {}
      }
      return updated;
    },

    async reset(): Promise<TSettings> {
      storage.reset();
      const fresh = await storage.readAsync();
      lastSnapshot = safeSerialize(fresh);
      for (const listener of [...listeners]) {
        try {
          listener(fresh);
        } catch {}
      }
      return fresh;
    },

    read(): TSettings {
      return storage.read();
    },

    reload(): TSettings {
      const next = storage.read();
      lastSnapshot = safeSerialize(next);
      return next;
    },

    subscribe,
    watch: subscribe,

    register(
      context: HandleableServerContext,
      rpcOptions: RegisterSettingsRpcOptions<TSettings> = {},
    ): void {
      registerSettingsRpc(context, contract, storage, rpcOptions);
    },

    createHandlers(rpcOptions: RegisterSettingsRpcOptions<TSettings> = {}) {
      return createSettingsHandlers(contract, storage, rpcOptions);
    },

    dispose(): void {
      listeners.clear();
      disposeWatcher();
    },
  };
}
