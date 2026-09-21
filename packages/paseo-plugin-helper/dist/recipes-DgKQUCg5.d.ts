import { StyleProp, ViewStyle, TextStyle } from 'react-native';
import { P as PlatformType, R as ResponsiveLayout, T as ThemeColors, g as PluginTheme, S as StatusVariant } from './custom-pills-C98QP7Cg.js';
import React__default, { ReactNode } from 'react';
import { d as HostLayout } from './host-DatQ2QJE.js';

type RadiusStyle = "sharp" | "rounded" | "pill";
type DensityStyle = "compact" | "comfortable" | "spacious";
type SurfaceStyle = "flat" | "tinted" | "elevated";
type HeadingTransform = "none" | "uppercase";
interface VisualFlair {
    /**
     * Corner radius preset for interactive elements and containers.
     * - "sharp": 2-3px (terminal / technical flair)
     * - "rounded": 6-8px (default Paseo native flair)
     * - "pill": 9999px (soft / playful flair)
     */
    radius: RadiusStyle;
    /**
     * Spacing and typography density.
     * - "compact": tight padding and smaller fonts (the default — plugin UI is
     *   dense by nature and generous padding wastes vertical space)
     * - "comfortable": balanced, roomier defaults (opt in per plugin)
     * - "spacious": generous breathing room
     */
    density: DensityStyle;
    /**
     * Surface background styling for cards, panels, and modal boxes.
     * - "flat": pure surface0 with border
     * - "tinted": subtle tinted foreground / accent wash
     * - "elevated": uses surface1 / surface2 hierarchy
     */
    surfaceStyle: SurfaceStyle;
    /**
     * Optional custom brand accent color (e.g. "#10b981", "#3b82f6").
     * Overrides Paseo's theme.colors.accent within this plugin.
     */
    accentColor?: string;
    /**
     * Default border width for cards and bordered elements (default: 1).
     */
    borderWidth: number;
    /**
     * Text transform for section headers and meta labels.
     */
    headingTransform: HeadingTransform;
}
declare const defaultFlair: VisualFlair;
declare function resolveRadius(radius: RadiusStyle, size?: "xs" | "sm" | "md" | "lg" | "pill"): number;

/**
 * Standard spacing scale (pt/px) shared by every helper surface.
 * Density rule: compact viewports step exactly one rung down the scale.
 */
declare const spacing: {
    readonly xxs: 2;
    readonly xs: 4;
    readonly sm: 8;
    readonly md: 12;
    readonly lg: 16;
    readonly xl: 24;
};
type SpacingKey = keyof typeof spacing;
/**
 * A gap/size value: either a named spacing token or a raw px number. Layout
 * primitives accept this so callers never have to invent their own scale.
 */
type SpacingValue = SpacingKey | number;
/**
 * Resolves a {@link SpacingValue} to px, falling back to the theme-derived
 * value when the caller did not specify one.
 */
declare function resolveSpacing(value: SpacingValue | undefined, fallback: number): number;
interface TypographyToken {
    fontSize: number;
    lineHeight: number;
    fontWeight: "400" | "500" | "600" | "700";
}
interface TypographyScale {
    title: TypographyToken;
    heading: TypographyToken;
    body: TypographyToken;
    bodyStrong: TypographyToken;
    /**
     * Value text that pairs with a {@link TypographyScale.label}: same size as
     * the label, normal weight, so a value never outranks its own label.
     */
    bodySmall: TypographyToken;
    caption: TypographyToken;
    label: TypographyToken;
}
/**
 * Semantic text sizes keep helper components visually coherent while still
 * allowing compact panes and plugin density preferences to breathe.
 */
declare function resolveTypography(layout: ResponsiveLayout, density: DensityStyle): TypographyScale;
/** Fallback text color on accent fills when the host omits accentForeground. */
declare const FALLBACK_ACCENT_FOREGROUND = "#ffffff";
type ElevationLevel = "none" | "sm" | "md" | "lg";
interface ElevationStyle {
    shadowColor: string;
    shadowOpacity: number;
    shadowRadius: number;
    shadowOffset: {
        width: number;
        height: number;
    };
    elevation: number;
}
/**
 * Standard shadow/elevation presets. shadowColor lives here once so client
 * components never hardcode their own.
 */
