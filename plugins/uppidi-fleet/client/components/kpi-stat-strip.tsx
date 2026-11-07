import React, { useState } from "react";
import {
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Badge, InteractiveRow, StatusDot } from "../host-ui.js";
import { useFleetTheme } from "../theme.js";
import type { UppidiAgent } from "../../shared/contracts.js";
import {
  agentRequiresAttention,
  isBlockedLifecycleState,
  resolveAgentLifecycleState,
} from "../../shared/contracts.js";
import { filterBulkArchiveCandidates } from "../../shared/sort-filter.js";

/** Terminal status set across agent life-cycles. */
export const TERMINAL_STATUSES = new Set([
  "closed",
  "done",
  "failed",
  "cancelled",
  "completed",
  "terminated",
  "archived",
]);

/**
 * Returns true if the agent status represents a closed, completed, or failed state.
 */
export function isTerminalAgentStatus(status?: string | null): boolean {
  if (!status) return false;
  return TERMINAL_STATUSES.has(status.toLowerCase().trim());
}

/**
 * Checks if a given timestamp falls on the same calendar day as the reference date.
 */
export function isSameLocalDay(
  dateStr?: string | null,
  reference: Date | number = new Date()
): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const now = reference instanceof Date ? reference : new Date(reference);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * Checks if an agent has finished within the last 24 hours or during the current calendar day.
 */
export function isCompletedRecently(
  agent: {
    lastActivityAt?: string | null;
    updatedAt?: string | null;
    created?: string | null;
  },
  reference: Date | number = new Date()
): boolean {
  const ref = reference instanceof Date ? reference : new Date(reference);
  const nowMs = ref.getTime();
  const timestamps = [agent.lastActivityAt, agent.updatedAt, agent.created].filter(
    Boolean
  ) as string[];
  if (timestamps.length === 0) return false;

  for (const ts of timestamps) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) continue;
    if (isSameLocalDay(ts, ref)) return true;
    const diff = nowMs - d.getTime();
    if (diff >= 0 && diff <= 24 * 60 * 60 * 1000) return true;
  }
  return false;
}

export interface KpiStats {
  activeCount: number;
  blockedCount: number;
  completedToday: number;
  queueDepth: number;
}

export interface CalculateKpiStatsOptions {
  queueDepth?: number;
  totalQueued?: number;
  repoQueuedHooks?: Record<string, number>;
  now?: Date | number;
}

/**
 * Computes executive KPI summary metrics across the fleet roster.
 */
export function calculateKpiStats(
  agents: UppidiAgent[] = [],
  options?: CalculateKpiStatsOptions
): KpiStats {
  const list = Array.isArray(agents) ? agents.filter(Boolean) : [];
  const ref = options?.now ?? new Date();

  let activeCount = 0;
  let blockedCount = 0;
  let completedToday = 0;

  for (const a of list) {
    const detState = String(a.deterministicState ?? "");
    const status = String(a.status ?? "").toLowerCase();
    const lifecycle = resolveAgentLifecycleState(a);

    // 1. Check if terminal agent completed recently (today / within 24h)
    const isTerminal = isTerminalAgentStatus(status);
    if (isTerminal && isCompletedRecently(a, ref)) {
      completedToday++;
      continue;
    }

    // 2. Check if agent is blocked, paused, failed, or waiting for attention
    const isBlocked =
      a.isPaused === true ||
      agentRequiresAttention(a) ||
      (a.pendingPermissions && a.pendingPermissions.length > 0) ||
      (a.requiresAttention === true && a.attentionReason !== "finished") ||
      isBlockedLifecycleState(lifecycle) ||
      detState === "attention-required" ||
      detState === "permission-prompt" ||
      detState.startsWith("failed") ||
      detState.startsWith("idle") ||
      detState === "sleeping" ||
      status === "paused" ||
      status === "blocked" ||
      status === "error" ||
      status === "waiting";

    if (isBlocked) {
      blockedCount++;
      continue;
    }

    // 3. Check if agent is actively running or thinking
    const isActive =
      detState === "working" ||
      detState === "running" ||
      lifecycle === "running" ||
      status === "running" ||
      status === "thinking";

    if (isActive) {
      activeCount++;
    }
  }

  let queueDepth = 0;
  if (typeof options?.queueDepth === "number") {
    queueDepth = options.queueDepth;
  } else if (typeof options?.totalQueued === "number") {
    queueDepth = options.totalQueued;
  } else if (options?.repoQueuedHooks) {
    queueDepth = Object.values(options.repoQueuedHooks).reduce(
      (sum, n) => sum + (n || 0),
      0
    );
  }

  return {
    activeCount,
    blockedCount,
    completedToday,
    queueDepth,
  };
}

