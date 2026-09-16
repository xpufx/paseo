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
  /** How long an undelivered outbox message is retried before it expires. */
  outboxExpirySeconds?: number;
  /** Per-daemon enablement; an absent or non-false entry means enabled. */
  daemonEnabled?: Record<string, boolean>;
}

export const OUTBOX_EXPIRY_DEFAULT_SECONDS = 10 * 60;
export const OUTBOX_EXPIRY_MIN_SECONDS = 10;
export const OUTBOX_EXPIRY_MAX_SECONDS = 24 * 60 * 60;

/**
 * Outbox expiry in ms. Absent/invalid values fall back to the 10 minute
 * default; explicit values are clamped to a sane range so a bad setting cannot
 * disable retries or hold messages forever.
 */
export function resolveOutboxExpiryMs(prefs: FeaturePrefs): number {
  const raw = prefs.outboxExpirySeconds;
  const seconds =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.floor(raw)
      : OUTBOX_EXPIRY_DEFAULT_SECONDS;
  const clamped = Math.min(OUTBOX_EXPIRY_MAX_SECONDS, Math.max(OUTBOX_EXPIRY_MIN_SECONDS, seconds));
  return clamped * 1000;
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
    ...(input.outboxExpirySeconds !== undefined
      ? { outboxExpirySeconds: input.outboxExpirySeconds }
      : {}),
    ...(daemonEnabled !== undefined ? { daemonEnabled } : {}),
  };
}
