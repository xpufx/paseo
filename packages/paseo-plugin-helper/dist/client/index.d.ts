import { D as DensityStyle, S as SurfaceStyle, o as BadgeSize, p as ButtonProps, q as SpacingValue, V as VisualFlair } from '../recipes-BkOWLdJz.js';
export { A as AttentionBeacon, s as AttentionBeaconMode, u as AttentionBeaconProps, v as AttentionBeaconTone, w as Badge, x as BadgeProps, B as BadgeRecipeOptions, a as BadgeRecipeResult, y as BadgeStyle, z as Button, E as ButtonAttention, b as ButtonRecipeOptions, c as ButtonRecipeResult, F as ButtonSize, G as ButtonVariant, C as CardRecipeOptions, d as CardRecipeResult, H as ElevationLevel, J as ElevationStyle, K as FALLBACK_ACCENT_FOREGROUND, L as HeadingTransform, M as HostFontVariables, N as HostThemeVariables, I as InputRecipeOptions, e as InputRecipeResult, P as PASEO_HOST_CSS_VARIABLES, O as PaseoHostCssVariable, Q as PluginThemeContextValue, R as PluginThemeProvider, U as PluginThemeProviderProps, W as RadiusStyle, X as SpacingKey, T as TabItemRecipeOptions, f as TabItemRecipeResult, g as TabStripRecipeOptions, h as TabStripRecipeResult, i as ThemeInput, Y as TypographyScale, Z as TypographyToken, j as badgeRecipe, k as buttonRecipe, l as cardRecipe, _ as defaultDarkTheme, $ as defaultFlair, a0 as defaultLightTheme, a1 as elevationForPlatform, a2 as getDefaultTheme, m as inputRecipe, a3 as mergeThemeColors, a4 as normalizeBeaconMode, a5 as readHostThemeVariables, a6 as resolveBeaconToneColor, a7 as resolveButtonAttentionMode, a8 as resolveButtonAttentionTone, a9 as resolveElevation, aa as resolveRadius, ab as resolveSpacing, r as resolveThemeColors, ac as resolveTypography, ad as spacing, t as tabItemRecipe, n as tabStripRecipe, ae as useAppearanceScheme, af as usePluginTheme } from '../recipes-BkOWLdJz.js';
import { S as StatusVariant, T as ThemeColors, P as PlatformType, R as ResponsiveLayout, d as CustomPillState } from '../custom-pills-C98QP7Cg.js';
import React__default, { ReactNode, Ref, ComponentType } from 'react';
import { StyleProp, ViewStyle, TextStyle, GestureResponderEvent, AccessibilityRole, KeyboardTypeOptions, ImageSourcePropType, ScrollView, ImageStyle } from 'react-native';
import { M as MetricThresholds, f as TruncatePathOptions, a as ForgeMarkInput, F as ForgeKind } from '../forge-BMhLnv9s.js';
export { R as ResolvedForgeMark, g as forgeKindFromHost, m as isForgeKind, n as normalizeForgeHost, r as resolveForgeMark } from '../forge-BMhLnv9s.js';
import { q as HostPillProps, r as ComposerPillRegistrar, P as PluginCleanup, o as HostSurfaceProps, t as HostAgentPanelProps, u as HostWorkspacePanelProps, h as HostToast, v as HostIconProps } from '../host-DatQ2QJE.js';
export { C as ClientHostDeps, w as ComposerPillButtonContribution, x as ComposerPillButtonDescriptor, y as ComposerPillButtonIcon, p as ComposerPillContribution, z as ComposerPillRegistration, A as ComposerPillRegistrationHandle, B as ComposerPillSdkContribution, H as HostAgentRef, a as HostAgentUpdate, b as HostAgentsApi, c as HostCopyText, D as HostFlatList, E as HostIcon, d as HostLayout, F as HostModal, G as HostModalContentProps, I as HostModalProps, e as HostRpcContract, J as HostScrollView, K as HostTextInput, f as HostTheme, g as HostThemeColors, i as HostUseRpc, j as HostUseToast, k as getClientHost, l as getOptionalClientHost, m as initClientHelpers, n as isClientHostInitialized, s as selectHostScrollView } from '../host-DatQ2QJE.js';
export { C as CommandCenterCapabilities, a as CommandCenterContext, b as CommandCenterItemContribution, c as CommandCenterItemRegistrar, r as registerCommandCenterItem } from '../command-center-D535JyIo.js';
export { R as REFRESH_INTERVALS, a as RefreshRate, b as RpcMutationOptions, c as RpcQueryOptions, U as UseAutoRefreshQueryOptions, d as UsePluginSettingsOptions, e as UsePluginSettingsResult, f as UseSharedPluginSettingsOptions, n as normalizeSnapshotScope, s as shallowEqualRecord, g as sharedSnapshotKey, h as shouldEmitSnapshotUpdate, u as useAutoRefreshQuery, i as usePluginSettings, j as useRpcMutation, k as useRpcQuery, l as useSharedPluginSettings, m as useSuiteSettings } from '../shared-settings-C1yRsiKp.js';
export { H as HelperSettingsCardProps, a as HelperSettingsField, b as HelperSettingsFieldKind, c as HelperSettingsFieldOverrides, d as HelperSettingsInputProps, e as HelperSettingsRowBaseProps, f as HelperSettingsScreenContribution, g as HelperSettingsScreenRegistrar, h as HelperSettingsSectionProps, i as HelperSettingsSelectComponent, j as HelperSettingsSelectProps, k as HelperSettingsSwitchProps, l as HelperSettingsUiBundle, R as RegisterHelperSettingsScreenOptions, m as contractSchemaToFields, r as registerHelperSettingsScreen } from '../settings-screen-V3oRvE_U.js';
import 'zod';
import '../settings-CP1gv9q3.js';
import '../rpc-D27pph91.js';
import '@tanstack/query-core';
import '@tanstack/react-query';

/**
 * Converts a hex color and opacity (0.0 to 1.0) into an 8-character hex or rgba string.
 */
declare function alpha(color: string, opacity: number): string;
/**
 * Calculates relative luminance (WCAG 2.0 formula) from a hex color.
 */
declare function getLuminance(hexColor: string): number;
/**
 * Returns either lightText or darkText depending on which has highest contrast against bgHex.
 */
declare function getContrastColor(bgHex: string, lightText?: string, darkText?: string): string;
/**
 * Resolves a StatusVariant to a corresponding theme color hex string.
 */
declare function getStatusColor(variant: StatusVariant, colors: ThemeColors, customAccent?: string): string;
/**
 * Returns background, text, and border styling colors for a given status variant.
 */
declare function getVariantPalette(variant: StatusVariant, colors: ThemeColors, customAccent?: string): {
    bg: string;
    text: string;
    border: string;
};

/**
 * Container width (px) at or below which a surface steps down to the compact
 * scale. Mirrors the host's `COMPACT_FORM_FACTOR_WIDTH` so plugin typography
 * in narrow popovers matches full-screen mobile surfaces.
 */
declare const COMPACT_FORM_FACTOR_WIDTH = 500;
/**
 * Resolves compact mode from the actual container width when it is known,
 * falling back to the host's viewport-derived `compact` flag otherwise.
 *
 * A host-declared compact surface stays compact at any width; a known width at
 * or below {@link COMPACT_FORM_FACTOR_WIDTH} forces compact even when the host
 * viewport is wide (e.g. a narrow header-button popover on desktop).
 */
declare function resolveEffectiveCompact(layout: ResponsiveLayout, widthOverride?: number): boolean;
/**
 * Checks if the current platform is mobile (iOS or Android).
 */
declare function isMobilePlatform(platform: PlatformType): boolean;
/**
 * Interactive target floor for a compact surface on a non-mobile platform
 * (e.g. a narrow desktop popover). Sits between the full-desktop floor and the
 * 44pt touch target: a mouse pointer needs a little more room than a wide
 * panel, but nothing like a finger-sized hit area.
 */
