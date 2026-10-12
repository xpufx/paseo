import React, { useState } from "react";
import { Platform, Text, View, type StyleProp, type ViewStyle } from "react-native";
import {
  getColumnTransitions,
  type KanbanColumnId,
} from "@xpufx/backend-tickets/client";
import {
  HostBadge,
  HostButton,
  HostInteractiveRow,
  HostRow,
  useHostTheme,
} from "../index.js";
import type { KanbanCardProps, KanbanIssue } from "./types.js";

const ATTENTION_CONFIG: Record<
  string,
  { label: string; variant: "neutral" | "info" | "warning" }
> = {
  "attention/orchestrator": { label: "Orchestrator", variant: "info" },
  "attention/agent": { label: "Agent", variant: "neutral" },
  "attention/user": { label: "You", variant: "warning" },
  "attention/0-orchestrator": { label: "Orchestrator", variant: "info" },
  "attention/1-agent": { label: "Agent", variant: "neutral" },
  "attention/2-user": { label: "You", variant: "warning" },
};

let activeDraggingIssue: KanbanIssue | null = null;

export function getActiveDraggingIssue(): KanbanIssue | null {
  return activeDraggingIssue;
}

export function setActiveDraggingIssue(issue: KanbanIssue | null): void {
  activeDraggingIssue = issue;
  if (typeof globalThis !== "undefined") {
    (globalThis as any).__paseo_dragging_issue = issue;
  }
}

export function HostKanbanCard({
  issue,
  columnId,
  onSelect,
  onTransition,
  isTransitioning = false,
  isDragging = false,
  onDragStart,
  onDragEnd,
}: KanbanCardProps) {
  const { colors } = useHostTheme();
  const transitions = getColumnTransitions(columnId);
  const attentionKey = issue.attention ?? "attention/agent";
  const attention = ATTENTION_CONFIG[attentionKey] ?? { label: "Agent", variant: "neutral" as const };
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
        console.error("[paseo-plugin-ui] kanban drag-and-drop:", err);
      }
    }
    if (e && !e.dataTransfer && e.nativeEvent?.dataTransfer) {
      try {
        e.dataTransfer = e.nativeEvent.dataTransfer;
      } catch (err) {
        console.error("[paseo-plugin-ui] kanban drag-and-drop:", err);
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
        // ignore in restricted environments
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
        <HostRow gap="xs" align="center">
          <HostInteractiveRow
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
          </HostInteractiveRow>
          {issue.repo ? <HostBadge label={issue.repo} variant="neutral" size="sm" /> : null}
        </HostRow>
        <HostBadge label={attention.label} variant={attention.variant} size="sm" />
      </View>

      {/* Title */}
      <HostInteractiveRow
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
      </HostInteractiveRow>

      {/* Meta tags (branch, comments) */}
      {(issue.branch || (issue.comments !== undefined && issue.comments > 0)) && (
        <HostRow gap="xs" align="center" wrap>
          {issue.branch && (
            <HostBadge label={issue.branch} variant="neutral" size="sm" />
          )}
          {issue.comments !== undefined && issue.comments > 0 && (
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
              💬 {issue.comments}
            </Text>
          )}
        </HostRow>
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
          <HostButton
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

export { HostKanbanCard as KanbanCard };
