import React, { type ReactNode } from "react";
import {
  HostThemeProvider as PluginUiThemeProvider,
  useHostTheme,
  type StatusVariant,
  type ThemeColors,
} from "@xpufx/paseo-plugin-ui";
import {
  HostThemeProvider as HelperThemeProvider,
} from "paseo-plugin-helper/lifecycle";

/**
 * Fleet theme accessor backed by the host theme prop.
 *
 * Colors, alpha and the status palettes come from `useHostTheme()` — the host
 * `theme` prop carried by the lifecycle `HostThemeProvider`/registration
 * wrappers (#937). No `client/` provider, no `getComputedStyle` scraping.
 *
 * Typography is the plugin's own scale. The host theme prop carries colors but
 * no type scale, so the fleet pins one dense scale here instead of depending on
 * the deleted `client/` flair/density machinery.
 */

export interface FleetTypographyToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: "400" | "500" | "600" | "700";
}

export interface FleetTypographyScale {
  title: FleetTypographyToken;
  heading: FleetTypographyToken;
  body: FleetTypographyToken;
  bodyStrong: FleetTypographyToken;
  bodySmall: FleetTypographyToken;
  caption: FleetTypographyToken;
  label: FleetTypographyToken;
}

const FLEET_TYPOGRAPHY: FleetTypographyScale = {
  title: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  heading: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
  body: { fontSize: 12, lineHeight: 18, fontWeight: "400" },
  bodyStrong: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  bodySmall: { fontSize: 11, lineHeight: 15, fontWeight: "400" },
  caption: { fontSize: 10, lineHeight: 14, fontWeight: "400" },
  label: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
};

export interface FleetTheme {
  colors: ThemeColors;
  alpha: (color: string, opacity: number) => string;
  getStatusColor: (variant: StatusVariant) => string;
  getVariantPalette: (variant: StatusVariant) => { bg: string; text: string; border: string };
  typography: FleetTypographyScale;
}

export function useFleetTheme(): FleetTheme {
  const host = useHostTheme();
  return {
    colors: host.colors,
    alpha: host.alpha,
    getStatusColor: host.getStatusColor,
    getVariantPalette: host.getVariantPalette,
    typography: FLEET_TYPOGRAPHY,
  };
}

export interface HostThemeProviderProps {
  theme?: { colors: ThemeColors } | { colors?: Partial<ThemeColors> };
  children: ReactNode;
}

/** Host theme provider for the plugin's surfaces and panels. */
export function HostThemeProvider({ theme, children }: HostThemeProviderProps) {
  return React.createElement(HelperThemeProvider, {
    theme: theme as any,
    children: React.createElement(PluginUiThemeProvider, { theme: theme as any, children }),
  });
}
