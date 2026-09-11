import { S as StatusVariant, T as ThemeColors, P as PlatformType, R as ResponsiveLayout, c as PluginTheme, a as SettingsContract, b as CustomPillState } from '../custom-pills-CnrXjVIR.cjs';
import * as React from 'react';
import React__default, { ReactNode, Ref, ComponentType } from 'react';
import { c as HostLayout, d as HostPillProps, e as ComposerPillRegistrar, P as PluginCleanup, a as HostSurfaceProps, f as HostAgentPanelProps, g as HostWorkspacePanelProps, h as HostToast, i as HostIconProps } from '../host-BsbqDlSJ.cjs';
export { j as ClientHostDeps, k as ComposerPillButtonContribution, l as ComposerPillButtonDescriptor, m as ComposerPillButtonIcon, C as ComposerPillContribution, n as ComposerPillRegistration, o as ComposerPillRegistrationHandle, H as HostAgentRef, b as HostAgentUpdate, p as HostAgentsApi, q as HostCopyText, r as HostFlatList, s as HostIcon, t as HostModal, u as HostModalContentProps, v as HostModalProps, w as HostRpcContract, x as HostScrollView, y as HostTextInput, z as HostTheme, A as HostThemeColors, B as HostUseRpc, D as HostUseToast, E as getClientHost, F as getOptionalClientHost, G as initClientHelpers, I as isClientHostInitialized, J as selectHostScrollView } from '../host-BsbqDlSJ.cjs';
import { StyleProp, ViewStyle, TextStyle, KeyboardTypeOptions, ImageSourcePropType, ScrollView } from 'react-native';
import { M as MetricThresholds } from '../formatters-CQSnqWmS.cjs';
import { P as PluginRpcContract, R as RpcInput, a as RpcOutput } from '../rpc-D27pph91.cjs';
import { UseMutationOptions, UseQueryOptions, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import * as _tanstack_query_core from '@tanstack/query-core';
import 'zod';

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
     * - "compact": tight padding and smaller fonts
     * - "comfortable": balanced defaults
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
 * Checks if the current platform is mobile (iOS or Android).
 */
declare function isMobilePlatform(platform: PlatformType): boolean;
/**
 * Returns the recommended minimum interactive touch target size (in pt/px).
 * Ensures compliance with Apple HIG and Android Material guidelines (min 44pt).
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
}
declare const defaultDarkTheme: PluginTheme;
declare const defaultLightTheme: PluginTheme;
declare function getDefaultTheme(): PluginTheme;
interface PluginThemeProviderProps {
    theme: PluginTheme;
    layout?: HostLayout;
    flair?: Partial<VisualFlair>;
    children: ReactNode;
}
declare function PluginThemeProvider({ theme, layout, flair: userFlair, children, }: PluginThemeProviderProps): React__default.JSX.Element;
declare function usePluginTheme(): PluginThemeContextValue;

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

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";
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
}
declare function Button({ label, variant, size, icon, iconPosition, onPress, disabled, loading, style, textStyle, accessibilityLabel, }: ButtonProps): React__default.JSX.Element;

type BadgeStyle = "tinted" | "outline" | "solid";
interface BadgeProps {
    label: string;
    variant?: StatusVariant;
    styleVariant?: BadgeStyle;
    icon?: string | ReactNode;
    dot?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
declare function Badge({ label, variant, styleVariant, icon, dot, style, textStyle, }: BadgeProps): React__default.JSX.Element;

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
}
declare function CardHeader({ title, subtitle, value, badge, action, icon, style, titleStyle, }: CardHeaderProps): React__default.JSX.Element;
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
    title: string;
    children: React__default.ReactNode;
    initiallyExpanded?: boolean;
    isExpanded?: boolean;
    onToggle?: (expanded: boolean) => void;
    badge?: React__default.ReactNode;
    icon?: string;
    style?: StyleProp<ViewStyle>;
}
declare function Collapsible({ title, children, initiallyExpanded, isExpanded: controlledExpanded, onToggle, badge, icon, style, }: CollapsibleProps): React__default.JSX.Element;

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

interface KeyValueProps {
    label: string;
    value: string | number | null | undefined;
    subValue?: string;
    mono?: boolean;
    copyable?: boolean;
    stackOnCompact?: boolean;
    style?: StyleProp<ViewStyle>;
    labelStyle?: StyleProp<TextStyle>;
    valueStyle?: StyleProp<TextStyle>;
}
declare function KeyValue({ label, value, subValue, mono, copyable, stackOnCompact, style, labelStyle, valueStyle, }: KeyValueProps): React__default.JSX.Element;
interface KeyValueGroupProps {
    children: ReactNode;
    columns?: 1 | 2 | 3 | 4;
    gap?: number;
    style?: StyleProp<ViewStyle>;
}
declare function KeyValueGroup({ children, columns, gap, style, }: KeyValueGroupProps): React__default.JSX.Element;

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
declare function AboutSection({ name, description, version, author, logo, repository, issues, homepage, license, links, extraItems, showDiagnosticsCopy, style, }: AboutSectionProps): React__default.JSX.Element;

interface ModalBodyProps {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    extraBottomInset?: number;
    refreshing?: boolean;
    onRefresh?: () => void | Promise<void>;
    stickToEnd?: boolean;
    scrollRef?: Ref<ScrollView>;
}
/**
 * Mobile-safe scrollable body for Paseo <Modal.Content>.
 * Automatically calculates responsive bottom padding so controls are not cut off
 * by mobile home bars or virtual keyboards.
 * Supports pull-to-refresh on mobile via `refreshing` and `onRefresh`.
 * Uses the host ScrollView from initClientHelpers when supplied (sheet-gesture
 * integrated on Paseo v0.8), otherwise plain React Native ScrollView.
 * Pass `stickToEnd` for conversation-style views that track new content, or
 * `scrollRef` for imperative scrolling.
 */
declare function ModalBody({ children, style, contentContainerStyle, extraBottomInset, refreshing, onRefresh, stickToEnd, scrollRef, }: ModalBodyProps): React__default.JSX.Element;

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
    style?: StyleProp<ViewStyle>;
}
declare function FormRow({ label, description, children, style }: FormRowProps): React__default.JSX.Element;

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
     * (when `layout.compact` is true). Defaults to `title`.
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
     * Optional compact Lucide icon name shown when in compact mode. Defaults to `icon`.\
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
     * Receives `isOpen`, `open`, `close`, and `toggle` along with standard pill props.
     */
    renderPill?: (props: RenderPillProps<TPayload>) => ReactNode;
    /**
      * Resolves the live pill label on button-shaped hosts (Paseo 0.8+), where the
      * pill body is host-rendered from a static `label` string and `renderPill`
      * never mounts. Called once at registration and then every
      * `refreshIntervalMs`. Keep it cheap and synchronous when possible; async
      * resolvers are awaited. Returning `undefined` leaves the current label.
      * Cycle modes can advance rotation state on each call.
      */
    resolveLabel?: (context: PillLiveContext) => string | undefined | Promise<string | undefined>;
    /**
      * Poll interval for `resolveLabel` on button-shaped hosts. Defaults to 5000ms
      * when `resolveLabel` is set. Set to 0 to resolve once at registration.
      * Ignored on legacy hosts (their `renderPill` re-renders via React state).
      */
    refreshIntervalMs?: number;
    /**
      * Renders the content inside the controlled modal.
     * Automatically wrapped with PluginThemeProvider and supplied with a `close()` helper and optional payload.
      * On button-shaped hosts (Paseo 0.8+) the modal is replaced by an anchored
      * popover rendering this same content at the host surface width (expect a
      * narrow column, not a wide modal); keep content vertically stacked and
      * reflowing. `open`/`toggle` from `renderPill` cannot drive host-owned
      * popovers, so live pill text comes from `resolveLabel` instead.
     */
    renderModal: (props: RenderModalProps<TPayload>) => ReactNode;
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
 */
