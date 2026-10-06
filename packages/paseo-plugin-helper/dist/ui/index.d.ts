export { F as FALLBACK_COLORS, H as HOST_SHADOW_COLOR, a as HostLayoutProvider, b as HostLayoutProviderProps, c as HostTheme, d as HostThemeProvider, e as HostThemeProviderProps, f as alpha, g as getContrastColor, h as getLuminance, i as getStatusColor, j as getVariantPalette, r as resolveHostColors, u as useHostLayout, k as useHostTheme } from '../host-color-D7eYd9g_.js';
import React__default, { ReactNode, ComponentType } from 'react';
import { StyleProp, ViewStyle, ScrollViewProps, TextStyle, KeyboardTypeOptions, GestureResponderEvent, AccessibilityRole } from 'react-native';
import { S as StatusVariant, T as ThemeColors } from '../types-4TBN5lgi.js';
import { M as MetricThresholds } from '../formatters-Bv2wa1fZ.js';
import { S as SettingsContract } from '../settings-CP1gv9q3.js';
import { a as HostSurfaceProps, P as PluginCleanup } from '../host-BAF48X1U.js';
import 'zod';
import '../rpc-D27pph91.js';
import '@getpaseo/plugin/client';

/**
 * Host-delegating modal content for `paseo-plugin-helper/ui`.
 *
 * Contract — ONLY for content rendered directly inside your OWN host
 * `<Modal>` (e.g. x-comms style own-modal surfaces):
 * - Scroll ownership stays with the host: renders the injected host
 *   `<Modal.Content>` with its default `scrollable` behavior and adds NO
 *   helper-owned scroller, so sheet gestures, keyboard avoidance, and
 *   safe-area clearance keep working on compact/mobile and desktop alike.
 * - No width opinions: there is deliberately NO `maxContentWidth` /
 *   `size="large"` prop. The host allocates the dialog frame; this wrapper
 *   fills it fluidly (`width: "100%"`).
 * - No theme scraping: colors come from the host `theme` prop via
 *   `PluginThemeProvider`, never from DOM CSS variables.
 * - NEVER render this inside `registerComposerPill` `renderModal`: the pill
 *   host already provides the one `<Modal.Content>` (or no modal at all on
 *   0.8 popovers), so a nested `<Modal.Content>` violates the host contract
 *   and crashes the plugin. Use `HostModalSection` there instead.
 */
declare function HostModalContent({ children, style, contentContainerStyle, }: {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
}): React__default.JSX.Element;
/**
 * Explicit single scroll owner for surfaces where the host supplies NO
 * scroller (sidebar surfaces, settings screens). Prefers the injected host
 * ScrollView (sheet-gesture integrated on Paseo v0.8) and falls back to plain
 * React Native ScrollView. Callers own the decision to scroll; this component
 * never nests itself inside another scroller.
 */
declare function HostScroll({ children, style, contentContainerStyle, ...props }: {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
} & ScrollViewProps): React__default.JSX.Element;
/**
 * Fluid inner content for pill-embedded modals (`registerComposerPill`
 * `renderModal`).
 *
 * The pill host already provides the one `<Modal.Content>` (legacy/centered
 * modal paths) or no modal at all (0.8 popover path, where the host owns the
 * outer scroll). This renders a plain fluid `<View>` — no `<Modal.Content>`,
 * no scroller, no width caps — so exactly one `<Modal.Content>` exists and
 * nothing nests. Pair with `hostScroll: true` on the pill registration so
 * the wrapper leaves scrolling to the host; without it the wrapper bounds
 * the dialog (`scrollable={false}`) for legacy `ModalBody` content.
 */
declare function HostModalSection({ children, style, }: {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
}): React__default.JSX.Element;

/** Static spacing scale (px). The host owns the design language; this is just layout. */
declare const spacing: {
    readonly xs: 4;
    readonly sm: 8;
    readonly md: 12;
    readonly lg: 16;
    readonly xl: 24;
};
type SpacingValue = keyof typeof spacing | number;
declare function resolveSpacing(value: SpacingValue | undefined, fallback: number): number;
interface HostRowProps {
    children: ReactNode;
    gap?: number;
    align?: "start" | "center" | "end" | "stretch";
    justify?: "start" | "center" | "end" | "between";
    wrap?: boolean;
    style?: StyleProp<ViewStyle>;
}
/**
 * Host-delegating horizontal row for `paseo-plugin-helper/ui`.
 *
 * Colors come from `useHostTheme()` (provided by `HostThemeProvider`) — no
 * theme scraping.
 */
