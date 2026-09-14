import type { StatusVariant, ThemeColors } from "../../shared/types.js";

/**
 * Converts a hex color and opacity (0.0 to 1.0) into an 8-character hex or rgba string.
 */
export function alpha(color: string, opacity: number): string {
  if (!color) return `rgba(0, 0, 0, ${opacity})`;
  const clampedOpacity = Math.max(0, Math.min(1, opacity));

  if (color.startsWith("#")) {
    let cleanHex = color.replace("#", "");
    if (cleanHex.length === 3) {
      cleanHex = cleanHex
        .split("")
        .map((c) => c + c)
        .join("");
    } else if (cleanHex.length === 4) {
      cleanHex = cleanHex
        .slice(0, 3)
        .split("")
        .map((c) => c + c)
        .join("");
    } else if (cleanHex.length === 8) {
      cleanHex = cleanHex.slice(0, 6);
    }
    const alphaHex = Math.round(clampedOpacity * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${cleanHex}${alphaHex}`;
  }

  if (color.startsWith("rgb")) {
    const parts = color.replace(/[^\d,.]/g, "").split(",");
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${clampedOpacity})`;
    }
  }

  return color;
}

/**
 * Calculates relative luminance (WCAG 2.0 formula) from a hex color.
 */
export function getLuminance(hexColor: string): number {
  let hex = hexColor.replace("#", "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Returns either lightText or darkText depending on which has highest contrast against bgHex.
 */
export function getContrastColor(
  bgHex: string,
  lightText = "#ffffff",
  darkText = "#0f172a",
): string {
  try {
    const lum = getLuminance(bgHex);
    return lum > 0.45 ? darkText : lightText;
  } catch {
    return lightText;
  }
}

/**
 * Resolves a StatusVariant to a corresponding theme color hex string.
 */
export function getStatusColor(
  variant: StatusVariant,
  colors: ThemeColors,
  customAccent?: string,
): string {
  const accent = customAccent || colors.accent;
  switch (variant) {
    case "success":
      return colors.statusSuccess;
    case "warning":
      return colors.statusWarning;
    case "danger":
      return colors.statusDanger;
    case "accent":
      return accent;
    case "info":
      return colors.accent;
    case "neutral":
    default:
      return colors.foregroundMuted;
  }
}

/**
 * Returns background, text, and border styling colors for a given status variant.
 */
export function getVariantPalette(
  variant: StatusVariant,
  colors: ThemeColors,
  customAccent?: string,
): { bg: string; text: string; border: string } {
  const base = getStatusColor(variant, colors, customAccent);
  return {
    bg: alpha(base, 0.12),
    text: base,
    border: alpha(base, 0.3),
  };
}