declare function resolveElevation(level: ElevationLevel): ElevationStyle;
/**
 * Native `elevation` is Android-only; iOS renders the shadow props.
 * Kept as a helper so call sites read consistently.
 */
declare function elevationForPlatform(level: ElevationLevel, platform: PlatformType): ElevationStyle;

/**
 * Paseo 0.8 host theme variables. On web hosts the live theme is exposed as
 * CSS custom properties on the document root; this map binds each variable
 * to the semantic ThemeColors slot it feeds.
 */
declare const PASEO_HOST_CSS_VARIABLES: {
    readonly "--background": "surface0";
    readonly "--foreground": "foreground";
    readonly "--muted": "foregroundMuted";
    readonly "--accent": "accent";
    readonly "--accent-foreground": "accentForeground";
    readonly "--border": "border";
};
type PaseoHostCssVariable = keyof typeof PASEO_HOST_CSS_VARIABLES;
interface HostFontVariables {
    sans?: string;
    mono?: string;
}
interface HostThemeVariables {
    colors: Partial<ThemeColors>;
    fonts: HostFontVariables;
}
/**
 * Reads the live Paseo 0.8 host variables. Returns empty slots outside a DOM
 * runtime so native callers merge to static defaults untouched.
 */
declare function readHostThemeVariables(): HostThemeVariables;
/**
 * Pure merge for the provider: static defaults lose to live host variables,
 * which lose to the injected host theme, which loses to the flair accent.
 * Runtime `undefined` slots are skipped so a partial host theme falls back
 * instead of blanking a slot. Exported for tests; the provider applies it
 * inside useMemo.
 */
declare function mergeThemeColors(defaults: ThemeColors, hostVariables: Partial<ThemeColors>, injected: ThemeColors, accentOverride?: string): ThemeColors;

interface PluginThemeContextValue {
    theme: PluginTheme;
    colors: ThemeColors;
    fonts: HostFontVariables;
    layout: ResponsiveLayout;
    flair: VisualFlair;
    isCompact: boolean;
    isMobile: boolean;
    touchTargetMin: number;
    alpha: (color: string, opacity: number) => string;
    getContrastColor: (bgHex: string, light?: string, dark?: string) => string;
    getStatusColor: (variant: StatusVariant) => string;
    getVariantPalette: (variant: StatusVariant) => {
        bg: string;
        text: string;
        border: string;
    };
    resolveRadius: (size?: "xs" | "sm" | "md" | "lg" | "pill") => number;
    padding: {
        horizontal: number;
        vertical: number;
        gap: number;
    };
    typography: TypographyScale;
}
declare const defaultDarkTheme: PluginTheme;
declare const defaultLightTheme: PluginTheme;
declare function getDefaultTheme(scheme?: string): PluginTheme;
declare function useAppearanceScheme(): [string | undefined, (s: string | undefined) => void];
interface PluginThemeProviderProps {
    theme: PluginTheme;
    layout?: HostLayout;
    flair?: Partial<VisualFlair>;
    children: ReactNode;
}
declare function PluginThemeProvider({ theme, layout, flair: userFlair, children, }: PluginThemeProviderProps): React__default.JSX.Element;
declare function usePluginTheme(): PluginThemeContextValue;

