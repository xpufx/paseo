import React__default, { ReactNode } from 'react';
import { R as ResponsiveLayout, T as ThemeColors, S as StatusVariant, P as PluginTheme } from './types-4TBN5lgi.js';

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
interface HostTheme {
    /** Host theme colors, straight from the host `theme` prop. */
    colors: ThemeColors;
    /** Color-token opacity helper bound to nothing but its arguments. */
    alpha: (color: string, opacity: number) => string;
    /** Status variant → host theme color. */
    getStatusColor: (variant: StatusVariant) => string;
    /** Status variant → { bg, text, border } palette derived via `alpha`. */
    getVariantPalette: (variant: StatusVariant) => {
        bg: string;
        text: string;
        border: string;
    };
}
interface HostThemeProviderProps {
    /** The host `theme` prop for this surface — the single source of colors. */
    theme: PluginTheme;
    children: ReactNode;
}
/**
 * Provides host theme colors to every ui/ adapter in the subtree. Same `theme`
 * prop shape the removed legacy `PluginThemeProvider` took, but no scraped
 * variables and no flair.
 */
declare function HostThemeProvider({ theme, children }: HostThemeProviderProps): React__default.JSX.Element;
/**
 * Reads the host theme provided by {@link HostThemeProvider}. Falls back to a
 * static neutral palette when no provider is above — adapters never throw and
 * never scrape.
 */
declare function useHostTheme(): HostTheme;
interface HostLayoutProviderProps {
    /** The host `layout` prop for this surface. */
    layout: ResponsiveLayout;
    children: ReactNode;
}
/**
 * Provides the host layout descriptor (compact / platform / width) to ui/
 * adapters that branch on it (e.g. `HostResponsive`). Optional: adapters
 * fall back to a wide-web default when no provider is above.
 */
declare function HostLayoutProvider({ layout, children }: HostLayoutProviderProps): React__default.JSX.Element;
/** Reads the host layout descriptor. */
declare function useHostLayout(): ResponsiveLayout;

/**
 * The single host-color fallback owned by the helper.
 *
 * A host `theme` prop normally supplies every token, but a partial or older
 * payload may omit some. Rather than each plugin inventing its own
 * `colors.border || "#334155"` guard, the helper resolves a theme once, here,
 * and every adapter reads the resolved token. Plugins may pass this palette to
 * code that renders outside a provider (recipes, previews, tests); they must
 * not define their own literal fallbacks.
 */
declare const FALLBACK_COLORS: ThemeColors;
/**
 * The host theme carries no shadow token, so shadows use this documented
 * overlay constant owned by the helper. It is not a `ThemeColors` token and is
 * intentionally not part of the palette a render guard checks; it is the one
 * allowed non-theme color.
 */
declare const HOST_SHADOW_COLOR = "rgba(0, 0, 0, 0.4)";
/**
 * Fills a possibly-partial host `theme.colors` from {@link FALLBACK_COLORS}.
 * This is the one place a missing token becomes a literal, so surfaces never
 * need a per-property `|| "#hex"` guard.
 */
declare function resolveHostColors(colors?: Partial<ThemeColors> | null): ThemeColors;
/**
 * Paseo Plugin Helper — UI color tokens (`paseo-plugin-helper/ui`).
 *
 * Pure color math for the ui/ adapter layer. These helpers are deliberately
 * self-contained: they never read the DOM, never scrape CSS variables, and
 * never import the frozen `client/` theme system. Colors arrive from the host
 * `theme` prop via {@link HostThemeProvider} and are combined here.
 */
/**
 * Converts a hex color and opacity (0.0 to 1.0) into an 8-character hex or
 * rgba string.
 *
 * - `#rgb` / `#rrggbb` / `#rrggbbaa` → `#rrggbbaa` (alpha channel replaced)
 * - `rgb()` / `rgba()` → `rgba(r, g, b, opacity)`
 * - anything else is returned unchanged (named colors, `transparent`, …)
 * - empty/invalid color degrades to `rgba(0, 0, 0, opacity)`
 */
declare function alpha(color: string, opacity: number): string;
/**
 * Resolves a StatusVariant to a corresponding theme color hex string.
 */
declare function getStatusColor(variant: StatusVariant, colors: ThemeColors, customAccent?: string): string;
/**
 * Returns background, text, and border styling colors for a given status
 * variant, derived from the host theme colors via {@link alpha}.
 */
declare function getVariantPalette(variant: StatusVariant, colors: ThemeColors, customAccent?: string): {
    bg: string;
    text: string;
    border: string;
};
/**
 * Calculates relative luminance (WCAG 2.0 formula) from a hex color.
 */
declare function getLuminance(hexColor: string): number;
/**
 * Returns either lightText or darkText depending on which has highest contrast against bgHex.
 */
declare function getContrastColor(bgHex: string, lightText?: string, darkText?: string): string;

export { FALLBACK_COLORS as F, HOST_SHADOW_COLOR as H, HostLayoutProvider as a, type HostLayoutProviderProps as b, type HostTheme as c, HostThemeProvider as d, type HostThemeProviderProps as e, alpha as f, getContrastColor as g, getLuminance as h, getStatusColor as i, getVariantPalette as j, useHostTheme as k, resolveHostColors as r, useHostLayout as u };
