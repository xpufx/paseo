/**
 * Structural theme/layout types for the shared UI package.
 *
 * Mirrors the Paseo host theme shape without importing the Paseo SDK or
 * `paseo-plugin-helper`, so the package typechecks and bundles against any
 * supported host version.
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

export interface MetricThresholds {
  /** Threshold for warning status (default: 75). */
  warning?: number;
  /** Threshold for danger status (default: 90). */
  danger?: number;
  /** Inverts logic: lower values become worse (e.g. battery level, disk free). */
  invert?: boolean;
}
