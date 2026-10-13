import type {
  KanbanColumnId,
  KanbanColumnDef,
  KanbanTransitionAction,
  AgentEnvelope,
  IssueComment,
  ForgeLabel,
  RepoGroup,
  AutomationTier,
} from "@xpufx/backend-tickets/client";

export type {
  KanbanColumnId,
  KanbanColumnDef,
  KanbanTransitionAction,
  AgentEnvelope,
  IssueComment,
  ForgeLabel,
  RepoGroup,
  AutomationTier,
};

export type PullRequestState = "open" | "draft" | "merged" | "closed" | "unknown";

export type PullRequestReviewDecision =
  | "approved"
  | "changes-requested"
  | "pending"
  | "unknown";

export type CiStatus = "passing" | "failing" | "running" | "pending" | "unknown";

export interface LinkedPullRequest {
  number?: number;
  url?: string;
  title?: string;
  state?: PullRequestState;
  draft?: boolean;
  reviewDecision?: PullRequestReviewDecision;
}

export interface ChecklistItem {
  /** Zero-based position among the parsed checklist items. */
  index: number;
  /** 1-based line number in the source body. */
  line: number;
  text: string;
  checked: boolean;
}

/** Full issue payload backing the slide-over detail drawer. */
export interface IssueDetailData {
  body?: string;
  labels?: ForgeLabel[];
  comments?: IssueComment[];
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  webUrl?: string;
}

export interface KanbanIssue {
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

export interface KanbanCardProps {
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

export interface KanbanBoardProps {
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
  onBackwardTransition?: (
    issue: KanbanIssue,
    from: KanbanColumnId,
    to: KanbanColumnId,
  ) => void | Promise<void>;
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