/**
 * Predicate to evaluate whether an agent matches the active KPI filter.
 */
export function matchesKpiFilter(agent: UppidiAgent, filter: string): boolean {
  if (!filter || filter === "all") return true;
  if (!agent) return false;

  const detState = String(agent.deterministicState ?? "");
  const status = String(agent.status ?? "").toLowerCase();
  const lifecycle = resolveAgentLifecycleState(agent);

  if (filter === "active") {
    if (isTerminalAgentStatus(status)) return false;
    return (
      detState === "working" ||
      detState === "running" ||
      lifecycle === "running" ||
      status === "running" ||
      status === "thinking"
    );
  }

  if (filter === "blocked" || filter === "attention") {
    if (isTerminalAgentStatus(status)) return false;
    return (
      agent.isPaused === true ||
      agentRequiresAttention(agent) ||
      (agent.pendingPermissions && agent.pendingPermissions.length > 0) ||
      (agent.requiresAttention === true && agent.attentionReason !== "finished") ||
      isBlockedLifecycleState(lifecycle) ||
      detState === "attention-required" ||
      detState === "permission-prompt" ||
      detState.startsWith("failed") ||
      detState.startsWith("idle") ||
      detState === "sleeping" ||
      status === "paused" ||
      status === "blocked" ||
      status === "error" ||
      status === "waiting"
    );
  }

  if (filter === "completed") {
    return (
      isTerminalAgentStatus(status) ||
      lifecycle === "completed" ||
      filterBulkArchiveCandidates([agent]).length > 0
    );
  }

  if (filter === "queue") {
    return (agent.queuedHooksCount ?? 0) > 0;
  }

  return true;
}

