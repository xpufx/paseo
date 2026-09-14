/**
 * Structural theme types for Paseo plugins.
 *
 * These interfaces mirror the Paseo host theme shapes without importing any
 * Paseo SDK module, so `paseo-plugin-helper/shared` (and everything
 * built on it) typechecks and bundles identically against Paseo v0.7 and
 * Paseo v0.8 SDKs.
 */
export interface ThemeColors {
  readonly surface0: string;
  readonly surface1: string;
  readonly surface2: string;
  readonly border: string;
  readonly foreground: string;
  readonly foregroundMuted: string;
  readonly accent: string;
  readonly accentForeground: string;
  readonly statusSuccess: string;
  readonly statusWarning: string;
  readonly statusDanger: string;
}

export interface PluginTheme {
  readonly colors: ThemeColors;
}

export type PlatformType = "ios" | "android" | "web";

export interface ResponsiveLayout {
  compact: boolean;
  platform: PlatformType;
  width?: number;
  height?: number;
}

export type StatusVariant = "neutral" | "success" | "warning" | "danger" | "accent" | "info";