type AttentionBeaconMode = "radar" | "ring" | "glow" | "badge" | "bounce" | "pulse";
type AttentionBeaconTone = "warning" | "accent" | "danger";
interface AttentionBeaconProps {
    children: ReactNode;
    mode?: AttentionBeaconMode;
    tone?: AttentionBeaconTone;
    color?: string;
    active?: boolean;
    style?: StyleProp<ViewStyle>;
    haloStyle?: StyleProp<ViewStyle>;
    badgeStyle?: StyleProp<ViewStyle>;
    accessibilityLabel?: string;
    testID?: string;
    badgeIcon?: string | ReactNode;
    duration?: number;
    easing?: (value: number) => number;
}
declare function normalizeBeaconMode(mode?: AttentionBeaconMode): "radar" | "glow" | "badge" | "bounce" | "pulse";
declare function resolveBeaconToneColor(colors: ThemeColors, tone?: AttentionBeaconTone, customColor?: string): string;
declare function AttentionBeacon({ children, mode, tone, color, active, style, haloStyle, badgeStyle, accessibilityLabel, testID, badgeIcon, duration, easing, }: AttentionBeaconProps): React__default.JSX.Element;

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";
type ButtonAttention = boolean | "radar" | "glow" | "bounce";
declare function resolveButtonAttentionMode(attention?: ButtonAttention): AttentionBeaconMode | null;
declare function resolveButtonAttentionTone(variant: ButtonVariant): AttentionBeaconTone;
interface ButtonProps {
    label?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: string | ReactNode;
    iconPosition?: "left" | "right";
    onPress?: () => void | Promise<void>;
    disabled?: boolean;
    loading?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    accessibilityLabel?: string;
    attention?: ButtonAttention;
}
declare function Button({ label, variant, size, icon, iconPosition, onPress, disabled, loading, style, textStyle, accessibilityLabel, attention, }: ButtonProps): React__default.JSX.Element;

type BadgeStyle = "tinted" | "outline" | "solid";
type BadgeSize = "sm" | "md";
interface BadgeProps {
    label: string;
    variant?: StatusVariant;
    styleVariant?: BadgeStyle;
    size?: BadgeSize;
    icon?: string | ReactNode;
    dot?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    /**
     * When set, every case-insensitive occurrence of the query inside `label` is
     * painted with the accent highlight. The query is matched literally, never as
     * a regular expression.
     */
    highlightQuery?: string;
    /**
     * With `highlightQuery`, marks the whole label when the query has neither a
     * literal nor a token hit — for a single primary chip, not a chip list.
     */
    highlightFuzzyFallback?: boolean;
}
declare function Badge({ label, variant, styleVariant, size, icon, dot, style, textStyle, highlightQuery, highlightFuzzyFallback, }: BadgeProps): React__default.JSX.Element;

type ThemeInput = PluginTheme | PluginThemeContextValue | ThemeColors | {
    colors: ThemeColors;
} | undefined;
/**
 * Resolves ThemeColors from a PluginTheme, PluginThemeContextValue, ThemeColors, or undefined.
 */
declare function resolveThemeColors(themeInput?: ThemeInput): ThemeColors;
interface InputRecipeOptions {
    focused?: boolean;
    isFocused?: boolean;
    error?: boolean;
    hasError?: boolean;
    disabled?: boolean;
    multiline?: boolean;
    mono?: boolean;
    compact?: boolean;
    size?: "sm" | "md" | "lg";
}
interface InputRecipeResult extends TextStyle, ViewStyle {
    input: TextStyle & ViewStyle;
    container: ViewStyle;
    label: TextStyle;
    hint: TextStyle;
}
/**
 * Generates standard React Native styles for text inputs and surrounding container/label/hint elements.
 */
declare function inputRecipe(themeInput?: ThemeInput, options?: InputRecipeOptions): InputRecipeResult;
interface CardRecipeOptions {
    variant?: SurfaceStyle;
    noPadding?: boolean;
    radius?: number;
    borderWidth?: number;
    compact?: boolean;
}
interface CardRecipeResult extends ViewStyle {
    card: ViewStyle;
    header: ViewStyle;
    headerTitle: TextStyle;
    headerSubtitle: TextStyle;
}
/**
 * Generates standard React Native styles for cards and card headers.
 */
declare function cardRecipe(themeInput?: ThemeInput, optionsOrVariant?: CardRecipeOptions | SurfaceStyle): CardRecipeResult;
interface ButtonRecipeOptions {
    variant?: ButtonVariant;
    size?: ButtonSize;
    pressed?: boolean;
    disabled?: boolean;
    loading?: boolean;
    compact?: boolean;
}
interface ButtonRecipeResult extends ViewStyle {
    container: ViewStyle;
    text: TextStyle;
}
/**
 * Generates standard React Native styles for interactive buttons and text labels.
 */