declare function registerSidebarSurface(plugin: SidebarSurfaceRegistrar, options: RegisterSidebarSurfaceOptions): void;

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
declare function registerWorkspacePanel(plugin: WorkspacePanelRegistrar, options: RegisterWorkspacePanelOptions): void;
/**
 * Registers an agent-scoped panel with automatic `<PluginThemeProvider>` injection.
 * Works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 */
declare function registerAgentPanel(plugin: WorkspacePanelRegistrar, options: RegisterAgentPanelOptions): void;

type RpcQueryOptions<TOutput> = Omit<UseQueryOptions<TOutput, Error, TOutput, readonly unknown[]>, "queryKey" | "queryFn">;
/**
 * Executes a Paseo RPC contract as a cached, reactive React Query.
 * Automatically hashes contract name and input arguments into query keys.
 */
declare function useRpcQuery<TContract extends PluginRpcContract<any, any>, TInput = RpcInput<TContract>, TOutput = RpcOutput<TContract>>(contract: TContract, input: TInput, options?: RpcQueryOptions<TOutput>): UseQueryResult<TOutput, Error>;
type RpcMutationOptions<TInput, TOutput> = UseMutationOptions<TOutput, Error, TInput, unknown>;
/**
 * Executes a Paseo RPC contract as a mutation (for state changes, write operations).
 */
