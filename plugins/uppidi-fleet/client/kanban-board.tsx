import React from "react";
import {
  KanbanBoard,
  KanbanCard,
  getActiveDraggingIssue,
  setActiveDraggingIssue,
  type KanbanCardProps,
  type KanbanBoardProps,
  type KanbanIssue,
} from "@xpufx/paseo-plugin-ui";
import {
  KANBAN_COLUMNS,
  getIssueKanbanColumn,
  getColumnTransitions,
  type KanbanColumnId,
  type KanbanColumnDef,
  type KanbanTransitionAction,
} from "@xpufx/backend-tickets/client";
import type { UppidiIssue } from "../shared/contracts.js";

export {
  KANBAN_COLUMNS,
  getIssueKanbanColumn,
  getColumnTransitions,
  getActiveDraggingIssue,
  setActiveDraggingIssue,
  KanbanCard,
  type KanbanColumnId,
  type KanbanColumnDef,
  type KanbanTransitionAction,
  type KanbanCardProps,
};

export interface UppidiFleetKanbanBoardProps {
  issues: UppidiIssue[];
  selectedRepo?: string;
  onSelectIssue?: (issueNumber: number) => void;
  onTransitionIssue?: (issue: UppidiIssue, targetState: KanbanColumnId) => void | Promise<void>;
  filterQuery?: string;
  onFilterQueryChange?: (query: string) => void;
  isLoading?: boolean;
}

export function UppidiFleetKanbanBoard(props: UppidiFleetKanbanBoardProps) {
  return (
    <KanbanBoard
      issues={props.issues}
      selectedRepo={props.selectedRepo}
      onSelectIssue={props.onSelectIssue}
      onTransitionIssue={props.onTransitionIssue as any}
      filterQuery={props.filterQuery}
      onFilterQueryChange={props.onFilterQueryChange}
      isLoading={props.isLoading}
    />
  );
}
