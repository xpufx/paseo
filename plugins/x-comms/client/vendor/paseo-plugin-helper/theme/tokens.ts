import type { PlatformType } from "../../../../shared/vendor/paseo-plugin-helper/types";
import type { DensityStyle } from "./flair";
import type { ResponsiveLayout } from "../../../../shared/vendor/paseo-plugin-helper/types";

/**
 * Standard spacing scale (pt/px) shared by every helper surface.
 * Density rule: compact viewports step exactly one rung down the scale.
 */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export type SpacingKey = keyof typeof spacing;

export interface TypographyToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: "400" | "500" | "600" | "700";
}

export interface TypographyScale {
  title: TypographyToken;
  heading: TypographyToken;
  body: TypographyToken;
  bodyStrong: TypographyToken;
  caption: TypographyToken;
  label: TypographyToken;
}

/**
 * Semantic text sizes keep helper components visually coherent while still
 * allowing compact panes and plugin density preferences to breathe.
 */
export function resolveTypography(
  layout: ResponsiveLayout,
  density: DensityStyle,
): TypographyScale {
  const compact = layout.compact;
  const densityStep = density === "compact" ? -1 : density === "spacious" ? 1 : 0;
  const size = (regular: number, minimum = 10) =>
    Math.max(minimum, regular + (compact ? -1 : 0) + densityStep);

  return {
    title: { fontSize: size(16, 14), lineHeight: size(22, 18), fontWeight: "600" },
    heading: { fontSize: size(14, 12), lineHeight: size(20, 16), fontWeight: "600" },
    body: { fontSize: size(13, 12), lineHeight: size(19, 16), fontWeight: "400" },
    bodyStrong: { fontSize: size(13, 12), lineHeight: size(19, 16), fontWeight: "600" },
    caption: { fontSize: size(11, 10), lineHeight: size(15, 14), fontWeight: "400" },
    label: { fontSize: size(12, 11), lineHeight: size(16, 14), fontWeight: "600" },
  };
}

/** Fallback text color on accent fills when the host omits accentForeground. */
export const FALLBACK_ACCENT_FOREGROUND = "#ffffff";

export type ElevationLevel = "none" | "sm" | "md" | "lg";

export interface ElevationStyle {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

/**
 * Standard shadow/elevation presets. shadowColor lives here once so client
 * components never hardcode their own.
 */
export function resolveElevation(level: ElevationLevel): ElevationStyle {
  switch (level) {
    case "none":
      return {
        shadowColor: "#000",
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: 0,
      };
    case "sm":
      return {
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
      };
    case "lg":
      return {
        shadowColor: "#000",
        shadowOpacity: 0.24,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      };
    case "md":
    default:
      return {
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      };
  }
}

/**
 * Native `elevation` is Android-only; iOS renders the shadow props.
 * Kept as a helper so call sites read consistently.
 */
export function elevationForPlatform(
  level: ElevationLevel,
  platform: PlatformType,
): ElevationStyle {
  const style = resolveElevation(level);
  if (platform !== "android") {
    return { ...style, elevation: 0 };
  }
  return style;
}
