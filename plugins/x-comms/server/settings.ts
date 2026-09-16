/**
 * Daemon-wide feature flags for the mesh layers. Pure resolution logic lives
 * here so it is unit-testable without touching the prefs file; persistence
 * stays in server/handlers.ts via the PluginStorage-backed ui prefs.
 *
 * Defaults: presence on, injection on. Absent keys mean enabled.
 */

export interface FeaturePrefs {
  presenceEnabled?: boolean;
  injectionEnabled?: boolean;
  /** Per-daemon enablement; an absent or non-false entry means enabled. */
  daemonEnabled?: Record<string, boolean>;
}

export function resolvePresenceEnabled(prefs: FeaturePrefs): boolean {
  return prefs.presenceEnabled !== false;
}

export function resolveDaemonEnabled(prefs: FeaturePrefs, name: string): boolean {
  return prefs.daemonEnabled?.[name] !== false;
}

export function resolveInjectionEnabled(prefs: FeaturePrefs): boolean {
  return prefs.injectionEnabled !== false;
}

export interface FeatureFlags {
  presenceEnabled: boolean;
  injectionEnabled: boolean;
}

export function resolveFeatureFlags(prefs: FeaturePrefs): FeatureFlags {
  return {
    presenceEnabled: resolvePresenceEnabled(prefs),
    injectionEnabled: resolveInjectionEnabled(prefs),
  };
}

/**
 * Merge a partial prefs update over stored prefs (toggle round-trip).
 * Undefined fields keep their stored value.
 */
export function applyFeaturePrefsUpdate(
  stored: FeaturePrefs,
  input: FeaturePrefs,
): FeaturePrefs {
  const daemonEnabled = input.daemonEnabled
    ? { ...stored.daemonEnabled, ...input.daemonEnabled }
    : stored.daemonEnabled;
  return {
    ...stored,
    presenceEnabled: input.presenceEnabled ?? stored.presenceEnabled,
    injectionEnabled: input.injectionEnabled ?? stored.injectionEnabled,
    ...(daemonEnabled !== undefined ? { daemonEnabled } : {}),
  };
}