declare const COMPACT_DESKTOP_TOUCH_TARGET = 36;
/**
 * Returns the recommended minimum interactive target size (in pt/px).
 * Real touch platforms follow Apple HIG / Android Material (min 44pt); a
 * compact desktop surface gets a modest bump over the 28pt desktop floor.
 */
declare function getTouchTargetMin(layout: ResponsiveLayout): number;
/**
 * Selects a value based on compact/mobile vs desktop screen constraints.
 */
declare function responsiveValue<T>(layout: ResponsiveLayout, desktopVal: T, compactVal: T): T;
/**
 * Calculates adaptive padding based on compact mode and density preset.
 */
declare function resolvePadding(layout: ResponsiveLayout, density: DensityStyle): {
    horizontal: number;
    vertical: number;
    gap: number;
};
interface GridColumnOptions {
    /** Requested (and maximum) column count. */
    columns: number;
    /** Horizontal gap between cells, in px. Default: 0. */
    gap?: number;
    /** Measured container width, when the host reports one. */
    width?: number;
    /**
     * Minimum width each column should keep before wrapping to fewer columns.
     * Only applied when a positive container width is known; `columns` stays the
     * upper bound.
     */
    minColumnWidth?: number;
    /**
     * How a compact surface treats the requested column count.
     * - "never" (default): keep the requested columns; flexbox wraps as needed.
     * - "compact": collapse to a single column on a compact surface.
     */
    collapse?: "compact" | "never";
    /** Whether the current surface is compact. */
    isCompact?: boolean;
}
/**
 * Resolves the effective column count for a responsive grid.
 *
 * A `minColumnWidth` plus a known container width yields as many columns as
 * fit, capped at the requested count — so a narrow container wraps down to
 * fewer columns instead of the requested count being forced through.
 */
declare function resolveGridColumns(options: GridColumnOptions): number;
interface ResponsiveSelectOptions<T> {
    /**
     * Default fallback value, used on desktop/wide viewports if no more specific option matches.
     */
    desktop?: T;
    /**
     * Value to use on mobile platforms ('ios' | 'android').
     */
    mobile?: T;
    /**
     * Value to use when in compact mode (layout.compact === true), such as on mobile or narrow split panes.
     */
    compact?: T;
    /**
     * Value to use when not in compact mode (layout.compact === false).
     */
    wide?: T;
    /**
     * Platform-specific overrides ('web', 'desktop', 'ios', 'android', 'macos', 'windows', 'linux').
     */
    platform?: Partial<Record<PlatformType, T>>;
}
/**
 * Selects a value based on responsive criteria with priority:
 * 1. Platform-specific override (`options.platform?.[platform]`)
 * 2. Mobile platform match (`options.mobile` if mobile OS)
 * 3. Compact mode match (`options.compact` if layout.compact)
 * 4. Wide mode match (`options.wide` if !layout.compact)
 * 5. Desktop / Default (`options.desktop`)
 */
declare function responsiveSelect<T>(layout: ResponsiveLayout, options: ResponsiveSelectOptions<T>): T | undefined;

interface UseResponsiveResult {
    /**
     * Whether the container or viewport is in compact mode (narrow trackbar, mobile screen, or split-pane).
     */
    isCompact: boolean;
    /**
     * Whether the current OS platform is mobile ('ios' | 'android').
     */
    isMobile: boolean;
    /**
     * The platform identifier ('web' | 'desktop' | 'ios' | 'android' | 'macos' | 'windows' | 'linux').
     */
    platform: PlatformType;
    /**
     * Container width if reported by Paseo's layout.
     */
    width?: number;
    /**
     * Container height if reported by Paseo's layout.
     */
    height?: number;
    /**
     * Recommended minimum interactive touch target (44pt on mobile/compact, 28pt on desktop).
     */
    touchTargetMin: number;
    /**
     * Helper function to select a value based on the current responsive environment.
     */
    select: <T>(options: ResponsiveSelectOptions<T>) => T | undefined;
}
/**
 * Universal hook for responsive plugin UI across composer pills, modals, panels, and surfaces.
 * Automatically adapts based on Paseo's layout context (compact mode, mobile OS, touch targets).
 */
declare function useResponsive(): UseResponsiveResult;

