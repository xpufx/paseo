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
}

export interface KanbanCardProps {
  issue: KanbanIssue;
  columnId: KanbanColumnId;
  onSelect?: (issueNumber: number) => void;
  onTransition?: (issue: KanbanIssue, targetState: KanbanColumnId) => void | Promise<void>;
  isTransitioning?: boolean;
  isDragging?: boolean;
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
}