declare function HostRow({ children, gap, align, justify, wrap, style, }: HostRowProps): React__default.JSX.Element;
interface HostStackProps {
    children: ReactNode;
    gap?: number;
    align?: "start" | "center" | "end" | "stretch";
    justify?: "start" | "center" | "end" | "between";
    grow?: boolean;
    style?: StyleProp<ViewStyle>;
}
/**
 * Host-delegating vertical stack for `paseo-plugin-helper/ui`.
 *
 * Colors come from `useHostTheme()` (provided by `HostThemeProvider`) — no
 * theme scraping.
 */
declare function HostStack({ children, gap, align, justify, grow, style, }: HostStackProps): React__default.JSX.Element;
interface HostGridProps {
    children: ReactNode;
    columns?: number;
    gap?: number;
    style?: StyleProp<ViewStyle>;
}
/**
 * Host-delegating wrapping grid for `paseo-plugin-helper/ui`.
 *
 * Colors come from `useHostTheme()` (provided by `HostThemeProvider`) — no
 * theme scraping.
 */
declare function HostGrid({ children, columns, gap, style, }: HostGridProps): React__default.JSX.Element;
interface HostActionBarProps {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
}
/**
 * Host-delegating action bar for `paseo-plugin-helper/ui`.
 *
 * Colors come from `useHostTheme()` (provided by `HostThemeProvider`) — no
 * theme scraping.
 */
declare function HostActionBar({ children, style, }: HostActionBarProps): React__default.JSX.Element;
interface HostFormRowProps {
    label: string;
    description?: string;
    children: ReactNode;
    layout?: "stacked" | "inline";
    style?: StyleProp<ViewStyle>;
}
/**
 * Host-delegating form row for `paseo-plugin-helper/ui`.
 *
 * Colors come from `useHostTheme()` (provided by `HostThemeProvider`) — no
 * theme scraping.
 */
declare function HostFormRow({ label, description, children, layout, style, }: HostFormRowProps): React__default.JSX.Element;

/**
 * Paseo Plugin Helper — UI content adapters (`paseo-plugin-helper/ui`).
 *
 * Thin, host-delegating content adapters (Card, Tabs, Badge, …). Contract
 * shared by everything here:
 *
 * - Colors come from the host `theme` prop via {@link useHostTheme} — never
 *   from DOM CSS variables, flair, or a density scale.
 * - Scroll ownership stays with the host: these components render plain
 *   content and add no helper-owned scroller (see `ui/modal.tsx`).
 * - No width caps, no `minWidth` floors, no design-system machinery. The host
 *   owns the design language; these adapters only compose its color tokens.
 */
/** Surface variants shared by HostCard / HostCollapsible. */
type HostSurfaceVariant = "flat" | "elevated" | "tinted";
/**
 * Resolves a surface variant to host theme colors. Single source of truth for
 * the "flat / elevated / tinted" vocabulary.
 */
