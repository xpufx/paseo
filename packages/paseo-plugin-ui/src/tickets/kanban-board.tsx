import React, { useState, useMemo } from "react";
import { Platform, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import {
  KANBAN_COLUMNS,
  getIssueKanbanColumn,
  isRepoMatching,
  type KanbanColumnId,
  type KanbanColumnDef,
} from "@xpufx/backend-tickets/client";
import {
  HostBadge,
  HostRow,
  HostSearchInput,
  HostStatusDot,
  useHostTheme,
} from "../index.js";
import {
  HostKanbanCard,
  getActiveDraggingIssue,
  setActiveDraggingIssue,
} from "./kanban-card.js";
import type { KanbanBoardProps, KanbanIssue } from "./types.js";

export function HostKanbanBoard({
  issues,
  selectedRepo,
  onSelectIssue,
  onTransitionIssue,
  filterQuery: externalFilterQuery,
  onFilterQueryChange,
  isLoading = false,
  columns = KANBAN_COLUMNS,
}: KanbanBoardProps) {
  const { colors } = useHostTheme();
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

  // Group issues by column ID
  const issuesByColumn = useMemo(() => {
    const map: Record<string, KanbanIssue[]> = {};
    for (const col of columns) {
      map[col.id] = [];
    }
    for (const issue of filteredIssues) {
      const col = getIssueKanbanColumn(issue);
      if (map[col]) {
        map[col].push(issue);
      } else if (map.backlog) {
        map.backlog.push(issue);
      }
    }
    return map;
  }, [filteredIssues, columns]);

  const handleTransition = async (issue: KanbanIssue, targetState: KanbanColumnId) => {
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
        console.error("[paseo-plugin-ui] kanban drag-and-drop:", err);
      }
    }
    const dts = new Set<any>();
    if (e?.dataTransfer) dts.add(e.dataTransfer);
    if (e?.nativeEvent?.dataTransfer) dts.add(e.nativeEvent.dataTransfer);
    for (const dt of dts) {
      try {
        dt.dropEffect = "move";
      } catch (err) {
        console.error("[paseo-plugin-ui] kanban drag-and-drop:", err);
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
        console.error("[paseo-plugin-ui] kanban drag-and-drop:", err);
      }
    }
    const dts = new Set<any>();
    if (e?.dataTransfer) dts.add(e.dataTransfer);
    if (e?.nativeEvent?.dataTransfer) dts.add(e.nativeEvent.dataTransfer);
    for (const dt of dts) {
      try {
        dt.dropEffect = "move";
      } catch (err) {
        console.error("[paseo-plugin-ui] kanban drag-and-drop:", err);
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
        console.error("[paseo-plugin-ui] kanban drag-and-drop:", err);
      }
    }
    e.stopPropagation?.();
    if (e?.nativeEvent?.stopPropagation) {
      try {
        e.nativeEvent.stopPropagation();
      } catch (err) {
        console.error("[paseo-plugin-ui] kanban drag-and-drop:", err);
      }
    }
    setDragOverColumn(null);

    let issueToTransition: KanbanIssue | undefined;
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
        // fallback
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
        console.error("[paseo-plugin-ui] kanban drag-and-drop:", err);
      }
    }

    if (!issueToTransition) {
      issueToTransition =
        getActiveDraggingIssue() ??
        (typeof globalThis !== "undefined" ? (globalThis as any).__paseo_dragging_issue : undefined);
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
          <HostSearchInput
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery("")}
            placeholder="Filter board cards..."
            height={28}
          />
        </View>

        <HostRow gap="xs" align="center" wrap>
          {columns.map((col) => (
            <HostRow
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
              <HostStatusDot variant={col.tone === "accent" ? "info" : col.tone} />
              <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
                {col.title}:
              </Text>
              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 11 }}>
                {issuesByColumn[col.id]?.length ?? 0}
              </Text>
            </HostRow>
          ))}
        </HostRow>
      </View>

      {/* Horizontal ScrollView across the Columns */}
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
        {columns.map((col) => {
          const colIssues = issuesByColumn[col.id] ?? [];
          const isOver = dragOverColumn === col.id;

          const columnStyle: Record<string, any> = {
            width: 290,
            minWidth: 260,
            backgroundColor: isOver ? colors.surface2 : colors.surface1,
            borderColor: isOver ? colors.accent : colors.border,
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
              <HostRow align="center" gap="xs">
                <HostStatusDot variant={col.tone === "accent" ? "info" : col.tone} />
                <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>
                  {col.title}
                </Text>
              </HostRow>
              <HostBadge label={String(colIssues.length)} variant="neutral" size="sm" />
            </View>
          );

          const columnCards =
            colIssues.length === 0 ? (
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
                    fontSize: 12,
                  }}
                >
                  No issues in this column
                </Text>
              </View>
            ) : (
              colIssues.map((issue) => (
                <HostKanbanCard
                  key={issue.number}
                  issue={issue}
                  columnId={col.id}
                  onSelect={onSelectIssue}
                  onTransition={handleTransition}
                  isTransitioning={transitioningIssueId === issue.number}
                />
              ))
            );

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

export { HostKanbanBoard as KanbanBoard };
