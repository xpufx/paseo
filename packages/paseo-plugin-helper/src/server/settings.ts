import type { SettingsContract } from "../shared/settings.js";
import type { PluginStorage } from "./storage.js";

/**
 * Structural server context interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginServerContext.
 */
export interface HandleableServerContext {
  handle(contract: any, handler: (input?: any) => any): any;
}

export interface RegisterSettingsRpcOptions<TSettings> {
  /**
   * Optional callback invoked whenever settings are updated.
   */
  onUpdate?: (newSettings: TSettings, prevSettings: TSettings) => void | Promise<void>;
  /**
   * Optional callback invoked whenever settings are reset.
   */
  onReset?: (defaultSettings: TSettings, prevSettings: TSettings) => void | Promise<void>;
}

/**
 * Registers RPC handlers on the daemon PluginContext/PluginServerContext for a SettingsContract.
 * Connects get, update, and reset RPCs directly to atomic PluginStorage persistence.
 * Works with both Paseo v0.7 and Paseo v0.8.
 */
export function registerSettingsRpc<TSettings extends Record<string, any>>(
  context: HandleableServerContext,
  contract: SettingsContract<TSettings>,
  storage: PluginStorage<TSettings>,
  options: RegisterSettingsRpcOptions<TSettings> = {},
): void {
  // Register GET handler
  context.handle(contract.get, async () => {
    return storage.readAsync();
  });

  // Register UPDATE handler
  context.handle(contract.update, async (input) => {
    const prev = await storage.readAsync();
    const updated = await storage.updateAsync((current) => {
      return { ...current, ...(input as Partial<TSettings>) };
    });
    if (options.onUpdate) {
      await options.onUpdate(updated, prev);
    }
    return updated;
  });

  // Register RESET handler
  context.handle(contract.reset, async () => {
    const prev = await storage.readAsync();
    storage.reset();
    const fresh = await storage.readAsync();
    if (options.onReset) {
      await options.onReset(fresh, prev);
    }
    return fresh;
  });
}

/**
 * Creates individual RPC handler functions (get, update, reset) for a SettingsContract.
 * Useful when registering handlers in root index.ts via plugin.handle() so that
 * Paseo's AST-based client compiler can cleanly strip all server registrations.
 */
export function createSettingsHandlers<TSettings extends Record<string, any>>(
  contract: SettingsContract<TSettings>,
  storage: PluginStorage<TSettings>,
  options: RegisterSettingsRpcOptions<TSettings> = {},
) {
  return {
    get: async () => {
      return storage.readAsync();
    },
    update: async (input: unknown) => {
      const prev = await storage.readAsync();
      const updated = await storage.updateAsync((current) => {
        return { ...current, ...(input as Partial<TSettings>) };
      });
      if (options.onUpdate) {
        await options.onUpdate(updated, prev);
      }
      return updated;
    },
    reset: async () => {
      const prev = await storage.readAsync();
      storage.reset();
      const fresh = await storage.readAsync();
      if (options.onReset) {
        await options.onReset(fresh, prev);
      }
      return fresh;
    },
  };
}
