import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import type { StatusVariant, ThemeColors } from "./types.js";

export interface PluginUiTheme {
  colors: ThemeColors;
  alpha: (color: string, opacity: number) => string;
  getStatusColor: (variant: StatusVariant) => string;
  getVariantPalette: (variant: StatusVariant) => { bg: string; text: string; border: string };
}

export const FALLBACK_COLORS: ThemeColors = {
  surface0: "#18181b",
  surface1: "#27272a",
  surface2: "#3f3f46",
  border: "#3f3f46",
  foreground: "#fafafa",
  foregroundMuted: "#a1a1aa",
  accent: "#3b82f6",
  accentForeground: "#ffffff",
  statusSuccess: "#22c55e",
  statusWarning: "#eab308",
  statusDanger: "#ef4444",
};

export function alpha(color: string, opacity: number): string {
  if (!color) return `rgba(0, 0, 0, ${opacity})`;
  const clamped = Math.max(0, Math.min(1, opacity));

  if (color.startsWith("#")) {
    let clean = color.replace("#", "");
    if (clean.length === 3) {
      clean = clean.split("").map((c) => c + c).join("");
    } else if (clean.length === 4) {
      clean = clean.slice(0, 3).split("").map((c) => c + c).join("");
    } else if (clean.length === 8) {
      clean = clean.slice(0, 6);
    }
    const alphaHex = Math.round(clamped * 255).toString(16).padStart(2, "0");
    return `#${clean}${alphaHex}`;
  }

  if (color.startsWith("rgb")) {
    const parts = color.replace(/[^\d,.]/g, "").split(",");
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${clamped})`;
    }
  }

  return color;
}

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

export function resolveHostColors(colors?: Partial<ThemeColors> | null): ThemeColors {
  return { ...FALLBACK_COLORS, ...(colors ?? {}) };
}

function createPluginUiTheme(colors: ThemeColors): PluginUiTheme {
  return {
    colors,
    alpha,
    getStatusColor: (variant) => getStatusColor(variant, colors),
    getVariantPalette: (variant) => {
      const base = getStatusColor(variant, colors);
      return { bg: alpha(base, 0.12), text: base, border: alpha(base, 0.3) };
    },
  };
}

const ThemeContext = createContext<PluginUiTheme>(createPluginUiTheme(FALLBACK_COLORS));

export interface HostThemeProviderProps {
  theme?: { colors: ThemeColors } | { colors?: Partial<ThemeColors> };
  children: ReactNode;
}

export function HostThemeProvider({ theme, children }: HostThemeProviderProps) {
  const value = useMemo(
    () => createPluginUiTheme(resolveHostColors(theme?.colors as Partial<ThemeColors> | undefined)),
    [theme?.colors],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useHostTheme(): PluginUiTheme {
  return useContext(ThemeContext);
}
