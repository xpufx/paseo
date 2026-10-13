import { canonicalLabel } from "./taxonomy.js";

export type KanbanColumnId = "backlog" | "in_progress" | "review" | "done";

export interface KanbanColumnDef {
  id: KanbanColumnId;
  title: string;
  stateLabel: string;
  tone: "neutral" | "accent" | "warning" | "success";
  description: string;
}

export const KANBAN_COLUMNS: readonly KanbanColumnDef[] = [
  {
    id: "backlog",
    title: "Backlog / Triage",
    stateLabel: "state/triage",
    tone: "neutral",
    description: "Issues awaiting triage or in backlog",
  },
  {
    id: "in_progress",
    title: "In Progress",
    stateLabel: "state/wip",
    tone: "accent",
    description: "Work actively in progress",
  },
  {
    id: "review",
    title: "Review / Verify",
    stateLabel: "state/review",
    tone: "warning",
    description: "Work under review or ready to verify",
  },
  {
    id: "done",
    title: "Done",
    stateLabel: "state/done",
    tone: "success",
    description: "Work completed and verified",
  },
] as const;

export interface IssueKanbanInput {
  number?: number;
  title?: string;
  repo?: string;
  status?: string | null;
  state?: string | null;
  labels?: readonly string[] | null;
  attention?: string | null;
  branch?: string | null;
  comments?: number | null;
  url?: string | null;
  updatedAt?: string | null;
}

/**
 * Maps an issue or ticket to one of the 4 canonical Kanban columns
 * based on its status enum, state string, or scoped labels.
 */
export function getIssueKanbanColumn(issue: IssueKanbanInput): KanbanColumnId {
  const rawLabels = Array.isArray(issue.labels) ? issue.labels : [];
  const normalized = rawLabels.map((l) => canonicalLabel(String(l).trim().toLowerCase()));

  if (
    issue.status === "Done" ||
    issue.state === "closed" ||
    normalized.some((l) => l === "state/done" || l.startsWith("state/4"))
  ) {
    return "done";
  }
  if (
    issue.status === "Review" ||
    normalized.some(
      (l) =>
        l === "state/review" ||
        l === "state/verify" ||
        l.startsWith("state/2") ||
        l.startsWith("state/3") ||
        l.startsWith("review/"),
    )
  ) {
    return "review";
  }
  if (
    issue.status === "In progress" ||
    normalized.some((l) => l === "state/wip" || l.startsWith("state/1"))
  ) {
    return "in_progress";
  }
  return "backlog";
}

export interface KanbanTransitionAction {
  targetState: KanbanColumnId;
  label: string;
  icon: string;
  title: string;
}

/**
 * Returns permissible 1-click state transition actions from a given column.
 */
export function getColumnTransitions(currentColumn: KanbanColumnId): KanbanTransitionAction[] {
  switch (currentColumn) {
    case "backlog":
      return [
        { targetState: "in_progress", label: "Start", icon: "Play", title: "Move to In Progress" },
        { targetState: "review", label: "Review", icon: "FileCheck", title: "Move to Review" },
      ];
    case "in_progress":
      return [
        { targetState: "backlog", label: "Backlog", icon: "ArrowLeft", title: "Move to Backlog" },
        { targetState: "review", label: "Review", icon: "ArrowRight", title: "Move to Review" },
      ];
    case "review":
      return [
        { targetState: "in_progress", label: "WIP", icon: "ArrowLeft", title: "Return to In Progress" },
        { targetState: "done", label: "Done", icon: "Check", title: "Mark as Done" },
      ];
    case "done":
      return [
        { targetState: "backlog", label: "Reopen", icon: "RotateCcw", title: "Reopen into Backlog" },
        { targetState: "in_progress", label: "WIP", icon: "Play", title: "Move to In Progress" },
      ];
  }
}

const KANBAN_COLUMN_RANK: Record<KanbanColumnId, number> = {
  backlog: 0,
  in_progress: 1,
  review: 2,
  done: 3,
};

/**
 * True when moving from `from` to `to` walks the board backward (#1282): the
 * canonical use is Review → In Progress, which signals change requests rather
 * than forward progress.
 */
export function isBackwardKanbanTransition(
  from: KanbanColumnId,
  to: KanbanColumnId,
): boolean {
  return KANBAN_COLUMN_RANK[to] < KANBAN_COLUMN_RANK[from];
}

/**
 * Deterministically checks if two repository coordinates or URL descriptors match.
 */
export function isRepoMatching(repoA?: string | null, repoB?: string | null): boolean {
  if (!repoA || !repoB) return false;
  if (repoA.toLowerCase() === repoB.toLowerCase()) return true;
  const cleanA = repoA
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/^git@[^:]+:/, "");
  const cleanB = repoB
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/^git@[^:]+:/, "");
  if (cleanA === cleanB) return true;
  if (cleanA.endsWith(`/${cleanB}`) || cleanB.endsWith(`/${cleanA}`)) return true;
  return false;
}
