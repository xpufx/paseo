import React, { createContext, useContext, type ReactNode } from "react";
import type { PluginTheme, ResponsiveLayout, StatusVariant, ThemeColors } from "../shared/types.js";
import { alpha, getStatusColor, getVariantPalette, FALLBACK_COLORS, resolveHostColors } from "./host-color.js";

/**
 * Paseo Plugin Helper — Host theme context (`paseo-plugin-helper/ui`).
 *
 * The ui/ adapter layer's ONLY source of color tokens. The host hands every
 * surface a `theme` prop (`PluginTheme`); `HostThemeProvider` carries those
 * colors to every ui/ adapter below it.
 *
 * Contract — what this context deliberately does NOT do:
 * - No DOM CSS variable scraping. Colors come from the host `theme` prop only;
 *   the removed legacy theme provider's `getComputedStyle` scraper is gone.
 * - No flair, density, typography, or padding machinery. The host owns the
 *   design language; ui/ only consumes its color tokens.
 * - No scroll-ownership state machine. See `ui/modal.tsx`.
 *
 * Usage:
 * ```tsx
 * <HostThemeProvider theme={props.theme}>
 *   <HostCard>…</HostCard>
 * </HostThemeProvider>
 * ```
 */

export interface HostTheme {
  /** Host theme colors, straight from the host `theme` prop. */
  colors: ThemeColors;
  /** Color-token opacity helper bound to nothing but its arguments. */
  alpha: (color: string, opacity: number) => string;
  /** Status variant → host theme color. */
  getStatusColor: (variant: StatusVariant) => string;
  /** Status variant → { bg, text, border } palette derived via `alpha`. */
  getVariantPalette: (variant: StatusVariant) => { bg: string; text: string; border: string };
}

/**
 * Neutral fallback palette so ui/ adapters still render outside a provider
 * (tests, previews, host surfaces that have not migrated yet). It is the single
 * helper-owned fallback; see {@link FALLBACK_COLORS}. A supplied `theme` is
 * merged over it, so a partial host payload never paints a raw literal.
 */
function createHostTheme(colors: ThemeColors): HostTheme {
  return {
    colors,
    alpha,
    getStatusColor: (variant) => getStatusColor(variant, colors),
    getVariantPalette: (variant) => getVariantPalette(variant, colors),
  };
}

const FALLBACK_HOST_THEME: HostTheme = createHostTheme(FALLBACK_COLORS);

const HostThemeContext = createContext<HostTheme>(FALLBACK_HOST_THEME);

export interface HostThemeProviderProps {
  /** The host `theme` prop for this surface — the single source of colors. */
  theme: PluginTheme;
  children: ReactNode;
}

/**
 * Provides host theme colors to every ui/ adapter in the subtree. Same `theme`
 * prop shape the removed legacy `PluginThemeProvider` took, but no scraped
 * variables and no flair.
 */
export function HostThemeProvider({ theme, children }: HostThemeProviderProps) {
  const value = createHostTheme(resolveHostColors(theme.colors));
  return <HostThemeContext.Provider value={value}>{children}</HostThemeContext.Provider>;
}

/**
 * Reads the host theme provided by {@link HostThemeProvider}. Falls back to a
 * static neutral palette when no provider is above — adapters never throw and
 * never scrape.
 */
export function useHostTheme(): HostTheme {
  return useContext(HostThemeContext);
}

// --- Host layout -----------------------------------------------------------

const DEFAULT_LAYOUT: ResponsiveLayout = {
  compact: false,
  platform: "web",
};

const HostLayoutContext = createContext<ResponsiveLayout>(DEFAULT_LAYOUT);

export interface HostLayoutProviderProps {
  /** The host `layout` prop for this surface. */
  layout: ResponsiveLayout;
  children: ReactNode;
}

/**
 * Provides the host layout descriptor (compact / platform / width) to ui/
 * adapters that branch on it (e.g. `HostResponsive`). Optional: adapters
 * fall back to a wide-web default when no provider is above.
 */
export function HostLayoutProvider({ layout, children }: HostLayoutProviderProps) {
  return <HostLayoutContext.Provider value={layout}>{children}</HostLayoutContext.Provider>;
}

/** Reads the host layout descriptor. */
export function useHostLayout(): ResponsiveLayout {
  return useContext(HostLayoutContext);
}
