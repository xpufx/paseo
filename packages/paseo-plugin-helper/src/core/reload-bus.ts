/**
 * Paseo Plugin Helper — Global Reload Bus (`paseo-plugin-helper/core`).
 *
 * Centralizes plugin and daemon reload notifications into a debounced,
 * coalesced global toast dispatcher. Prevents notification storms when
 * multiple plugins or daemon rebuilds reload concurrently.
 *
 * Contract — headless & client-safe:
 * - No `node:*` imports.
 * - No React Native or DOM scraping.
 * - Toast delivery delegates to host toast provider via `getOptionalClientHost()?.useToast()`
 *   or `globalThis.__PASEO_HOST__?.toast`.
 */

import { getOptionalClientHost } from "./host.js";
import { bumpPluginLoadCount } from "./plugin-load-count.js";

export const DEFAULT_RELOAD_DEBOUNCE_MS = 500;
export const DEFAULT_RELOAD_QUENCH_MS = 5000;

export interface ReloadToastAction {
  label: string;
  onClick: () => void;
}

export interface ReloadToastOptions {
  duration?: number;
  action?: ReloadToastAction;
  [key: string]: unknown;
}

export interface NotifyPluginReloadOptions {
  /**
   * If true, unconditionally enqueues the reload notification even on the
   * initial bundle evaluation (load count <= 1). Useful for manual testing or
   * explicit reload triggers.
   */
  force?: boolean;
  /** Custom debounce window in milliseconds (default: 500ms). */
  debounceMs?: number;
  /** Custom quench cooldown window in milliseconds (default: 5000ms). */
  quenchMs?: number;
}

export interface ReloadBusState {
  pendingPlugins: Set<string>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  lastToastTime: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __PASEO_RELOAD_BUS__: ReloadBusState | undefined;
}

const _bus: ReloadBusState = (globalThis.__PASEO_RELOAD_BUS__ ||= {
  pendingPlugins: new Set<string>(),
  debounceTimer: null,
  lastToastTime: 0,
});

/**
 * Deliver a reload toast notification to the host client.
 * Tries `globalThis.__PASEO_HOST__?.toast`, then `getOptionalClientHost()?.useToast()`,
 * falling back to `console.info` if no host toast is available.
 */
export function deliverReloadToast(
  message: string,
  customOptions?: ReloadToastOptions,
): boolean {
  const options: ReloadToastOptions = {
    duration: 10000,
    action: {
      label: "Reload Now",
      onClick: () => {
        const win = (globalThis as any).window ?? globalThis;
        if (typeof win?.location?.reload === "function") {
          win.location.reload();
        }
      },
    },
    ...customOptions,
  };

  const globalHost = (globalThis as any).__PASEO_HOST__;
  if (globalHost?.toast) {
    if (typeof globalHost.toast.show === "function") {
      globalHost.toast.show(message, options);
      return true;
    }
    if (typeof globalHost.toast === "function") {
      globalHost.toast(message, options);
      return true;
    }
  }

  const host = getOptionalClientHost();
  if (host?.useToast) {
    try {
      const toast = host.useToast();
      if (toast && typeof toast.show === "function") {
        toast.show(message, options);
        return true;
      }
    } catch {
      // In case useToast is a React hook executed outside React rendering context
    }
  }

  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info(`[paseo:reload] ${message}`);
  }

  return false;
}

/**
 * Format a human-readable reload toast message for a list of reloaded plugin IDs.
 */
export function formatReloadMessage(plugins: string[]): string {
  if (plugins.length === 0) {
    return "⚡ Plugin reloaded on daemon. Press Ctrl+R to refresh open views.";
  }
  if (plugins.length === 1) {
    return `⚡ Plugin ${plugins[0]} reloaded on daemon. Press Ctrl+R to refresh open views.`;
  }
  const pluginList =
    plugins.length <= 3
      ? plugins.join(", ")
      : `${plugins.slice(0, 3).join(", ")}...`;
  return `⚡ ${plugins.length} plugins reloaded (${pluginList}). Press Ctrl+R to refresh.`;
}

/**
 * Immediately flush any pending reload notifications, delivering the coalesced toast.
 */
export function flushReloadBusNow(options?: { quenchMs?: number }): boolean {
  if (_bus.debounceTimer !== null) {
    clearTimeout(_bus.debounceTimer);
    _bus.debounceTimer = null;
  }

  if (_bus.pendingPlugins.size === 0) {
    return false;
  }

  const now = Date.now();
  const quenchMs = options?.quenchMs ?? DEFAULT_RELOAD_QUENCH_MS;

  if (_bus.lastToastTime > 0 && now - _bus.lastToastTime < quenchMs) {
    // Within quench cooldown window: quench (suppress) toast flood
    _bus.pendingPlugins.clear();
    return false;
  }

  const plugins = Array.from(_bus.pendingPlugins);
  _bus.pendingPlugins.clear();
  _bus.lastToastTime = now;

  const message = formatReloadMessage(plugins);
  deliverReloadToast(message);
  return true;
}

/**
 * Directly enqueue a plugin ID into the reload debounce queue.
 */
export function enqueuePluginReload(
  pluginId: string,
  options?: NotifyPluginReloadOptions,
): void {
  _bus.pendingPlugins.add(pluginId);

  if (_bus.debounceTimer !== null) {
    clearTimeout(_bus.debounceTimer);
  }

  const debounceMs = options?.debounceMs ?? DEFAULT_RELOAD_DEBOUNCE_MS;
  _bus.debounceTimer = setTimeout(() => {
    _bus.debounceTimer = null;
    flushReloadBusNow(options);
  }, debounceMs);
}

/**
 * Notify that a plugin was evaluated.
 *
 * Increments the plugin load counter. If the plugin has been reloaded (load count > 1)
 * or if `options.force` is true, queues a debounced, storm-coalesced toast notification.
 */
export function notifyPluginReload(
  pluginId: string,
  options?: NotifyPluginReloadOptions,
): boolean {
  const count = bumpPluginLoadCount(pluginId);
  const isReload = count > 1 || options?.force === true;

  if (!isReload) {
    return false;
  }

  enqueuePluginReload(pluginId, options);
  return true;
}

/**
 * Reset the global reload bus state (clears pending queue, timer, and quench timestamp).
 * Useful for test isolation and teardown.
 */
export function resetReloadBus(): void {
  if (_bus.debounceTimer !== null) {
    clearTimeout(_bus.debounceTimer);
    _bus.debounceTimer = null;
  }
  _bus.pendingPlugins.clear();
  _bus.lastToastTime = 0;
}

/**
 * Return a copy of currently pending plugin IDs awaiting debounce flush.
 */
export function getPendingReloadPlugins(): string[] {
  return Array.from(_bus.pendingPlugins);
}

/**
 * Return the timestamp of the last delivered reload toast.
 */
export function getLastReloadToastTime(): number {
  return _bus.lastToastTime;
}