interface InlineButtonProps {
    label: string;
    onPress?: () => void | Promise<void>;
    icon?: string | ReactNode;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityRole?: "button" | "link";
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
/** Compact text/link action for inline cards and timeline content. */
declare function InlineButton({ label, onPress, icon, disabled, accessibilityLabel, accessibilityRole, style, textStyle, }: InlineButtonProps): React__default.JSX.Element;

interface InteractiveRowProps {
    /** Arbitrary row content — status dots, badges, text, metric readouts. */
    children?: ReactNode;
    /**
     * Press handler. Receives the raw event so callers can control propagation
     * (e.g. a nested status light calling `event.stopPropagation()`).
     */
    onPress?: (event: GestureResponderEvent) => void;
    /** Native / RN-web tooltip text attached to the hit area. */
    title?: string;
    disabled?: boolean;
    accessibilityRole?: AccessibilityRole;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    testID?: string;
    /** Base layout style, merged before the interaction layers. */
    style?: StyleProp<ViewStyle>;
    /** Extra style layered only while hovered (and not disabled). */
    hoverStyle?: StyleProp<ViewStyle>;
    /** Apply a subtle theme accent tint while hovered. Default: false. */
    hoverTint?: boolean;
    /** Accent opacity used by `hoverTint`. Default: 0.05. */
    hoverTintOpacity?: number;
    /** Opacity while pressed. Default: 0.7. */
    pressedOpacity?: number;
    /** Opacity while hovered but not pressed. Defaults to `opacity`. */
    hoveredOpacity?: number;
    /** Opacity at rest. Default: 1. */
    opacity?: number;
    /** Opacity when disabled. Default: 0.45. */
    disabledOpacity?: number;
    /** Expanded touch target beyond the visual bounds. */
    hitSlop?: number;
    /** Notified whenever the hover state flips, for callers that tint their own children. */
    onHoverChange?: (hovered: boolean) => void;
}
/**
 * Hover-aware, pressable row container for dense interactive content (#580).
 *
 * Owns the interaction concerns a labeled `Button` cannot: a hover state (with
 * optional accent tint), an RN-web `title` tooltip, pressed opacity, a pointer
 * cursor, and an `onPress` that forwards the event for `stopPropagation`.
 * Content is arbitrary, so a status dot, badges, and metric readouts compose
 * inside without wrapping each in its own control.
 */
declare function InteractiveRow({ children, onPress, title, disabled, accessibilityRole, accessibilityLabel, accessibilityHint, testID, style, hoverStyle, hoverTint, hoverTintOpacity, pressedOpacity, hoveredOpacity, opacity, disabledOpacity, hitSlop, onHoverChange, }: InteractiveRowProps): React__default.JSX.Element;

interface StatusDotProps {
    variant?: StatusVariant;
    size?: "sm" | "md" | "lg";
    pulse?: boolean;
    style?: StyleProp<ViewStyle>;
}
declare function StatusDot({ variant, size, pulse, style }: StatusDotProps): React__default.JSX.Element;

interface CardProps {
    children: ReactNode;
    variant?: SurfaceStyle;
    style?: StyleProp<ViewStyle>;
    noPadding?: boolean;
}
interface CardHeaderProps {
    title: string;
    subtitle?: string;
    value?: string | number | ReactNode;
    badge?: ReactNode;
    action?: ReactNode;
    icon?: string;
    style?: StyleProp<ViewStyle>;
    titleStyle?: StyleProp<TextStyle>;
    subtitleStyle?: StyleProp<TextStyle>;
    /**
     * When set, every case-insensitive (literal, non-regex) occurrence of the
     * query inside `title` is painted with the accent highlight. With no literal
     * or token hit the whole title is marked, so a fuzzy match still reads.
     */
    highlightQuery?: string;
}
declare function CardHeader({ title, subtitle, value, badge, action, icon, style, titleStyle, subtitleStyle, highlightQuery, }: CardHeaderProps): React__default.JSX.Element;
declare function Card({ children, variant, style, noPadding }: CardProps): React__default.JSX.Element;
declare namespace Card {
    var Header: typeof CardHeader;
}

interface TabItem {
    id: string;
    label: string;
    /**
     * Optional abbreviated label for compact viewports in fit mode.
     * e.g. label: "Interactive Controls", shortLabel: "Controls"
     */
    shortLabel?: string;
    icon?: string;
    badge?: string | number;
}
interface TabsProps {
    tabs: TabItem[];
    activeTab: string;
    onTabChange: (tabId: string) => void;
    mode?: "auto" | "fit" | "scroll";
    style?: StyleProp<ViewStyle>;
}
declare function Tabs({ tabs, activeTab, onTabChange, mode, style, }: TabsProps): React__default.JSX.Element;

interface CodeBlockProps {
    code: string;
    language?: string;
    title?: string;
    maxHeight?: number;
    copyable?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
declare function CodeBlock({ code, language, title, maxHeight, copyable, style, textStyle, }: CodeBlockProps): React__default.JSX.Element;

type CopyButtonSize = "sm" | "md";
type CopyButtonVariant = "ghost" | "secondary";
interface CopyButtonFeedback {
    icon: string;
    label: string;
}
/**
 * Pure idle/copied visual state, split out so the feedback contract is
 * testable without a renderer or a clipboard. Callers may override the idle
 * `icon`/`label`; the copied state is always the Check/"Copied!" affordance.
 */
declare function resolveCopyButtonFeedback(copied: boolean, options?: {
    icon?: string;
    label?: string;
    copiedLabel?: string;
}): CopyButtonFeedback;
interface CopyButtonProps {
    /** Literal text to copy. Ignored when `getText` is provided. */
    text?: string;
    /** Lazy/Promise text source, resolved at press time. Takes precedence over `text`. */
    getText?: () => string | Promise<string>;
    /** Idle button label. Defaults to "Copy". */
    label?: string;
    /** Label shown after a successful copy. Defaults to "Copied!". */
    copiedLabel?: string;
    /** Icon name for the idle state. Defaults to "Copy". */
    icon?: string;
    size?: CopyButtonSize;
    variant?: CopyButtonVariant;
    accessibilityLabel?: string;
    /** Forwarded to the clipboard toast (e.g. "timeline card"). */
    toastMessage?: string;
    /** How long the Check/"Copied!" feedback stays up. Defaults to 2000ms. */
    feedbackDurationMs?: number;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
/**
 * Explicit copy affordance for styled/plugin surfaces.
 *
 * Web's selection-copy handler only rebuilds clipboard content for
 * `[data-testid="assistant-message"]` selections, so styled timeline, telemetry,
 * and panel content copies nothing (xpufx-org/paseo#278). This bypasses that
 * gate with the helper's host `copyText` / `copyToClipboard` path and shows
 * Check/"Copied!" feedback, matching CodeBlock's pattern.
 */
declare function CopyButton({ text, getText, label, copiedLabel, icon, size, variant, accessibilityLabel, toastMessage, feedbackDurationMs, disabled, style, textStyle, }: CopyButtonProps): React__default.ReactElement | null;

interface SearchInputProps {
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    onClear?: () => void;
    style?: StyleProp<ViewStyle>;
    inputStyle?: StyleProp<TextStyle>;
    testID?: string;
}
/**
 * Standardized search input with search icon, clear button, and theme support.
 */
declare function SearchInput({ value, onChangeText, placeholder, onClear, style, inputStyle, testID, }: SearchInputProps): React__default.JSX.Element;

interface TextInputProps {
    value: string;
    onChangeText: (text: string) => void;
    label?: string;
    placeholder?: string;
    helperText?: string;
    errorText?: string;
    secureTextEntry?: boolean;
    keyboardType?: KeyboardTypeOptions;
    autoCapitalize?: "none" | "sentences" | "words" | "characters";
    autoCorrect?: boolean;
    disabled?: boolean;
    mono?: boolean;
    multiline?: boolean;
    numberOfLines?: number;
    style?: StyleProp<ViewStyle>;
    inputStyle?: StyleProp<TextStyle>;
    onSubmitEditing?: () => void;
}
declare function TextInput({ value, onChangeText, label, placeholder, helperText, errorText, secureTextEntry, keyboardType, autoCapitalize, autoCorrect, disabled, mono, multiline, numberOfLines, style, inputStyle, onSubmitEditing, }: TextInputProps): React__default.JSX.Element;

interface SelectOption {
    label: string;
    value: string;
}
interface SelectProps {
    value: string;
    options: SelectOption[];
    onValueChange: (value: string) => void;
    label?: string;
    /** Compact/pill scale shared with {@link Badge}: `"md"` (default) or `"sm"`. */
    size?: BadgeSize;
    placeholder?: string;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
}
/**
 * Compact single-choice picker sized to sit inside a {@link FormRow}. The
 * closed trigger stays one line tall; opening mounts the menu in a root
 * transparent `<Modal>` overlay portal, so a long list never expands the
 * trigger's parent container, is never clipped by an ancestor
 * `overflow: "hidden"` (Card/Tabs/Modal), and always paints above later
 * siblings regardless of local stacking context.
 */
declare function Select({ value, options, onValueChange, label, size, placeholder, disabled, style, }: SelectProps): React__default.JSX.Element;

interface ToggleProps {
    value: boolean;
    onValueChange: (next: boolean) => void;
    label?: string;
    description?: string;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    labelStyle?: StyleProp<TextStyle>;
}
declare function Toggle({ value, onValueChange, label, description, disabled, style, labelStyle, }: ToggleProps): React__default.JSX.Element;

interface CollapsibleProps {
    title?: string | React__default.ReactNode;
    subtitle?: string | React__default.ReactNode;
    children: React__default.ReactNode;
    initiallyExpanded?: boolean;
    isExpanded?: boolean;
    onToggle?: (expanded: boolean) => void;
    badge?: React__default.ReactNode;
    headerRight?: React__default.ReactNode;
    summary?: React__default.ReactNode;
    icon?: string;
    style?: StyleProp<ViewStyle>;
    headerStyle?: StyleProp<ViewStyle>;
    contentStyle?: StyleProp<ViewStyle>;
    variant?: SurfaceStyle;
}
declare function resolveCollapsibleChevron(expanded: boolean): string;
/**
 * Container background for a Collapsible, honoring the same `SurfaceStyle`
 * contract as `Card`:
 * - "flat" (default): surface0, the normal page surface.
 * - "elevated": surface1, so the card visibly lifts off the page.
 * - "tinted": a faint accent wash.
 *
 * Before this existed, `variant="elevated"` only changed the border radius and
 * the container stayed `surface0` — so a card placed on an already-`surface0`
 * timeline read as a bleeding shaded band with no elevation (#208).
 */
declare function resolveCollapsibleSurface(colors: ThemeColors, alpha: (color: string, opacity: number) => string, variant?: SurfaceStyle): {
    backgroundColor: string;
    borderColor: string;
};
/**
 * Header stripe background. Kept for backwards compatibility; prefer
 * {@link resolveCollapsibleSurface} for the container and use this only for the
 * pressed/unpressed header delta.
 */
declare function resolveCollapsibleHeaderBackground(colors: ThemeColors, pressed: boolean): string;
declare function Collapsible({ title, subtitle, children, initiallyExpanded, isExpanded: controlledExpanded, onToggle, badge, headerRight, summary, icon, style, headerStyle, contentStyle, variant, }: CollapsibleProps): React__default.JSX.Element;

interface ProgressBarProps {
    value: number;
    color?: string;
    autoStatusColor?: boolean;
    thresholds?: MetricThresholds;
    label?: string;
    showValueText?: boolean;
    height?: number;
    style?: StyleProp<ViewStyle>;
}
declare function ProgressBar({ value, color, autoStatusColor, thresholds, label, showValueText, height, style, }: ProgressBarProps): React__default.JSX.Element;

interface MetricGaugeProps {
    value: number;
    size?: number;
    strokeWidth?: number;
    thresholds?: MetricThresholds;
    color?: string;
    autoStatusColor?: boolean;
    label?: string;
    showPercent?: boolean;
    centerSlot?: ReactNode;
    style?: StyleProp<ViewStyle>;
}
/**
 * Clean circular metric gauge.
 * Displays a proportional percentage ring with automated threshold coloring and center slot.
 */
declare function MetricGauge({ value, size, strokeWidth, thresholds, color, autoStatusColor, label, showPercent, centerSlot, style, }: MetricGaugeProps): React__default.JSX.Element;

interface DataColumn<T> {
    key: string;
    header: string;
    flex?: number;
    width?: number;
    align?: "left" | "center" | "right";
    render: (item: T) => ReactNode;
}
interface DataTableProps<T> {
    data: T[];
    columns: DataColumn<T>[];
    keyExtractor: (item: T, index: number) => string;
    emptyState?: ReactNode;
    style?: StyleProp<ViewStyle>;
}
/**
 * Responsive data table that automatically reflows between a traditional table
 * on desktop and structured card list on mobile / compact viewports.
 */
declare function DataTable<T>({ data, columns, keyExtractor, emptyState, style, }: DataTableProps<T>): React__default.JSX.Element | null;

type KeyValueTruncateMode = "end" | "middle" | "path";
interface KeyValueProps {
    label: string;
    value: string | number | null | undefined;
    subValue?: string;
    mono?: boolean;
    copyable?: boolean;
    /** Truncate long value: "middle" (UUIDs/hashes), "path" (filepaths), or "end" (standard) */
    truncate?: boolean | KeyValueTruncateMode;
    /** Maximum length before truncation applies. Default: 32 */
    truncateMaxLength?: number;
    /** Custom options when truncate="path" */
    truncatePathOptions?: TruncatePathOptions;
    /**
     * "stacked" (default) keeps the existing label-above-value layout.
     * "inline" renders label and value on one line, with the value truncating
     * middle so the row stays a single text line.
     */
    layout?: "stacked" | "inline";
    stackOnCompact?: boolean;
    style?: StyleProp<ViewStyle>;
    labelStyle?: StyleProp<TextStyle>;
    valueStyle?: StyleProp<TextStyle>;
}
declare function KeyValue({ label, value, subValue, mono, copyable, truncate: truncateProp, truncateMaxLength, truncatePathOptions, layout, stackOnCompact, style, labelStyle, valueStyle, }: KeyValueProps): React__default.JSX.Element;
interface KeyValueGroupProps {
    children: ReactNode;
    columns?: 1 | 2 | 3 | 4;
    gap?: number;
    /**
     * How a compact surface treats the column count.
     * - "compact" (default): collapse to a single column on a compact surface —
     *   the historical behavior.
     * - "never": keep the requested column count on a compact surface.
     */
    collapse?: "compact" | "never";
    /**
     * Minimum width a column should keep. When set and the container width is
     * known, the effective column count is capped so each column stays at least
     * this wide, wrapping to fewer columns rather than collapsing to one.
     * `columns` remains the upper bound.
     */
    minColumnWidth?: number;
    style?: StyleProp<ViewStyle>;
}
declare function KeyValueGroup({ children, columns, gap, collapse, minColumnWidth, style, }: KeyValueGroupProps): React__default.JSX.Element;

interface EmptyStateProps {
    icon?: string | ReactNode;
    title: string;
    description?: string;
    action?: ButtonProps;
    actionLabel?: string;
    onAction?: () => void;
    style?: StyleProp<ViewStyle>;
}
declare function EmptyState({ icon, title, description, action, actionLabel, onAction, style, }: EmptyStateProps): React__default.JSX.Element;

interface ResponsiveProps {
    /**
     * Content to render on desktop / wide viewports.
     */
    desktop?: ReactNode;
    /**
     * Content to render on mobile platforms ('ios' | 'android').
     */
    mobile?: ReactNode;
    /**
     * Content to render when in compact mode (narrow trackbar, mobile bottom sheet, or split view).
     */
    compact?: ReactNode;
    /**
     * Content to render when in wide mode (not compact).
     */
    wide?: ReactNode;
    /**
     * Render function taking `UseResponsiveResult` or children.
     */
    children?: ReactNode | ((responsive: UseResponsiveResult) => ReactNode);
}
/**
 * Declarative component for rendering different UI elements across desktop, mobile, and compact layouts.
 *
 * @example
 * ```tsx
 * <Responsive
 *   desktop={<DataTable columns={["ID", "Name", "Status", "Latency"]} data={items} />}
 *   mobile={<DataTable columns={["Name", "Status"]} data={items} />}
 * />
 * ```
 */
declare function Responsive({ desktop, mobile, compact, wide, children }: ResponsiveProps): React__default.JSX.Element;

interface AboutLink {
    label: string;
    url: string;
    icon?: string;
}
interface AboutSectionProps {
    /**
     * Name of the plugin.
     */
    name: string;
    /**
     * Short description or tagline.
     */
    description?: string;
    /**
     * Semantic version string (e.g. from `PLUGIN_VERSION` or package.json).
     */
    version: string;
    /**
     * Author or organization name.
     */
    author?: string;
    /**
     * Logo or icon to display.
     * - A React Native image source object: `{ uri: "https://..." }` or `require("./assets/logo.png")`
     * - A string starting with "http" (e.g. avatar/logo URL)
     * - A Paseo Lucide icon name (e.g. "Cpu", "Layers", "Sparkles")
     * - If omitted and `repository` or `author` is a GitHub link/username, defaults to the GitHub avatar!
     */
    logo?: ImageSourcePropType | string;
    /**
     * Repository URL (e.g. "https://github.com/xpufx/paseo-top").
     */
    repository?: string;
    /**
     * Issue tracker URL (e.g. "https://github.com/xpufx/paseo-top/issues").
     */
    issues?: string;
    /**
     * Documentation website or wiki URL.
     */
    homepage?: string;
    /**
     * License identifier (e.g. "MIT", "Apache-2.0").
     */
    license?: string;
    /**
     * Custom additional links.
     */
    links?: AboutLink[];
    /**
     * Extra diagnostic or environmental items to display in the details section.
     */
    extraItems?: Array<{
        label: string;
        value: string;
        subValue?: string;
        copyable?: boolean;
    }>;
    /**
     * Whether to display the "Copy Diagnostics" button. Default: true.
     */
    showDiagnosticsCopy?: boolean;
    /**
     * Optional custom container style.
     */
    style?: StyleProp<ViewStyle>;
    /**
     * Visual density. `"tiny"` scales all fonts to the smallest readable
     * size for dense About pages. Default: `"default"`.
     */
    density?: "default" | "compact" | "tiny";
}
/**
 * `<AboutSection>` provides a standardized, responsive plugin information and diagnostics view.
 *
 * Features:
 * - Displays plugin branding, author, description, version, and license badges.
 * - Supports custom logo images, local asset requires, Lucide icons, or auto-resolved GitHub avatars.
 * - One-click "Copy Diagnostics" button formatting system info for GitHub issue triage.
 * - Pre-styled external links with native browser launch via React Native `Linking`.
 */
declare function AboutSection({ name, description, version, author, logo, repository, issues, homepage, license, links, extraItems, showDiagnosticsCopy, style, density, }: AboutSectionProps): React__default.JSX.Element;

type TruncateMode = "end" | "middle" | "path";
interface TruncatedTextProps {
    /** The full, raw text string (e.g. UUID, file path, commit SHA, token) */
    text: string;
    /** Maximum length allowed before truncation. Default: 32 */
    maxLength?: number;
    /** Truncation algorithm: "middle" (UUIDs/hashes), "path" (directory paths), or "end" (standard). Default: "middle" */
    mode?: TruncateMode;
    /** Additional path truncation options when mode="path" */
    pathOptions?: TruncatePathOptions;
    /** Whether to render an inline copy button. Default: true */
    copyable?: boolean;
    /** Use monospace font. Default: true */
    mono?: boolean;
    /** Toast message on successful copy. Default: "Copied" */
    toastMessage?: string;
    /** Custom container style */
    style?: StyleProp<ViewStyle>;
    /** Custom text style */
    textStyle?: StyleProp<TextStyle>;
}
/**
 * Renders long strings (paths, UUIDs, hashes) shortened with smart truncation,
 * while preserving the full untruncated string for one-click clipboard copying.
 */
declare function TruncatedText({ text, maxLength, mode, pathOptions, copyable, mono, toastMessage, style, textStyle, }: TruncatedTextProps): React__default.JSX.Element;

interface CommandBoxProps {
    /** argv array — program is rendered bold, args muted */
    argv?: string[];
    /** Optional override to display a pre-joined string instead of argv */
    command?: string;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    /** Accessibility label override for the copy button */
    copyLabel?: string;
}
declare function formatCommandLine(argv: string[]): string;
declare function CommandBox({ argv, command, style, textStyle, copyLabel, }: CommandBoxProps): React__default.ReactElement | null;

interface SectionHeaderProps {
    title: string;
    /** Optional count — shown as a Badge (warning variant when > 0, neutral otherwise) */
    count?: number;
    /** Badge variant override */
    badgeVariant?: StatusVariant;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
declare function SectionHeader({ title, count, badgeVariant, style, textStyle, }: SectionHeaderProps): React__default.ReactElement | null;

interface HighlightedTextProps {
    /** Source text rendered as-is when no query is active. */
    text: string;
    /**
     * Active search query; matched case-insensitively and never as a regex. When
     * the literal query is absent the query's tokens are highlighted, so a fuzzy
     * result still reads.
     */
    query: string;
    style?: StyleProp<TextStyle>;
    /**
     * Overrides the matched-run style. Defaults to the theme accent background
     * with `accentForeground` text so a match reads as selected.
     */
    highlightStyle?: StyleProp<TextStyle>;
    numberOfLines?: number;
    selectable?: boolean;
    /**
     * When true, a query with no literal or token hit marks the whole text, so a
     * fuzzy search result still reads as matched. Use it on the primary label
     * (row/detail title) rather than every small field.
     */
    fuzzyFallback?: boolean;
}
/**
 * `<Text>` that paints every case-insensitive occurrence of `query` with the
 * accent background/foreground. The query is matched literally, so user input
 * is never evaluated as a regular expression. When the literal query is absent
 * the splitter highlights the query's tokens; `fuzzyFallback` additionally
 * marks the whole text when even a token misses, so a fuzzy result is not left
 * silently unmarked. Renders the plain text when the query is empty or absent.
 */
declare function HighlightedText({ text, query, style, highlightStyle, numberOfLines, selectable, fuzzyFallback, }: HighlightedTextProps): React__default.JSX.Element;

type ModalBodySize = "default" | "large";
interface ModalBodyProps {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    header?: ReactNode;
    headerStyle?: StyleProp<ViewStyle>;
    /**
     * Advisory density hint. It carries no width floor: the host `Modal` has no
     * size prop, so a content-side `minWidth` would override the host dialog
     * allocation and clip inside narrow docks (paseo#641). Use `maxContentWidth`
     * for a readable dense column. Ignored on compact/mobile surfaces.
     */
    size?: ModalBodySize;
    /**
     * Optional upper bound (px) on the content column width. On large viewports
     * the host still allocates a wide dialog, but the body's content column stays
     * readable instead of stretching edge-to-edge: `width: "100%"` keeps it fluid
     * below the cap and `alignSelf: "center"` centers the capped column. Undefined
     * (default) preserves the fully fluid body. This does not dictate the dialog
     * frame; widen the frame with `size` when dense content genuinely needs room.
     */
    maxContentWidth?: number;
    /**
     * "scroll" (default): header renders INSIDE the helper-owned compact/mobile
     * ScrollView and moves with content. "pinned": header renders above that
     * compact/mobile scroller; on desktop the host remains the scroll owner.
     */
    headerMode?: "pinned" | "scroll";
    /**
     * Scroll ownership override. "auto" (default) renders the helper-owned
     * scroller only on compact/mobile surfaces and defers to the host elsewhere.
     * "always" makes the helper the scroll owner on every surface; use it when
     * the host supplies no scroller because the content view is bounded
     * (`ModalContent` passes it for `<Modal.Content scrollable={false}>`).
     */
    scrollMode?: "auto" | "always";
    /**
     * When set, ModalBody logs measured layout values (viewport height,
     * content height) via onLayout/onContentSizeChange under this tag, e.g.
     * `[ModalBody:mcp] viewport=… content=…`. Use on-device to see which
     * container actually scrolls instead of guessing from theory (#110).
     */
    debugTag?: string;
    extraBottomInset?: number;
    refreshing?: boolean;
    onRefresh?: () => void | Promise<void>;
    stickToEnd?: boolean;
    scrollRef?: Ref<ScrollView>;
}
/**
 * Scroll-ownership signal for `ModalBody`.
 *
 * - `"helper"` — the default; `ModalBody` decides from the surface
 *   (compact/mobile) and `scrollMode`.
 * - `"host"` — an ancestor host view already provides the one scroller
 *   (0.8 composer popovers). `ModalBody` renders plain content.
 * - `"required"` — the ancestor has NO host scroller and the content is
 *   host-sized, so `ModalBody` MUST own the scroll on every surface. Set by
 *   `registerSidebarSurface` (a plugin surface is a full host page whose body
 *   is not wrapped in a host scroller) and by `ModalContent`.
 *
 * Adding the `"required"` member is additive: the existing two values keep
 * their meaning and the default stays `"helper"`.
 */
type ModalBodyScrollOwner = "helper" | "host" | "required" | "popover";
declare const ModalBodyScrollOwnerContext: React__default.Context<ModalBodyScrollOwner>;
/**
 * Mobile-safe scrollable body for Paseo <Modal.Content>.
 *
 * Size contract: a modal takes the host-allocated dialog size and is fluid
 * within it. `ModalBody` fills that allocation (`flex: 1`, `minHeight: 0`,
 * `width: "100%"`) and never lets its children drive the dialog frame, so the
 * modal stays stable while content loads, refreshes, or grows. Do not wrap it
 * in a container that hardcodes `minWidth`/`minHeight`/`width`/`height` or that
 * sizes itself to its children - that reintroduces content-driven resize/redraw.
 * Shrinkable text uses `minWidth: 0` + `flexShrink: 1`, never a fixed dimension.
 *
 * Host behavior differs by platform: on desktop the host owns a bounded dialog
 * and its outer scroll, so `ModalBody` renders plain content and adds no second
 * scroll region. On mobile the host presents a bottom sheet
 * (`AdaptiveModalSheet`) that already owns the viewport and sheet gesture, so
 * `ModalBody` defers to a host-provided scroller (or a plain view) and only adds
 * the safe bottom inset. Plugin code must not guess either size.
 *
 * Scroll ownership: ordinary compact/mobile modal content uses this helper
 * scroller. A 0.8 composer popover is different: Paseo's MenuSurface already
 * supplies the sole outer scroller, and registerComposerPill marks that
 * subtree through ModalBodyScrollOwnerContext so this component renders plain
 * content instead. Pass `scrollMode="always"` when the host content view is
 * bounded and supplies no scroller (`ModalContent` does this), so the helper
 * scrolls on desktop too instead of clipping the bounded dialog.
 * "pinned" is opt-in. Desktop surfaces retain host-owned scrolling so they do
 * not create a second scrollbar; web hosts pin the header with sticky layout.
 * Automatically calculates responsive bottom padding so controls are not cut off
 * by mobile home bars or virtual keyboards.
 * Supports pull-to-refresh on mobile via `refreshing` and `onRefresh`.
 * Uses the host ScrollView from initClientHelpers when supplied (sheet-gesture
 * integrated on Paseo v0.8), otherwise plain React Native ScrollView.
 * Pass `stickToEnd` for conversation-style views that track new content, or
 * `scrollRef` for imperative scrolling.
 * Pass `header` for a pinned navbar (e.g. <Tabs>): it renders above the
 * scroller in a flex column, so the header stays fixed while the body scrolls.
 * Requires the host <Modal.Content scrollable={false}> so no outer sheet
 * scroller drags the header along.
 */
declare function ModalBody({ children, style, contentContainerStyle, header, headerStyle, headerMode, maxContentWidth, scrollMode, debugTag, extraBottomInset, refreshing, onRefresh, stickToEnd, scrollRef, }: ModalBodyProps): React__default.JSX.Element;

interface ModalContentProps extends Omit<ModalBodyProps, "scrollMode"> {
    children: ReactNode;
    /**
     * Whether the host owns the outer scroll container.
     * Defaults to `true` so host desktop mouse wheel, trackpad, and mobile bottom
     * sheet gestures scroll natively without fighting an inner scroller.
     * Set to `false` only if the modal contains a custom internal scroller
     * (e.g. virtualized list or canvas).
     */
    scrollable?: boolean;
}
/**
 * Helper-owned modal body for plugins that open their own host `<Modal>`.
 *
 * Delegates scroll ownership to the host `<Modal.Content>` (scrollable by default)
 * so desktop mouse wheel, trackpad, and mobile bottom sheet gestures scroll
 * natively under Paseo host rules without fighting an inner scroller.
 *
 * Sizing stays fluid within the host-allocated modal frame, respecting
 * `size?: "default" | "large"`.
 *
 * ```tsx
 * <Modal title="…" open={open} onOpenChange={setOpen}>
 *   <ModalContent size="default">
 *     …cards, controls, rows…
 *   </ModalContent>
 * </Modal>
 * ```
 *
 * Accepts every `ModalBody` prop (header, headerMode, refreshing, onRefresh,
 * stickToEnd, scrollRef, debugTag, style, contentContainerStyle, …).
 */
declare function ModalContent({ children, scrollable, ...bodyProps }: ModalContentProps): React__default.JSX.Element;

interface ActionBarProps {
    children: ReactNode;
    align?: "flex-start" | "flex-end" | "center" | "space-between";
    direction?: "row" | "column" | "auto";
    style?: StyleProp<ViewStyle>;
}
/**
 * Responsive action toolbar for modals and surfaces.
 * Automatically wraps or stacks on compact/mobile layouts.
 */
declare function ActionBar({ children, align, direction, style, }: ActionBarProps): React__default.JSX.Element;

interface FormRowProps {
    label: string;
    description?: string;
    children: ReactNode;
    /**
     * "stacked" (default) keeps the historical label/description above the
     * control. "inline" puts the label + description in a left column and the
     * control on the right of the SAME line, which is what a short control
     * (Toggle, StatusDot, Badge, small Button) wants. Stacking a one-line
     * control under its label doubles a settings row's height for no gain
     * (xpufx-org/paseo#213).
     */
    layout?: "stacked" | "inline";
    style?: StyleProp<ViewStyle>;
}
declare function FormRow({ label, description, children, layout, style, }: FormRowProps): React__default.JSX.Element;

interface RowProps {
    children?: ReactNode;
    /** Gap between children: a spacing token or raw px. Defaults to the theme gap. */
    gap?: SpacingValue;
    /** Allow children to wrap onto the next line. Default: false. */
    wrap?: boolean;
    align?: ViewStyle["alignItems"];
    justify?: ViewStyle["justifyContent"];
    style?: StyleProp<ViewStyle>;
    testID?: string;
}
/**
 * Horizontal flexbox row with theme-derived gap. A thin vocabulary wrapper so
 * plugins stop hand-rolling `<View style={{ flexDirection: "row", gap }}>`.
 */
declare function Row({ children, gap, wrap, align, justify, style, testID }: RowProps): React__default.JSX.Element;

interface StackProps {
    children?: ReactNode;
    /** Gap between children: a spacing token or raw px. Defaults to the theme gap. */
    gap?: SpacingValue;
    align?: ViewStyle["alignItems"];
    justify?: ViewStyle["justifyContent"];
    style?: StyleProp<ViewStyle>;
    testID?: string;
}
/**
 * Vertical flexbox stack with theme-derived gap. The deliberate column default,
 * named so it composes visually alongside {@link Row}.
 */
declare function Stack({ children, gap, align, justify, style, testID }: StackProps): React__default.JSX.Element;
/** Explicit vertical-stack alias; identical to {@link Stack}. */
declare const VStack: typeof Stack;

interface GridProps {
    children?: ReactNode;
    /** Maximum column count. Default: 2. */
    columns?: number;
    /**
     * Minimum width a column should keep. When set and the container width is
     * known, the grid uses as many columns as fit (up to `columns`) and wraps
     * down instead of collapsing to one.
     */
    minColumnWidth?: number;
    /** Gap between cells: a spacing token or raw px. Defaults to the theme gap. */
    gap?: SpacingValue;
    style?: StyleProp<ViewStyle>;
    testID?: string;
}
/**
 * Width-aware wrapping grid. Cells keep a percentage basis driven by the
 * effective column count, so they reflow across rows rather than stacking
 * one-per-line or collapsing to a single column.
 */
declare function Grid({ children, columns, minColumnWidth, gap, style, testID }: GridProps): React__default.JSX.Element;

interface RenderPillProps<TPayload = any> extends HostPillProps {
    isOpen: boolean;
    open: (payload?: TPayload) => void;
    close: () => void;
    toggle: (payload?: TPayload) => void;
}
interface RenderModalProps<TPayload = any> extends HostPillProps {
    close: () => void;
    payload?: TPayload;
}
interface PillLiveContext {
    agentId: string;
    workspaceId: string;
}
interface PillLivePayload {
    label?: string;
    icon?: string;
}
type PillLabelResolver = (context: PillLiveContext) => string | PillLivePayload | undefined | Promise<string | PillLivePayload | undefined>;
type PillIconResolver = (context: PillLiveContext) => string | undefined | Promise<string | undefined>;
/**
 * Single precedence rule for pill modal scroll ownership (#219), shared by
 * the centered and legacy modal wrappers so they cannot disagree.
 * `true` delegates the scroller to the host `<Modal.Content>`; `false`
 * (default) keeps the legacy bounded dialog for `ModalBody`-based content.
 * Either way the wrapper renders exactly one `<Modal.Content>`.
 */
declare function resolvePillModalScrollable(hostScroll?: boolean): boolean;
interface RegisterComposerPillOptions<TPayload = any> {
    /**
     * Unique ID for the pill (e.g. "paseo-top", "mcp-monitor").
     */
    id: string;
    /**
     * Title shown in the composer trackbar (keep concise, e.g. "top", "CPU 12%").
     */
    title: string;
    /**
     * Optional compact title shown in the composer trackbar when screen or track is narrow/mobile
     * (when `layout.compact` is true). Defaults to `title`.\
     */
    compactTitle?: string;
    /**
     * Optional custom title shown in the modal header (defaults to `title`).
     * Useful when the modal needs a full descriptive title (e.g. "Host System Resources").
     */
    modalTitle?: string;
    /**
     * Lucide icon name for the pill (e.g. "Cpu", "Server", "MessageSquare").
     */
    icon?: string;
    /**
     * Optional compact Lucide icon name shown when in compact mode. Defaults to `icon`.
     */
    compactIcon?: string;
    /**
     * Optional custom icon for the modal header. Can be a Lucide icon name string or a JSX element.
     * If omitted, falls back to `icon`.
     */
    modalIcon?: string | ReactNode;
    /**
     * Optional visual flair preset or overrides for the plugin's theme.
     */
    flair?: Partial<VisualFlair>;
    /**
     * Optional custom badge text shown inside the default pill (e.g. "LIVE", "3").
     */
    badgeText?: string;
    /**
     * Optional compact badge text shown inside the default pill in compact mode. Defaults to `badgeText`.
     */
    compactBadgeText?: string;
    /**
     * Optional callback to resolve default payload when the outer host pill is clicked.
     * Receives agentId and workspaceId.
     */
    resolveDefaultPayload?: (context: {
        agentId: string;
        workspaceId: string;
    }) => TPayload | undefined;
    /**
     * Custom pill body renderer if you want to replace the default pill layout.
     * Receives `isOpen`, `open`, `close`, and `toggle` along with standard pill props.\
     */
    renderPill?: (props: RenderPillProps<TPayload>) => ReactNode;
    /**
     * Resolves the live pill label (and optionally icon) on button-shaped hosts (Paseo 0.8+), where the
     * pill body is host-rendered from a static `label` and `icon` string and `renderPill`
     * never mounts. Called once at registration and then every
     * `refreshIntervalMs`. Keep it cheap and synchronous when possible; async
     * resolvers are awaited. Returning `undefined` leaves the current label/icon.
     * Can return a plain string (label) or an object `{ label?: string; icon?: string }`.
     * Cycle modes can advance rotation state on each call.
     */
    resolveLabel?: PillLabelResolver;
    /**
     * Optional standalone resolver for the button icon on button-shaped hosts (Paseo 0.8+).
     * Evaluated alongside `resolveLabel` on each tick.
     */
    resolveIcon?: PillIconResolver;
    /**
     * Poll interval for `resolveLabel` on button-shaped hosts. Defaults to 5000ms
     * when `resolveLabel` or `resolveIcon` is set. Set to 0 to resolve once at registration.
     * Ignored on legacy hosts (their `renderPill` re-renders via React state).
     */
    refreshIntervalMs?: number;
    /**
     * Fixed width, in pixels, for the anchored popover on non-compact hosts.
     *
     * Without it the popover is sized from its content, so any content that
     * reflows (a measured table, a responsive group, a gauge that settles) can
     * resize the surface under the pointer. Pinning the width makes the frame the
     * authority and lets the content overflow into its own scroll/clip instead.
     *
     * Ignored on compact hosts, where the same content renders in a full-bleed
     * bottom sheet. Clamped to the window width so a fixed width cannot overflow
     * a narrow viewport.
     */
    popoverWidth?: number;
    /**
     * Renders the content inside the controlled modal.
     * Automatically wrapped with PluginThemeProvider and supplied with a `close()` helper and optional payload.
     * On button-shaped hosts (Paseo 0.8+) the modal is replaced by an anchored
     * popover rendering this same content at the host surface width (expect a
     * narrow column, not a wide modal); keep content vertically stacked and
     * reflowing. `open`/`toggle` from `renderPill` cannot drive host-owned
     * popovers, so live pill text comes from `resolveLabel` instead.
     *
     * The wrapper renders exactly one host `<Modal.Content>` around this output
     * on the modal paths (legacy + centered). Never render another
     * `<Modal.Content>` here — use `HostModalSection` from
     * `paseo-plugin-helper/ui` for fluid content. (`HostModalContent` is only
     * for plugins that open their OWN host `<Modal>`.)
     */
    renderModal?: (props: RenderModalProps<TPayload>) => ReactNode;
    /**
     * Host-owned scroll for the pill modal paths (#219).
     * - `false` (default, legacy): the wrapper renders
     *   `<Modal.Content scrollable={false}>` (bounded dialog) and
     *   `ModalBody`-based content owns the one scroller.
     * - `true`: the wrapper renders `<Modal.Content scrollable={true}>` so the
     *   host scrolls, and `renderModal` must provide fluid content with NO
     *   nested `<Modal.Content>` or scroller (`HostModalSection`).
     * Exactly one `<Modal.Content>` is rendered in both modes. The 0.8 popover
     * path is unaffected (plain host-owned container either way).
     */
    hostScroll?: boolean;
    /**
     * Makes the pill an action button instead of a tethered popover: pressing it
     * calls this and the host never mounts a popover. Use it to open a plugin
     * surface (`openSurface(id)`), which the host renders outside the composer —
     * an agent-stream re-render of the composer then cannot remount it. Ignored
     * when unset, in which case `renderModal` renders the popover.
     */
    onPress?: () => void | Promise<void>;
    /**
     * How an open pill presents.
     * - `"popover"` (default): the host anchors `renderModal` to the pill. The
     *   host may remount that subtree on every composer re-render, which can tear
     *   an open popover down.
     * - `"centered"`: the host `Modal` is rendered from the pill's always-mounted
     *   icon and toggled by the pill press, so the surface is not a child of the
     *   composer popover and a composer re-render does not unmount it.
     */
    presentation?: "popover" | "centered";
    /**
     * Called when a pill cannot be registered on the current host (for example
     * a host API mismatch). Reporting instead of throwing keeps the rest of the
     * plugin client alive; render the message in your own panel to make it visible.
     */
    onError?: (info: {
        agentId: string;
        workspaceId: string;
        error: Error;
    }) => void;
}
/**
 * Registers an agent-scoped composer pill and modal lifecycle.
 * Manages agent subscription events, unmount cleanup, and pill-to-modal activation.
 *
 * Works against both host generations: legacy `{Component, onPress}` pills
 * (Paseo 0.7 and beta apps) and `button`-descriptor pills (Paseo 0.8+), detected
 * once per call with a throwaway probe registration that is removed immediately.
 */
declare function registerComposerPill<TPayload = any>(client: ComposerPillRegistrar, options: RegisterComposerPillOptions<TPayload>): PluginCleanup;

/**
 * Structural registrar interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginClientContext.
 */
interface SidebarSurfaceRegistrar {
    addSurface(surfaceId: string, Component: ComponentType<HostSurfaceProps>): any;
    addSidebarItem(contribution: any): any;
}
interface RegisterSidebarSurfaceOptions {
    id: string;
    title: string;
    icon: string;
    Component: ComponentType<HostSurfaceProps>;
    flair?: VisualFlair;
}
/**
 * Registers a sidebar icon and corresponding full-page surface in a single call,
 * automatically injecting `<PluginThemeProvider>` with custom visual flair.
 * Works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 *
 * A sidebar surface is a full host page: Paseo routes to it directly and does
 * NOT wrap the surface body in a host scroller (unlike `<Modal.Content>`, which
 * bounds the dialog and supplies the outer scroll). Any `ModalBody` in the
 * subtree would therefore pick the plain, non-scrolling branch on a
 * non-compact desktop and clip overflowing content — the recurring
 * "plugin page does not scroll" bug. Marking the subtree with the
 * `"required"` scroll-owner context makes every `ModalBody` inside own the
 * scroll on every surface, so plugins inherit working scroll with no
 * per-plugin workaround.
 *
 * Returns an idempotent disposer that removes both the surface and the sidebar
 * item, matching every other helper `add*` registration. Existing callers that
 * ignore the return value are unaffected.
 */
declare function registerSidebarSurface(plugin: SidebarSurfaceRegistrar, options: RegisterSidebarSurfaceOptions): () => void;

/**
 * Structural registrar interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginClientContext.
 */
interface WorkspacePanelRegistrar {
    addWorkspacePanel(contribution: any): any;
}
interface RegisterWorkspacePanelOptions {
    id: string;
    title: string;
    icon: string;
    Component: ComponentType<HostWorkspacePanelProps>;
    flair?: VisualFlair;
    /** Host locations in which the panel should be available. */
    locations?: string[];
}
interface RegisterAgentPanelOptions {
    id: string;
    title: string;
    icon: string;
    Component: ComponentType<HostAgentPanelProps>;
    flair?: VisualFlair;
}
/**
 * Registers a workspace-scoped panel with automatic `<PluginThemeProvider>` injection.
 * Works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 */
declare function registerWorkspacePanel(plugin: WorkspacePanelRegistrar, options: RegisterWorkspacePanelOptions): () => void;
/**
 * Registers an agent-scoped panel with automatic `<PluginThemeProvider>` injection.
 * Works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 */
declare function registerAgentPanel(plugin: WorkspacePanelRegistrar, options: RegisterAgentPanelOptions): void;

interface CopyToClipboardOptions {
    toast?: HostToast;
    toastMessage?: string;
}
type ClipboardTier = "navigator" | "host" | "rnAsync" | "rnSync" | "execCommand";
interface ClipboardEnvironment {
    hasNavigatorClipboard: boolean;
    hasHostCopyText: boolean;
    hasRnClipboard: boolean;
    hasRnSetStringAsync: boolean;
    isDom: boolean;
}
/**
 * Deterministic tier order for an explicit copy.
 *
 * Web's `navigator.clipboard.writeText` is the only API that rejects when the
 * clipboard did not change, so it leads. The synchronous
 * `react-native-web` `Clipboard.setString` reports success even when its
 * `document.execCommand("copy")` fails, which leaves the previous clipboard
 * item in place while the UI claims success (xpufx-org/paseo#278); it is only
 * usable off-DOM (native), where it is the real platform clipboard. The same
 * applies to any `setStringAsync` whose DOM fallback is that unverified
 * `execCommand`. In a DOM the checked `execCommand` fallback is preferred to
 * those unverifiable paths.
 */
declare function clipboardTierOrder(env: ClipboardEnvironment): ClipboardTier[];
/**
 * Robust cross-platform clipboard copy helper for Paseo plugins.
 * Works seamlessly across React Native (mobile), web, and desktop.
 *
 * Tier order comes from `clipboardTierOrder`; every tier reports failure
 * honestly so a denied or blocked write never leaves the previous clipboard
 * item behind under a fake success.
 */
declare function copyToClipboard(text: string, options?: CopyToClipboardOptions): Promise<boolean>;

type HapticFeedbackType = "light" | "medium" | "heavy" | "success" | "warning" | "error";
/**
 * Cross-platform haptic feedback helper for Paseo plugins.
 * Supports web vibration API and graceful fallback when vibration is unavailable.
 */
declare function triggerHaptic(type?: HapticFeedbackType): boolean;

interface CustomPillBodyProps {
    state: CustomPillState;
}
/**
 * Standard pill body renderer for a custom metric pill in the composer trackbar.
 * Automatically adapts to responsive compact/mobile modes and shows threshold status.
 */
declare function CustomPillBody({ state }: CustomPillBodyProps): React__default.JSX.Element;
interface CustomPillModalContentProps {
    state: CustomPillState;
    onRefresh?: () => Promise<void> | void;
    isRefreshing?: boolean;
}
/**
 * Full modal inspection content for a custom metric pill.
 * Shows status, preformatted command output, last updated time, and quick actions.
 *
 * Sized by the host: the root fills the host-allocated modal frame (flex/fluid)
 * so changing output never drives the dialog size.
 */
declare function CustomPillModalContent({ state, onRefresh, isRefreshing, }: CustomPillModalContentProps): React__default.JSX.Element;
interface RegisterCustomPillsOptions {
    /**
     * The list of custom pill states or definitions.
     */
    pills: CustomPillState[];
    /**
     * Callback invoked when a pill needs a fresh refresh or modal command run.
     */
    onRefreshModal?: (pillId: string) => Promise<{
        output?: string;
        error?: string;
    }>;
    /**
     * Optional visual flair overrides.
     */
    flair?: Partial<VisualFlair>;
}
/**
 * Registers one or more declarative custom metric pills into Paseo's composer trackbar.
 * Automatically handles pill lifecycle, responsive layouts, and drill-down inspection modals.
 */
declare function registerCustomPills(client: ComposerPillRegistrar, options: RegisterCustomPillsOptions): PluginCleanup;

declare function Icon(props: HostIconProps): React__default.JSX.Element;

/** Inline SVG data URI for a custom mark, tinted with the resolved color. */
declare function forgeMarkSource(kind: ForgeKind, color: string): {
    uri: string;
} | null;
interface ForgeIconProps extends ForgeMarkInput {
    /** Icon box in points; defaults to 16 to match the host Lucide default. */
    size?: number;
    /** Mark color; defaults to the active theme foreground. */
    color?: string;
    style?: StyleProp<ImageStyle>;
    /** Overrides the default forge-name accessibility label. */
    accessibilityLabel?: string;
}
/**
 * Shared forge brand mark. Resolves a host/kind to one mark and renders it:
 * GitHub/GitLab/unknown delegate to the host Lucide set, while Codeberg,
 * Forgejo and Gitea draw their official mono marks inline. On native, where
 * Paseo plugin bundles cannot render SVG, custom marks fall back to their
 * closest Lucide glyph so forges stay distinct.
 */
declare function ForgeIcon({ host, kind, size, color, style, accessibilityLabel, }: ForgeIconProps): React__default.JSX.Element;

export { type AboutLink, AboutSection, type AboutSectionProps, ActionBar, type ActionBarProps, BadgeSize, ButtonProps, COMPACT_DESKTOP_TOUCH_TARGET, COMPACT_FORM_FACTOR_WIDTH, Card, CardHeader, type CardHeaderProps, type CardProps, type ClipboardEnvironment, type ClipboardTier, CodeBlock, type CodeBlockProps, Collapsible, type CollapsibleProps, CommandBox, type CommandBoxProps, ComposerPillRegistrar, CopyButton, type CopyButtonFeedback, type CopyButtonProps, type CopyButtonSize, type CopyButtonVariant, type CopyToClipboardOptions, CustomPillBody, type CustomPillBodyProps, CustomPillModalContent, type CustomPillModalContentProps, type DataColumn, DataTable, type DataTableProps, DensityStyle, EmptyState, type EmptyStateProps, ForgeIcon, type ForgeIconProps, ForgeKind, ForgeMarkInput, FormRow, type FormRowProps, Grid, type GridColumnOptions, type GridProps, type HapticFeedbackType, HighlightedText, type HighlightedTextProps, HostAgentPanelProps, HostIconProps, HostPillProps, HostSurfaceProps, HostToast, HostWorkspacePanelProps, Icon, InlineButton, type InlineButtonProps, InteractiveRow, type InteractiveRowProps, KeyValue, KeyValueGroup, type KeyValueGroupProps, type KeyValueProps, type KeyValueTruncateMode, MetricGauge, type MetricGaugeProps, ModalBody, type ModalBodyProps, type ModalBodyScrollOwner, ModalBodyScrollOwnerContext, type ModalBodySize, ModalContent, type ModalContentProps, type PillIconResolver, type PillLabelResolver, type PillLiveContext, type PillLivePayload, PluginCleanup, ProgressBar, type ProgressBarProps, type RegisterAgentPanelOptions, type RegisterComposerPillOptions, type RegisterCustomPillsOptions, type RegisterSidebarSurfaceOptions, type RegisterWorkspacePanelOptions, type RenderModalProps, type RenderPillProps, Responsive, type ResponsiveProps, type ResponsiveSelectOptions, Row, type RowProps, SearchInput, type SearchInputProps, SectionHeader, type SectionHeaderProps, Select, type SelectOption, type SelectProps, type SidebarSurfaceRegistrar, SpacingValue, Stack, type StackProps, StatusDot, type StatusDotProps, SurfaceStyle, type TabItem, Tabs, type TabsProps, TextInput, type TextInputProps, Toggle, type ToggleProps, type TruncateMode, TruncatedText, type TruncatedTextProps, type UseResponsiveResult, VStack, VisualFlair, type WorkspacePanelRegistrar, alpha, clipboardTierOrder, copyToClipboard, forgeMarkSource, formatCommandLine, getContrastColor, getLuminance, getStatusColor, getTouchTargetMin, getVariantPalette, isMobilePlatform, registerAgentPanel, registerComposerPill, registerCustomPills, registerSidebarSurface, registerWorkspacePanel, resolveCollapsibleChevron, resolveCollapsibleHeaderBackground, resolveCollapsibleSurface, resolveCopyButtonFeedback, resolveEffectiveCompact, resolveGridColumns, resolvePadding, resolvePillModalScrollable, responsiveSelect, responsiveValue, triggerHaptic, useResponsive };
