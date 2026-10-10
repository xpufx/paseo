import React, { useState, useMemo } from "react";
import { View, Text, Platform, ScrollView } from "react-native";
import {
  Badge,
  Button,
  Row,
  StatusDot,
  SearchInput,
  InteractiveRow,
} from "./host-ui.js";
import { useFleetTheme } from "./theme.js";
import type { UppidiIssue, AttentionLabel, KanbanColumnId } from "../shared/contracts.js";
import { isRepoMatching } from "../shared/sort-filter.js";

export interface KanbanColumnDef {
  id: KanbanColumnId;
  title: string;
  stateLabel: string;
  tone: "neutral" | "accent" | "warning" | "success";
  description: string;
}

export const KANBAN_COLUMNS: KanbanColumnDef[] = [
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
];

export function getIssueKanbanColumn(issue: UppidiIssue): KanbanColumnId {
  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  const normalized = labels.map((l) => String(l).trim().toLowerCase());

  if (
    issue.status === "Done" ||
    issue.state === "closed" ||
    normalized.some((l) => l === "state/done" || l === "state/4-done" || l.startsWith("state/4"))
  ) {
    return "done";
  }
  if (
    issue.status === "Review" ||
    normalized.some(
      (l) =>
        l === "state/review" ||
        l === "state/verify" ||
        l === "state/2-review" ||
        l === "state/3-verify" ||
        l.startsWith("state/2") ||
        l.startsWith("state/3") ||
        l.startsWith("review/"),
    )
  ) {
    return "review";
  }
  if (
    issue.status === "In progress" ||
    normalized.some((l) => l === "state/wip" || l === "state/1-wip" || l.startsWith("state/1"))
  ) {
    return "in_progress";
  }
  return "backlog";
}

const ATTENTION_CONFIG: Record<
  AttentionLabel,
  { label: string; variant: "neutral" | "info" | "warning" }
> = {
  "attention/orchestrator": { label: "Orchestrator", variant: "info" },
  "attention/agent": { label: "Agent", variant: "neutral" },
  "attention/user": { label: "You", variant: "warning" },
  "attention/0-orchestrator": { label: "Orchestrator", variant: "info" },
  "attention/1-agent": { label: "Agent", variant: "neutral" },
  "attention/2-user": { label: "You", variant: "warning" },
};

export interface KanbanTransitionAction {
  targetState: KanbanColumnId;
  label: string;
  icon: string;
  title: string;
}

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

let activeDraggingIssue: UppidiIssue | null = null;

export function getActiveDraggingIssue(): UppidiIssue | null {
  return activeDraggingIssue;
}

export function setActiveDraggingIssue(issue: UppidiIssue | null): void {
  activeDraggingIssue = issue;
  if (typeof window !== "undefined") {
    (window as any).__uppidi_dragging_issue = issue;
  }
}

export interface KanbanCardProps {
  issue: UppidiIssue;
  columnId: KanbanColumnId;
  onSelect?: (issueNumber: number) => void;
  onTransition?: (issue: UppidiIssue, targetState: KanbanColumnId) => void | Promise<void>;
  isTransitioning?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: any) => void;
  onDragEnd?: (e: any) => void;
}

