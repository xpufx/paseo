import React, { ReactNode } from 'react';
import { StyleProp, ViewStyle, TextStyle, GestureResponderEvent, AccessibilityRole, ScrollView, ScrollViewProps, KeyboardTypeOptions } from 'react-native';
import { ForgeLabel, IssueComment, KanbanColumnId, KanbanColumnDef, AgentEnvelope } from '@xpufx/backend-tickets/client';
export { AgentEnvelope, ForgeLabel, IssueComment, KanbanColumnDef, KanbanColumnId, KanbanTransitionAction } from '@xpufx/backend-tickets/client';

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
interface PluginTheme {
    readonly colors: ThemeColors;
}
type PlatformType = "ios" | "android" | "web";
interface ResponsiveLayout {
    compact: boolean;
    isCompact?: boolean;
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

interface ListActionHeaderAction {
    id: string;
    label: string;
    icon?: string;
    variant?: "primary" | "secondary" | "danger" | "ghost";
    loading?: boolean;
    disabled?: boolean;
    onPress: () => void | Promise<void>;
}
interface ListActionPageTemplateProps<T> {
    /** Page or section title. */
    title: string;
    /** Subtitle or status summary text. */
    subtitle?: ReactNode;
    /** Icon shown next to the title (Lucide icon name). */
    icon?: string;
    /** Optional badge or pill rendered beside the title. */
    badge?: ReactNode;
    /** Global action buttons in the header row (e.g. Refresh, Update All). */
    headerActions?: readonly ListActionHeaderAction[];
    /** Search or filter control slot beneath the header. */
    filterSlot?: ReactNode;
    /** Top banner or progress bar slot (e.g. HostProgressBar, error banners). */
    bannerSlot?: ReactNode;
    /** Data items for the list. */
    data: readonly T[];
    /** Key extractor for list items. */
    keyExtractor: (item: T, index: number) => string;
    /** Render function for each item card. */
    renderItem: (item: T, index: number) => ReactNode;
    /** Title and description for empty state when data is empty. */
    emptyState?: {
        title: string;
        description?: string;
        icon?: string;
    };
    /** Whether data is currently loading on initial fetch. */
    isLoading?: boolean;
    /** Optional supplemental sections rendered after the list (e.g. orphans, audit logs). */
    footerSlot?: ReactNode;
    /** Container style overrides. */
    style?: StyleProp<ViewStyle>;
    /** Content container style overrides for the scroll view. */
    contentContainerStyle?: StyleProp<ViewStyle>;
}
/**
 * Standard whole-page template for collection views with global actions,
 * search filters, and card lists. Enforces responsive mobile reflow and
 * single scroll ownership.
 */
declare function ListActionPageTemplate<T>({ title, subtitle, icon, badge, headerActions, filterSlot, bannerSlot, data, keyExtractor, renderItem, emptyState, isLoading, footerSlot, style, contentContainerStyle, }: ListActionPageTemplateProps<T>): React.JSX.Element;

type PullRequestState = "open" | "draft" | "merged" | "closed" | "unknown";
type PullRequestReviewDecision = "approved" | "changes-requested" | "pending" | "unknown";
type CiStatus = "passing" | "failing" | "running" | "pending" | "unknown";
interface LinkedPullRequest {
    number?: number;
    url?: string;
    title?: string;
    state?: PullRequestState;
    draft?: boolean;
    reviewDecision?: PullRequestReviewDecision;
}
interface ChecklistItem {
    /** Zero-based position among the parsed checklist items. */
    index: number;
    /** 1-based line number in the source body. */
    line: number;
    text: string;
    checked: boolean;
}
/** Full issue payload backing the slide-over detail drawer. */
interface IssueDetailData {
    body?: string;
    labels?: ForgeLabel[];
    comments?: IssueComment[];
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    webUrl?: string;
}
interface KanbanIssue {
    number: number;
    title: string;
    state?: string;
    repo?: string;
    status?: "Backlog" | "In progress" | "Review" | "Done" | string;
    attention?: string;
    branch?: string;
    comments?: number;
    labels?: string[];
    url?: string;
    updatedAt?: string;
    /** Canonical linked pull-request artifacts; the first entry is shown on the card. */
    pullRequests?: LinkedPullRequest[];
    /** Convenience single linked pull request for hosts that only surface one. */
    pullRequest?: LinkedPullRequest;
    /** Explicit CI status; falls back to `ci/*` labels when omitted. */
    ciStatus?: CiStatus | string;
    ciUrl?: string;
}
interface KanbanCardProps {
    issue: KanbanIssue;
    columnId: KanbanColumnId;
    onSelect?: (issueNumber: number) => void;
    onTransition?: (issue: KanbanIssue, targetState: KanbanColumnId) => void | Promise<void>;
    isTransitioning?: boolean;
    isDragging?: boolean;
    /** Keyboard/click selection highlight (board-level j/k cursor). */
    isSelected?: boolean;
    onDragStart?: (e: any) => void;
    onDragEnd?: (e: any) => void;
}
interface KanbanBoardProps {
    issues: KanbanIssue[];
    selectedRepo?: string;
    onSelectIssue?: (issueNumber: number) => void;
    onTransitionIssue?: (issue: KanbanIssue, targetState: KanbanColumnId) => void | Promise<void>;
    filterQuery?: string;
    onFilterQueryChange?: (query: string) => void;
    isLoading?: boolean;
    columns?: readonly KanbanColumnDef[];
    /** Controlled keyboard selection; leave undefined to let the board own the cursor. */
    selectedIssueNumber?: number | null;
    onSelectedIssueNumberChange?: (issueNumber: number | null) => void;
    /**
     * Called when `Enter` activates the selected card. When provided, the board
     * delegates drawer ownership to the host instead of rendering its own.
     */
    onOpenIssueDetail?: (issueNumber: number) => void;
    /** Detail payload for the internally-rendered drawer. */
    issueDetail?: IssueDetailData | null;
    detailDrawer?: boolean;
    onToggleChecklistItem?: (item: ChecklistItem, checked: boolean) => void;
    onSubmitComment?: (body: string) => void | Promise<void>;
    onSelectLabel?: (label: string) => void;
    activeStateLabel?: string | null;
}

interface HostMarkdownLiteProps {
    body: string;
    query?: string;
    style?: StyleProp<ViewStyle>;
}
declare function HostMarkdownLite({ body, query, style }: HostMarkdownLiteProps): React.JSX.Element;

interface HostAgentEnvelopeCardProps {
    envelope: AgentEnvelope;
    style?: StyleProp<ViewStyle>;
    onOpenSession?: (url: string) => void;
}
declare function HostAgentEnvelopeCard({ envelope, style, onOpenSession, }: HostAgentEnvelopeCardProps): React.JSX.Element;

interface HostCommentCardProps {
    comment: IssueComment;
    issueUrl?: string;
    query?: string;
    style?: StyleProp<ViewStyle>;
    onOpenComment?: (url: string) => void;
    onOpenSession?: (url: string) => void;
}
declare function HostCommentCard({ comment, issueUrl, query, style, onOpenComment, onOpenSession, }: HostCommentCardProps): React.JSX.Element;

interface HostScopedLabelGroupProps {
    title: string;
    labels: readonly ForgeLabel[];
    active: string | null;
    pending?: boolean;
    onSelect: (label: string) => void;
    style?: StyleProp<ViewStyle>;
}
declare function HostScopedLabelGroup({ title, labels, active, pending, onSelect, style, }: HostScopedLabelGroupProps): React.JSX.Element;

interface CardArtifactBadge {
    label: string;
    variant: StatusVariant;
    icon?: string;
}
/**
 * Resolves the branch shown as a pill on a card. Explicit `issue.branch` wins;
 * hosts that only project labels can carry it as `branch/<name>`.
 */
declare function detectBranchPill(issue: KanbanIssue): string | null;
declare function isFeatureBranch(branch: string): boolean;
/**
 * Normalizes an explicit pull request, a `pr/<n>` label, or a PR URL into the
 * card artifact shape. Returns `null` when the issue carries no PR signal.
 */
declare function detectLinkedPullRequest(issue: KanbanIssue): LinkedPullRequest | null;
/**
 * Resolves the CI indicator status. Explicit `issue.ciStatus` wins; otherwise
 * the first recognized `ci/*` or `checks/*` label is used.
 */
declare function detectCiStatus(issue: KanbanIssue): CiStatus;
declare function describePullRequest(pr: LinkedPullRequest): CardArtifactBadge;
declare function describeReviewDecision(decision: PullRequestReviewDecision | undefined): CardArtifactBadge | null;
declare function describeCiStatus(status: CiStatus): CardArtifactBadge | null;
/** Parses GitHub/Forgejo task-list lines (`- [ ]` / `- [x]`) from a body. */
declare function extractChecklist(body: string | undefined | null): ChecklistItem[];
/** Rewrites one checklist item's checked state, preserving the rest of the body. */
declare function setChecklistItemChecked(body: string, index: number, checked: boolean): string;

declare function getActiveDraggingIssue(): KanbanIssue | null;
declare function setActiveDraggingIssue(issue: KanbanIssue | null): void;
declare function HostKanbanCard({ issue, columnId, onSelect, onTransition, isTransitioning, isDragging, isSelected, onDragStart, onDragEnd, }: KanbanCardProps): React.JSX.Element;

type KanbanKeyboardIntentType = "select-next" | "select-prev" | "open" | "move" | "close" | "none";
interface KanbanKeyboardIntent {
    type: KanbanKeyboardIntentType;
    /** Zero-based target column for `move` intents (digit `1` -> `0`). */
    columnIndex?: number;
}
/**
 * Maps a raw keydown key to a board intent. Pure and platform-free so the
 * dispatch logic is unit-testable without a DOM.
 */
declare function resolveKanbanKeyboardIntent(key: string, columnCount?: number): KanbanKeyboardIntent;
interface KanbanKeyboardEventLike {
    key?: string;
    target?: unknown;
    preventDefault?: () => void;
}
type KanbanKeydownListener = (event: KanbanKeyboardEventLike) => void;
interface KanbanKeydownTarget {
    addEventListener: (type: string, listener: KanbanKeydownListener) => void;
    removeEventListener: (type: string, listener: KanbanKeydownListener) => void;
}
/**
 * Returns the DOM keydown target when one exists. Uses `globalThis` so the
 * package stays DOM-lib-free for hosts that compile the source without `lib.dom`.
 */
declare function getKanbanKeydownTarget(): KanbanKeydownTarget | null;
/** True when the event originates from a text field and should keep native editing. */
declare function isEditableKeyboardTarget(target: unknown): boolean;

declare function HostKanbanBoard({ issues, selectedRepo, onSelectIssue, onTransitionIssue, filterQuery: externalFilterQuery, onFilterQueryChange, isLoading, columns, selectedIssueNumber, onSelectedIssueNumberChange, onOpenIssueDetail, issueDetail, detailDrawer, onToggleChecklistItem, onSubmitComment, onSelectLabel, activeStateLabel, }: KanbanBoardProps): React.JSX.Element;

interface IssueDetailDrawerProps {
    visible: boolean;
    issue: KanbanIssue | null;
    detail?: IssueDetailData | null;
    onClose: () => void;
    query?: string;
    activeStateLabel?: string | null;
    labelPending?: boolean;
    onSelectLabel?: (label: string) => void;
    onToggleChecklistItem?: (item: ChecklistItem, checked: boolean) => void;
    onSubmitComment?: (body: string) => void | Promise<void>;
    width?: number;
}
/**
 * Non-modal slide-over for inspecting an issue without leaving the board: full
 * markdown body, task-list toggles, scoped label quick toggles, PR/CI artifacts,
 * the comment timeline, and a composer.
 */
declare function HostIssueDetailDrawer({ visible, issue, detail, onClose, query, activeStateLabel, labelPending, onSelectLabel, onToggleChecklistItem, onSubmitComment, width, }: IssueDetailDrawerProps): React.JSX.Element | null;

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
declare const FALLBACK_COLORS: ThemeColors;
/**
 * Fills a possibly-partial host `theme.colors` from FALLBACK_COLORS.
 * Ensures no color token evaluates to undefined on platforms providing partial palettes.
 */
declare function resolveHostColors(colors?: Partial<ThemeColors> | null): ThemeColors;
interface HostThemeProviderProps {
    theme?: {
        colors: ThemeColors;
    } | {
        colors?: Partial<ThemeColors>;
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
declare function useHostLayout(): ResponsiveLayout & {
    isCompact: boolean;
};
/** Static spacing scale (px). */
declare const spacing: {
    readonly xxs: 2;
    readonly xs: 4;
    readonly sm: 8;
    readonly md: 12;
    readonly lg: 16;
    readonly xl: 24;
};
type SpacingValue = keyof typeof spacing | number;
declare function resolveSpacing(value: SpacingValue | undefined, fallback: number): number;
interface HostRowProps {
    children?: ReactNode;
    gap?: SpacingValue;
    align?: "start" | "center" | "end" | "stretch" | "flex-start" | "flex-end" | ViewStyle["alignItems"];
    justify?: "start" | "center" | "end" | "between" | "space-between" | "space-around" | "space-evenly" | "flex-start" | "flex-end" | ViewStyle["justifyContent"];
    wrap?: boolean;
    style?: StyleProp<ViewStyle>;
    testID?: string;
}
declare function HostRow({ children, gap, align, justify, wrap, style, testID, }: HostRowProps): React.JSX.Element;
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
    hoverStyle?: StyleProp<ViewStyle>;
    hoverTint?: boolean;
    hoverTintOpacity?: number;
    pressedOpacity?: number;
    hoveredOpacity?: number;
    opacity?: number;
    disabledOpacity?: number;
    hitSlop?: number;
    onHoverChange?: (hovered: boolean) => void;
}
/**
 * Clickable/tappable row container with hover tint, pressed states, and accessibility semantics.
 */
declare function HostInteractiveRow({ children, onPress, title, disabled, accessibilityRole, accessibilityLabel, accessibilityHint, testID, style, hoverStyle, hoverTint, hoverTintOpacity, pressedOpacity, hoveredOpacity, opacity, disabledOpacity, hitSlop, onHoverChange, }: HostInteractiveRowProps): React.JSX.Element;

interface HostStackProps {
    children?: ReactNode;
    gap?: SpacingValue;
    align?: "start" | "center" | "end" | "stretch" | "flex-start" | "flex-end" | ViewStyle["alignItems"];
    justify?: "start" | "center" | "end" | "between" | "space-between" | "space-around" | "space-evenly" | "flex-start" | "flex-end" | ViewStyle["justifyContent"];
    grow?: boolean;
    style?: StyleProp<ViewStyle>;
    testID?: string;
}
declare function HostStack({ children, gap, align, justify, grow, style, testID, }: HostStackProps): React.JSX.Element;
interface HostGridProps {
    children?: ReactNode;
    columns?: number;
    gap?: SpacingValue;
    style?: StyleProp<ViewStyle>;
    testID?: string;
}
declare function HostGrid({ children, columns, gap, style, testID }: HostGridProps): React.JSX.Element;
type HostSurfaceVariant = "flat" | "elevated" | "tinted";
interface HighlightPart {
    text: string;
    matched: boolean;
}
interface HighlightOptions {
    fallbackToWholeField?: boolean;
}
declare function splitHighlightParts(text: string, query: string, options?: HighlightOptions): HighlightPart[];
interface HostHighlightedTextProps {
    text: string;
    query: string;
    style?: StyleProp<TextStyle>;
    numberOfLines?: number;
    selectable?: boolean;
    fuzzyFallback?: boolean;
}
/** `<Text>` that paints literal query matches with the accent. */
declare function HostHighlightedText({ text, query, style, numberOfLines, selectable, fuzzyFallback, }: HostHighlightedTextProps): React.JSX.Element;
interface HostCardProps {
    children: ReactNode;
    variant?: HostSurfaceVariant;
    style?: StyleProp<ViewStyle>;
    noPadding?: boolean;
}
interface HostCardHeaderProps {
    title: string | ReactNode;
    subtitle?: string;
    value?: string | number | ReactNode;
    badge?: ReactNode;
    action?: ReactNode;
    icon?: string;
    style?: StyleProp<ViewStyle>;
    titleStyle?: StyleProp<TextStyle>;
    subtitleStyle?: StyleProp<TextStyle>;
    highlightQuery?: string;
}
declare function HostCardBase({ children, variant, style, noPadding }: HostCardProps): React.JSX.Element;
declare function HostCardHeader({ title, subtitle, value, badge, action, icon, style, titleStyle, subtitleStyle, highlightQuery, }: HostCardHeaderProps): React.JSX.Element;
declare const HostCard: typeof HostCardBase & {
    Header: typeof HostCardHeader;
};
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
    highlightQuery?: string;
    highlightFuzzyFallback?: boolean;
}
declare function HostBadge({ label, variant, styleVariant, size, icon, dot, style, textStyle, highlightQuery, highlightFuzzyFallback, }: HostBadgeProps): React.JSX.Element;
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
type HostAttentionBeaconMode = "radar" | "ring" | "glow" | "badge" | "bounce" | "pulse";
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
    easing?: (value: number) => number;
}
declare function HostAttentionBeacon({ children, mode, tone, color, active, style, accessibilityLabel, testID, }: HostAttentionBeaconProps): React.JSX.Element;
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
    stackOnCompact?: boolean;
    style?: StyleProp<ViewStyle>;
    labelStyle?: StyleProp<TextStyle>;
    valueStyle?: StyleProp<TextStyle>;
}
declare function HostKeyValue({ label, value, subValue, mono, copyable, truncate: truncateProp, truncateMaxLength, layout, stackOnCompact: _stackOnCompact, style, labelStyle, valueStyle, }: HostKeyValueProps): React.JSX.Element;
interface HostKeyValueGroupProps {
    children: ReactNode;
    columns?: 1 | 2 | 3 | 4 | number;
    gap?: number;
    collapse?: "compact" | "never" | string;
    minColumnWidth?: number;
    style?: StyleProp<ViewStyle>;
}
/** Fluid key/value grid. */
declare function HostKeyValueGroup({ children, columns, gap, style, }: HostKeyValueGroupProps): React.JSX.Element;
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
    testID?: string;
}
declare function HostButton({ label, children, variant, size, icon, iconPosition, onPress, disabled, loading, style, textStyle, accessibilityLabel, accessibilityRole, testID, }: HostButtonProps): React.JSX.Element;
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
/** Compact text/link action for inline timeline and card content. */
declare function HostInlineButton({ label, onPress, icon, disabled, accessibilityLabel, accessibilityRole, style, textStyle, }: HostInlineButtonProps): React.JSX.Element;
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
type ModalBodyScrollOwner = "helper" | "host" | "required" | "popover";
declare const ModalBodyScrollOwnerContext: React.Context<ModalBodyScrollOwner>;
declare function useModalBodyScrollOwner(): ModalBodyScrollOwner;
/**
 * Defensive layout sanitizer: strips `flex` and `minHeight` when rendered inside
 * a host-scrolled surface (BottomSheetScrollView), preventing accidental layout
 * pinning and scroll lock (#1054, #1254).
 */
