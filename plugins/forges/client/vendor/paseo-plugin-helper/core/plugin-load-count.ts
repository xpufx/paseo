/**
 * Paseo Plugin Helper — Bundle Re-Evaluation Tracking (`paseo-plugin-helper/core`).
 *
 * Tracks how many times each plugin bundle has been re-evaluated by the host
 * daemon.  Useful for detecting hot-reload / reload cycles so plugins can
 * surface a notice to the user.
 *
 * Contract — headless & client-safe:
 * - No `node:*` imports.
 * - No React Native or DOM scraping.
 * - The only React dependency is the exported hook (used inside React trees).
 */

// ---------------------------------------------------------------------------
// Global store --------------------------------------------------------------
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __PASEO_PLUGIN_LOAD_COUNT__: Record<string, number>;
}

const _store = (globalThis.__PASEO_PLUGIN_LOAD_COUNT__ ||= {});

/**
 * Increment and return the load count for *pluginId*.
 *
 * Call this from your plugin's entry-point (or wherever the bundle first
 * executes) so the daemon-side reload counter advances on every evaluation.
 */
export function bumpPluginLoadCount(pluginId: string): number {
  _store[pluginId] = (_store[pluginId] || 0) + 1;
  return _store[pluginId];
}

/**
 * Return the current load count for *pluginId* (0 if never bumped).
 */
export function getPluginLoadCount(pluginId: string): number {
  return _store[pluginId] || 0;
}

/**
 * Return `true` when the plugin has been reloaded at least once
 * (i.e. load count > 1).
 */
export function isPluginReloaded(pluginId: string): boolean {
  return (_store[pluginId] || 0) > 1;
}

// ---------------------------------------------------------------------------
// React hook ----------------------------------------------------------------
// ---------------------------------------------------------------------------

import { useState } from "react";

export interface PluginReloadNoticeState {
  /** Whether the plugin was reloaded (load count > 1). */
  isReloaded: boolean;
  /** Current load count for the plugin. */
  loadCount: number;
  /** Dismiss the reload notice locally. */
  dismiss: () => void;
}

/**
 * React hook that tracks whether a plugin bundle was reloaded.
 *
 * ```ts
 * const { isReloaded, loadCount, dismiss } = usePluginReloadNotice("my-plugin");
 * ```
 *
 * The `dismiss` callback toggles local state only — it does not affect the
 * global counter.
 */
export function usePluginReloadNotice(
  pluginId: string,
): PluginReloadNoticeState {
  const [dismissed, setDismissed] = useState(false);

  const loadCount = getPluginLoadCount(pluginId);
  const isReloaded = !dismissed && loadCount > 1;

  return {
    isReloaded,
    loadCount,
    dismiss: () => setDismissed(true),
  };
}