export function KanbanCard({
  issue,
  columnId,
  onSelect,
  onTransition,
  isTransitioning = false,
  isDragging = false,
  onDragStart,
  onDragEnd,
}: KanbanCardProps) {
  const { colors, typography } = useFleetTheme();
  const transitions = getColumnTransitions(columnId);
  const attention = ATTENTION_CONFIG[issue.attention] ?? { label: "Agent", variant: "neutral" };
  const isWeb = Platform.OS === "web";
  const [internalDragging, setInternalDragging] = useState(false);
  const draggingActive = isDragging || internalDragging;

  const handleDragStart = (e: any) => {
    setInternalDragging(true);
    setActiveDraggingIssue(issue);
    if (e && e.dataTransfer && e.nativeEvent && !e.nativeEvent.dataTransfer) {
      try {
        e.nativeEvent.dataTransfer = e.dataTransfer;
      } catch (err) {
        console.error("[uppidi-fleet] kanban drag-and-drop:", err);
      }
    }
    if (e && !e.dataTransfer && e.nativeEvent?.dataTransfer) {
      try {
        e.dataTransfer = e.nativeEvent.dataTransfer;
      } catch (err) {
        console.error("[uppidi-fleet] kanban drag-and-drop:", err);
      }
    }
    const dts = new Set<any>();
    if (e?.dataTransfer) dts.add(e.dataTransfer);
    if (e?.nativeEvent?.dataTransfer) dts.add(e.nativeEvent.dataTransfer);
    for (const dt of dts) {
      try {
        dt.setData?.("text/plain", String(issue.number));
        dt.setData?.("application/json", JSON.stringify(issue));
        dt.effectAllowed = "move";
      } catch {
        // ignore in environments with restricted dataTransfer
      }
    }
    onDragStart?.(e);
  };

  const handleDragEnd = (e: any) => {
    setInternalDragging(false);
    setActiveDraggingIssue(null);
    onDragEnd?.(e);
  };

  const cardStyle: Record<string, any> = {
    backgroundColor: colors.surface0,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 8,
    opacity: draggingActive ? 0.6 : 1,
    ...(isWeb ? { cursor: "grab" } : {}),
  };

  // React Native Web strips non-allowlisted DOM props (draggable, onDragStart,
  // onDragEnd, ...) from <View>, so the drag source must be a native element
  // on web or the browser never initiates the drag. See #807.
  const webCardTestProps = { testID: `kanban-card-${issue.number}` } as any;

  const cardContent = (
    <>
      {/* Top row: Issue number, repo, attention */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Row gap="xs" align="center">
          <InteractiveRow
            onPress={() => onSelect?.(issue.number)}
            accessibilityRole="button"
            accessibilityLabel={`Open issue #${issue.number}`}
          >
            <Text
              style={{
                color: colors.accent,
                fontWeight: "700",
                fontSize: 12,
              }}
            >
              #{issue.number}
            </Text>
          </InteractiveRow>
          <Badge label={issue.repo} variant="neutral" size="sm" />
        </Row>
        <Badge label={attention.label} variant={attention.variant} size="sm" />
      </View>

      {/* Title */}
      <InteractiveRow
        onPress={() => onSelect?.(issue.number)}
        accessibilityRole="button"
        accessibilityLabel={`View details for #${issue.number} ${issue.title}`}
      >
        <Text
          numberOfLines={3}
          style={{
            color: colors.foreground,
            fontWeight: "600",
            fontSize: 13,
            lineHeight: 18,
          }}
        >
          {issue.title}
        </Text>
      </InteractiveRow>

      {/* Meta tags (branch, comments) */}
      {(issue.branch || (issue.comments !== undefined && issue.comments > 0)) && (
        <Row gap="xs" align="center" wrap>
          {issue.branch && (
            <Badge label={issue.branch} variant="neutral" size="sm" />
          )}
          {issue.comments !== undefined && issue.comments > 0 && (
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
              💬 {issue.comments}
            </Text>
          )}
        </Row>
      )}

      {/* 1-Click State Transition Buttons */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
          marginTop: 2,
          paddingTop: 6,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        {transitions.map((t) => (
          <Button
            key={t.targetState}
            label={t.label}
            icon={t.icon}
            size="sm"
            variant="secondary"
            disabled={isTransitioning}
            accessibilityLabel={`Move #${issue.number} to ${t.title}`}
            onPress={() => onTransition?.(issue, t.targetState)}
          />
        ))}
      </View>
    </>
  );

  if (isWeb) {
    return (
      <div
        {...webCardTestProps}
        data-testid={`kanban-card-${issue.number}`}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ display: "flex", flexDirection: "column", ...cardStyle }}
      >
        {cardContent}
      </div>
    );
  }

  return (
    <View
      testID={`kanban-card-${issue.number}`}
      style={cardStyle}
    >
      {cardContent}
    </View>
  );
}