declare function resolveHostSurface(colors: ThemeColors, variant?: HostSurfaceVariant): {
    backgroundColor: string;
    borderColor: string;
};
interface HostCardProps {
    children: ReactNode;
    variant?: HostSurfaceVariant;
    style?: StyleProp<ViewStyle>;
    noPadding?: boolean;
}
interface HostCardHeaderProps {
    title: string;
    subtitle?: string;
    value?: string | number | ReactNode;
    badge?: ReactNode;
    action?: ReactNode;
    icon?: string;
    style?: StyleProp<ViewStyle>;
    titleStyle?: StyleProp<TextStyle>;
    subtitleStyle?: StyleProp<TextStyle>;
}
/** Surface card. Thin: host theme colors + border + padding, nothing else. */
declare function HostCard({ children, variant, style, noPadding }: HostCardProps): React__default.JSX.Element;
declare namespace HostCard {
    var Header: typeof HostCardHeader;
}
/** Card header row: title/subtitle on the left, value/badge/action on the right. */
declare function HostCardHeader({ title, subtitle, value, badge, action, icon, style, titleStyle, subtitleStyle, }: HostCardHeaderProps): React__default.JSX.Element;
interface HostSectionHeaderProps {
    title: string;
    count?: number;
    badgeVariant?: StatusVariant;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
/** Section title with an optional count badge. */
declare function HostSectionHeader({ title, count, badgeVariant, style, textStyle, }: HostSectionHeaderProps): React__default.JSX.Element;
type HostBadgeStyle = "tinted" | "outline" | "solid";
type HostBadgeSize = "sm" | "md";
interface HostBadgeProps {
    label: string;
    variant?: StatusVariant;
    styleVariant?: HostBadgeStyle;
    size?: HostBadgeSize;
    icon?: string | ReactNode;
    dot?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
/** Status pill. Colors derive from the host theme via `getVariantPalette`. */
declare function HostBadge({ label, variant, styleVariant, size, icon, dot, style, textStyle, }: HostBadgeProps): React__default.JSX.Element;
interface HostStatusDotProps {
    variant?: StatusVariant;
    size?: "sm" | "md" | "lg";
    pulse?: boolean;
    style?: StyleProp<ViewStyle>;
}
/** Small status indicator dot. */
declare function HostStatusDot({ variant, size, pulse, style, }: HostStatusDotProps): React__default.JSX.Element;
interface HostProgressBarProps {
    value: number;
    color?: string;
    autoStatusColor?: boolean;
    thresholds?: MetricThresholds;
    label?: string;
    showValueText?: boolean;
    height?: number;
    style?: StyleProp<ViewStyle>;
}
/** Horizontal progress bar with optional status coloring. */
declare function HostProgressBar({ value, color, autoStatusColor, thresholds, label, showValueText, height, style, }: HostProgressBarProps): React__default.JSX.Element;
interface HostMetricGaugeProps {
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
/** Radial metric gauge. Web paints a conic-gradient ring; native falls back to a track ring. */
declare function HostMetricGauge({ value, size, strokeWidth, thresholds, color, autoStatusColor, label, showPercent, centerSlot, style, }: HostMetricGaugeProps): React__default.JSX.Element;
type HostKeyValueTruncateMode = "end" | "middle" | "path";
interface HostKeyValueProps {
    label: string;
    value: string | number | null | undefined;
    subValue?: string;
    mono?: boolean;
    copyable?: boolean;
    truncate?: boolean | HostKeyValueTruncateMode;
    truncateMaxLength?: number;
    layout?: "stacked" | "inline";
    style?: StyleProp<ViewStyle>;
    labelStyle?: StyleProp<TextStyle>;
    valueStyle?: StyleProp<TextStyle>;
}
/** Label/value row with optional copy-to-clipboard (host `copyText`). */
declare function HostKeyValue({ label, value, subValue, mono, copyable, truncate: truncateProp, truncateMaxLength, layout, style, labelStyle, valueStyle, }: HostKeyValueProps): React__default.JSX.Element;
interface HostEmptyStateProps {
    icon?: string | ReactNode;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    style?: StyleProp<ViewStyle>;
}
/** Centered empty-state block. */
declare function HostEmptyState({ icon, title, description, actionLabel, onAction, style, }: HostEmptyStateProps): React__default.JSX.Element;
interface HostCollapsibleProps {
    title?: string | ReactNode;
    subtitle?: string | ReactNode;
    children: ReactNode;
    initiallyExpanded?: boolean;
    isExpanded?: boolean;
    onToggle?: (expanded: boolean) => void;
    badge?: ReactNode;
    headerRight?: ReactNode;
    icon?: string;
    style?: StyleProp<ViewStyle>;
    headerStyle?: StyleProp<ViewStyle>;
    contentStyle?: StyleProp<ViewStyle>;
    variant?: HostSurfaceVariant;
}
/** Expandable section with a host-themed header row. */
declare function HostCollapsible({ title, subtitle, children, initiallyExpanded, isExpanded: controlledExpanded, onToggle, badge, headerRight, icon, style, headerStyle, contentStyle, variant, }: HostCollapsibleProps): React__default.JSX.Element;
interface HostTabItem {
    id: string;
    label: string;
    shortLabel?: string;
    icon?: string;
    badge?: string | number;
}
interface HostTabsProps {
    tabs: HostTabItem[];
    activeTab: string;
    onTabChange: (tabId: string) => void;
    mode?: "auto" | "fit" | "scroll";
    style?: StyleProp<ViewStyle>;
}
/**
 * Tab strip. `mode="auto"` fits the track when there are few tabs and scrolls
 * otherwise; the strip itself is a plain horizontal scroller (never the host
 * sheet-gesture scroller, #219).
 */
declare function HostTabs({ tabs, activeTab, onTabChange, mode, style, }: HostTabsProps): React__default.JSX.Element;

/**
 * Paseo Plugin Helper — UI control adapters (`paseo-plugin-helper/ui`).
 *
 * Thin, host-delegating control adapters
 * (Button, Toggle, Select, TextInput, …). Same contract as the rest of ui/:
 * host theme colors only, no scroll ownership, no design-system machinery.
 * Text inputs prefer the host-injected `TextInput` (modal keyboard
 * positioning) and fall back to plain React Native.
 */
type HostButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type HostButtonSize = "sm" | "md" | "lg";
interface HostButtonProps {
    label?: string;
    children?: ReactNode;
    variant?: HostButtonVariant;
    size?: HostButtonSize;
    icon?: string | ReactNode;
    iconPosition?: "left" | "right";
    onPress?: () => void | Promise<void>;
    disabled?: boolean;
    loading?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    accessibilityLabel?: string;
    accessibilityRole?: "button" | "link";
}
/** Pressable button with host-theme variant colors. */
declare function HostButton({ label, children, variant, size, icon, iconPosition, onPress, disabled, loading, style, textStyle, accessibilityLabel, accessibilityRole, }: HostButtonProps): React__default.JSX.Element;
interface HostInlineButtonProps {
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
declare function HostInlineButton({ label, onPress, icon, disabled, accessibilityLabel, accessibilityRole, style, textStyle, }: HostInlineButtonProps): React__default.JSX.Element;
interface HostToggleProps {
    value: boolean;
    onValueChange: (next: boolean) => void;
    label?: string;
    description?: string;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    labelStyle?: StyleProp<TextStyle>;
}
/** Switch control with optional label/description. */
declare function HostToggle({ value, onValueChange, label, description, disabled, style, labelStyle, }: HostToggleProps): React__default.JSX.Element;
interface HostSelectOption {
    label: string;
    value: string;
}
interface HostSelectProps {
    value: string;
    options: HostSelectOption[];
    onValueChange: (value: string) => void;
    label?: string;
    size?: "sm" | "md";
    placeholder?: string;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
}
/**
 * Compact single-choice picker. The closed trigger stays one line tall;
 * opening mounts the menu in a root transparent `<Modal>` overlay portal, so a
 * long list never expands the trigger's parent container and always paints
 * above later siblings. The option list scrolls with a plain React Native
 * ScrollView — never the host sheet-gesture scroller (#219).
 */
declare function HostSelect({ value, options, onValueChange, label, size, placeholder, disabled, style, }: HostSelectProps): React__default.JSX.Element;
type HostCopyButtonSize = "sm" | "md";
type HostCopyButtonVariant = "ghost" | "secondary";
interface HostCopyButtonProps {
    text?: string;
    getText?: () => string | Promise<string>;
    label?: string;
    copiedLabel?: string;
    icon?: string;
    size?: HostCopyButtonSize;
    variant?: HostCopyButtonVariant;
    accessibilityLabel?: string;
    toastMessage?: string;
    feedbackDurationMs?: number;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
/** Copy-to-clipboard button. Uses the host clipboard via `copyToClipboard`. */
declare function HostCopyButton({ text, getText, label, copiedLabel, icon, size, variant, accessibilityLabel, toastMessage, feedbackDurationMs, disabled, style, textStyle, }: HostCopyButtonProps): React__default.ReactElement | null;
interface HostTextInputProps {
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
/**
 * Text input. Prefers the host-injected `TextInput` (native focus integrated
 * with modal keyboard positioning) and falls back to plain React Native.
 */
declare function HostTextInput({ value, onChangeText, label, placeholder, helperText, errorText, secureTextEntry, keyboardType, autoCapitalize, autoCorrect, disabled, mono, multiline, numberOfLines, style, inputStyle, onSubmitEditing, }: HostTextInputProps): React__default.JSX.Element;
interface HostSearchInputProps {
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    onClear?: () => void;
    height?: number;
    style?: StyleProp<ViewStyle>;
    inputStyle?: StyleProp<TextStyle>;
    testID?: string;
}
/** Search input with a leading icon and optional clear button. */
declare function HostSearchInput({ value, onChangeText, placeholder, onClear, height, style, inputStyle, testID, }: HostSearchInputProps): React__default.JSX.Element;

/**
 * Paseo Plugin Helper — UI text & misc adapters (`paseo-plugin-helper/ui`).
 *
 * Thin, host-delegating text adapters
 * (CodeBlock, CommandBox, TruncatedText, …). Same contract as the rest of ui/:
 * host theme colors only, no scroll ownership, no design-system machinery.
 */
interface HostCodeBlockProps {
    code: string;
    language?: string;
    title?: string;
    maxHeight?: number;
    copyable?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
/** Bounded code block with optional copy button. */
declare function HostCodeBlock({ code, language, title, maxHeight, copyable, style, textStyle, }: HostCodeBlockProps): React__default.JSX.Element;
interface HostCommandBoxProps {
    argv?: string[];
    command?: string;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    copyLabel?: string;
}
/** Formats an argv array into a shell command line. */
declare function formatCommandLine(argv: string[]): string;
/** Shell command display with copy-to-clipboard. */
declare function HostCommandBox({ argv, command, style, textStyle, copyLabel, }: HostCommandBoxProps): React__default.ReactElement | null;
type HostTruncateMode = "end" | "middle" | "path";
interface HostTruncatedTextProps {
    text: string;
    maxLength?: number;
    mode?: HostTruncateMode;
    copyable?: boolean;
    mono?: boolean;
    toastMessage?: string;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
/** Single-line text with truncation and optional copy-to-clipboard. */
declare function HostTruncatedText({ text, maxLength, mode, copyable, mono, toastMessage, style, textStyle, }: HostTruncatedTextProps): React__default.JSX.Element;
interface HostHighlightedTextProps {
    text: string;
    query: string;
    style?: StyleProp<TextStyle>;
    highlightStyle?: StyleProp<TextStyle>;
    numberOfLines?: number;
    selectable?: boolean;
    fuzzyFallback?: boolean;
}
/**
 * Renders text with case-insensitive query matches highlighted using the host
 * accent. The query is matched literally, never as a regex.
 */
declare function HostHighlightedText({ text, query, style, highlightStyle, numberOfLines, selectable, fuzzyFallback, }: HostHighlightedTextProps): React__default.JSX.Element;
interface HostResponsiveProps {
    desktop?: ReactNode;
    mobile?: ReactNode;
    compact?: ReactNode;
    wide?: ReactNode;
    children?: ReactNode | ((responsive: HostResponsiveLayout) => ReactNode);
}
interface HostResponsiveLayout {
    isCompact: boolean;
    isMobile: boolean;
    isWide: boolean;
    select<T>(options: {
        desktop?: T;
        mobile?: T;
        compact?: T;
        wide?: T;
    } & Record<string, T>): T | undefined;
}
/** Picks children by host layout (compact / mobile / wide). */
declare function HostResponsive({ desktop, mobile, compact, wide, children }: HostResponsiveProps): React__default.JSX.Element;
interface HostInteractiveRowProps {
    children?: ReactNode;
    onPress?: (event: GestureResponderEvent) => void;
    title?: string;
    disabled?: boolean;
    accessibilityRole?: AccessibilityRole;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    testID?: string;
    style?: StyleProp<ViewStyle>;
    pressedOpacity?: number;
    disabledOpacity?: number;
    hitSlop?: number;
}
/** Pressable row with pressed feedback. */
declare function HostInteractiveRow({ children, onPress, title, disabled, accessibilityRole, accessibilityLabel, accessibilityHint, testID, style, pressedOpacity, disabledOpacity, hitSlop, }: HostInteractiveRowProps): React__default.JSX.Element;
interface HostAboutLink {
    label: string;
    url: string;
    icon?: string;
}
interface HostAboutSectionProps {
    name: string;
    description?: string;
    version: string;
    author?: string;
    repository?: string;
    issues?: string;
    homepage?: string;
    license?: string;
    links?: HostAboutLink[];
    extraItems?: Array<{
        label: string;
        value: string;
        subValue?: string;
        copyable?: boolean;
    }>;
    style?: StyleProp<ViewStyle>;
}
/** Plugin identity card: name, version, author, links, and extra key-values. */
declare function HostAboutSection({ name, description, version, author, repository, issues, homepage, license, links, extraItems, style, }: HostAboutSectionProps): React__default.JSX.Element;
type HostAttentionBeaconMode = "radar" | "glow" | "pulse" | "badge";
type HostAttentionBeaconTone = "warning" | "accent" | "danger";
interface HostAttentionBeaconProps {
    children: ReactNode;
    mode?: HostAttentionBeaconMode;
    tone?: HostAttentionBeaconTone;
    color?: string;
    active?: boolean;
    style?: StyleProp<ViewStyle>;
    accessibilityLabel?: string;
    testID?: string;
    badgeIcon?: string | ReactNode;
}
/**
 * Attention beacon: a host-themed dot/badge overlay that pulses while active.
 * Thin by design — no halo/radar animation machinery; the host owns motion.
 */
declare function HostAttentionBeacon({ children, mode, tone, color, active, style, accessibilityLabel, testID, badgeIcon, }: HostAttentionBeaconProps): React__default.JSX.Element;

/**
 * Paseo Plugin Helper — UI data adapters (`paseo-plugin-helper/ui`).
 *
 * Thin, host-delegating data adapters
 * (DataTable). Same contract: host theme colors only, no scroll ownership, no
 * design-system machinery.
 */
interface HostDataColumn<T> {
    key: string;
    header: string;
    flex?: number;
    width?: number;
    align?: "left" | "center" | "right";
    render: (item: T) => ReactNode;
}
interface HostDataTableProps<T> {
    data: T[];
    columns: HostDataColumn<T>[];
    keyExtractor: (item: T, index: number) => string;
    emptyState?: ReactNode;
    style?: StyleProp<ViewStyle>;
}
/**
 * Responsive data table that reflows between a traditional table on wide
 * surfaces and a structured card list on compact/mobile layouts.
 */
declare function HostDataTable<T>({ data, columns, keyExtractor, emptyState, style, }: HostDataTableProps<T>): React__default.JSX.Element | null;

interface HelperSettingsCardProps {
    children: ReactNode;
    testID?: string;
}
interface HelperSettingsSectionProps {
    title: string;
    info?: ReactNode;
    trailing?: ReactNode;
    children: ReactNode;
    testID?: string;
}
interface HelperSettingsRowBaseProps {
    label: string;
    hint?: string;
    error?: string | null;
    children?: ReactNode;
    testID?: string;
}
interface HelperSettingsSwitchProps extends HelperSettingsRowBaseProps {
    value: boolean;
    onValueChange(value: boolean): void;
    disabled?: boolean;
}
interface HelperSettingsSelectProps<Value extends string = string> extends HelperSettingsRowBaseProps {
    value: Value;
    options: readonly {
        label: string;
        value: Value;
    }[];
    onValueChange(value: Value): void;
    disabled?: boolean;
}
interface HelperSettingsInputProps extends HelperSettingsRowBaseProps {
    initialValue?: string;
    onChangeText(text: string): void;
    placeholder?: string;
    disabled?: boolean;
    secureTextEntry?: boolean;
}
type HelperSettingsSelectComponent = <Value extends string = string>(props: HelperSettingsSelectProps<Value>) => ReactNode;
interface HelperSettingsUiBundle {
    SettingsCard: ComponentType<HelperSettingsCardProps>;
    SettingsSection: ComponentType<HelperSettingsSectionProps>;
    SettingsSwitch: ComponentType<HelperSettingsSwitchProps>;
    SettingsSelect: HelperSettingsSelectComponent;
    SettingsInput: ComponentType<HelperSettingsInputProps>;
}
interface HelperSettingsScreenContribution {
    id: string;
    title: string;
    icon: string;
    Component: ComponentType<HostSurfaceProps>;
}
interface HelperSettingsScreenRegistrar {
    addSettingsScreen(contribution: HelperSettingsScreenContribution): PluginCleanup;
}
type HelperSettingsFieldKind = "boolean" | "enum" | "string" | "number";
interface HelperSettingsField {
    key: string;
    kind: HelperSettingsFieldKind;
    label: string;
    description?: string;
    options?: string[];
}
interface HelperSettingsFieldOverrides {
    labels?: Record<string, string>;
    descriptions?: Record<string, string>;
}
declare function contractSchemaToFields(schema: unknown, overrides?: HelperSettingsFieldOverrides): HelperSettingsField[];
interface RegisterHelperSettingsScreenOptions {
    ui: HelperSettingsUiBundle;
    id?: string;
    title?: string;
    icon?: string;
    labels?: Record<string, string>;
    descriptions?: Record<string, string>;
}
declare function registerHelperSettingsScreen<TSettings extends Record<string, any>>(client: HelperSettingsScreenRegistrar, contract: SettingsContract<TSettings>, options: RegisterHelperSettingsScreenOptions): PluginCleanup;

export { type HelperSettingsCardProps, type HelperSettingsField, type HelperSettingsFieldKind, type HelperSettingsFieldOverrides, type HelperSettingsInputProps, type HelperSettingsRowBaseProps, type HelperSettingsScreenContribution, type HelperSettingsScreenRegistrar, type HelperSettingsSectionProps, type HelperSettingsSelectComponent, type HelperSettingsSelectProps, type HelperSettingsSwitchProps, type HelperSettingsUiBundle, type HostAboutLink, HostAboutSection, type HostAboutSectionProps, HostActionBar, type HostActionBarProps, HostAttentionBeacon, type HostAttentionBeaconMode, type HostAttentionBeaconProps, type HostAttentionBeaconTone, HostBadge, type HostBadgeProps, type HostBadgeSize, type HostBadgeStyle, HostButton, type HostButtonProps, type HostButtonSize, type HostButtonVariant, HostCard, HostCardHeader, type HostCardHeaderProps, type HostCardProps, HostCodeBlock, type HostCodeBlockProps, HostCollapsible, type HostCollapsibleProps, HostCommandBox, type HostCommandBoxProps, HostCopyButton, type HostCopyButtonProps, type HostCopyButtonSize, type HostCopyButtonVariant, type HostDataColumn, HostDataTable, type HostDataTableProps, HostEmptyState, type HostEmptyStateProps, HostFormRow, type HostFormRowProps, HostGrid, type HostGridProps, HostHighlightedText, type HostHighlightedTextProps, HostInlineButton, type HostInlineButtonProps, HostInteractiveRow, type HostInteractiveRowProps, HostKeyValue, type HostKeyValueProps, type HostKeyValueTruncateMode, HostMetricGauge, type HostMetricGaugeProps, HostModalContent, HostModalSection, HostProgressBar, type HostProgressBarProps, HostResponsive, type HostResponsiveLayout, type HostResponsiveProps, HostRow, type HostRowProps, HostScroll, HostSearchInput, type HostSearchInputProps, HostSectionHeader, type HostSectionHeaderProps, HostSelect, type HostSelectOption, type HostSelectProps, HostStack, type HostStackProps, HostStatusDot, type HostStatusDotProps, type HostSurfaceVariant, type HostTabItem, HostTabs, type HostTabsProps, HostTextInput, type HostTextInputProps, HostToggle, type HostToggleProps, type HostTruncateMode, HostTruncatedText, type HostTruncatedTextProps, type RegisterHelperSettingsScreenOptions, type SpacingValue, contractSchemaToFields, formatCommandLine, registerHelperSettingsScreen, resolveHostSurface, resolveSpacing, spacing };
