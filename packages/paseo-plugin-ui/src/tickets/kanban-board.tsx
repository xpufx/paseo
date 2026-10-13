import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import {
  KANBAN_COLUMNS,
  getIssueKanbanColumn,
  isBackwardKanbanTransition,
  isRepoMatching,
  AUTOMATION_TIER_META,
  DEFAULT_REPO_GROUP,
  DEFAULT_REPO_GROUP_ID,
  nextAutomationTier,
  repoGroupMatches,
  type KanbanColumnId,
  type KanbanColumnDef,
  type RepoGroup,
  type AutomationTier,
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
import { HostIssueDetailDrawer } from "./issue-detail-drawer.js";
import {
  getKanbanKeydownTarget,
  isEditableKeyboardTarget,
  resolveKanbanKeyboardIntent,
  type KanbanKeyboardEventLike,
} from "./kanban-keyboard.js";
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
  selectedIssueNumber,
  onSelectedIssueNumberChange,
  onOpenIssueDetail,
  issueDetail = null,
  detailDrawer = true,
  onToggleChecklistItem,
  onSubmitComment,
  onSelectLabel,
  activeStateLabel = null,
  repoGroups,
  selectedRepoGroup,
  onSelectRepoGroup,
  automationTiers,
  onToggleAutomationTier,
  onBackwardTransition,
}: KanbanBoardProps) {
  const { colors } = useHostTheme();
  const [internalQuery, setInternalQuery] = useState("");
  const [transitioningIssueId, setTransitioningIssueId] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumnId | null>(null);
  const [internalSelected, setInternalSelected] = useState<number | null>(null);
  const [drawerIssueNumber, setDrawerIssueNumber] = useState<number | null>(null);
  const [internalRepoGroup, setInternalRepoGroup] = useState<string>(DEFAULT_REPO_GROUP_ID);
  const isWeb = Platform.OS === "web";
  const isSelectionControlled = selectedIssueNumber !== undefined;
  const activeSelected = isSelectionControlled ? selectedIssueNumber ?? null : internalSelected;

  const query = externalFilterQuery !== undefined ? externalFilterQuery : internalQuery;
  const setQuery = onFilterQueryChange ?? setInternalQuery;
  const isGroupControlled = selectedRepoGroup !== undefined;
  const activeRepoGroup = isGroupControlled ? selectedRepoGroup : internalRepoGroup;

  // Board-toolbar groups (#1282): the implicit `All` group is always first, and
  // an explicitly-defined `all` is folded into it so the pill never duplicates.
  const groupTabs = useMemo<RepoGroup[]>(() => {
    if (!repoGroups || repoGroups.length === 0) return [];
    const explicitAll = repoGroups.find((group) => group.id === DEFAULT_REPO_GROUP_ID);
    const rest = repoGroups.filter((group) => group.id !== DEFAULT_REPO_GROUP_ID);
    return [explicitAll ?? DEFAULT_REPO_GROUP, ...rest];
  }, [repoGroups]);

  const setRepoGroup = useCallback(
    (groupId: string) => {
      if (!isGroupControlled) setInternalRepoGroup(groupId);
      onSelectRepoGroup?.(groupId);
    },
    [isGroupControlled, onSelectRepoGroup],
  );

  const activeGroup = useMemo(
    () => groupTabs.find((group) => group.id === activeRepoGroup) ?? null,
    [groupTabs, activeRepoGroup],
  );

  // Filter issues by search query, single repository, and repo group
  const filteredIssues = useMemo(() => {
    let list = Array.isArray(issues) ? issues : [];
    if (selectedRepo && selectedRepo !== "all") {
      list = list.filter((i) => isRepoMatching(i.repo, selectedRepo));
    }
    if (activeGroup && activeGroup.id !== DEFAULT_REPO_GROUP_ID) {
      list = list.filter((i) => repoGroupMatches(activeGroup, i.repo));
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
  }, [issues, selectedRepo, activeGroup, query]);

  // Repos surfaced for tier pills: the group-filtered board plus any repo the
  // host configured a tier for, sorted for a stable render order.
  const tierRepos = useMemo(() => {
    if (!automationTiers) return [];
    const repos = new Set<string>();
    for (const issue of filteredIssues) {
      if (issue.repo) repos.add(issue.repo);
    }
    for (const repo of Object.keys(automationTiers)) {
      if (repo) repos.add(repo);
    }
    return Array.from(repos).sort((a, b) => a.localeCompare(b));
  }, [automationTiers, filteredIssues]);

  const handleToggleAutomationTier = useCallback(
    (repo: string) => {
      if (!onToggleAutomationTier) return;
      const current = automationTiers?.[repo] ?? "full-active";
      void onToggleAutomationTier(repo, nextAutomationTier(current));
    },
    [automationTiers, onToggleAutomationTier],
  );

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

  const orderedIssues = useMemo(
    () => columns.flatMap((col) => issuesByColumn[col.id] ?? []),
    [columns, issuesByColumn],
  );

  const setSelectedIssue = useCallback(
    (value: number | null) => {
      if (!isSelectionControlled) setInternalSelected(value);
      onSelectedIssueNumberChange?.(value);
    },
    [isSelectionControlled, onSelectedIssueNumberChange],
  );

  const handleTransition = useCallback(
    async (issue: KanbanIssue, targetState: KanbanColumnId) => {
      if (!onTransitionIssue) return;
      const fromState = getIssueKanbanColumn(issue);
      setTransitioningIssueId(issue.number);
      try {
        await onTransitionIssue(issue, targetState);
        if (isBackwardKanbanTransition(fromState, targetState)) {
          await onBackwardTransition?.(issue, fromState, targetState);
        }
      } finally {
        setTransitioningIssueId(null);
      }
    },
    [onTransitionIssue, onBackwardTransition],
  );

  const selectByOffset = useCallback(
    (offset: number) => {
      if (orderedIssues.length === 0) return;
      const currentIndex =
        activeSelected === null
          ? -1
          : orderedIssues.findIndex((issue) => issue.number === activeSelected);
      const nextIndex =
        currentIndex < 0
          ? offset > 0
            ? 0
            : orderedIssues.length - 1
          : (currentIndex + offset + orderedIssues.length) % orderedIssues.length;
      setSelectedIssue(orderedIssues[nextIndex].number);
    },
    [orderedIssues, activeSelected, setSelectedIssue],
  );

  const handleSelectCard = useCallback(
    (issueNumber: number) => {
      setSelectedIssue(issueNumber);
      onSelectIssue?.(issueNumber);
    },
    [setSelectedIssue, onSelectIssue],
  );

  const openIssueDetail = useCallback(
    (issueNumber: number) => {
      setSelectedIssue(issueNumber);
      onSelectIssue?.(issueNumber);
      if (onOpenIssueDetail) {
        onOpenIssueDetail(issueNumber);
        return;
      }
      if (detailDrawer !== false) setDrawerIssueNumber(issueNumber);
    },
    [setSelectedIssue, onSelectIssue, onOpenIssueDetail, detailDrawer],
  );

  const closeIssueDetail = useCallback(() => setDrawerIssueNumber(null), []);

  const drawerIssue = useMemo(
    () => issues.find((issue) => issue.number === drawerIssueNumber) ?? null,
    [issues, drawerIssueNumber],
  );

  useEffect(() => {
    if (!isWeb) return;
    const keydownTarget = getKanbanKeydownTarget();
    if (!keydownTarget) return;
    const handleKeyDown = (event: KanbanKeyboardEventLike) => {
      if (isEditableKeyboardTarget(event?.target)) return;
      const intent = resolveKanbanKeyboardIntent(String(event?.key ?? ""), columns.length);
      if (intent.type === "none") return;
      event.preventDefault?.();
      if (intent.type === "close") {
        closeIssueDetail();
        return;
      }
      if (activeSelected === null) {
        if (intent.type === "select-next") selectByOffset(1);
        else if (intent.type === "select-prev") selectByOffset(-1);
        return;
      }
      switch (intent.type) {
        case "select-next":
          selectByOffset(1);
          break;
        case "select-prev":
          selectByOffset(-1);
          break;
        case "open":
          openIssueDetail(activeSelected);
          break;
        case "move": {
          const target = columns[intent.columnIndex ?? -1];
          const issue = issues.find((candidate) => candidate.number === activeSelected);
          if (
            target &&
            issue &&
            getIssueKanbanColumn(issue) !== target.id
          ) {
            void handleTransition(issue, target.id);
          }
          break;
        }
        default:
          break;
      }
    };
    keydownTarget.addEventListener("keydown", handleKeyDown);
    return () => keydownTarget.removeEventListener("keydown", handleKeyDown);
  }, [
    isWeb,
    columns,
    issues,
    activeSelected,
    selectByOffset,
    openIssueDetail,
    closeIssueDetail,
    handleTransition,
  ]);

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

      {/* Repo groups & 3-tier automation controls (#1282) */}
      {groupTabs.length > 0 || tierRepos.length > 0 ? (
        <View
          testID="kanban-board-controls"
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          {groupTabs.length > 0 ? (
            <HostRow gap="xs" align="center" wrap testID="kanban-repo-groups">
              {groupTabs.map((group) => {
                const isActive = group.id === activeRepoGroup;
                return (
                  <Pressable
                    key={group.id}
                    testID={`kanban-repo-group-${group.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={`Repository group ${group.name}`}
                    onPress={() => setRepoGroup(group.id)}
                    style={{
                      backgroundColor: isActive ? colors.accent : colors.surface1,
                      borderColor: isActive ? colors.accent : colors.border,
                      borderWidth: 1,
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: isActive ? colors.accentForeground : colors.foregroundMuted,
                        fontSize: 11,
                        fontWeight: isActive ? "700" : "500",
                      }}
                    >
                      {group.name}
                    </Text>
                  </Pressable>
                );
              })}
            </HostRow>
          ) : null}

          {tierRepos.length > 0 ? (
            <HostRow gap="xs" align="center" wrap testID="kanban-automation-tiers">
              {tierRepos.map((repo) => {
                const tier = automationTiers?.[repo] ?? "full-active";
                const meta = AUTOMATION_TIER_META[tier];
                return (
                  <Pressable
                    key={repo}
                    testID={`kanban-automation-tier-${repo}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${repo} automation tier ${meta.label}`}
                    onPress={() => handleToggleAutomationTier(repo)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      backgroundColor: colors.surface1,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }}
                  >
                    <HostStatusDot variant={meta.tone} />
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11 }}>
                      {repo}
                    </Text>
                    <HostBadge label={meta.label} variant={meta.tone} size="sm" />
                  </Pressable>
                );
              })}
            </HostRow>
          ) : null}
        </View>
      ) : null}

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
                  onSelect={handleSelectCard}
                  onTransition={handleTransition}
                  isTransitioning={transitioningIssueId === issue.number}
                  isSelected={activeSelected === issue.number}
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

      {detailDrawer !== false && !onOpenIssueDetail ? (
        <HostIssueDetailDrawer
          visible={drawerIssue !== null}
          issue={drawerIssue}
          detail={issueDetail ?? null}
          onClose={closeIssueDetail}
          activeStateLabel={activeStateLabel}
          onSelectLabel={onSelectLabel}
          onToggleChecklistItem={onToggleChecklistItem}
          onSubmitComment={onSubmitComment}
        />
      ) : null}
    </View>
  );
}

export { HostKanbanBoard as KanbanBoard };