declare function useRpcMutation<TContract extends PluginRpcContract<any, any>, TInput = RpcInput<TContract>, TOutput = RpcOutput<TContract>>(contract: TContract, options?: RpcMutationOptions<TInput, TOutput>): UseMutationResult<TOutput, Error, TInput, unknown>;

type RefreshRate = "1s" | "2s" | "5s" | "10s" | "15s" | "30s" | "60s" | "5m" | "paused";
declare const REFRESH_INTERVALS: Record<RefreshRate, number | false>;
interface UseAutoRefreshQueryOptions<TOutput> extends RpcQueryOptions<TOutput> {
    defaultRate?: RefreshRate;
    /**
     * Custom interval in milliseconds (overrides preset rates when not paused).
     */
    customIntervalMs?: number;
    /**
     * Whether the containing modal or panel is actively open/visible.
     * If false, background refetching is automatically paused to conserve mobile CPU and battery.
     */
    isOpen?: boolean;
}
/**
 * Enhanced React Query hook for live polling metrics.
 * Automatically halts background polling when modal/panel is closed (`isOpen === false`),
 * and provides state controls for user-selectable refresh intervals ("1s", "5s", "30s", "paused", etc.).
 */
declare function useAutoRefreshQuery<TContract extends PluginRpcContract<any, any>, TInput = RpcInput<TContract>, TOutput = RpcOutput<TContract>>(contract: TContract, input: TInput, options?: UseAutoRefreshQueryOptions<TOutput>): {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: TOutput;
    error: Error;
    isError: true;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: true;
    isSuccess: false;
    isPlaceholderData: false;
    status: "error";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
} | {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: TOutput;
    error: null;
    isError: false;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: true;
    isPlaceholderData: false;
    status: "success";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
} | {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: undefined;
    error: Error;
    isError: true;
    isPending: false;
    isLoading: false;
    isLoadingError: true;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "error";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
} | {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: undefined;
    error: null;
    isError: false;
    isPending: true;
    isLoading: true;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "pending";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
} | {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: undefined;
    error: null;
    isError: false;
    isPending: true;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "pending";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isLoading: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
} | {
    rate: RefreshRate;
    setRate: React.Dispatch<React.SetStateAction<RefreshRate>>;
    isPolling: boolean;
    effectiveInterval: number | false;
    data: TOutput;
    isError: false;
    error: null;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: true;
    isPlaceholderData: true;
    status: "success";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: _tanstack_query_core.RefetchOptions) => Promise<_tanstack_query_core.QueryObserverResult<TOutput, Error>>;
    fetchStatus: _tanstack_query_core.FetchStatus;
};

interface UsePluginSettingsOptions<TSettings> {
    /**
     * Optional initial settings data. Defaults to `contract.defaultSettings`.
     */
    initialData?: TSettings;
    /**
     * Whether to automatically refetch settings when the window/app regains focus.
     * Defaults to true.
     */
    refetchOnWindowFocus?: boolean;
    /**
     * Stale time in milliseconds before settings are considered stale.
     * Defaults to 0 so that newly opened modals/components always verify fresh
     * state against the daemon without waiting.
     */
    staleTime?: number;
    /**
     * Whether to refetch settings every time a component mounts.
     * Defaults to "always".
     */
    refetchOnMount?: boolean | "always";
    /**
     * Optional background polling interval in milliseconds.
     * When specified, keeps multi-window and mobile/desktop clients automatically in sync.
     */
    refetchInterval?: number | false;
    /**
     * Callback invoked after a successful update.
     */
    onSuccess?: (updated: TSettings) => void;
    /**
     * Callback invoked when an update fails.
     */
    onError?: (error: Error, rollbackSettings?: TSettings) => void;
}
interface UsePluginSettingsResult<TSettings> {
    /**
     * Current settings object. Never undefined (falls back to initialData or contract.defaultSettings).
     */
    settings: TSettings;
    /**
     * Triggers an optimistic update and persists via RPC.
     */
    updateSettings: (updates: Partial<TSettings>) => void;
    /**
     * Async version of updateSettings that returns a promise of the updated settings.
     */
    updateSettingsAsync: (updates: Partial<TSettings>) => Promise<TSettings>;
    /**
     * Resets settings back to their default values.
     */
    resetSettings: () => Promise<TSettings>;
    /**
     * Whether the initial query is loading.
     */
    isLoading: boolean;
    /**
     * Whether an update mutation is currently in-flight.
     */
    isUpdating: boolean;
    /**
     * Whether the last query or mutation encountered an error.
     */
    isError: boolean;
    /**
     * Error object if any error occurred.
     */
    error: Error | null;
    /**
     * Refetches settings from the server.
     */
    refetch: () => Promise<unknown>;
}
/**
 * Reactive hook for managing plugin settings with optimistic updates,
 * error rollbacks, and automatic caching via React Query.
 */
