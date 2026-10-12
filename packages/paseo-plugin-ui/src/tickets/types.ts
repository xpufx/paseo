import type {
  KanbanColumnId,
  KanbanColumnDef,
  KanbanTransitionAction,
  AgentEnvelope,
  IssueComment,
  ForgeLabel,
} from "@xpufx/backend-tickets/client";

export type {
  KanbanColumnId,
  KanbanColumnDef,
  KanbanTransitionAction,
  AgentEnvelope,
  IssueComment,
  ForgeLabel,
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
}
