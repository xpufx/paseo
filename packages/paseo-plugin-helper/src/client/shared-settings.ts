import type { SettingsContract } from "../shared/settings.js";
import { SuiteSettingsContract, type SuiteSettings } from "../shared/suite-settings.js";
import {
  usePluginSettings,
  type UsePluginSettingsOptions,
  type UsePluginSettingsResult,
} from "./settings.js";

export interface UseSharedPluginSettingsOptions<TSettings>
  extends UsePluginSettingsOptions<TSettings> {
  /**
   * Background polling interval keeping sibling plugins in sync when one of
   * them writes the shared file outside this client's RPC round-trip.
   * Defaults to 2000ms. Pass `false` to disable polling.
   */
  pollIntervalMs?: number | false;
}

/**
 * Reactive hook for suite-wide settings shared across independent sibling plugins.
 * Wraps usePluginSettings with sync-friendly defaults: always re-verifies on
 * mount and polls in the background so an update written by Plugin A appears
 * in Plugin B without a manual refresh.
 */
export function useSharedPluginSettings<TSettings extends Record<string, any>>(
  contract: SettingsContract<TSettings>,
  options: UseSharedPluginSettingsOptions<TSettings> = {},
): UsePluginSettingsResult<TSettings> {
  const { pollIntervalMs = 2000, ...rest } = options;
  return usePluginSettings(contract, {
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    ...rest,
    refetchInterval: rest.refetchInterval ?? pollIntervalMs,
  });
}

/**
 * Convenience hook bound to the canonical xpufx suite settings contract.
 */
export function useSuiteSettings(
  options: UseSharedPluginSettingsOptions<SuiteSettings> = {},
): UsePluginSettingsResult<SuiteSettings> {
  return useSharedPluginSettings(SuiteSettingsContract, options);
}