export interface UppidiFleetKanbanBoardProps {
  issues: UppidiIssue[];
  selectedRepo?: string;
  onSelectIssue?: (issueNumber: number) => void;
  onTransitionIssue?: (issue: UppidiIssue, targetState: KanbanColumnId) => void | Promise<void>;
  filterQuery?: string;
  onFilterQueryChange?: (query: string) => void;
  isLoading?: boolean;
}

export function UppidiFleetKanbanBoard({
  issues,
  selectedRepo,
  onSelectIssue,
  onTransitionIssue,
  filterQuery: externalFilterQuery,
  onFilterQueryChange,
  isLoading = false,
}: UppidiFleetKanbanBoardProps) {
  const { colors, typography } = useFleetTheme();
  const [internalQuery, setInternalQuery] = useState("");
  const [transitioningIssueId, setTransitioningIssueId] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumnId | null>(null);
  const isWeb = Platform.OS === "web";

  const query = externalFilterQuery !== undefined ? externalFilterQuery : internalQuery;
  const setQuery = onFilterQueryChange ?? setInternalQuery;

  // Filter issues by search query and repository
  const filteredIssues = useMemo(() => {
    let list = Array.isArray(issues) ? issues : [];
    if (selectedRepo && selectedRepo !== "all") {
      list = list.filter((i) => isRepoMatching(i.repo, selectedRepo));
    }
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((i) => {
      const matchNum = String(i.number).includes(q) || `#${i.number}`.includes(q);
      const matchTitle = (i.title || "").toLowerCase().includes(q);
      const matchRepo = (i.repo || "").toLowerCase().includes(q);
      const matchLabel = (i.labels || []).some((l) => l.toLowerCase().includes(q));
      return matchNum || matchTitle || matchRepo || matchLabel;
    });
  }, [issues, selectedRepo, query]);

  // Group issues into the 4 columns
  const issuesByColumn = useMemo(() => {
    const map: Record<KanbanColumnId, UppidiIssue[]> = {
      backlog: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const issue of filteredIssues) {
      const col = getIssueKanbanColumn(issue);
      map[col].push(issue);
    }
    return map;
  }, [filteredIssues]);

  const handleTransition = async (issue: UppidiIssue, targetState: KanbanColumnId) => {
    if (!onTransitionIssue) return;
    setTransitioningIssueId(issue.number);
    try {
      await onTransitionIssue(issue, targetState);
    } finally {
      setTransitioningIssueId(null);
    }
  };

  const handleColumnDragOver = (e: any, colId: KanbanColumnId) => {
    e.preventDefault?.();
    if (e?.nativeEvent?.preventDefault) {
      try {
        e.nativeEvent.preventDefault();
      } catch (err) {
        console.error("[uppidi-fleet] kanban drag-and-drop:", err);
      }
    }
    const dts = new Set<any>();
    if (e?.dataTransfer) dts.add(e.dataTransfer);
    if (e?.nativeEvent?.dataTransfer) dts.add(e.nativeEvent.dataTransfer);
    for (const dt of dts) {
      try {
        dt.dropEffect = "move";
      } catch (err) {
        console.error("[uppidi-fleet] kanban drag-and-drop:", err);
      }
    }
    if (dragOverColumn !== colId) {
      setDragOverColumn(colId);
    }
  };

  const handleColumnDragEnter = (e: any, colId: KanbanColumnId) => {
    e.preventDefault?.();
    if (e?.nativeEvent?.preventDefault) {
      try {
        e.nativeEvent.preventDefault();
      } catch (err) {
        console.error("[uppidi-fleet] kanban drag-and-drop:", err);
      }
    }
    const dts = new Set<any>();
    if (e?.dataTransfer) dts.add(e.dataTransfer);
    if (e?.nativeEvent?.dataTransfer) dts.add(e.nativeEvent.dataTransfer);
    for (const dt of dts) {
      try {
        dt.dropEffect = "move";
      } catch (err) {
        console.error("[uppidi-fleet] kanban drag-and-drop:", err);
      }
    }
    setDragOverColumn(colId);
  };

  const handleColumnDragLeave = (e: any, colId: KanbanColumnId) => {
    e.preventDefault?.();
    const relatedTarget = e?.relatedTarget ?? e?.nativeEvent?.relatedTarget;
    if (e?.currentTarget && relatedTarget && e.currentTarget.contains?.(relatedTarget)) {
      return;
    }
    setDragOverColumn((current) => (current === colId ? null : current));
  };

  const handleColumnDrop = async (e: any, targetColId: KanbanColumnId) => {
    e.preventDefault?.();
    if (e?.nativeEvent?.preventDefault) {
      try {
        e.nativeEvent.preventDefault();
      } catch (err) {
        console.error("[uppidi-fleet] kanban drag-and-drop:", err);
      }
    }
    e.stopPropagation?.();
    if (e?.nativeEvent?.stopPropagation) {
      try {
        e.nativeEvent.stopPropagation();
      } catch (err) {
        console.error("[uppidi-fleet] kanban drag-and-drop:", err);
      }
    }
    setDragOverColumn(null);

    let issueToTransition: UppidiIssue | undefined;
    const dts = [e?.dataTransfer, e?.nativeEvent?.dataTransfer].filter(Boolean);
    for (const dt of dts) {
      if (issueToTransition) break;
      try {
        const jsonStr = dt.getData?.("application/json");
        if (jsonStr) {
          issueToTransition = JSON.parse(jsonStr);
          break;
        }
      } catch {
        // Fallback to text/plain issue number
      }

      try {
        const numStr = dt.getData?.("text/plain");
        if (numStr) {
          const issueNum = parseInt(numStr, 10);
          if (!Number.isNaN(issueNum)) {
            issueToTransition = issues.find((i) => i.number === issueNum);
            if (issueToTransition) break;
          }
        }
      } catch (err) {
        console.error("[uppidi-fleet] kanban drag-and-drop:", err);
      }
    }

    if (!issueToTransition) {
      issueToTransition =
        activeDraggingIssue ??
        (typeof window !== "undefined" ? (window as any).__uppidi_dragging_issue : undefined);
    }

    if (issueToTransition) {
      const fullIssue = issues.find((i) => i.number === issueToTransition?.number) ?? issueToTransition;
      const currentColumn = getIssueKanbanColumn(fullIssue);
      if (currentColumn !== targetColId) {
        setActiveDraggingIssue(null);
        await handleTransition(fullIssue, targetColId);
      }
    }
  };

  return (
    <View style={{ width: "100%", gap: 12 }} testID="kanban-board-container">
      {/* Top Toolbar: Search + Column Metrics Summary */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <View style={{ flex: 1, minWidth: 220, maxWidth: 380 }}>
          <SearchInput
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery("")}
            placeholder="Filter board cards..."
            height={28}
          />
        </View>

        <Row gap="xs" align="center" wrap>
          {KANBAN_COLUMNS.map((col) => (
            <Row
              key={col.id}
              gap="xs"
              align="center"
              style={{
                backgroundColor: colors.surface1,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <StatusDot variant={col.tone === "accent" ? "info" : col.tone} />
              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                {col.title}:
              </Text>
              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 11 }}>
                {issuesByColumn[col.id].length}
              </Text>
            </Row>
          ))}
        </Row>
      </View>

      {/* Horizontal ScrollView across the 4 Columns.
          A nested horizontal scroller keeps the plain React Native ScrollView
          (not the host sheet-gesture scroller) so the bottom sheet never
          collapses on device (#219). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={true}
        contentContainerStyle={{
          flexDirection: "row",
          gap: 12,
          paddingBottom: 16,
          paddingTop: 4,
        }}
        testID="kanban-board-scroll"
      >
        {KANBAN_COLUMNS.map((col) => {
          const colIssues = issuesByColumn[col.id];
          const isOver = dragOverColumn === col.id;

          const columnStyle: Record<string, any> = {
            width: 290,
            minWidth: 260,
            backgroundColor: isOver
              ? (colors.surface2)
              : (colors.surface1),
            borderColor: isOver
              ? (colors.accent)
              : (colors.border),
            borderWidth: isOver ? 2 : 1,
            borderStyle: isOver ? "dashed" : "solid",
            borderRadius: 8,
            flexDirection: "column",
            flexShrink: 0,
            padding: isOver ? 9 : 10,
          };

          const dropHandlers = {
            onDragOver: (e: any) => handleColumnDragOver(e, col.id),
            onDragEnter: (e: any) => handleColumnDragEnter(e, col.id),
            onDragLeave: (e: any) => handleColumnDragLeave(e, col.id),
            onDrop: (e: any) => handleColumnDrop(e, col.id),
          };

          const columnHeader = (
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: 8,
                marginBottom: 8,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Row align="center" gap="xs">
                <StatusDot variant={col.tone === "accent" ? "info" : col.tone} />
                <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>
                  {col.title}
                </Text>
              </Row>
              <Badge label={String(colIssues.length)} variant="neutral" size="sm" />
            </View>
          );

          const columnCards = colIssues.length === 0 ? (
            <View
              style={{
                padding: 24,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: colors.foregroundMuted,
                  ...typography.caption,
                  fontSize: 12,
                }}
              >
                No issues in this column
              </Text>
            </View>
          ) : (
            colIssues.map((issue) => (
              <KanbanCard
                key={issue.number}
                issue={issue}
                columnId={col.id}
                onSelect={onSelectIssue}
                onTransition={handleTransition}
                isTransitioning={transitioningIssueId === issue.number}
              />
            ))
          );

          // React Native Web strips non-allowlisted DOM props (onDragOver,
          // onDrop, ...) from <View>/<ScrollView>, so drop zones must be
          // native elements on web or drops never fire. See #807.
          //
          // The column body is a native div that owns the drop handlers; the
          // vertical scroll is delegated to the host ScrollView (host scroll ownership)
          // instead of a hand-rolled `overflow: auto` div, which fought the
          // HTML5 drag gesture and broke drops (#807).
          if (isWeb) {
            const webColumnTestProps = { testID: `kanban-column-${col.id}` } as any;
            const webBodyTestProps = { testID: `kanban-column-body-${col.id}` } as any;
            return (
              <div
                key={col.id}
                {...webColumnTestProps}
                data-testid={`kanban-column-${col.id}`}
                {...dropHandlers}
                style={{ display: "flex", ...columnStyle }}
              >
                {columnHeader}
                <div
                  {...webBodyTestProps}
                  data-testid={`kanban-column-body-${col.id}`}
                  {...dropHandlers}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minHeight: 0,
                    maxHeight: 600,
                  }}
                >
                  <ScrollView
                    style={{ flex: 1, minHeight: 0 }}
                    contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
                  >
                    {columnCards}
                  </ScrollView>
                </div>
              </div>
            );
          }

          return (
            <View
              key={col.id}
              testID={`kanban-column-${col.id}`}
              style={columnStyle}
            >
              {columnHeader}

              {/* Column Body: vertical scroll delegated to the host ScrollView */}
              <ScrollView
                showsVerticalScrollIndicator={true}
                style={{ flex: 1, maxHeight: 600 }}
                contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
                testID={`kanban-column-body-${col.id}`}
              >
                {columnCards}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
