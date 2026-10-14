import { ForgeLabel, IssueComment, KanbanColumnId, KanbanColumnDef, RepoGroup, AutomationTier, AgentEnvelope } from '@xpufx/backend-tickets/client';
export { AgentEnvelope, AutomationTier, ForgeLabel, IssueComment, KanbanColumnDef, KanbanColumnId, KanbanTransitionAction, RepoGroup } from '@xpufx/backend-tickets/client';
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { S as StatusVariant } from '../types-bzCBod7A.js';

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
    /**
     * Multi-repo association (#1282): board-toolbar filter pills. The implicit
     * `All` group is prepended when absent. Omit to hide the group filter.
     */
    repoGroups?: readonly RepoGroup[];
    /** Controlled group selection; leave undefined to let the board own it. */
    selectedRepoGroup?: string;
    onSelectRepoGroup?: (groupId: string) => void;
    /**
     * Repo -> automation tier map (#1282). When provided, the board renders a
     * clickable tier pill per repository. Unset repos default to `full-active`.
     */
    automationTiers?: Readonly<Record<string, AutomationTier>>;
    /**
     * Advances a repository to `tier` when its pill is clicked. The board passes
     * {@link nextAutomationTier} of the repo's current tier, so repeated clicks
     * cycle Full Fleet Active → Paused → Kanban-Only.
     */
    onToggleAutomationTier?: (repo: string, tier: AutomationTier) => void | Promise<void>;
    /**
     * Fires after a card walks the board backward (#1282), e.g. Review → In
     * Progress. Hosts wire this to change-request steering; it runs after the
     * state transition itself succeeds.
     */
    onBackwardTransition?: (issue: KanbanIssue, from: KanbanColumnId, to: KanbanColumnId) => void | Promise<void>;
    /**
     * Swimlane grouping mode (#1282). When set to `repository` (default when
     * multi-repo group view is active), issues are grouped horizontally by
     * repository with collapsible swimlane rows. Also supports `epic`,
     * `priority`, or `none` for classic column layout.
     */
    swimlaneGroup?: "none" | "repository" | "epic" | "priority";
    /** Controlled swimlane selection; leave undefined to let the board own collapse state. */
    collapsedSwimlanes?: ReadonlySet<string>;
    /** Toggle handler called when a swimlane header is pressed. */
    onSwimlaneToggle?: (swimlaneId: string) => void;
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

/** True when `label` contains a valid scope prefix followed by a value. */
declare function isScopedLabel(label: string): boolean;
interface ScopedLabelChipProps {
    label: string;
    onPress?: () => void;
    style?: StyleProp<ViewStyle>;
}
declare function HostScopedLabelChip({ label, onPress, style, }: ScopedLabelChipProps): React.JSX.Element;

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

declare function HostKanbanBoard({ issues, selectedRepo, onSelectIssue, onTransitionIssue, filterQuery: externalFilterQuery, onFilterQueryChange, isLoading, columns, selectedIssueNumber, onSelectedIssueNumberChange, onOpenIssueDetail, issueDetail, detailDrawer, onToggleChecklistItem, onSubmitComment, onSelectLabel, activeStateLabel, repoGroups, selectedRepoGroup, onSelectRepoGroup, automationTiers, onToggleAutomationTier, onBackwardTransition, swimlaneGroup, collapsedSwimlanes: externalCollapsedSwimlanes, onSwimlaneToggle, }: KanbanBoardProps): React.JSX.Element;

/** Grouping mode for swimlane rows. */
type SwimlaneGroup = "none" | "repository" | "epic" | "priority";
interface SwimlaneHeaderProps {
    title: string;
    count: number;
    collapsed: boolean;
    onToggle: () => void;
    tone?: "neutral" | "accent" | "warning" | "success";
}
declare function HostSwimlaneHeader({ title, count, collapsed, onToggle, tone, }: SwimlaneHeaderProps): React.JSX.Element;
interface SwimlaneRowProps {
    /** Unique identifier for this swimlane. */
    id: string;
    /** Display title for the swimlane header. */
    title: string;
    /** Total issues across all columns in this swimlane. */
    totalCount: number;
    /** Issues grouped by column within this swimlane. */
    issuesByColumn: Record<KanbanColumnId, KanbanIssue[]>;
    /** Column definitions for rendering. */
    columns: readonly KanbanColumnDef[];
    /** Rendered card component for each issue. */
    renderCard: (issue: KanbanIssue, columnId: KanbanColumnId) => React.ReactNode;
    /** Whether this swimlane is currently collapsed. */
    collapsed: boolean;
    /** Toggle handler called when the header is pressed. */
    onToggle: () => void;
    /** Tone for the swimlane indicator dot. */
    tone?: "neutral" | "accent" | "warning" | "success";
    /** Optional drag-and-drop handlers at the column level. */
    dropHandlers?: Record<KanbanColumnId, {
        onDragOver?: (e: any) => void;
        onDragEnter?: (e: any) => void;
        onDragLeave?: (e: any) => void;
        onDrop?: (e: any) => void;
    }>;
}
declare function HostSwimlaneRow({ id, title, totalCount, issuesByColumn, columns, renderCard, collapsed, onToggle, tone, dropHandlers, }: SwimlaneRowProps): React.JSX.Element;

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

export { HostAgentEnvelopeCard as AgentEnvelopeCard, type CardArtifactBadge, type ChecklistItem, type CiStatus, HostCommentCard as CommentCard, HostAgentEnvelopeCard, type HostAgentEnvelopeCardProps, HostCommentCard, type HostCommentCardProps, HostIssueDetailDrawer, HostKanbanBoard, HostKanbanCard, HostMarkdownLite, type HostMarkdownLiteProps, HostScopedLabelChip, HostScopedLabelGroup, type HostScopedLabelGroupProps, HostSwimlaneHeader, HostSwimlaneRow, type IssueDetailData, HostIssueDetailDrawer as IssueDetailDrawer, type IssueDetailDrawerProps, HostKanbanBoard as KanbanBoard, type KanbanBoardProps, HostKanbanCard as KanbanCard, type KanbanCardProps, type KanbanIssue, type KanbanKeyboardEventLike, type KanbanKeyboardIntent, type KanbanKeyboardIntentType, type KanbanKeydownListener, type KanbanKeydownTarget, type LinkedPullRequest, HostMarkdownLite as MarkdownLite, type PullRequestReviewDecision, type PullRequestState, HostScopedLabelChip as ScopedLabelChip, HostScopedLabelGroup as ScopedLabelGroup, type SwimlaneGroup, type SwimlaneHeaderProps, type SwimlaneRowProps, describeCiStatus, describePullRequest, describeReviewDecision, detectBranchPill, detectCiStatus, detectLinkedPullRequest, extractChecklist, getActiveDraggingIssue, getKanbanKeydownTarget, isEditableKeyboardTarget, isFeatureBranch, isScopedLabel, resolveKanbanKeyboardIntent, setActiveDraggingIssue, setChecklistItemChecked };
