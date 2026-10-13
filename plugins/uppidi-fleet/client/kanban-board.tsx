import React from "react";
import {
  KanbanBoard,
  KanbanCard,
  getActiveDraggingIssue,
  setActiveDraggingIssue,
  type KanbanCardProps,
  type KanbanBoardProps,
  type KanbanIssue,
  type RepoGroup,
  type AutomationTier,
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
  type RepoGroup,
  type AutomationTier,
};

export interface UppidiFleetKanbanBoardProps {
  issues: UppidiIssue[];
  selectedRepo?: string;
  onSelectIssue?: (issueNumber: number) => void;
  onTransitionIssue?: (issue: UppidiIssue, targetState: KanbanColumnId) => void | Promise<void>;
  filterQuery?: string;
  onFilterQueryChange?: (query: string) => void;
  isLoading?: boolean;
  /** Multi-repo group filter pills (#1282). */
  repoGroups?: readonly RepoGroup[];
  selectedRepoGroup?: string;
  onSelectRepoGroup?: (groupId: string) => void;
  /** Repo -> 3-tier automation posture (#1282). */
  automationTiers?: Readonly<Record<string, AutomationTier>>;
  onToggleAutomationTier?: (repo: string, tier: AutomationTier) => void | Promise<void>;
  onBackwardTransition?: KanbanBoardProps["onBackwardTransition"];
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
      repoGroups={props.repoGroups}
      selectedRepoGroup={props.selectedRepoGroup}
      onSelectRepoGroup={props.onSelectRepoGroup}
      automationTiers={props.automationTiers}
      onToggleAutomationTier={props.onToggleAutomationTier}
      onBackwardTransition={props.onBackwardTransition}
    />
  );
}