declare function buttonRecipe(themeInput?: ThemeInput, optionsOrVariant?: ButtonRecipeOptions | ButtonVariant): ButtonRecipeResult;
interface TabStripRecipeOptions {
    radius?: number;
}
interface TabStripRecipeResult extends ViewStyle {
    frame: ViewStyle;
    track: ViewStyle;
}
/**
 * Generates standard React Native styles for tab tracks and bounding frames.
 */
declare function tabStripRecipe(themeInput?: ThemeInput, options?: TabStripRecipeOptions): TabStripRecipeResult;
interface TabItemRecipeOptions {
    active?: boolean;
    pressed?: boolean;
    compact?: boolean;
    fit?: boolean;
}
interface TabItemRecipeResult extends ViewStyle {
    container: ViewStyle;
    text: TextStyle;
    badge: ViewStyle;
    badgeText: TextStyle;
}
/**
 * Generates standard React Native styles for individual tab buttons and inner badges.
 */
declare function tabItemRecipe(themeInput?: ThemeInput, activeOrOptions?: boolean | TabItemRecipeOptions, options?: TabItemRecipeOptions): TabItemRecipeResult;
interface BadgeRecipeOptions {
    variant?: StatusVariant;
    styleVariant?: BadgeStyle;
    size?: BadgeSize;
}
interface BadgeRecipeResult extends ViewStyle {
    container: ViewStyle;
    text: TextStyle;
    dot: ViewStyle;
}
/**
 * Generates standard React Native styles for pill badges, indicators, and labels.
 */
declare function badgeRecipe(themeInput?: ThemeInput, variantOrOptions?: StatusVariant | BadgeRecipeOptions, options?: BadgeRecipeOptions): BadgeRecipeResult;

export { defaultFlair as $, AttentionBeacon as A, type BadgeRecipeOptions as B, type CardRecipeOptions as C, type DensityStyle as D, type ButtonAttention as E, type ButtonSize as F, type ButtonVariant as G, type ElevationLevel as H, type InputRecipeOptions as I, type ElevationStyle as J, FALLBACK_ACCENT_FOREGROUND as K, type HeadingTransform as L, type HostFontVariables as M, type HostThemeVariables as N, type PaseoHostCssVariable as O, PASEO_HOST_CSS_VARIABLES as P, type PluginThemeContextValue as Q, PluginThemeProvider as R, type SurfaceStyle as S, type TabItemRecipeOptions as T, type PluginThemeProviderProps as U, type VisualFlair as V, type RadiusStyle as W, type SpacingKey as X, type TypographyScale as Y, type TypographyToken as Z, defaultDarkTheme as _, type BadgeRecipeResult as a, defaultLightTheme as a0, elevationForPlatform as a1, getDefaultTheme as a2, mergeThemeColors as a3, normalizeBeaconMode as a4, readHostThemeVariables as a5, resolveBeaconToneColor as a6, resolveButtonAttentionMode as a7, resolveButtonAttentionTone as a8, resolveElevation as a9, resolveRadius as aa, resolveSpacing as ab, resolveTypography as ac, spacing as ad, useAppearanceScheme as ae, usePluginTheme as af, type ButtonRecipeOptions as b, type ButtonRecipeResult as c, type CardRecipeResult as d, type InputRecipeResult as e, type TabItemRecipeResult as f, type TabStripRecipeOptions as g, type TabStripRecipeResult as h, type ThemeInput as i, badgeRecipe as j, buttonRecipe as k, cardRecipe as l, inputRecipe as m, tabStripRecipe as n, type BadgeSize as o, type ButtonProps as p, type SpacingValue as q, resolveThemeColors as r, type AttentionBeaconMode as s, tabItemRecipe as t, type AttentionBeaconProps as u, type AttentionBeaconTone as v, Badge as w, type BadgeProps as x, type BadgeStyle as y, Button as z };
