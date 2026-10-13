import React, { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { KanbanColumnId, KanbanColumnDef } from "@xpufx/backend-tickets/client";
import {
  HostBadge,
  HostRow,
  HostStatusDot,
  useHostTheme,
} from "../index.js";
import type { KanbanIssue } from "./types.js";

/** Grouping mode for swimlane rows. */
export type SwimlaneGroup = "none" | "repository" | "epic" | "priority";

export interface SwimlaneHeaderProps {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  tone?: "neutral" | "accent" | "warning" | "success";
}

export function HostSwimlaneHeader({
  title,
  count,
  collapsed,
  onToggle,
  tone = "neutral",
}: SwimlaneHeaderProps) {
  const { colors } = useHostTheme();
  const isWeb = Platform.OS === "web";

  const headerStyle: Record<string, any> = {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: colors.surface2,
    borderRadius: 6,
    marginBottom: 4,
  };

  if (isWeb) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={`${title} swimlane, ${count} issues${collapsed ? ", collapsed" : ""}`}
        onClick={onToggle}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        data-testid={`kanban-swimlane-header-${title}`}
        style={{ ...headerStyle, cursor: "pointer" }}
      >
        <HostRow gap="xs" align="center">
          <HostStatusDot variant={tone === "accent" ? "info" : tone} />
          <Text
            style={{
              color: colors.foreground,
              fontWeight: "600",
              fontSize: 12,
            }}
          >
            {title}
          </Text>
          <HostBadge label={String(count)} variant="neutral" size="sm" />
        </HostRow>
        <Text
          style={{
            color: colors.foregroundMuted,
            fontSize: 11,
            fontWeight: "500",
          }}
        >
          {collapsed ? "▶ Expand" : "▼ Collapse"}
        </Text>
      </div>
    );
  }

  return (
    <Pressable
      testID={`kanban-swimlane-header-${title}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={`${title} swimlane, ${count} issues${collapsed ? ", collapsed" : ""}`}
      onPress={onToggle}
      style={headerStyle}
    >
      <HostRow gap="xs" align="center">
        <HostStatusDot variant={tone === "accent" ? "info" : tone} />
        <Text
          style={{
            color: colors.foreground,
            fontWeight: "600",
            fontSize: 12,
          }}
        >
          {title}
        </Text>
        <HostBadge label={String(count)} variant="neutral" size="sm" />
      </HostRow>
      <Text
        style={{
          color: colors.foregroundMuted,
          fontSize: 11,
          fontWeight: "500",
        }}
      >
        {collapsed ? "▶ Expand" : "▼ Collapse"}
      </Text>
    </Pressable>
  );
}

export interface SwimlaneRowProps {
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

export function HostSwimlaneRow({
  id,
  title,
  totalCount,
  issuesByColumn,
  columns,
  renderCard,
  collapsed,
  onToggle,
  tone = "neutral",
  dropHandlers,
}: SwimlaneRowProps) {
  const { colors } = useHostTheme();
  const isWeb = Platform.OS === "web";

  // Compute per-column counts for the header badge
  const columnCounts = useMemo(() => {
    const counts: Record<KanbanColumnId, number> = {} as Record<KanbanColumnId, number>;
    for (const col of columns) {
      counts[col.id] = (issuesByColumn[col.id] ?? []).length;
    }
    return counts;
  }, [issuesByColumn, columns]);

  const visibleColumns = useMemo(() => {
    if (collapsed) return columns.filter((col) => columnCounts[col.id] === 0);
    return columns;
  }, [columns, columnCounts, collapsed]);

  if (isWeb) {
    return (
      <div
        data-testid={`kanban-swimlane-row-${id}`}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <HostSwimlaneHeader
          title={title}
          count={totalCount}
          collapsed={collapsed}
          onToggle={onToggle}
          tone={tone}
        />
        {!collapsed && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              gap: 12,
              overflowX: "auto",
            }}
          >
            {visibleColumns.map((col) => {
              const colIssues = issuesByColumn[col.id] ?? [];
              const handlers = dropHandlers?.[col.id];

              const columnStyle: Record<string, any> = {
                width: 290,
                minWidth: 260,
                backgroundColor: colors.surface1,
                borderColor: colors.border,
                borderWidth: 1,
                borderStyle: "solid",
                borderRadius: 8,
                flexDirection: "column",
                flexShrink: 0,
                padding: 10,
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
                    <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                      No issues in this column
                    </Text>
                  </View>
                ) : (
                  colIssues.map((issue) => renderCard(issue, col.id))
                );

              return (
                <div
                  key={col.id}
                  data-testid={`kanban-swimlane-column-${id}-${col.id}`}
                  {...(handlers ? {
                    onDragOver: handlers.onDragOver,
                    onDragEnter: handlers.onDragEnter,
                    onDragLeave: handlers.onDragLeave,
                    onDrop: handlers.onDrop,
                  } : {})}
                  style={{ display: "flex", ...columnStyle }}
                >
                  {columnHeader}
                  <div
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
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <View
      testID={`kanban-swimlane-row-${id}`}
      style={{
        flexDirection: "column",
        gap: 4,
      }}
    >
      <HostSwimlaneHeader
        title={title}
        count={totalCount}
        collapsed={collapsed}
        onToggle={onToggle}
        tone={tone}
      />
      {!collapsed && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={true}
          contentContainerStyle={{
            flexDirection: "row",
            gap: 12,
            paddingBottom: 16,
          }}
        >
          {visibleColumns.map((col) => {
            const colIssues = issuesByColumn[col.id] ?? [];
            const handlers = dropHandlers?.[col.id];

            const columnStyle: Record<string, any> = {
              width: 290,
              minWidth: 260,
              backgroundColor: colors.surface1,
              borderColor: colors.border,
              borderWidth: 1,
              borderStyle: "solid",
              borderRadius: 8,
              flexDirection: "column",
              flexShrink: 0,
              padding: 10,
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
                  <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                    No issues in this column
                  </Text>
                </View>
              ) : (
                colIssues.map((issue) => renderCard(issue, col.id))
              );

            return (
              <View
                key={col.id}
                testID={`kanban-swimlane-column-${id}-${col.id}`}
                style={columnStyle}
                {...(handlers ? {
                  onDragOver: handlers.onDragOver,
                  onDragEnter: handlers.onDragEnter,
                  onDragLeave: handlers.onDragLeave,
                  onDrop: handlers.onDrop,
                } : {})}
              >
                {columnHeader}
                <ScrollView
                  showsVerticalScrollIndicator={true}
                  style={{ flex: 1, maxHeight: 600 }}
                >
                  {columnCards}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