export interface KpiStatTileProps {
  label: string;
  value: number | string;
  sublabel?: string;
  tone?: "success" | "warning" | "neutral" | "info" | "danger";
  icon?: string;
  live?: boolean;
  active?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Single live metric tile with status indicator, numeric count, and badge.
 */
export function KpiStatTile({
  label,
  value,
  sublabel,
  tone = "neutral",
  icon,
  live = false,
  active = false,
  onPress,
  style,
  testID,
}: KpiStatTileProps) {
  const { colors, alpha, getStatusColor, typography } = useFleetTheme();
  const [hovered, setHovered] = useState(false);

  const statusColor = tone === "neutral" ? colors.foreground : getStatusColor(tone);
  const accentColor = tone === "neutral" ? colors.foregroundMuted : getStatusColor(tone);
  const interactive = typeof onPress === "function";

  const containerStyle: StyleProp<ViewStyle> = [
    styles.tile,
    {
      borderColor: active
        ? statusColor
        : hovered && interactive
          ? alpha(statusColor, 0.45)
          : colors.border,
      backgroundColor: active
        ? alpha(statusColor, 0.12)
        : hovered && interactive
          ? colors.surface1
          : colors.surface0,
    },
    style,
  ];

  const content = (
    <View style={styles.tileContent}>
      <View style={styles.tileHeader}>
        <View style={styles.tileTitleRow}>
          {live ? (
            <StatusDot variant={tone === "neutral" ? "success" : tone} pulse />
          ) : icon ? (
            <Icon name={icon} size={13} color={accentColor} />
          ) : (
            <View style={[styles.dot, { backgroundColor: accentColor }]} />
          )}
          <Text
            numberOfLines={1}
            style={[
              typography.caption,
              styles.tileLabel,
              { color: colors.foregroundMuted },
            ]}
          >
            {label}
          </Text>
        </View>
        <Badge
          label={String(value)}
          variant={tone}
          size="sm"
          styleVariant={active ? "solid" : "tinted"}
        />
      </View>

      <View style={styles.tileValueRow}>
        <Text
          numberOfLines={1}
          style={[
            typography.heading,
            styles.tileValueText,
            { color: value === 0 ? colors.foregroundMuted : colors.foreground },
          ]}
        >
          {value}
        </Text>
        {active ? (
          <View style={styles.activeFilterPill}>
            <Icon name="Filter" size={10} color={statusColor} />
            <Text
              style={[
                typography.caption,
                { color: statusColor, fontSize: 9, fontWeight: "600" },
              ]}
            >
              FILTERED
            </Text>
          </View>
        ) : null}
      </View>

      {sublabel ? (
        <Text
          numberOfLines={1}
          style={[
            typography.caption,
            styles.tileSublabel,
            { color: colors.foregroundMuted },
          ]}
        >
          {sublabel}
        </Text>
      ) : null}
    </View>
  );

  if (!interactive) {
    return (
      <View testID={testID} style={containerStyle}>
        {content}
      </View>
    );
  }

  return (
    <InteractiveRow
      testID={testID}
      onPress={onPress}
      onHoverChange={setHovered}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}${active ? " (active filter, click to clear)" : " (click to filter)"}`}
      style={containerStyle}
      pressedOpacity={0.75}
    >
      {content}
    </InteractiveRow>
  );
}

export interface KpiStatStripProps {
  stats?: KpiStats;
  activeCount?: number;
  blockedCount?: number;
  completedToday?: number;
  queueDepth?: number;
  activeFilter?: string | null;
  onFilterChange?: (filterId: string) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Executive KPI stat strip with 4 responsive live metric tiles:
 * - Active Agents
 * - Blocked / Waiting
 * - Completed Today
 * - Queue Depth
 *
 * Clicking a tile applies an instant filter to the roster below.
 * Clicking the active tile toggles the filter back to "all".
 */
export function KpiStatStrip({
  stats,
  activeCount: propActiveCount,
  blockedCount: propBlockedCount,
  completedToday: propCompletedToday,
  queueDepth: propQueueDepth,
  activeFilter = "all",
  onFilterChange,
  style,
  testID = "kpi-stat-strip",
}: KpiStatStripProps) {
  const activeVal = stats?.activeCount ?? propActiveCount ?? 0;
  const blockedVal = stats?.blockedCount ?? propBlockedCount ?? 0;
  const completedVal = stats?.completedToday ?? propCompletedToday ?? 0;
  const queueVal = stats?.queueDepth ?? propQueueDepth ?? 0;

  const handleToggle = (id: string) => {
    if (!onFilterChange) return;
    if (activeFilter === id) {
      onFilterChange("all");
    } else {
      onFilterChange(id);
    }
  };

  return (
    <View testID={testID} style={[styles.stripContainer, style]}>
      <KpiStatTile
        testID="kpi-tile-active"
        label="Active Agents"
        value={activeVal}
        sublabel="working now"
        tone="success"
        live
        active={activeFilter === "active"}
        onPress={() => handleToggle("active")}
      />
      <KpiStatTile
        testID="kpi-tile-blocked"
        label="Blocked / Waiting"
        value={blockedVal}
        sublabel="need attention"
        tone="warning"
        icon="AlertTriangle"
        active={activeFilter === "blocked" || activeFilter === "attention"}
        onPress={() => handleToggle("blocked")}
      />
      <KpiStatTile
        testID="kpi-tile-completed"
        label="Completed Today"
        value={completedVal}
        sublabel="last 24 hours"
        tone="neutral"
        icon="CheckCircle2"
        active={activeFilter === "completed"}
        onPress={() => handleToggle("completed")}
      />
      <KpiStatTile
        testID="kpi-tile-queue"
        label="Queue Depth"
        value={queueVal}
        sublabel="queued hooks"
        tone="info"
        icon="Layers"
        active={activeFilter === "queue"}
        onPress={() => handleToggle("queue")}
      />
    </View>
  );
}

const styles: {
  stripContainer: ViewStyle;
  tile: ViewStyle;
  tileContent: ViewStyle;
  tileHeader: ViewStyle;
  tileTitleRow: ViewStyle;
  tileLabel: TextStyle;
  dot: ViewStyle;
  tileValueRow: ViewStyle;
  tileValueText: TextStyle;
  activeFilterPill: ViewStyle;
  tileSublabel: TextStyle;
} = {
  stripContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  tile: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 120,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: "hidden",
  },
  tileContent: {
    width: "100%",
  },
  tileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  tileTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
  },
  tileLabel: {
    fontWeight: "700",
    textTransform: "uppercase",
    fontSize: 10,
    letterSpacing: 0.6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tileValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 4,
    gap: 6,
  },
  tileValueText: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800",
  },
  activeFilterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  tileSublabel: {
    fontSize: 10,
    marginTop: 2,
  },
};