declare function usePluginSettings<TSettings extends Record<string, any>>(contract: SettingsContract<TSettings>, options?: UsePluginSettingsOptions<TSettings>): UsePluginSettingsResult<TSettings>;

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

interface CopyToClipboardOptions {
    toast?: HostToast;
    toastMessage?: string;
}
/**
 * Robust cross-platform clipboard copy helper for Paseo plugins.
 * Works seamlessly across React Native (Hermes / mobile), web, and desktop.
 *
 * Precedence:
 * 1. Host copyText from initClientHelpers (Paseo v0.8, optional)
 * 2. React Native's Clipboard (react-native / react-native-web)
 * 3. Web navigator.clipboard.writeText (modern secure web contexts)
 * 4. Fallback: document.execCommand("copy") (older web / non-secure contexts)
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

export { type AboutLink, AboutSection, type AboutSectionProps, ActionBar, type ActionBarProps, Badge, type BadgeProps, type BadgeStyle, Button, type ButtonProps, type ButtonSize, type ButtonVariant, Card, CardHeader, type CardHeaderProps, type CardProps, CodeBlock, type CodeBlockProps, Collapsible, type CollapsibleProps, ComposerPillRegistrar, type CopyToClipboardOptions, CustomPillBody, type CustomPillBodyProps, CustomPillModalContent, type CustomPillModalContentProps, type DataColumn, DataTable, type DataTableProps, type DensityStyle, type ElevationLevel, type ElevationStyle, EmptyState, type EmptyStateProps, FALLBACK_ACCENT_FOREGROUND, FormRow, type FormRowProps, type HapticFeedbackType, type HeadingTransform, type HelperSettingsCardProps, type HelperSettingsField, type HelperSettingsFieldKind, type HelperSettingsFieldOverrides, type HelperSettingsInputProps, type HelperSettingsRowBaseProps, type HelperSettingsScreenContribution, type HelperSettingsScreenRegistrar, type HelperSettingsSectionProps, type HelperSettingsSelectComponent, type HelperSettingsSelectProps, type HelperSettingsSwitchProps, type HelperSettingsUiBundle, HostAgentPanelProps, type HostFontVariables, HostIconProps, HostLayout, HostPillProps, HostSurfaceProps, type HostThemeVariables, HostToast, HostWorkspacePanelProps, Icon, KeyValue, KeyValueGroup, type KeyValueGroupProps, type KeyValueProps, MetricGauge, type MetricGaugeProps, ModalBody, type ModalBodyProps, PASEO_HOST_CSS_VARIABLES, type PaseoHostCssVariable, type PillLiveContext, PluginCleanup, type PluginThemeContextValue, PluginThemeProvider, type PluginThemeProviderProps, ProgressBar, type ProgressBarProps, REFRESH_INTERVALS, type RadiusStyle, type RefreshRate, type RegisterAgentPanelOptions, type RegisterComposerPillOptions, type RegisterCustomPillsOptions, type RegisterHelperSettingsScreenOptions, type RegisterSidebarSurfaceOptions, type RegisterWorkspacePanelOptions, type RenderModalProps, type RenderPillProps, Responsive, type ResponsiveProps, type ResponsiveSelectOptions, type RpcMutationOptions, type RpcQueryOptions, SearchInput, type SearchInputProps, type SidebarSurfaceRegistrar, type SpacingKey, StatusDot, type StatusDotProps, type SurfaceStyle, type TabItem, Tabs, type TabsProps, TextInput, type TextInputProps, Toggle, type ToggleProps, type UseAutoRefreshQueryOptions, type UsePluginSettingsOptions, type UsePluginSettingsResult, type UseResponsiveResult, type VisualFlair, type WorkspacePanelRegistrar, alpha, contractSchemaToFields, copyToClipboard, defaultDarkTheme, defaultFlair, defaultLightTheme, elevationForPlatform, getContrastColor, getDefaultTheme, getLuminance, getStatusColor, getTouchTargetMin, getVariantPalette, isMobilePlatform, mergeThemeColors, readHostThemeVariables, registerAgentPanel, registerComposerPill, registerCustomPills, registerHelperSettingsScreen, registerSidebarSurface, registerWorkspacePanel, resolveElevation, resolvePadding, resolveRadius, responsiveSelect, responsiveValue, spacing, triggerHaptic, useAutoRefreshQuery, usePluginSettings, usePluginTheme, useResponsive, useRpcMutation, useRpcQuery };
