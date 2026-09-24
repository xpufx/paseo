import { shouldEmitSnapshotUpdate } from "paseo-plugin-helper/client";
import type { TopSettings } from "../shared/resources";

export type SettingsListener = (settings: TopSettings) => void;
const settingsListeners = new Set<SettingsListener>();
let lastNotifiedSettings: TopSettings | null = null;

export function addSettingsListener(listener: SettingsListener): void {
  settingsListeners.add(listener);
}

export function removeSettingsListener(listener: SettingsListener): void {
  settingsListeners.delete(listener);
}

export function notifySettingsChanged(settings: TopSettings): void {
  if (
    !shouldEmitSnapshotUpdate(
      lastNotifiedSettings as unknown as Record<string, unknown> | null,
      settings as unknown as Record<string, unknown>,
    )
  ) {
    return;
  }
  lastNotifiedSettings = settings;
  for (const listener of settingsListeners) {
    try {
      listener(settings);
    } catch {
      // Ignore listener errors
    }
  }
}
