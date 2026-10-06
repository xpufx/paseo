import React, { ReactNode } from 'react';
import { StyleProp, ViewStyle, TextStyle } from 'react-native';

/**
 * Structural theme/layout types for the shared UI package.
 *
 * Mirrors the Paseo host theme shape without importing the Paseo SDK or
 * `paseo-plugin-helper`, so the package typechecks and bundles against any
 * supported host version.
 */
interface ThemeColors {
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
type PlatformType = "ios" | "android" | "web";
interface ResponsiveLayout {
    compact: boolean;
    platform: PlatformType;
    width?: number;
    height?: number;
}
type StatusVariant = "neutral" | "success" | "warning" | "danger" | "accent" | "info";
interface MetricThresholds {
    /** Threshold for warning status (default: 75). */
    warning?: number;
    /** Threshold for danger status (default: 90). */
    danger?: number;
    /** Inverts logic: lower values become worse (e.g. battery level, disk free). */
    invert?: boolean;
}

/**
 * Canonical shared composition of the presentational pieces every plugin used
 * to hand-roll in its local `client/host-ui.tsx` (xpufx-org/paseo#937, #976).
 *
 * The host SDK owns the design language and provides the primitives that carry
 * host behaviour (`Icon`, `ScrollView`, `useToast`, `copyText`); everything
 * here is plain React Native layout and color-token composition on top of the
 * host `theme` prop.
 *
 * This package is private and bundled (inlined) into each consuming plugin at
 * build time, so it deliberately imports only the host plugin allowlist:
 * `@getpaseo/plugin/client/react-native`, `react`, and `react-native`. It has
 * no root provider and no `react-native-svg`.
 *
 * Components keep the `Host*` names and prop shapes the plugins already use so
 * call sites only change the import path.

// --- theme -----------------------------------------------------------------

/** Converts a hex/rgb color and opacity (0..1) into an alpha-applied color. */
declare function alpha(color: string, opacity: number): string;
/** Resolves a status variant to a host theme color. */
declare function getStatusColor(variant: StatusVariant, colors: ThemeColors, customAccent?: string): string;

interface PluginUiTheme {
    colors: ThemeColors;
    alpha: (color: string, opacity: number) => string;
    getStatusColor: (variant: StatusVariant) => string;
    getVariantPalette: (variant: StatusVariant) => {
        bg: string;
        text: string;
        border: string;
    };
}
interface HostThemeProviderProps {
    theme?: {
        colors: ThemeColors;
    };
    children: ReactNode;
}
/**
 * Carries the host `theme` prop colors to every local adapter below it. Falls
 * back to the static neutral palette when no host theme is supplied (tests,
 * previews) so adapters still render.
 */
declare function HostThemeProvider({ theme, children }: HostThemeProviderProps): React.JSX.Element;
/** Reads the host theme supplied by {@link HostThemeProvider}. */
declare function useHostTheme(): PluginUiTheme;
interface HostLayoutProviderProps {
    layout: ResponsiveLayout;
    children: ReactNode;
}
/** Carries the host layout descriptor to local adapters that branch on it. */
declare function HostLayoutProvider({ layout, children }: HostLayoutProviderProps): React.JSX.Element;
/** Reads the host layout descriptor. */
declare function useHostLayout(): ResponsiveLayout;
interface HostRowProps {
    children: ReactNode;
    gap?: number;
    align?: "start" | "center" | "end" | "stretch";
    justify?: "start" | "center" | "end" | "between";
    wrap?: boolean;
    style?: StyleProp<ViewStyle>;
}
declare function HostRow({ children, gap, align, justify, wrap, style, }: HostRowProps): React.JSX.Element;
interface HostStackProps {
    children: ReactNode;
    gap?: number;
    align?: "start" | "center" | "end" | "stretch";
    justify?: "start" | "center" | "end" | "between";
    grow?: boolean;
    style?: StyleProp<ViewStyle>;
}
declare function HostStack({ children, gap, align, justify, grow, style, }: HostStackProps): React.JSX.Element;
interface HostGridProps {
    children: ReactNode;
    columns?: number;
    gap?: number;
    style?: StyleProp<ViewStyle>;
}
declare function HostGrid({ children, columns, gap, style }: HostGridProps): React.JSX.Element;
type HostSurfaceVariant = "flat" | "elevated" | "tinted";
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
declare function HostCard({ children, variant, style, noPadding }: HostCardProps): React.JSX.Element;
declare function HostCardHeader({ title, subtitle, value, badge, action, icon, style, titleStyle, subtitleStyle, }: HostCardHeaderProps): React.JSX.Element;
interface HostSectionHeaderProps {
    title: string;
    count?: number;
    badgeVariant?: StatusVariant;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
declare function HostSectionHeader({ title, count, badgeVariant, style, textStyle, }: HostSectionHeaderProps): React.JSX.Element;
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
declare function HostBadge({ label, variant, styleVariant, size, icon, dot, style, textStyle, }: HostBadgeProps): React.JSX.Element;
interface HostVitalProps {
    children: ReactNode;
    icon?: string | ReactNode;
    color: string;
    /** Chip grows to share the row and caps at `maxWidth` (default 110). */
    grow?: boolean;
    maxWidth?: number;
    style?: StyleProp<ViewStyle>;
}
/**
 * Icon + text chip used to pack the timeline card's vitals several per row.
 *
 * A chip must never claim the full row: it grows from its content width and
 * caps out, so a wrapping parent fits as many as the width allows instead of
 * collapsing to one pill per line (xpufx-org/paseo#1010).
 */
declare function HostVital({ children, icon, color, grow, maxWidth, style, }: HostVitalProps): React.JSX.Element;
interface HostStatusDotProps {
    variant?: StatusVariant;
    size?: "sm" | "md" | "lg";
    pulse?: boolean;
    style?: StyleProp<ViewStyle>;
}
declare function HostStatusDot({ variant, size, pulse, style, }: HostStatusDotProps): React.JSX.Element;
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
declare function HostProgressBar({ value, color, autoStatusColor, thresholds, label, showValueText, height, style, }: HostProgressBarProps): React.JSX.Element;
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
declare function HostMetricGauge({ value, size, strokeWidth, thresholds, color, autoStatusColor, label, showPercent, centerSlot, style, }: HostMetricGaugeProps): React.JSX.Element;
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
declare function HostKeyValue({ label, value, subValue, mono, copyable, truncate: truncateProp, truncateMaxLength, layout, style, labelStyle, valueStyle, }: HostKeyValueProps): React.JSX.Element;
interface HostEmptyStateProps {
    icon?: string | ReactNode;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    style?: StyleProp<ViewStyle>;
}
declare function HostEmptyState({ icon, title, description, actionLabel, onAction, style, }: HostEmptyStateProps): React.JSX.Element;
interface HostCollapsibleProps {
    title?: string | ReactNode;
    subtitle?: string | ReactNode;
    children: ReactNode;
    initiallyExpanded?: boolean;
    isExpanded?: boolean;
    onToggle?: (expanded: boolean) => void;
    badge?: ReactNode;
    headerRight?: ReactNode;
    /** Always-visible preview between the header and the expanded content. */
    summary?: ReactNode;
    icon?: string;
    style?: StyleProp<ViewStyle>;
    headerStyle?: StyleProp<ViewStyle>;
    contentStyle?: StyleProp<ViewStyle>;
    variant?: HostSurfaceVariant;
}
declare function HostCollapsible({ title, subtitle, children, initiallyExpanded, isExpanded: controlledExpanded, onToggle, badge, headerRight, summary, icon, style, headerStyle, contentStyle, variant, }: HostCollapsibleProps): React.JSX.Element;
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
 * Local segmented tab strip. Wraps instead of scrolling: the surfaces that use
 * it are fluid, and a wrapping strip avoids competing with the host scroller.
 */
declare function HostTabs({ tabs, activeTab, onTabChange, style }: HostTabsProps): React.JSX.Element;
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
declare function HostButton({ label, children, variant, size, icon, iconPosition, onPress, disabled, loading, style, textStyle, accessibilityLabel, accessibilityRole, }: HostButtonProps): React.JSX.Element;
interface HostToggleProps {
    value: boolean;
    onValueChange: (next: boolean) => void;
    label?: string;
    description?: string;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    labelStyle?: StyleProp<TextStyle>;
}
declare function HostToggle({ value, onValueChange, label, description, disabled, style, labelStyle, }: HostToggleProps): React.JSX.Element;
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
declare function HostCopyButton({ text, getText, label, copiedLabel, icon, size, variant, accessibilityLabel, toastMessage, feedbackDurationMs, disabled, style, textStyle, }: HostCopyButtonProps): React.ReactElement | null;
interface HostModalSectionProps {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
}
/**
 * Fluid plain View for pill `renderModal` bodies (no nested Modal.Content).
 *
 * The host centered-modal wrapper hands the body a bounded `flex: 1` frame and
 * (with the default `hostScroll: false`) no scroller, so this section must fill
 * that frame: without `flex: 1` / `minHeight: 0` the section sizes to its
 * content and the child `HostScroll` is never given a viewport to scroll in
 * (xpufx-org/paseo#975).
 */
declare function HostModalSection({ children, style }: HostModalSectionProps): React.JSX.Element;
interface HostScrollProps {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
}
/** Explicit single scroll owner for surfaces where the host supplies none. */
declare function HostScroll({ children, style, contentContainerStyle, ...props }: HostScrollProps & Record<string, unknown>): React.JSX.Element;
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
declare function HostAboutSection({ name, description, version, author, repository, issues, homepage, license, links, extraItems, style, }: HostAboutSectionProps): React.JSX.Element;

export { type HostAboutLink, HostAboutSection, type HostAboutSectionProps, HostBadge, type HostBadgeProps, type HostBadgeSize, type HostBadgeStyle, HostButton, type HostButtonProps, type HostButtonSize, type HostButtonVariant, HostCard, HostCardHeader, type HostCardHeaderProps, type HostCardProps, HostCollapsible, type HostCollapsibleProps, HostCopyButton, type HostCopyButtonProps, type HostCopyButtonSize, type HostCopyButtonVariant, HostEmptyState, type HostEmptyStateProps, HostGrid, type HostGridProps, HostKeyValue, type HostKeyValueProps, type HostKeyValueTruncateMode, HostLayoutProvider, type HostLayoutProviderProps, HostMetricGauge, type HostMetricGaugeProps, HostModalSection, type HostModalSectionProps, HostProgressBar, type HostProgressBarProps, HostRow, type HostRowProps, HostScroll, type HostScrollProps, HostSectionHeader, type HostSectionHeaderProps, HostStack, type HostStackProps, HostStatusDot, type HostStatusDotProps, type HostSurfaceVariant, type HostTabItem, HostTabs, type HostTabsProps, HostThemeProvider, type HostThemeProviderProps, HostToggle, type HostToggleProps, HostVital, type HostVitalProps, type MetricThresholds, type PluginUiTheme, type ResponsiveLayout, type StatusVariant, type ThemeColors, alpha, getStatusColor, useHostLayout, useHostTheme };