declare function sanitizeFluidStyle(style: StyleProp<ViewStyle>, hostOwnsScroll: boolean): StyleProp<ViewStyle>;
interface HostCodeBlockProps {
    code: string;
    language?: string;
    title?: string;
    maxHeight?: number;
    copyable?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
declare function HostCodeBlock({ code, language, title, maxHeight, copyable, style, textStyle, }: HostCodeBlockProps): React.JSX.Element;
interface HostCommandBoxProps {
    command?: string;
    argv?: string[];
    copyLabel?: string;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}
declare function HostCommandBox({ command, argv, copyLabel, style, textStyle, }: HostCommandBoxProps): React.JSX.Element;
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
type ScrollViewInstance = React.ElementRef<typeof ScrollView>;
interface HostScrollProps extends ScrollViewProps {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
}
/** Explicit single scroll owner for surfaces where the host supplies none. */
declare const HostScroll: React.ForwardRefExoticComponent<HostScrollProps & React.RefAttributes<ScrollView>>;
interface HostActionBarProps {
    children: ReactNode;
    align?: "start" | "center" | "end" | "between" | "flex-start" | "flex-end" | "space-between";
    direction?: "row" | "column";
    gap?: number;
    style?: StyleProp<ViewStyle>;
}
/** Trailing action row inside a card or dialog footer. */
declare function HostActionBar({ children, align, direction, gap, style, }: HostActionBarProps): React.JSX.Element;
interface HostFormRowProps {
    label: string;
    description?: string;
    children: ReactNode;
    layout?: "stacked" | "inline";
    style?: StyleProp<ViewStyle>;
}
/** Label and description stacked or inlined with a single control. */
declare function HostFormRow({ label, description, children, layout, style }: HostFormRowProps): React.JSX.Element;
interface HostTextInputProps {
    value: string;
    onChangeText: (text: string) => void;
    label?: string;
    placeholder?: string;
    errorText?: string;
    helperText?: string;
    disabled?: boolean;
    editable?: boolean;
    multiline?: boolean;
    numberOfLines?: number;
    mono?: boolean;
    secureTextEntry?: boolean;
    autoCapitalize?: "none" | "sentences" | "words" | "characters";
    autoCorrect?: boolean;
    keyboardType?: KeyboardTypeOptions;
    onSubmitEditing?: () => void;
    style?: StyleProp<ViewStyle>;
    inputStyle?: StyleProp<TextStyle>;
}
/** Single or multi-line text input using host theme and modal-aware primitive. */
declare function HostTextInput({ value, onChangeText, label, placeholder, errorText, helperText, disabled, editable, multiline, numberOfLines, mono, secureTextEntry, autoCapitalize, autoCorrect, keyboardType, onSubmitEditing, style, inputStyle, }: HostTextInputProps): React.JSX.Element;
interface HostSearchInputProps {
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    onClear?: () => void;
    height?: number;
    style?: StyleProp<ViewStyle>;
    inputStyle?: StyleProp<TextStyle>;
}
/** Search field with leading icon and clear affordance. */
declare function HostSearchInput({ value, onChangeText, placeholder, onClear, height, style, inputStyle, }: HostSearchInputProps): React.JSX.Element;
interface HostSelectOption {
    label: string;
    value: string;
    description?: string;
    display?: string;
}
interface HostSelectProps {
    value: string;
    options: readonly HostSelectOption[];
    onValueChange: (value: string) => void;
    label?: string;
    size?: "sm" | "md" | string;
    placeholder?: string;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
}
/** Inline single-choice picker styled for host dark/light theme palettes. */
declare function HostSelect({ value, options, onValueChange, label, size, placeholder, disabled, style, }: HostSelectProps): React.JSX.Element;
interface HostModalBodyProps {
    children: ReactNode;
    header?: ReactNode;
    headerStyle?: StyleProp<ViewStyle>;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    size?: "default" | "large";
    headerMode?: "pinned" | "scroll";
    refreshing?: boolean;
    onRefresh?: () => void | Promise<void>;
    scrollRef?: React.Ref<ScrollViewInstance>;
    scrollable?: boolean;
}
/** Scrollable body for modal dialogues and plugin surfaces. Owns single scroll unless an ancestor scroller is present. */
declare function HostModalBody({ children, header, headerStyle, style, contentContainerStyle, size, headerMode, refreshing, onRefresh, scrollRef, scrollable, }: HostModalBodyProps): React.JSX.Element;
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
    density?: "compact" | "tiny" | "normal";
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
 * Standard table container rendering styled header and rows with theme borders.
 */
declare function HostDataTable<T>({ data, columns, keyExtractor, emptyState, style, }: HostDataTableProps<T>): React.JSX.Element | null;

interface HostResponsiveProps {
    desktop?: ReactNode;
    mobile?: ReactNode;
    compact?: ReactNode;
    wide?: ReactNode;
    children?: ReactNode | ((responsive: {
        isCompact: boolean;
        isMobile: boolean;
        isWide: boolean;
    }) => ReactNode);
}
/**
 * Responsive viewport container that switches children between mobile and desktop layouts.
 */
declare function HostResponsive({ desktop, mobile, compact, wide, children }: HostResponsiveProps): React.JSX.Element;

export { HostAgentEnvelopeCard as AgentEnvelopeCard, type CardArtifactBadge, type ChecklistItem, type CiStatus, HostCommentCard as CommentCard, type HostDataColumn as DataColumn, HostDataTable as DataTable, type HostDataTableProps as DataTableProps, FALLBACK_COLORS, type HighlightOptions, type HighlightPart, type HostAboutLink, HostAboutSection, type HostAboutSectionProps, HostActionBar, type HostActionBarProps, HostAgentEnvelopeCard, type HostAgentEnvelopeCardProps, HostAttentionBeacon, type HostAttentionBeaconMode, type HostAttentionBeaconProps, type HostAttentionBeaconTone, HostBadge, type HostBadgeProps, type HostBadgeSize, type HostBadgeStyle, HostButton, type HostButtonProps, type HostButtonSize, type HostButtonVariant, HostCard, HostCardHeader, type HostCardHeaderProps, type HostCardProps, HostCodeBlock, type HostCodeBlockProps, HostCollapsible, type HostCollapsibleProps, HostCommandBox, type HostCommandBoxProps, HostCommentCard, type HostCommentCardProps, HostCopyButton, type HostCopyButtonProps, type HostCopyButtonSize, type HostCopyButtonVariant, type HostDataColumn, HostDataTable, type HostDataTableProps, HostEmptyState, type HostEmptyStateProps, HostFormRow, type HostFormRowProps, HostGrid, type HostGridProps, HostHighlightedText, type HostHighlightedTextProps, HostInlineButton, type HostInlineButtonProps, HostInteractiveRow, type HostInteractiveRowProps, HostIssueDetailDrawer, HostKanbanBoard, HostKanbanCard, HostKeyValue, HostKeyValueGroup, type HostKeyValueGroupProps, type HostKeyValueProps, type HostKeyValueTruncateMode, HostLayoutProvider, type HostLayoutProviderProps, HostMarkdownLite, type HostMarkdownLiteProps, HostMetricGauge, type HostMetricGaugeProps, HostModalBody, type HostModalBodyProps, HostModalSection, type HostModalSectionProps, HostProgressBar, type HostProgressBarProps, HostResponsive, type HostResponsiveProps, HostRow, type HostRowProps, HostScopedLabelGroup, type HostScopedLabelGroupProps, HostScroll, type HostScrollProps, HostSearchInput, type HostSearchInputProps, HostSectionHeader, type HostSectionHeaderProps, HostSelect, type HostSelectOption, type HostSelectProps, HostStack, type HostStackProps, HostStatusDot, type HostStatusDotProps, type HostSurfaceVariant, type HostTabItem, HostTabs, type HostTabsProps, HostTextInput, type HostTextInputProps, HostThemeProvider, type HostThemeProviderProps, HostToggle, type HostToggleProps, HostVital, type HostVitalProps, HostInteractiveRow as InteractiveRow, type HostInteractiveRowProps as InteractiveRowProps, type IssueDetailData, HostIssueDetailDrawer as IssueDetailDrawer, type IssueDetailDrawerProps, HostKanbanBoard as KanbanBoard, type KanbanBoardProps, HostKanbanCard as KanbanCard, type KanbanCardProps, type KanbanIssue, type KanbanKeyboardEventLike, type KanbanKeyboardIntent, type KanbanKeyboardIntentType, type KanbanKeydownListener, type KanbanKeydownTarget, type LinkedPullRequest, type ListActionHeaderAction, ListActionPageTemplate, type ListActionPageTemplateProps, HostMarkdownLite as MarkdownLite, type MetricThresholds, type ModalBodyScrollOwner, ModalBodyScrollOwnerContext, type PluginTheme, type PluginUiTheme, type PullRequestReviewDecision, type PullRequestState, HostResponsive as Responsive, type ResponsiveLayout, type HostResponsiveProps as ResponsiveProps, HostScopedLabelGroup as ScopedLabelGroup, type ScrollViewInstance, type SpacingValue, type StatusVariant, type ThemeColors, alpha, describeCiStatus, describePullRequest, describeReviewDecision, detectBranchPill, detectCiStatus, detectLinkedPullRequest, extractChecklist, getActiveDraggingIssue, getKanbanKeydownTarget, getStatusColor, isEditableKeyboardTarget, isFeatureBranch, resolveHostColors, resolveKanbanKeyboardIntent, resolveSpacing, sanitizeFluidStyle, setActiveDraggingIssue, setChecklistItemChecked, spacing, splitHighlightParts, useHostLayout, useHostTheme, useModalBodyScrollOwner };
